from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from agents import RunContextWrapper, function_tool
from sqlalchemy.orm import Session

from app.schemas import TaskPatch
from app.services.assignee_service import AssigneeService
from app.services.task_service import TaskService
from app.statuses import TaskStatus


@dataclass
class BoardToolContext:
    session: Session
    tasks: TaskService
    task_id: str
    agent_user_id: str
    publish_change: Callable[[], None]


async def requires_completion_approval(
    _context: RunContextWrapper[BoardToolContext],
    parameters: dict[str, object],
    _call_id: str,
) -> bool:
    """Require a human decision only when an agent attempts to finish a task."""
    return parameters.get("status") == TaskStatus.DONE.value


@function_tool(
    # @STEP-05: Add `needs_approval=requires_completion_approval` to protect Done.
    needs_approval=requires_completion_approval,
)
def update_status(
    context: RunContextWrapper[BoardToolContext], status: TaskStatus
) -> str:
    """Move the current task to a new workflow status."""
    context.context.tasks.update(
        context.context.session,
        context.context.task_id,
        TaskPatch(status=status),
        actor_id=context.context.agent_user_id,
    )
    context.context.publish_change()
    return f"Task status updated to {status.value}."


@function_tool
def update_assignee(
    context: RunContextWrapper[BoardToolContext], assignee_id: str | None
) -> str:
    """Assign the current task to a known human or agent user id."""
    context.context.tasks.update(
        context.context.session,
        context.context.task_id,
        TaskPatch(assignee_id=assignee_id),
        actor_id=context.context.agent_user_id,
    )
    context.context.publish_change()
    return f"Task assigned to {assignee_id or 'unassigned'}."


@function_tool
def search_assignees(
    context: RunContextWrapper[BoardToolContext],
    query: str,
    capabilities: list[str] | None = None,
) -> list[dict[str, str]]:
    """Search possible assignees by name, title, or required capability."""
    users = AssigneeService.search(context.context.session, query, capabilities)
    return [
        {"id": user.id, "name": user.display_name, "title": user.title or ""}
        for user in users
    ]


WORKFLOW_TOOLS = [update_status, update_assignee, search_assignees]
