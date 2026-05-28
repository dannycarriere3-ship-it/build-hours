from __future__ import annotations

from collections.abc import Generator

from fastapi import Request
from sqlalchemy.orm import Session

from app.db import Database
from app.config import Settings
from app.services.task_service import TaskService
from app.services.task_change_bus import TaskChangeBus
from app.services.workspace_service import WorkspaceService
from app.storage.base import AttachmentStore


def get_session(request: Request) -> Generator[Session, None, None]:
    database: Database = request.app.state.database
    yield from database.session()


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> AttachmentStore:
    return request.app.state.attachment_store


def get_task_service(request: Request) -> TaskService:
    return TaskService()


def get_task_change_bus(request: Request) -> TaskChangeBus:
    return request.app.state.task_changes


def get_workspace_service(request: Request) -> WorkspaceService:
    return WorkspaceService(get_store(request))
