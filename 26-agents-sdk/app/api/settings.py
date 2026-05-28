from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.demo.capability_flags import list_capabilities
from app.deps import get_session, get_store
from app.models import Tag, User
from app.schemas import CapabilityOut, TagOut, UserOut
from app.services.assignee_service import AssigneeService
from app.services.serializers import user_out
from app.storage.base import AttachmentStore

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/me", response_model=UserOut)
def me(session: Session = Depends(get_session)) -> UserOut:
    return user_out(session.get(User, "steve-c"))


@router.get("/tags", response_model=list[TagOut])
def tags(session: Session = Depends(get_session)) -> list[TagOut]:
    return [
        TagOut(id=tag.id, name=tag.name, color=tag.color)
        for tag in session.scalars(select(Tag).order_by(Tag.name)).all()
    ]


@router.get("/assignees", response_model=list[UserOut])
def assignees(
    q: str = Query(""),
    capabilities: list[str] | None = Query(None),
    session: Session = Depends(get_session),
) -> list[UserOut]:
    return [user_out(user) for user in AssigneeService.search(session, q, capabilities)]


@router.get("/demo/capabilities", response_model=list[CapabilityOut])
def capabilities(
    session: Session = Depends(get_session),
    store: AttachmentStore = Depends(get_store),
) -> list[CapabilityOut]:
    return [
        CapabilityOut(key=item.key, enabled=item.enabled, detail=item.detail)
        for item in list_capabilities(session, store)
    ]
