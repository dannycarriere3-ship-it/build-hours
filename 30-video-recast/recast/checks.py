"""Pre-flight checks. Each check reports what it actually found, nothing more."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from recast.commands import GENERATE_SCRIPT, PREPROCESS_SCRIPT

# Preprocessing models replacement mode loads (layout from upstream UserGuider.md).
REQUIRED_PROCESS_MODELS = (
    Path("det/yolov10m.onnx"),
    Path("pose2d/vitpose_h_wholebody.onnx"),
    Path("sam2/sam2_hiera_large.pt"),
)

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str
    required: bool = True


def gpu_check(run=subprocess.run) -> Check:
    if shutil.which("nvidia-smi") is None:
        return Check("GPU", False, "nvidia-smi not found: no NVIDIA GPU visible")
    try:
        out = run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=20, check=True,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError) as exc:
        return Check("GPU", False, f"nvidia-smi failed: {exc}")
    if not out:
        return Check("GPU", False, "nvidia-smi reported no GPU")
    return Check("GPU", True, out.replace("\n", "; "))


def torch_check() -> Check:
    found = importlib.util.find_spec("torch") is not None
    return Check("PyTorch", found, "installed" if found else "not installed in this Python")


def wan_repo_check(wan_dir: Path) -> Check:
    missing = [str(p) for p in (GENERATE_SCRIPT, PREPROCESS_SCRIPT) if not (wan_dir / p).is_file()]
    if missing:
        return Check("Wan2.2 code", False, f"{wan_dir}: missing {', '.join(missing)}")
    return Check("Wan2.2 code", True, str(wan_dir))


def weights_check(ckpt_dir: Path) -> Check:
    if not ckpt_dir.is_dir():
        return Check("Wan2.2-Animate-14B weights", False, f"{ckpt_dir} does not exist")
    process = ckpt_dir / "process_checkpoint"
    missing = [str(p) for p in REQUIRED_PROCESS_MODELS if not (process / p).is_file()]
    if missing:
        return Check("Wan2.2-Animate-14B weights", False, f"missing in {process}: {', '.join(missing)}")
    return Check("Wan2.2-Animate-14B weights", True, str(ckpt_dir))


def ffprobe_check() -> Check:
    found = shutil.which("ffprobe") is not None
    return Check("ffprobe", found, "found" if found else "not found (only used to read the input video's info)", required=False)


def doctor(wan_dir: Path, ckpt_dir: Path, run=subprocess.run) -> list[Check]:
    return [gpu_check(run), torch_check(), wan_repo_check(wan_dir), weights_check(ckpt_dir), ffprobe_check()]


def input_errors(video: Path, reference: Path) -> list[str]:
    errors = []
    if not video.is_file():
        errors.append(f"video not found: {video}")
    elif video.suffix.lower() not in VIDEO_EXTS:
        errors.append(f"unsupported video type {video.suffix!r}: use one of {sorted(VIDEO_EXTS)}")
    if not reference.is_file():
        errors.append(f"reference image not found: {reference}")
    elif reference.suffix.lower() not in IMAGE_EXTS:
        errors.append(f"unsupported image type {reference.suffix!r}: use one of {sorted(IMAGE_EXTS)}")
    return errors
