from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from agents.sandbox.session.sandbox_client import BaseSandboxClient
from agents.sandbox.snapshot import SnapshotBase


def no_snapshot(_run_id: str) -> SnapshotBase | None:
    return None


@dataclass(frozen=True)
class SandboxProvider:
    name: str
    client: BaseSandboxClient[Any]
    options: Any
    snapshot_for_run: Callable[[str], SnapshotBase | None] = no_snapshot
