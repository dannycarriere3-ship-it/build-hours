from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.statuses import TaskStatus


class UserOut(BaseModel):
    id: str
    display_name: str
    kind: str
    title: str | None
    avatar_initials: str
    capabilities: list[str]


class TagOut(BaseModel):
    id: str
    name: str
    color: str


class AttachmentOut(BaseModel):
    id: str
    kind: str
    file_name: str
    storage_path: str
    content_type: str | None
    size_bytes: int
    created_at: datetime


class CommentOut(BaseModel):
    id: str
    author: UserOut
    body_markdown: str
    created_at: datetime


class ActivityOut(BaseModel):
    id: str
    actor: UserOut | None
    event_type: str
    payload: dict[str, object]
    created_at: datetime


class AgentRunOut(BaseModel):
    id: str
    provider: str
    status: str
    workspace_backend: str
    summary: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class TaskOut(BaseModel):
    id: str
    issue_key: str
    title: str
    description: str
    status: TaskStatus
    assignee: UserOut | None
    created_by: UserOut
    session_name: str | None
    workspace_key: str
    tags: list[TagOut]
    attachments: list[AttachmentOut]
    comments: list[CommentOut]
    activity: list[ActivityOut]
    runs: list[AgentRunOut]
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    status: TaskStatus = TaskStatus.QUEUED
    assignee_id: str | None = None
    session_name: str | None = None
    tag_ids: list[str] = Field(default_factory=list)


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    status: TaskStatus | None = None
    assignee_id: str | None = None
    session_name: str | None = None
    tag_ids: list[str] | None = None


class CommentCreate(BaseModel):
    body_markdown: str = Field(min_length=1)


class ApprovalDecision(BaseModel):
    approved: bool


class CapabilityOut(BaseModel):
    key: str
    enabled: bool
    detail: str | None


class ResetRequest(BaseModel):
    state: str = "empty"
