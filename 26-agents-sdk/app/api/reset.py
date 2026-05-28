from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.deps import get_session, get_store, get_task_change_bus
from app.schemas import ResetRequest, TaskOut
from app.seed import reset_demo
from app.services.serializers import task_out
from app.services.task_change_bus import TaskChangeBus
from app.storage.base import AttachmentStore

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/reset", response_model=list[TaskOut])
def reset(
    payload: ResetRequest,
    request: Request,
    session: Session = Depends(get_session),
    store: AttachmentStore = Depends(get_store),
    changes: TaskChangeBus = Depends(get_task_change_bus),
) -> list[TaskOut]:
    try:
        tasks = reset_demo(
            session,
            store,
            request.app.state.fixture_root,
            state=payload.state,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    changes.publish()
    return [task_out(task) for task in tasks]
