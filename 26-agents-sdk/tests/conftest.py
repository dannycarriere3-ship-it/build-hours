from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'desk.sqlite3'}",
        file_storage_root=tmp_path / "files",
    )
    with TestClient(app) as test_client:
        yield test_client
