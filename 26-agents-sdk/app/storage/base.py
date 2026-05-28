from __future__ import annotations

from typing import TYPE_CHECKING, BinaryIO, Protocol

if TYPE_CHECKING:
    from app.models import Attachment, Task


class AttachmentStore(Protocol):
    def write(self, task: "Task", attachment: "Attachment", source: BinaryIO) -> int: ...

    def open(self, task: "Task", attachment: "Attachment") -> BinaryIO: ...

    def clear_all(self) -> None: ...
