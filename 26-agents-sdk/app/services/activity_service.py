from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.models import ActivityEvent, Comment


class ActivityService:
    @staticmethod
    def event(
        session: Session,
        *,
        task_id: str,
        event_type: str,
        actor_id: str | None,
        payload: dict[str, object],
    ) -> ActivityEvent:
        event = ActivityEvent(
            task_id=task_id,
            actor_id=actor_id,
            event_type=event_type,
            payload_json=json.dumps(payload),
        )
        session.add(event)
        return event

    @classmethod
    def add_comment(
        cls, session: Session, *, task_id: str, body: str, actor_id: str
    ) -> Comment:
        comment = Comment(task_id=task_id, author_id=actor_id, body_markdown=body)
        session.add(comment)
        cls.event(
            session,
            task_id=task_id,
            event_type="comment_added",
            actor_id=actor_id,
            payload={"body": body},
        )
        return comment
