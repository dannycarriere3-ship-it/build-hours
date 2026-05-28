from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from agents import (
    ItemHelpers,
    MessageOutputItem,
    RunConfig,
    RunItemStreamEvent,
    RunState,
    Runner,
    ToolCallItem,
    ToolCallOutputItem,
)
from agents.sandbox import Manifest, SandboxRunConfig
from agents.sandbox.session.sandbox_session import SandboxSession
from agents.sandbox.snapshot import SnapshotBase
from fastapi import FastAPI
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db import Database
from app.agents.asset_producer import build_asset_producer
from app.agents.program_editor import build_program_editor
from app.agents.providers.base import SandboxProvider
from app.agents.providers.docker import docker_provider
from app.agents.providers.modal import modal_provider
from app.agents.tools import BoardToolContext
from app.config import Settings
from app.models import AgentRun, Task
from app.schemas import TaskPatch
from app.services.activity_service import ActivityService
from app.services.task_change_bus import TaskChangeBus
from app.services.task_service import TaskService
from app.services.workspace_service import WorkspaceService
from app.statuses import TaskStatus
from app.storage.base import AttachmentStore
from app.storage.manifest import task_workspace_manifest
from app.storage.r2 import R2AttachmentStore


logger = logging.getLogger(__name__)
MAX_CHAINED_HANDOFFS = 3


@dataclass
class PendingApproval:
    task_id: str
    run_id: str
    agent: Any
    provider: SandboxProvider
    manifest: Manifest
    snapshot: SnapshotBase | None
    state: RunState[BoardToolContext]


@dataclass(frozen=True)
class RunOutcome:
    task: Task
    completed_agent_id: str | None = None


async def start_task_run(
    task_id: str,
    *,
    session: Session,
    tasks: TaskService,
    workspaces: WorkspaceService,
    store: AttachmentStore,
    settings: Settings,
    pending_approvals: dict[str, PendingApproval],
    changes: TaskChangeBus,
) -> RunOutcome:
    task = tasks.get(session, task_id)
    if any(run.status in {"running", "awaiting_approval"} for run in task.runs):
        return RunOutcome(task=task)
    agent_user_id = task.assignee_id
    if task.assignee is None or task.assignee.kind != "agent" or agent_user_id is None:
        raise HTTPException(
            status_code=409,
            detail="Assign this task to an agent before starting a run.",
        )
    try:
        manifest = task_workspace_manifest(task, store, settings)
        agent, provider, workspace_backend = _execution_for_assignee(
            agent_user_id=agent_user_id, settings=settings
        )
        if isinstance(store, R2AttachmentStore):
            workspace_backend = "r2"
    except NotImplementedError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    task = tasks.update(
        session,
        task.id,
        TaskPatch(status=TaskStatus.IN_PROGRESS),
        actor_id=agent_user_id,
    )
    run = AgentRun(
        task_id=task.id,
        agent_user_id=agent_user_id,
        provider=provider.name,
        status="running",
        workspace_backend=workspace_backend,
        started_at=_now(),
    )
    session.add(run)
    ActivityService.event(
        session,
        task_id=task.id,
        event_type="agent_run_started",
        actor_id=agent_user_id,
        payload={"body": f"Started {provider.name.title()} sandbox."},
    )
    session.commit()
    changes.publish()

    pending_approvals.pop(task.id, None)
    snapshot = provider.snapshot_for_run(run.id)
    updated_task = await _continue_task_run(
        task,
        run=run,
        agent=agent,
        provider=provider,
        manifest=manifest,
        snapshot=snapshot,
        agent_input=_task_prompt(task),
        session=session,
        tasks=tasks,
        workspaces=workspaces,
        pending_approvals=pending_approvals,
        changes=changes,
    )
    return RunOutcome(
        task=updated_task,
        completed_agent_id=agent_user_id if run.status == "completed" else None,
    )


async def _continue_task_run(
    task: Task,
    *,
    run: AgentRun,
    agent: Any,
    provider: SandboxProvider,
    manifest: Manifest,
    snapshot: SnapshotBase | None,
    agent_input: str | RunState[BoardToolContext],
    session: Session,
    tasks: TaskService,
    workspaces: WorkspaceService,
    pending_approvals: dict[str, PendingApproval],
    changes: TaskChangeBus,
) -> Task:
    sandbox: SandboxSession | None = None
    try:
        sandbox = await provider.client.create(
            snapshot=snapshot,
            manifest=manifest,
            options=provider.options,
        )
        await sandbox.start()
        run_context = (
            None
            if isinstance(agent_input, RunState)
            else BoardToolContext(
                session=session,
                tasks=tasks,
                task_id=task.id,
                agent_user_id=run.agent_user_id,
                publish_change=changes.publish,
            )
        )
        result = Runner.run_streamed(
            agent,
            agent_input,
            context=run_context,
            max_turns=None,
            run_config=RunConfig(
                workflow_name="Conference Launch Desk",
                sandbox=SandboxRunConfig(session=sandbox),
            ),
        )
        async for event in result.stream_events():
            output = _stream_output(event)
            if output is not None:
                kind, body = output
                ActivityService.event(
                    session,
                    task_id=task.id,
                    event_type="agent_output",
                    actor_id=run.agent_user_id,
                    payload={"kind": kind, "body": body},
                )
                session.commit()
                changes.publish()
        await _import_generated_files(
            sandbox, session, task, workspaces, actor_id=run.agent_user_id
        )
        changes.publish()
        if result.interruptions:
            run.status = "awaiting_approval"
            pending_approvals[task.id] = PendingApproval(
                task_id=task.id,
                run_id=run.id,
                agent=agent,
                provider=provider,
                manifest=manifest,
                snapshot=snapshot,
                state=result.to_state(),
            )
            ActivityService.event(
                session,
                task_id=task.id,
                event_type="agent_approval_requested",
                actor_id=run.agent_user_id,
                payload={"body": "Requested approval to mark this task Done."},
            )
            session.commit()
            changes.publish()
            session.expire_all()
            return tasks.get(session, task.id)
        final_message = (
            str(result.final_output).strip()
            or "Completed the task without a written summary."
        )
        run.status = "completed"
        run.summary = final_message
        run.completed_at = _now()
        ActivityService.add_comment(
            session,
            task_id=task.id,
            body=final_message,
            actor_id=run.agent_user_id,
        )
        ActivityService.event(
            session,
            task_id=task.id,
            event_type="agent_run_completed",
            actor_id=run.agent_user_id,
            payload={"body": "Completed agent run and collected generated files."},
        )
        session.commit()
        changes.publish()
        pending_approvals.pop(task.id, None)
    except Exception as error:
        failure = _format_run_failure(error)
        run.status = "failed"
        run.summary = failure
        run.completed_at = _now()
        ActivityService.event(
            session,
            task_id=task.id,
            event_type="agent_run_failed",
            actor_id=run.agent_user_id,
            payload={"body": f"Run failed: {_truncate_output(failure)}"},
        )
        session.commit()
        changes.publish()
        pending_approvals.pop(task.id, None)
        raise
    finally:
        if sandbox is not None:
            await sandbox.aclose()
            await provider.client.delete(sandbox)

    session.expire_all()
    return tasks.get(session, task.id)


async def run_assigned_task_in_background(app: FastAPI, task_id: str) -> None:
    database: Database = app.state.database
    store: AttachmentStore = app.state.attachment_store
    with database.session_factory() as session:
        tasks = TaskService()
        handoff_count = 0
        while True:
            try:
                outcome = await start_task_run(
                    task_id,
                    session=session,
                    tasks=tasks,
                    workspaces=WorkspaceService(store),
                    store=store,
                    settings=app.state.settings,
                    pending_approvals=app.state.pending_approvals,
                    changes=app.state.task_changes,
                )
            except HTTPException:
                # A staged agent can be assigned before its demo implementation is revealed.
                return
            except Exception:
                # Runs that begin record their own failure in the task output feed.
                logger.exception("Background agent run failed for task %s.", task_id)
                return

            next_agent_id = _next_handoff_agent_id(outcome)
            if next_agent_id is None:
                return
            if handoff_count >= MAX_CHAINED_HANDOFFS:
                ActivityService.event(
                    session,
                    task_id=task_id,
                    event_type="agent_handoff_paused",
                    actor_id=outcome.completed_agent_id,
                    payload={
                        "body": (
                            "Automatic agent handoff paused after "
                            f"{MAX_CHAINED_HANDOFFS} chained runs."
                        )
                    },
                )
                session.commit()
                app.state.task_changes.publish()
                return
            handoff_count += 1


async def resume_task_run_in_background(
    app: FastAPI, pending: PendingApproval, *, approved: bool
) -> None:
    database: Database = app.state.database
    store: AttachmentStore = app.state.attachment_store
    with database.session_factory() as session:
        tasks = TaskService()
        task = tasks.get(session, pending.task_id)
        run = session.get(AgentRun, pending.run_id)
        if run is None:
            return
        try:
            context = BoardToolContext(
                session=session,
                tasks=tasks,
                task_id=task.id,
                agent_user_id=run.agent_user_id,
                publish_change=app.state.task_changes.publish,
            )
            if pending.state._context is None:
                raise RuntimeError("Pending run has no approval context.")
            pending.state._context.context = context
            interruption = pending.state.get_interruptions()[0]
            if approved:
                pending.state.approve(interruption)
            else:
                pending.state.reject(
                    interruption,
                    rejection_message=(
                        "Steve C declined marking this task Done. Leave it in a "
                        "reviewable state and explain any remaining work."
                    ),
                )
            await _continue_task_run(
                task,
                run=run,
                agent=pending.agent,
                provider=pending.provider,
                manifest=pending.manifest,
                snapshot=pending.snapshot,
                agent_input=pending.state,
                session=session,
                tasks=tasks,
                workspaces=WorkspaceService(store),
                pending_approvals=app.state.pending_approvals,
                changes=app.state.task_changes,
            )
        except Exception as error:
            logger.exception(
                "Background agent approval resume failed for task %s and run %s.",
                task.id,
                run.id,
            )
            if run.status == "running":
                failure = _format_run_failure(error)
                run.status = "failed"
                run.summary = failure
                run.completed_at = _now()
                ActivityService.event(
                    session,
                    task_id=task.id,
                    event_type="agent_run_failed",
                    actor_id=run.agent_user_id,
                    payload={"body": f"Run failed: {_truncate_output(failure)}"},
                )
                session.commit()
                app.state.task_changes.publish()
            return


def _execution_for_assignee(
    *, agent_user_id: str, settings: Settings
) -> tuple[object, SandboxProvider, str]:
    if agent_user_id == "program-editor":
        agent = build_program_editor()
    elif agent_user_id == "asset-producer":
        agent = build_asset_producer()
    else:
        raise NotImplementedError(f"No runnable agent is configured for {agent_user_id}.")
    return agent, _sandbox_provider(settings), "local"


def _sandbox_provider(settings: Settings) -> SandboxProvider:
    try:
        return modal_provider(settings)
    except NotImplementedError:
        return docker_provider(settings)


async def _import_generated_files(
    sandbox: SandboxSession,
    session: Session,
    task: Task,
    workspaces: WorkspaceService,
    *,
    actor_id: str,
) -> None:
    listing = await sandbox.exec(
        "find",
        "/workspace/task/working",
        "/workspace/task/output",
        "/workspace/task/handoffs",
        "-type",
        "f",
        "-print",
        shell=False,
    )
    if not listing.ok():
        return
    for absolute_path in listing.stdout.decode("utf-8").splitlines():
        relative = (
            PurePosixPath(absolute_path).relative_to("/workspace/task").as_posix()
        )
        stream = await sandbox.read(Path(absolute_path))
        workspaces.import_generated(session, task, relative, stream, actor_id=actor_id)


def _task_prompt(task: Task) -> str:
    description = (task.description or "").strip() or "No task description provided."
    prompt = (
        f"Work on conference task {task.issue_key}.\n"
        f"Title: {task.title}\n"
        f"Description:\n{description}\n"
        f"Session: {task.session_name or 'unspecified'}.\n"
    )
    if task.comments:
        latest_comment = max(task.comments, key=lambda comment: comment.created_at)
        return prompt + (
            f"Latest task comment from {latest_comment.author.display_name}: "
            f"{latest_comment.body_markdown}"
        )
    return prompt + (
        "Follow the task description above. Review supplied files and create "
        "appropriate artifacts when the task calls for them."
    )


def _stream_output(event: object) -> tuple[str, str] | None:
    if not isinstance(event, RunItemStreamEvent):
        return None
    if event.name == "tool_called" and isinstance(event.item, ToolCallItem):
        return "command", f"Running {event.item.tool_name or 'tool'}..."
    if event.name == "tool_output" and isinstance(event.item, ToolCallOutputItem):
        output = _truncate_output(str(event.item.output)).strip()
        return ("output", output) if output else None
    if event.name == "message_output_created" and isinstance(
        event.item, MessageOutputItem
    ):
        message = _truncate_output(ItemHelpers.text_message_output(event.item)).strip()
        return ("message", message) if message else None
    return None


def _truncate_output(value: str, limit: int = 2_000) -> str:
    return value if len(value) <= limit else f"{value[:limit]}\n... output truncated"


def _format_run_failure(error: BaseException) -> str:
    details: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        message = str(current).strip()
        details.append(
            f"{type(current).__name__}: {message}" if message else type(current).__name__
        )
        current = current.__cause__ or current.__context__
    return " caused by ".join(details)


def _next_handoff_agent_id(outcome: RunOutcome) -> str | None:
    task = outcome.task
    if (
        outcome.completed_agent_id is None
        or task.assignee is None
        or task.assignee.kind != "agent"
        or task.assignee_id == outcome.completed_agent_id
    ):
        return None
    return task.assignee_id


def _now() -> datetime:
    return datetime.now(timezone.utc)
