from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.deps import get_task_change_bus
from app.services.task_change_bus import TaskChangeBus

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/tasks")
def task_events(
    changes: TaskChangeBus = Depends(get_task_change_bus),
) -> StreamingResponse:
    return StreamingResponse(
        changes.stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
