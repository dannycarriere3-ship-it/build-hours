import subprocess
import sys
from pathlib import Path

import pytest

from recast.__main__ import main
from recast.checks import REQUIRED_PROCESS_MODELS, doctor, input_errors
from recast.commands import PREPROCESS_OUTPUTS, PREPROCESS_SCRIPT, RecastJob, generate_command, preprocess_command
from recast.pipeline import CONSENT_REQUIRED, RecastError, run_recast


@pytest.fixture
def setup(tmp_path):
    """A fake but complete install: Wan2.2 files, weights layout, inputs."""
    wan = tmp_path / "Wan2.2"
    (wan / PREPROCESS_SCRIPT).parent.mkdir(parents=True)
    (wan / PREPROCESS_SCRIPT).write_text("")
    (wan / "generate.py").write_text("")
    ckpt = tmp_path / "Wan2.2-Animate-14B"
    for rel in REQUIRED_PROCESS_MODELS:
        f = ckpt / "process_checkpoint" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("")
    video = tmp_path / "shot.mp4"
    video.write_bytes(b"v")
    ref = tmp_path / "actor.jpg"
    ref.write_bytes(b"i")
    job = RecastJob(video=video, reference=ref, output=tmp_path / "out" / "recast.mp4",
                    wan_dir=wan, ckpt_dir=ckpt, work_dir=tmp_path / "work")
    return job


class FakeWan:
    """Stands in for subprocess.run: answers nvidia-smi, and writes the files
    the real preprocess/generate steps would write."""

    def __init__(self, job, *, gpu=True, preprocess_writes=PREPROCESS_OUTPUTS, generate_writes=True, fail=None):
        self.job, self.gpu, self.pre_writes, self.gen_writes, self.fail = job, gpu, preprocess_writes, generate_writes, fail
        self.calls = []

    def __call__(self, cmd, **kwargs):
        self.calls.append((cmd, kwargs))
        if cmd[0] == "nvidia-smi":
            return subprocess.CompletedProcess(cmd, 0, stdout="NVIDIA H100 80GB HBM3, 81559 MiB\n" if self.gpu else "")
        step = "preprocess" if str(PREPROCESS_SCRIPT) in cmd else "generate"
        if self.fail == step:
            return subprocess.CompletedProcess(cmd, 1)
        if step == "preprocess":
            for name in self.pre_writes:
                (self.job.process_dir / name).write_bytes(b"x")
        elif self.gen_writes:
            self.job.output.write_bytes(b"mp4")
        return subprocess.CompletedProcess(cmd, 0)


@pytest.fixture(autouse=True)
def visible_gpu(monkeypatch):
    # checks.gpu_check looks for nvidia-smi on PATH before calling it.
    import recast.checks as checks
    real = checks.shutil.which
    monkeypatch.setattr(checks.shutil, "which", lambda name: "/usr/bin/nvidia-smi" if name == "nvidia-smi" else real(name))
    monkeypatch.setattr(checks, "torch_check", lambda: checks.Check("PyTorch", True, "installed"))


# --- Commands match the upstream Wan2.2 flags exactly ----------------------

def test_preprocess_command_matches_upstream_replacement_mode(setup):
    cmd = preprocess_command(setup)
    assert cmd[0] == sys.executable
    assert cmd[1] == "wan/modules/animate/preprocess/preprocess_data.py"
    assert cmd[2:] == [
        "--ckpt_path", str(setup.ckpt_dir / "process_checkpoint"),
        "--video_path", str(setup.video),
        "--refer_path", str(setup.reference),
        "--save_path", str(setup.work_dir / "process_results"),
        "--resolution_area", "1280", "720",
        "--fps", "30",
        "--iterations", "3", "--k", "7", "--w_len", "1", "--h_len", "1",
        "--replace_flag",
    ]


def test_generate_command_matches_upstream_replacement_mode(setup):
    cmd = generate_command(setup)
    assert cmd[1:] == [
        "generate.py", "--task", "animate-14B",
        "--ckpt_dir", str(setup.ckpt_dir),
        "--src_root_path", str(setup.work_dir / "process_results"),
        "--refert_num", "1",
        "--replace_flag",
        "--save_file", str(setup.output),
        "--use_relighting_lora",
    ]


def test_relighting_off_and_low_vram_flags(setup):
    from dataclasses import replace
    cmd = generate_command(replace(setup, relighting=False, low_vram=True))
    assert "--use_relighting_lora" not in cmd
    assert cmd[-4:] == ["--offload_model", "True", "--convert_model_dtype", "--t5_cpu"]


# --- Consent and input checks ----------------------------------------------

def test_refuses_without_consent_and_runs_nothing(setup):
    fake = FakeWan(setup)
    with pytest.raises(RecastError, match="consent"):
        run_recast(setup, consent=False, run=fake)
    assert fake.calls == []


def test_missing_and_wrong_type_inputs_are_reported(tmp_path):
    txt = tmp_path / "notes.txt"
    txt.write_text("x")
    errors = input_errors(tmp_path / "nope.mp4", txt)
    assert errors == [
        f"video not found: {tmp_path / 'nope.mp4'}",
        "unsupported image type '.txt': use one of ['.jpeg', '.jpg', '.png', '.webp']",
    ]


def test_dry_run_returns_commands_without_running(setup):
    fake = FakeWan(setup)
    result = run_recast(setup, consent=True, dry_run=True, run=fake)
    assert result.dry_run and result.output is None
    assert result.commands == [preprocess_command(setup), generate_command(setup)]
    assert fake.calls == []


# --- Full run, with each step checked ---------------------------------------

def test_full_run_executes_both_steps_in_wan_dir_and_returns_output(setup):
    fake = FakeWan(setup)
    result = run_recast(setup, consent=True, run=fake)
    steps = [c for c in fake.calls if c[0][0] != "nvidia-smi"]
    assert [c[0] for c in steps] == [preprocess_command(setup), generate_command(setup)]
    assert all(c[1]["cwd"] == str(setup.wan_dir) for c in steps)
    assert result.output == setup.output and setup.output.is_file()


def test_no_gpu_stops_before_any_step(setup):
    fake = FakeWan(setup, gpu=False)
    with pytest.raises(RecastError, match="GPU"):
        run_recast(setup, consent=True, run=fake)
    assert all(c[0][0] == "nvidia-smi" for c in fake.calls)


def test_missing_weights_stops_before_any_step(setup):
    (setup.ckpt_dir / "process_checkpoint" / "sam2" / "sam2_hiera_large.pt").unlink()
    fake = FakeWan(setup)
    with pytest.raises(RecastError, match="sam2_hiera_large.pt"):
        run_recast(setup, consent=True, run=fake)
    assert all(c[0][0] == "nvidia-smi" for c in fake.calls)


def test_preprocess_that_skips_a_file_is_caught(setup):
    fake = FakeWan(setup, preprocess_writes=("src_face.mp4", "src_pose.mp4"))
    with pytest.raises(RecastError, match="src_bg.mp4, src_mask.mp4"):
        run_recast(setup, consent=True, run=fake)
    assert not any(str(c[0][1]) == "generate.py" for c in fake.calls)


def test_failed_step_reports_exit_code(setup):
    with pytest.raises(RecastError, match="generation failed with exit code 1"):
        run_recast(setup, consent=True, run=FakeWan(setup, fail="generate"))


def test_generate_that_writes_no_video_is_caught(setup):
    with pytest.raises(RecastError, match="was not written"):
        run_recast(setup, consent=True, run=FakeWan(setup, generate_writes=False))


# --- doctor and CLI ----------------------------------------------------------

def test_doctor_reports_each_missing_piece(tmp_path):
    fake = FakeWan(None)
    checks = {c.name: c for c in doctor(tmp_path / "Wan2.2", tmp_path / "w", fake)}
    assert checks["GPU"].ok
    assert not checks["Wan2.2 code"].ok and "generate.py" in checks["Wan2.2 code"].detail
    assert not checks["Wan2.2-Animate-14B weights"].ok


def test_cli_without_consent_exits_2(setup, capsys):
    code = main(["run", "--video", str(setup.video), "--reference", str(setup.reference),
                 "--out", str(setup.output), "--wan-dir", str(setup.wan_dir), "--ckpt-dir", str(setup.ckpt_dir)])
    assert code == 2
    assert CONSENT_REQUIRED in capsys.readouterr().err


def test_cli_dry_run_prints_both_commands(setup, capsys):
    code = main(["run", "--video", str(setup.video), "--reference", str(setup.reference),
                 "--out", str(setup.output), "--wan-dir", str(setup.wan_dir), "--ckpt-dir", str(setup.ckpt_dir),
                 "--consent", "--dry-run"])
    out = capsys.readouterr().out
    assert code == 0
    assert "preprocess_data.py" in out and "--replace_flag" in out and "generate.py --task animate-14B" in out
