from __future__ import annotations

import json
from datetime import datetime, timezone

from app import models
from app.schemas import (
    ActivityOut,
    AgentRunOut,
    AttachmentOut,
    CommentOut,
    TagOut,
    TaskOut,
    UserOut,
)


def _utc_timestamp(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def user_out(user: models.User) -> UserOut:
    return UserOut(
        id=user.id,
        display_name=user.display_name,
        kind=user.kind,
        title=user.title,
        avatar_initials=user.avatar_initials,
        capabilities=json.loads(user.capabilities_json),
    )


def task_out(task: models.Task) -> TaskOut:
    return TaskOut(
        id=task.id,
        issue_key=task.issue_key,
        title=task.title,
        description=task.description,
        status=task.status,
        assignee=user_out(task.assignee) if task.assignee else None,
        created_by=user_out(task.created_by),
        session_name=task.session_name,
        workspace_key=task.workspace_key,
        tags=[TagOut(id=tag.id, name=tag.name, color=tag.color) for tag in task.tags],
        attachments=[
            AttachmentOut(
                id=item.id,
                kind=item.kind,
                file_name=item.file_name,
                storage_path=item.storage_path,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                created_at=_utc_timestamp(item.created_at),
            )
            for item in sorted(task.attachments, key=lambda value: value.created_at)
        ],
        comments=[
            CommentOut(
                id=item.id,
                author=user_out(item.author),
                body_markdown=item.body_markdown,
                created_at=_utc_timestamp(item.created_at),
            )
            for item in sorted(
                task.comments, key=lambda value: value.created_at, reverse=True
            )
        ],
        activity=[
            ActivityOut(
                id=item.id,
                actor=user_out(item.actor) if item.actor else None,
                event_type=item.event_type,
                payload=json.loads(item.payload_json),
                created_at=_utc_timestamp(item.created_at),
            )
            for item in sorted(
                task.activity, key=lambda value: value.created_at, reverse=True
            )
        ],
        runs=[
            AgentRunOut(
                id=item.id,
                provider=item.provider,
                status=item.status,
                workspace_backend=item.workspace_backend,
                summary=item.summary,
                created_at=_utc_timestamp(item.created_at),
                started_at=_utc_timestamp(item.started_at),
                completed_at=_utc_timestamp(item.completed_at),
            )
            for item in sorted(
                task.runs, key=lambda value: value.created_at, reverse=True
            )
        ],
        created_at=_utc_timestamp(task.created_at),
        updated_at=_utc_timestamp(task.updated_at),
    )
