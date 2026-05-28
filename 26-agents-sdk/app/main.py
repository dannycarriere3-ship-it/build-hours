from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from app import models
from app.api import events, reset, settings, tasks
from app.config import Settings
from app.db import Database
from app.seed import seed_reference_data
from app.services.task_change_bus import TaskChangeBus
from app.storage.base import AttachmentStore
from app.storage.local import LocalAttachmentStore
from app.statuses import TaskStatus


def create_app(
    *,
    database_url: str | None = None,
    file_storage_root: Path | None = None,
    fixture_root: Path | None = None,
) -> FastAPI:
    settings_config = Settings()
    url = database_url or settings_config.database_url
    store_root = file_storage_root or settings_config.file_storage_root
    fixtures = fixture_root or Path(__file__).resolve().parents[1] / "fake data"
    database = Database(url)
    server_instance_id = uuid4().hex
    attachment_store: AttachmentStore = LocalAttachmentStore(store_root)
    # @STEP-06: Store task uploads in R2 and mount those inputs for each agent run.
    from app.storage.r2 import R2AttachmentStore
    attachment_store = R2AttachmentStore(settings_config)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database.create_all()
        with database.session_factory() as session:
            seed_reference_data(session)
            session.execute(
                update(models.Task)
                .where(models.Task.status == "changes_requested")
                .values(status=TaskStatus.IN_PROGRESS.value)
            )
            session.commit()
        app.state.database = database
        app.state.settings = settings_config
        app.state.attachment_store = attachment_store
        app.state.fixture_root = fixtures
        app.state.pending_approvals = {}
        app.state.task_changes = TaskChangeBus()
        yield

    app = FastAPI(title="Conference Launch Desk API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(tasks.router)
    app.include_router(settings.router)
    app.include_router(reset.router)
    app.include_router(events.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "instance_id": server_instance_id}

    return app


app = create_app()
