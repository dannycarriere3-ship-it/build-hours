from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(ENV_FILE, override=False)


class Settings(BaseSettings):
    database_url: str = "sqlite:///./data/conference_desk.sqlite3"
    file_storage_root: Path = Path("./data/files")
    local_snapshot_root: Path = Path("./data/snapshots")
    docker_image: str = "python:3.12-bookworm"
    modal_app_name: str = "conference-launch-desk"
    modal_image: str = "python:3.12-bookworm"
    r2_endpoint_url: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket: str = "conference-launch-desk"
    r2_prefix: str = "tasks"
    r2_snapshot_prefix: str = "snapshots"

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")
