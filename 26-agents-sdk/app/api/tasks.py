from __future__ import annotations

from pathlib import Path
from typing import cast

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.datastructures import UploadFile as StarletteUploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.runtime import (
    PendingApproval,
    resume_task_run_in_background,
    run_assigned_task_in_background,
)
from app.deps import (
    get_session,
    get_task_change_bus,
    get_task_service,
    get_workspace_service,
)
from app.models import AgentRun, Attachment
from app.schemas import ApprovalDecision, CommentCreate, TaskCreate, TaskOut, TaskPatch
from app.services.activity_service import ActivityService
from app.services.serializers import task_out
from app.services.task_change_bus import TaskChangeBus
from app.services.task_service import CURRENT_USER_ID, TaskService
from app.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(
    session: Session = Depends(get_session),
    service: TaskService = Depends(get_task_service),
) -> list[TaskOut]:
    return [task_out(task) for task in service.list(session)]


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    service: TaskService = Depends(get_task_service),
    workspaces: WorkspaceService = Depends(get_workspace_service),
) -> TaskOut:
    payload, uploads = await _task_create_input(request)
    task = service.create(session, payload)
    for upload in uploads:
        workspaces.upload(session, task, upload)
    task = service.get(session, task.id)
    changes.publish()
    if task.assignee is not None and task.assignee.kind == "agent":
        background_tasks.add_task(run_assigned_task_in_background, request.app, task.id)
    return task_out(task)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: str,
    session: Session = Depends(get_session),
    service: TaskService = Depends(get_task_service),
) -> TaskOut:
    return task_out(service.get(session, task_id))


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    payload: TaskPatch,
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    service: TaskService = Depends(get_task_service),
) -> TaskOut:
    task = service.update(session, task_id, payload)
    changes.publish()
    return task_out(task)


@router.post("/{task_id}/clone", response_model=TaskOut, status_code=201)
def clone_task(
    task_id: str,
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    service: TaskService = Depends(get_task_service),
    workspaces: WorkspaceService = Depends(get_workspace_service),
) -> TaskOut:
    source = service.get(session, task_id)
    cloned = service.clone(session, source)
    workspaces.clone_attachments(session, source, cloned)
    changes.publish()
    return task_out(service.get(session, cloned.id))


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    service: TaskService = Depends(get_task_service),
) -> Response:
    service.delete(session, task_id)
    changes.publish()
    return Response(status_code=204)


@router.post("/{task_id}/comments", response_model=TaskOut)
def add_comment(
    task_id: str,
    payload: CommentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    service: TaskService = Depends(get_task_service),
) -> TaskOut:
    task = service.get(session, task_id)
    ActivityService.add_comment(
        session, task_id=task_id, body=payload.body_markdown, actor_id=CURRENT_USER_ID
    )
    session.commit()
    session.expire_all()
    task = service.get(session, task_id)
    changes.publish()
    if task.assignee is not None and task.assignee.kind == "agent":
        background_tasks.add_task(run_assigned_task_in_background, request.app, task.id)
    return task_out(task)


@router.post("/{task_id}/approval", response_model=TaskOut)
def decide_approval(
    task_id: str,
    payload: ApprovalDecision,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    service: TaskService = Depends(get_task_service),
) -> TaskOut:
    pending: PendingApproval | None = request.app.state.pending_approvals.get(task_id)
    if pending is None:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409, detail="No approval is pending for this task."
        )
    run = session.get(AgentRun, pending.run_id)
    if run is None or run.status != "awaiting_approval":
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409, detail="This approval is no longer active."
        )
    request.app.state.pending_approvals.pop(task_id, None)
    run.status = "running"
    ActivityService.event(
        session,
        task_id=task_id,
        event_type="agent_approval_resolved",
        actor_id=CURRENT_USER_ID,
        payload={
            "body": (
                "Approved completing this task."
                if payload.approved
                else "Declined completing this task."
            ),
            "approved": payload.approved,
        },
    )
    session.commit()
    changes.publish()
    background_tasks.add_task(
        resume_task_run_in_background, request.app, pending, approved=payload.approved
    )
    return task_out(service.get(session, task_id))


@router.post("/{task_id}/attachments", response_model=TaskOut)
def add_attachment(
    task_id: str,
    file: UploadFile = File(...),
    kind: str = Form("input"),
    session: Session = Depends(get_session),
    changes: TaskChangeBus = Depends(get_task_change_bus),
    tasks: TaskService = Depends(get_task_service),
    workspaces: WorkspaceService = Depends(get_workspace_service),
) -> TaskOut:
    task = tasks.get(session, task_id)
    workspaces.upload(session, task, file, kind)
    changes.publish()
    return task_out(tasks.get(session, task.id))


@router.get("/{task_id}/attachments/{attachment_id}/download")
def download_attachment(
    task_id: str,
    attachment_id: str,
    session: Session = Depends(get_session),
    tasks: TaskService = Depends(get_task_service),
    workspaces: WorkspaceService = Depends(get_workspace_service),
) -> StreamingResponse:
    task = tasks.get(session, task_id)
    attachment = session.scalar(
        select(Attachment).where(
            Attachment.id == attachment_id, Attachment.task_id == task.id
        )
    )
    if attachment is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Attachment not found.")
    return StreamingResponse(
        workspaces.attachment_stream(task, attachment),
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{Path(attachment.file_name).name}"'
            )
        },
    )


async def _task_create_input(request: Request) -> tuple[TaskCreate, list[UploadFile]]:
    try:
        if request.headers.get("content-type", "").startswith("multipart/form-data"):
            form = await request.form()
            payload = TaskCreate.model_validate_json(str(form["payload"]))
            uploads = [
                cast(UploadFile, upload)
                for upload in form.getlist("files")
                if isinstance(upload, StarletteUploadFile)
            ]
            return payload, uploads
        return TaskCreate.model_validate(await request.json()), []
    except ValidationError as error:
        raise RequestValidationError(error.errors()) from error
