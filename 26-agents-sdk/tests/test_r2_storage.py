from io import BytesIO

from agents.sandbox.entries import Dir, S3Mount

from app.config import Settings
from app.models import Attachment, Task
from app.storage.manifest import task_workspace_manifest
from app.storage.r2 import R2AttachmentStore, R2SnapshotClient


class FakeR2Client:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes) -> None:
        _ = Bucket
        self.objects[Key] = Body

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, BytesIO]:
        _ = Bucket
        return {"Body": BytesIO(self.objects[Key])}

    def head_object(self, *, Bucket: str, Key: str) -> None:
        _ = Bucket
        if Key not in self.objects:
            raise KeyError(Key)


def _settings() -> Settings:
    return Settings(
        r2_endpoint_url="https://example.r2.cloudflarestorage.com",
        r2_access_key_id="key",
        r2_secret_access_key="secret",
        r2_bucket="demo-bucket",
        r2_prefix="tasks",
        r2_snapshot_prefix="snapshots",
    )


def test_r2_attachment_store_drives_the_scoped_input_mount() -> None:
    client = FakeR2Client()
    store = R2AttachmentStore(_settings(), client=client)
    task = Task(workspace_key="tasks/cls-101-agenda-preview")
    attachment = Attachment(
        id="blob-1", storage_path="input/original/abstract.md"
    )

    store.write(task, attachment, BytesIO(b"# Abstract\n"))
    manifest = task_workspace_manifest(task, store, _settings())

    assert (
        client.objects["tasks/cls-101-agenda-preview/input/original/abstract.md"]
        == b"# Abstract\n"
    )
    task_entry = manifest.entries["task"]
    assert isinstance(task_entry, Dir)
    input_entry = task_entry.children["input"]
    assert isinstance(input_entry, S3Mount)
    assert input_entry.prefix == "tasks/cls-101-agenda-preview/input/"
    assert input_entry.read_only


def test_r2_snapshot_client_uses_a_separate_snapshot_prefix() -> None:
    client = FakeR2Client()
    snapshots = R2SnapshotClient(_settings(), client=client)

    snapshots.upload("run-123", BytesIO(b"snapshot tar"))

    assert snapshots.exists("run-123")
    assert snapshots.download("run-123").read() == b"snapshot tar"
    assert client.objects["snapshots/run-123.tar"] == b"snapshot tar"
