from __future__ import annotations

import re
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import ActivityEvent, Comment, Tag, Task
from app.schemas import TaskCreate, TaskPatch

from .activity_service import ActivityService

CURRENT_USER_ID = "steve-c"


def task_query():
    return select(Task).options(
        selectinload(Task.assignee),
        selectinload(Task.created_by),
        selectinload(Task.tags),
        selectinload(Task.attachments),
        selectinload(Task.comments).selectinload(Comment.author),
        selectinload(Task.activity).selectinload(ActivityEvent.actor),
        selectinload(Task.runs),
    )


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:54] or str(uuid4())[:8]


class TaskService:
    def list(self, session: Session) -> list[Task]:
        return list(
            session.scalars(task_query().order_by(Task.created_at.desc())).all()
        )

    def get(self, session: Session, task_id: str) -> Task:
        task = session.scalar(task_query().where(Task.id == task_id))
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found.")
        return task

    def create(self, session: Session, payload: TaskCreate) -> Task:
        issue_number = (session.scalar(select(func.count(Task.id))) or 0) + 101
        issue_key = f"CLS-{issue_number}"
        task = Task(
            issue_key=issue_key,
            title=payload.title,
            description=payload.description,
            status=payload.status.value,
            assignee_id=payload.assignee_id,
            created_by_id=CURRENT_USER_ID,
            session_name=payload.session_name,
            workspace_key=f"tasks/{issue_key.lower()}-{slugify(payload.title)}",
        )
        task.tags = self._tags(session, payload.tag_ids)
        session.add(task)
        session.flush()
        ActivityService.event(
            session,
            task_id=task.id,
            event_type="task_created",
            actor_id=CURRENT_USER_ID,
            payload={"issue_key": issue_key, "title": task.title},
        )
        session.commit()
        session.expire_all()
        return self.get(session, task.id)

    def clone(self, session: Session, source: Task) -> Task:
        issue_number = (session.scalar(select(func.count(Task.id))) or 0) + 101
        issue_key = f"CLS-{issue_number}"
        task = Task(
            issue_key=issue_key,
            title=source.title,
            description=source.description,
            status=source.status,
            assignee_id=source.assignee_id,
            created_by_id=source.created_by_id,
            session_name=source.session_name,
            workspace_key=f"tasks/{issue_key.lower()}-{slugify(source.title)}",
        )
        task.tags = list(source.tags)
        session.add(task)
        session.commit()
        session.expire_all()
        return self.get(session, task.id)

    def update(
        self,
        session: Session,
        task_id: str,
        payload: TaskPatch,
        *,
        actor_id: str = CURRENT_USER_ID,
    ) -> Task:
        task = self.get(session, task_id)
        fields = payload.model_fields_set
        if "title" in fields and payload.title:
            task.title = payload.title
        if "description" in fields and payload.description is not None:
            task.description = payload.description
        if "session_name" in fields:
            task.session_name = payload.session_name
        if "tag_ids" in fields and payload.tag_ids is not None:
            task.tags = self._tags(session, payload.tag_ids)
        if (
            "status" in fields
            and payload.status is not None
            and payload.status.value != task.status
        ):
            previous = task.status
            task.status = payload.status.value
            ActivityService.event(
                session,
                task_id=task.id,
                event_type="status_changed",
                actor_id=actor_id,
                payload={"from": previous, "to": payload.status.value},
            )
        if "assignee_id" in fields and payload.assignee_id != task.assignee_id:
            previous = task.assignee_id
            task.assignee_id = payload.assignee_id
            ActivityService.event(
                session,
                task_id=task.id,
                event_type="assignee_changed",
                actor_id=actor_id,
                payload={
                    "from": previous or "unassigned",
                    "to": payload.assignee_id or "unassigned",
                },
            )
        session.commit()
        session.expire_all()
        return self.get(session, task.id)

    def delete(self, session: Session, task_id: str) -> None:
        task = self.get(session, task_id)
        session.delete(task)
        session.commit()

    @staticmethod
    def _tags(session: Session, tag_ids: list[str]) -> list[Tag]:
        if not tag_ids:
            return []
        tags = list(session.scalars(select(Tag).where(Tag.id.in_(tag_ids))).all())
        if len(tags) != len(set(tag_ids)):
            raise HTTPException(status_code=400, detail="Unknown tag.")
        return tags
