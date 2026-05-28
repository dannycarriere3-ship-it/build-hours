from __future__ import annotations

import json
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


class AssigneeService:
    @staticmethod
    def list(session: Session) -> list[User]:
        users = session.scalars(select(User).order_by(User.display_name)).all()
        return [user for user in users if _is_available_assignee(user)]

    @staticmethod
    def search(
        session: Session, query: str, capabilities: list[str] | None = None
    ) -> list[User]:
        text = query.casefold()
        users = AssigneeService.list(session)
        matches: list[User] = []
        for user in users:
            haystack = f"{user.display_name} {user.title or ''}".casefold()
            user_capabilities = [
                item.casefold() for item in json.loads(user.capabilities_json)
            ]
            matches_query = (
                not text
                or text in haystack
                or any(text in item for item in user_capabilities)
            )
            matches_capabilities = not capabilities or all(
                requested.casefold() in user_capabilities for requested in capabilities
            )
            if matches_query and matches_capabilities:
                matches.append(user)
        return matches


def _program_editor_is_available() -> object:
    from app.agents.program_editor import build_program_editor

    return build_program_editor()


def _asset_producer_is_available() -> object:
    from app.agents.providers.modal import modal_provider
    from app.agents.asset_producer import build_asset_producer
    from app.config import Settings

    modal_provider(Settings())
    return build_asset_producer()


AGENT_AVAILABILITY_CHECKS: dict[str, Callable[[], object]] = {
    "program-editor": _program_editor_is_available,
    "asset-producer": _asset_producer_is_available,
}


def _is_available_assignee(user: User) -> bool:
    if user.kind != "agent":
        return user.id == "steve-c"
    check = AGENT_AVAILABILITY_CHECKS.get(user.id)
    if check is None:
        return False
    try:
        check()
    except (ImportError, ModuleNotFoundError, NotImplementedError):
        return False
    return True
