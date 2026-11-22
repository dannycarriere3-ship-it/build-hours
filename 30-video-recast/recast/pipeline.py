"""Runs the two Wan2.2-Animate steps and checks each one actually produced its files."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from recast.checks import doctor, input_errors
from recast.commands import PREPROCESS_OUTPUTS, RecastJob, generate_command, preprocess_command

CONSENT_REQUIRED = (
    "Refusing to run without --consent. Only replace people who agreed to it, "
    "and use a reference image of someone who agreed to appear."
)


class RecastError(RuntimeError):
    pass


@dataclass
class RunResult:
    commands: list[list[str]] = field(default_factory=list)
    output: Path | None = None
    dry_run: bool = False


def run_recast(job: RecastJob, *, consent: bool, dry_run: bool = False, run=subprocess.run) -> RunResult:
    if not consent:
        raise RecastError(CONSENT_REQUIRED)

    errors = input_errors(job.video, job.reference)
    if errors:
        raise RecastError("; ".join(errors))

    pre = preprocess_command(job)
    gen = generate_command(job)
    result = RunResult(commands=[pre, gen], dry_run=dry_run)
    if dry_run:
        return result

    failed = [c for c in doctor(job.wan_dir, job.ckpt_dir, run) if c.required and not c.ok]
    if failed:
        raise RecastError("not ready: " + "; ".join(f"{c.name}: {c.detail}" for c in failed))

    job.process_dir.mkdir(parents=True, exist_ok=True)
    job.output.parent.mkdir(parents=True, exist_ok=True)

    _step("preprocessing", pre, job.wan_dir, run)
    missing = [name for name in PREPROCESS_OUTPUTS if not (job.process_dir / name).is_file()]
    if missing:
        raise RecastError(f"preprocessing finished but did not write {', '.join(missing)} in {job.process_dir}")

    _step("generation", gen, job.wan_dir, run)
    if not job.output.is_file():
        raise RecastError(f"generation finished but {job.output} was not written")

    result.output = job.output
    return result


def _step(label: str, cmd: list[str], cwd: Path, run) -> None:
    try:
        completed = run(cmd, cwd=str(cwd))
    except OSError as exc:
        raise RecastError(f"{label} could not start: {exc}") from exc
    if completed.returncode != 0:
        raise RecastError(f"{label} failed with exit code {completed.returncode}")
