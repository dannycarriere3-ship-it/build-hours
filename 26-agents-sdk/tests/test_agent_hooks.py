import asyncio
from io import BytesIO

from fastapi.testclient import TestClient
from agents.sandbox import LocalSnapshot
from agents.sandbox.entries import Dir, LocalFile
from agents.sandbox.snapshot import RemoteSnapshot

from app.agents.asset_producer import build_asset_producer
from app.agents.providers.docker import docker_provider
from app.agents.providers.modal import modal_provider
from app.agents.runtime import RunOutcome, _format_run_failure, _next_handoff_agent_id, _task_prompt
from app.agents.tools import requires_completion_approval, update_status
from app.config import Settings
from app.models import Attachment, Comment, Task, User, utcnow
from app.statuses import TaskStatus
from app.storage.local import LocalAttachmentStore
from app.storage.manifest import task_workspace_manifest


def test_modal_provider_persists_snapshots_remotely() -> None:
    provider = modal_provider(Settings())

    snapshot = provider.snapshot_for_run("run-123")

    assert provider.name == "modal"
    assert isinstance(snapshot, RemoteSnapshot)
    assert snapshot.id == "run-123"
    assert snapshot.client_dependency_key == "r2_snapshots"


def test_docker_provider_persists_snapshots_locally(tmp_path) -> None:
    provider = docker_provider(Settings(local_snapshot_root=tmp_path))

    snapshot = provider.snapshot_for_run("run-123")

    assert isinstance(snapshot, LocalSnapshot)
    assert snapshot.id == "run-123"
    assert snapshot.base_path == tmp_path


def test_asset_producer_is_prepared_for_the_hosted_handoff() -> None:
    agent = build_asset_producer()

    assert agent.name == "Asset Producer"
    assert {tool.name for tool in agent.tools} == {
        "update_status",
        "update_assignee",
        "search_assignees",
    }


def test_only_done_requires_completion_approval() -> None:
    assert asyncio.run(requires_completion_approval(None, {"status": "done"}, "call-1"))
    assert not asyncio.run(
        requires_completion_approval(None, {"status": "ready_for_review"}, "call-2")
    )


def test_update_status_tool_advertises_canonical_status_values() -> None:
    assert update_status.params_json_schema["$defs"]["TaskStatus"]["enum"] == [
        status.value for status in TaskStatus
    ]


def test_run_failures_preserve_exception_types_and_chained_detail() -> None:
    cause = RuntimeError("Modal mount unavailable")
    error = AssertionError()
    error.__cause__ = cause

    assert (
        _format_run_failure(error)
        == "AssertionError caused by RuntimeError: Modal mount unavailable"
    )


def test_completed_run_hands_off_only_to_a_different_agent() -> None:
    asset_producer = User(
        id="asset-producer",
        display_name="Asset Producer Agent",
        kind="agent",
        avatar_initials="AP",
    )
    assigned_to_asset_producer = Task(assignee_id=asset_producer.id)
    assigned_to_asset_producer.assignee = asset_producer

    assert (
        _next_handoff_agent_id(
            RunOutcome(
                task=assigned_to_asset_producer,
                completed_agent_id="program-editor",
            )
        )
        == "asset-producer"
    )
    assert (
        _next_handoff_agent_id(
            RunOutcome(
                task=assigned_to_asset_producer,
                completed_agent_id="asset-producer",
            )
        )
        is None
    )


def test_handoff_prompt_identifies_an_agent_authored_comment() -> None:
    program_editor = User(
        id="program-editor",
        display_name="Program Editor Agent",
        kind="agent",
        avatar_initials="PE",
    )
    task = Task(issue_key="CLS-101", title="Prepare landing page")
    task.comments = [
        Comment(author=program_editor, body_markdown="Produce the final hero image.")
    ]

    assert (
        "Latest task comment from Program Editor Agent: Produce the final hero image."
        in _task_prompt(task)
    )


def test_new_task_prompt_includes_its_title_and_description() -> None:
    task = Task(
        issue_key="CLS-101",
        title="Test",
        description="Tell me a joke.",
        session_name="Demo",
    )
    task.comments = []

    prompt = _task_prompt(task)

    assert "Title: Test" in prompt
    assert "Description:\nTell me a joke." in prompt
    assert "Follow the task description above." in prompt


def test_task_workspace_manifest_exposes_the_common_local_contract(tmp_path) -> None:
    task = Task(workspace_key="tasks/common-contract")
    task.attachments = [
        Attachment(
            id="blob-1",
            storage_path="input/original/source.md",
            created_at=utcnow(),
        )
    ]
    store = LocalAttachmentStore(tmp_path / "files")
    store.write(task, task.attachments[0], BytesIO(b"# Source\n"))

    manifest = task_workspace_manifest(task, store, Settings())

    assert set(manifest.entries) == {"task"}
    task_entry = manifest.entries["task"]
    assert isinstance(task_entry, Dir)
    input_entry = task_entry.children["input"]
    assert isinstance(input_entry, Dir)
    original_entry = input_entry.children["original"]
    assert isinstance(original_entry, Dir)
    assert isinstance(original_entry.children["source.md"], LocalFile)


def test_there_is_no_direct_run_trigger(client: TestClient) -> None:
    task = client.post(
        "/api/tasks",
        json={"title": "Review copy", "description": "", "tag_ids": ["editorial"]},
    ).json()

    assigned = client.patch(
        f"/api/tasks/{task['id']}", json={"assignee_id": "program-editor"}
    ).json()
    assert assigned["runs"] == []

    response = client.post(f"/api/tasks/{task['id']}/runs")
    assert response.status_code == 404
