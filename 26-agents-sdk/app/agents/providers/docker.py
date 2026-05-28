from __future__ import annotations

import docker
from agents.sandbox import LocalSnapshot
from agents.sandbox.sandboxes.docker import (
    DockerSandboxClient,
    DockerSandboxClientOptions,
)

from app.agents.providers.base import SandboxProvider
from app.config import Settings


def docker_provider(settings: Settings) -> SandboxProvider:
    return SandboxProvider(
        name="docker",
        client=DockerSandboxClient(docker.from_env()),
        options=DockerSandboxClientOptions(image=settings.docker_image),
        snapshot_for_run=lambda run_id: LocalSnapshot(
            id=run_id, base_path=settings.local_snapshot_root
        ),
    )
