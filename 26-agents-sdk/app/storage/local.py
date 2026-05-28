from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO

if TYPE_CHECKING:
    from app.models import Attachment, Task


class LocalAttachmentStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def write(self, task: "Task", attachment: "Attachment", source: BinaryIO) -> int:
        _ = task
        destination = self.path_for(attachment.id)
        size = 0
        with destination.open("wb") as output:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
                size += len(chunk)
        return size

    def open(self, task: "Task", attachment: "Attachment") -> BinaryIO:
        _ = task
        return self.path_for(attachment.id).open("rb")

    def path_for(self, blob_key: str) -> Path:
        if not blob_key or blob_key in {".", ".."} or "/" in blob_key or "\\" in blob_key:
            raise ValueError("Invalid attachment blob key.")
        return self.root / blob_key

    def clear_all(self) -> None:
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
