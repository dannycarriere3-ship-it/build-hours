from __future__ import annotations

from pathlib import PurePosixPath

from agents.sandbox import Manifest, SandboxPathGrant
from agents.sandbox.entries import Dir, LocalFile

from app.config import Settings
from app.models import Task

from .base import AttachmentStore
from .local import LocalAttachmentStore
from .r2 import R2AttachmentStore


def task_workspace_manifest(
    task: Task, store: AttachmentStore, settings: Settings
) -> Manifest:
    """Materialize the `/workspace/task` filesystem presented to every agent."""
    if isinstance(store, R2AttachmentStore):
        return _r2_input_manifest(task, store, settings)
    if not isinstance(store, LocalAttachmentStore):
        raise ValueError("Unsupported task attachment store.")
    _ = settings
    task_tree = Dir(
        children={
            "input": Dir(children={"original": Dir()}),
            "working": Dir(),
            "output": Dir(),
            "handoffs": Dir(),
        }
    )
    for attachment in sorted(task.attachments, key=lambda item: item.created_at):
        _add_attachment(
            task_tree,
            attachment.storage_path,
            LocalFile(src=store.path_for(attachment.id)),
        )
    return Manifest(
        entries={"task": task_tree},
        extra_path_grants=(
            SandboxPathGrant(
                path=store.root,
                read_only=True,
                description="Attachment blobs staged into the sandbox manifest.",
            ),
        ),
    )


def _r2_input_manifest(
    task: Task, store: R2AttachmentStore, settings: Settings
) -> Manifest:
    from agents.extensions.sandbox.modal.mounts import ModalCloudBucketMountStrategy
    from agents.sandbox.entries import S3Mount

    return Manifest(
        entries={
            "task": Dir(
                children={
                    "input": S3Mount(
                        bucket=settings.r2_bucket,
                        prefix=store.input_prefix(task),
                        endpoint_url=settings.r2_endpoint_url,
                        access_key_id=settings.r2_access_key_id,
                        secret_access_key=settings.r2_secret_access_key,
                        read_only=True,
                        mount_strategy=ModalCloudBucketMountStrategy(),
                    ),
                    "working": Dir(),
                    "output": Dir(),
                    "handoffs": Dir(),
                }
            )
        }
    )


def _add_attachment(directory: Dir, workspace_path: str, entry: LocalFile) -> None:
    relative = PurePosixPath(workspace_path)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("Invalid attachment workspace path.")
    parent = directory
    for part in relative.parts[:-1]:
        child = parent.children.get(part)
        if child is None:
            child = Dir()
            parent.children[part] = child
        if not isinstance(child, Dir):
            raise ValueError(f"Attachment path conflicts at {part}.")
        parent = child
    parent.children[relative.name] = entry
