from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.models import AgentRun, Task


def test_health_exposes_stable_server_instance_id(client: TestClient) -> None:
    first = client.get("/api/health").json()
    second = client.get("/api/health").json()

    assert first["status"] == "ok"
    assert first["instance_id"]
    assert second["instance_id"] == first["instance_id"]


def test_board_starts_empty_with_manual_reference_data(client: TestClient) -> None:
    assert client.get("/api/tasks").json() == []
    assert client.get("/api/me").json()["display_name"] == "Steve C"
    assert len(client.get("/api/tags").json()) == 6
    assert {item["id"] for item in client.get("/api/assignees").json()} == {
        "asset-producer",
        "program-editor",
        "steve-c",
    }


def test_manual_task_workflow_persists_changes_and_file(client: TestClient) -> None:
    task = client.post(
        "/api/tasks",
        json={
            "title": "Review session abstract",
            "description": "Check copy.",
            "tag_ids": ["editorial"],
            "session_name": "Production Readiness",
        },
    ).json()
    task_id = task["id"]

    response = client.post(
        f"/api/tasks/{task_id}/attachments",
        files={"file": ("abstract.md", b"# Draft\n", "text/markdown")},
        data={"kind": "input"},
    )
    assert response.status_code == 200
    assert (
        response.json()["attachments"][0]["storage_path"]
        == "input/original/abstract.md"
    )

    client.post(
        f"/api/tasks/{task_id}/comments",
        json={"body_markdown": "I will review this before it goes public."},
    )
    updated = client.patch(
        f"/api/tasks/{task_id}",
        json={"status": "ready_for_review", "assignee_id": "steve-c"},
    ).json()

    assert updated["status"] == "ready_for_review"
    assert updated["assignee"]["display_name"] == "Steve C"
    assert updated["comments"][0]["author"]["id"] == "steve-c"
    assert {"comment_added", "status_changed", "assignee_changed"}.issubset(
        {event["event_type"] for event in updated["activity"]}
    )
    activity_timestamp = updated["activity"][0]["created_at"]
    parsed_timestamp = datetime.fromisoformat(activity_timestamp.replace("Z", "+00:00"))
    assert parsed_timestamp.tzinfo is not None
    assert parsed_timestamp.utcoffset().total_seconds() == 0

    attachment_id = updated["attachments"][0]["id"]
    assert (
        client.get(f"/api/tasks/{task_id}/attachments/{attachment_id}/download").content
        == b"# Draft\n"
    )


def test_task_status_only_accepts_canonical_values(client: TestClient) -> None:
    created = client.post(
        "/api/tasks", json={"title": "Review title", "status": "Ready for Review"}
    )
    assert created.status_code == 422

    task = client.post("/api/tasks", json={"title": "Review title"}).json()
    updated = client.patch(
        f"/api/tasks/{task['id']}", json={"status": "ready for review"}
    )
    assert updated.status_code == 422
    removed = client.patch(
        f"/api/tasks/{task['id']}", json={"status": "changes_requested"}
    )
    assert removed.status_code == 422


def test_existing_changes_requested_tasks_are_migrated_to_in_progress(
    tmp_path: Path,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'desk.sqlite3'}"
    app = create_app(database_url=database_url, file_storage_root=tmp_path / "files")
    with TestClient(app) as client:
        task = client.post("/api/tasks", json={"title": "Legacy card"}).json()
        with client.app.state.database.session_factory() as session:
            session.get(Task, task["id"]).status = "changes_requested"
            session.commit()

    restarted = create_app(
        database_url=database_url, file_storage_root=tmp_path / "files"
    )
    with TestClient(restarted) as client:
        assert client.get(f"/api/tasks/{task['id']}").json()["status"] == "in_progress"


def test_composer_create_stages_attached_files_in_one_request(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/tasks",
        data={
            "payload": (
                '{"title":"Prepare abstract","description":"","tag_ids":["editorial"]}'
            )
        },
        files={"files": ("abstract.md", b"# Draft\n", "text/markdown")},
    )

    assert response.status_code == 201
    task = response.json()
    assert task["assignee"] is None
    assert task["attachments"][0]["storage_path"] == "input/original/abstract.md"
    assert task["runs"] == []


def test_clone_copies_task_and_files_without_history_or_runs(client: TestClient) -> None:
    source = client.post(
        "/api/tasks",
        json={
            "title": "Confirm final session assets",
            "description": "Check speaker card and transcript.",
            "status": "ready_for_review",
            "assignee_id": "steve-c",
            "session_name": "Production Readiness",
            "tag_ids": ["assets", "editorial"],
        },
    ).json()
    task_id = source["id"]
    client.post(
        f"/api/tasks/{task_id}/attachments",
        files={"file": ("speaker-card.png", b"fake image", "image/png")},
        data={"kind": "input"},
    )
    client.post(
        f"/api/tasks/{task_id}/attachments",
        files={"file": ("handoff.md", b"# Delivery\n", "text/markdown")},
        data={"kind": "handoff"},
    )
    client.post(
        f"/api/tasks/{task_id}/comments",
        json={"body_markdown": "Ready for an agent pass."},
    )
    with client.app.state.database.session_factory() as session:
        session.add(
            AgentRun(
                task_id=task_id,
                agent_user_id="steve-c",
                provider="docker",
                status="completed",
            )
        )
        session.commit()

    source = client.get(f"/api/tasks/{task_id}").json()
    response = client.post(f"/api/tasks/{task_id}/clone")

    assert response.status_code == 201
    cloned = response.json()
    assert cloned["id"] != source["id"]
    assert cloned["issue_key"] != source["issue_key"]
    for field in ("title", "description", "status", "assignee", "session_name", "tags"):
        assert cloned[field] == source[field]
    assert cloned["comments"] == []
    assert cloned["activity"] == []
    assert cloned["runs"] == []
    assert [
        (item["kind"], item["file_name"], item["storage_path"], item["content_type"])
        for item in cloned["attachments"]
    ] == [
        (item["kind"], item["file_name"], item["storage_path"], item["content_type"])
        for item in source["attachments"]
    ]
    downloads = {
        item["file_name"]: client.get(
            f"/api/tasks/{cloned['id']}/attachments/{item['id']}/download"
        ).content
        for item in cloned["attachments"]
    }
    assert downloads == {"speaker-card.png": b"fake image", "handoff.md": b"# Delivery\n"}
