from __future__ import annotations

from sqlalchemy.orm import Session

from app.agents.program_editor import build_program_editor
from app.agents.providers.modal import modal_provider
from app.config import Settings
from app.models import DemoCapability
from app.storage.base import AttachmentStore
from app.storage.r2 import R2AttachmentStore

CAPABILITIES: dict[str, str] = {
    "docker_agent": "Program Editor and Docker sandbox are not configured.",
    "editorial_skill": "Conference editorial skill is not configured.",
    "modal": "Modal hosted execution is not configured.",
    "board_tools": "Agent workflow tools are not configured.",
    "completion_approval": "Completion approval is not configured.",
    "r2": "Task uploads use local server storage.",
}

READY_DETAILS: dict[str, str] = {
    "docker_agent": "Program Editor is ready for local Docker runs.",
    "editorial_skill": "Git-backed editorial skill is attached.",
    "modal": "Modal hosted execution is configured.",
    "board_tools": "Status, assignment, and assignee search tools are attached.",
    "completion_approval": "Moving a task to Done requires Steve C approval.",
    "r2": "Task uploads live in R2 and are mounted as agent inputs.",
}


def seed_capabilities(session: Session) -> None:
    for key, detail in CAPABILITIES.items():
        if session.get(DemoCapability, key) is None:
            session.add(DemoCapability(key=key, enabled=False, detail=detail))
    session.commit()


def list_capabilities(
    session: Session, store: AttachmentStore
) -> list[DemoCapability]:
    enabled = _detected_capabilities(Settings(), store)
    items = [session.get(DemoCapability, key) for key in CAPABILITIES]
    for item in items:
        if item is None:
            continue
        item.enabled = enabled[item.key]
        item.detail = (
            READY_DETAILS[item.key] if item.enabled else CAPABILITIES[item.key]
        )
    return [item for item in items if item is not None]


def _detected_capabilities(
    settings: Settings, store: AttachmentStore
) -> dict[str, bool]:
    try:
        agent = build_program_editor()
    except NotImplementedError:
        agent = None

    tool_names = {tool.name for tool in agent.tools} if agent is not None else set()
    update_status = (
        next((tool for tool in agent.tools if tool.name == "update_status"), None)
        if agent is not None
        else None
    )
    capability_types = (
        {capability.type for capability in agent.capabilities}
        if agent is not None
        else set()
    )
    modal_ready = _can_construct(lambda: modal_provider(settings))
    r2_ready = isinstance(store, R2AttachmentStore)
    return {
        "docker_agent": agent is not None,
        "editorial_skill": "skills" in capability_types,
        "modal": modal_ready,
        "board_tools": {
            "update_status",
            "update_assignee",
            "search_assignees",
        }.issubset(tool_names),
        "completion_approval": (
            update_status is not None and update_status.needs_approval is not False
        ),
        "r2": r2_ready,
    }


def _can_construct(factory) -> bool:
    try:
        factory()
    except (ImportError, ModuleNotFoundError, NotImplementedError):
        return False
    return True
