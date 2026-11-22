"""Builds the exact Wan2.2-Animate command lines.

Every flag here was read from the upstream source (Wan2.2 `generate.py` and
`wan/modules/animate/preprocess/preprocess_data.py`), not guessed. If upstream
renames a flag, the tests in tests/test_commands.py pin what we send.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

PREPROCESS_SCRIPT = Path("wan/modules/animate/preprocess/preprocess_data.py")
GENERATE_SCRIPT = Path("generate.py")
TASK = "animate-14B"

# Files preprocess_data.py writes in replacement mode.
PREPROCESS_OUTPUTS = ("src_face.mp4", "src_pose.mp4", "src_bg.mp4", "src_mask.mp4")


@dataclass(frozen=True)
class RecastJob:
    video: Path
    reference: Path
    output: Path
    wan_dir: Path
    ckpt_dir: Path
    work_dir: Path
    width: int = 1280
    height: int = 720
    fps: int = 30
    refert_num: int = 1
    relighting: bool = True
    low_vram: bool = False

    @property
    def process_dir(self) -> Path:
        return self.work_dir / "process_results"


def preprocess_command(job: RecastJob) -> list[str]:
    return [
        sys.executable,
        str(PREPROCESS_SCRIPT),
        "--ckpt_path", str(job.ckpt_dir / "process_checkpoint"),
        "--video_path", str(job.video),
        "--refer_path", str(job.reference),
        "--save_path", str(job.process_dir),
        "--resolution_area", str(job.width), str(job.height),
        "--fps", str(job.fps),
        "--iterations", "3",
        "--k", "7",
        "--w_len", "1",
        "--h_len", "1",
        "--replace_flag",
    ]


def generate_command(job: RecastJob) -> list[str]:
    cmd = [
        sys.executable,
        str(GENERATE_SCRIPT),
        "--task", TASK,
        "--ckpt_dir", str(job.ckpt_dir),
        "--src_root_path", str(job.process_dir),
        "--refert_num", str(job.refert_num),
        "--replace_flag",
        "--save_file", str(job.output),
    ]
    if job.relighting:
        cmd.append("--use_relighting_lora")
    if job.low_vram:
        # generate.py accepts these for every task, but upstream only documents
        # them for T2V/TI2V; their effect on Animate is untested.
        cmd += ["--offload_model", "True", "--convert_model_dtype", "--t5_cpu"]
    return cmd
