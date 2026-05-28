from __future__ import annotations

from app.agents.providers.base import SandboxProvider
from app.config import Settings


def modal_provider(settings: Settings) -> SandboxProvider:
    # @STEP-03: Move sandbox execution to Modal and persist snapshots in R2.

    from agents.extensions.sandbox.modal import (
        ModalImageSelector,
        ModalSandboxClient,
        ModalSandboxClientOptions,
    )
    from agents.sandbox.session.dependencies import Dependencies
    from agents.sandbox.snapshot import RemoteSnapshot

    from app.storage.r2 import R2SnapshotClient

    return SandboxProvider(
        name="modal",
        client=ModalSandboxClient(
            image=ModalImageSelector.from_tag(settings.modal_image),
            dependencies=Dependencies.with_values(
                {"r2_snapshots": R2SnapshotClient(settings)}
            ),
        ),
        options=ModalSandboxClientOptions(app_name=settings.modal_app_name),
        snapshot_for_run=lambda run_id: RemoteSnapshot(
            id=run_id, client_dependency_key="r2_snapshots"
        ),
    )
