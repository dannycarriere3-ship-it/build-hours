from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.demo.capability_flags import seed_capabilities
from app.models import Task, Tag, User
from app.schemas import TaskCreate
from app.services.task_service import TaskService
from app.services.workspace_service import WorkspaceService
from app.storage.base import AttachmentStore


USERS = [
    ("steve-c", "Steve C", "human", "Program Director", "SC", []),
    (
        "program-editor",
        "Program Editor Agent",
        "agent",
        "Editorial",
        "PE",
        ["Editorial"],
    ),
    (
        "asset-producer",
        "Asset Producer Agent",
        "agent",
        "Assets and publishing",
        "AP",
        ["Assets", "Accessibility", "Publishing"],
    ),
]

TAGS = [
    ("editorial", "Editorial", "lavender"),
    ("assets", "Assets", "rose"),
    ("accessibility", "Accessibility", "foam"),
    ("publishing", "Publishing", "gold"),
    ("urgent", "Urgent", "love"),
    ("brand-review", "Brand Review", "pine"),
]


def seed_reference_data(session: Session) -> None:
    import json

    for user_id, name, kind, title, initials, capabilities in USERS:
        if session.get(User, user_id) is None:
            session.add(
                User(
                    id=user_id,
                    display_name=name,
                    kind=kind,
                    title=title,
                    avatar_initials=initials,
                    capabilities_json=json.dumps(capabilities),
                )
            )
    for tag_id, name, color in TAGS:
        if session.get(Tag, tag_id) is None:
            session.add(Tag(id=tag_id, name=name, color=color))
    session.commit()
    seed_capabilities(session)


def reset_demo(
    session: Session,
    store: AttachmentStore,
    fixture_root: Path,
    *,
    state: str,
) -> list[Task]:
    if state not in {"empty", "ready_for_agent_demo"}:
        raise ValueError("Reset state must be empty or ready_for_agent_demo.")
    session.execute(delete(Task))
    session.commit()
    store.clear_all()
    if state == "empty":
        return []

    tasks = TaskService()
    files = WorkspaceService(store)
    editorial = tasks.create(
        session,
        TaskCreate(
            title="Review session copy for Priya Shah",
            description="Prepare the submitted abstract and bio for the public Summit 2026 agenda.",
            session_name="Production Readiness for Long-Running Agents",
            tag_ids=["editorial", "urgent"],
        ),
    )
    asset = tasks.create(
        session,
        TaskCreate(
            title="Produce agenda page preview for Priya Shah",
            description="Prepare publishable agenda-page assets from the speaker submission.",
            session_name="Production Readiness for Long-Running Agents",
            tag_ids=["assets", "accessibility", "publishing"],
        ),
    )
    for fixture in (fixture_root / "editorial-task").iterdir():
        if fixture.is_file():
            files.copy_fixture(session, editorial, fixture)
    for fixture in (fixture_root / "asset-task").rglob("*"):
        if fixture.is_file():
            files.copy_fixture(
                session,
                asset,
                fixture,
                relative_name=fixture.relative_to(
                    fixture_root / "asset-task"
                ).as_posix(),
            )
    return tasks.list(session)
