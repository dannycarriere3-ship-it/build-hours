from __future__ import annotations

from collections.abc import Iterator
from mimetypes import guess_type
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import Attachment, Task, new_id
from app.storage.base import AttachmentStore

from .activity_service import ActivityService
from .task_service import CURRENT_USER_ID


class WorkspaceService:
    def __init__(self, store: AttachmentStore) -> None:
        self.store = store

    def upload(
        self, session: Session, task: Task, upload: UploadFile, kind: str = "input"
    ) -> None:
        file_name = Path(upload.filename or "upload.bin").name
        workspace_path = self._path(kind, file_name)
        self._record(
            session,
            task,
            file_name,
            kind,
            workspace_path,
            upload.file,
            upload.content_type,
        )

    def copy_fixture(
        self,
        session: Session,
        task: Task,
        source: Path,
        *,
        kind: str = "input",
        relative_name: str | None = None,
    ) -> None:
        file_name = relative_name or source.name
        with source.open("rb") as stream:
            workspace_path = self._path(kind, file_name)
            content_type, _ = guess_type(file_name)
            self._record(
                session, task, file_name, kind, workspace_path, stream, content_type
            )

    def clone_attachments(self, session: Session, source: Task, target: Task) -> None:
        for attachment in sorted(source.attachments, key=lambda item: item.created_at):
            try:
                stream = self.store.open(source, attachment)
            except FileNotFoundError:
                raise HTTPException(status_code=404, detail="Attachment file not found.")
            with stream:
                self._record(
                    session,
                    target,
                    attachment.file_name,
                    attachment.kind,
                    attachment.storage_path,
                    stream,
                    attachment.content_type,
                    actor_id=attachment.uploaded_by_id,
                    record_activity=False,
                )

    def import_generated(
        self,
        session: Session,
        task: Task,
        relative_path: str,
        source: BinaryIO,
        *,
        actor_id: str,
    ) -> None:
        kind = "handoff" if relative_path.startswith("handoffs/") else "output"
        file_name = Path(relative_path).name
        existing = next(
            (
                attachment
                for attachment in task.attachments
                if attachment.storage_path == relative_path
            ),
            None,
        )
        if existing is not None:
            existing.size_bytes = self.store.write(task, existing, source)
            session.commit()
            return
        self._record(
            session,
            task,
            file_name,
            kind,
            relative_path,
            source,
            None,
            actor_id=actor_id,
        )

    def attachment_stream(self, task: Task, attachment: Attachment) -> Iterator[bytes]:
        try:
            source = self.store.open(task, attachment)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Attachment file not found.")
        return self._chunks(source)

    @staticmethod
    def _chunks(source: BinaryIO) -> Iterator[bytes]:
        try:
            while chunk := source.read(1024 * 1024):
                yield chunk
        finally:
            source.close()

    @staticmethod
    def _path(kind: str, file_name: str) -> str:
        directories = {
            "input": "input/original",
            "output": "output",
            "handoff": "handoffs",
        }
        if kind not in directories:
            raise HTTPException(status_code=400, detail="Invalid attachment kind.")
        return f"{directories[kind]}/{file_name}"

    def _record(
        self,
        session: Session,
        task: Task,
        file_name: str,
        kind: str,
        workspace_path: str,
        source: BinaryIO,
        content_type: str | None,
        *,
        actor_id: str | None = CURRENT_USER_ID,
        record_activity: bool = True,
    ) -> None:
        attachment = Attachment(
            id=new_id(),
            task_id=task.id,
            kind=kind,
            file_name=file_name,
            storage_path=workspace_path,
            content_type=content_type,
            size_bytes=0,
            uploaded_by_id=actor_id,
        )
        attachment.size_bytes = self.store.write(task, attachment, source)
        session.add(attachment)
        if record_activity:
            ActivityService.event(
                session,
                task_id=task.id,
                event_type="file_added",
                actor_id=actor_id,
                payload={"file_name": file_name, "kind": kind},
            )
        session.commit()
        session.expire_all()
