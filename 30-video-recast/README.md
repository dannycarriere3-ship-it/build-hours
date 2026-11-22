# Video Recast

Replace the person in a video with someone from a reference image. Motion,
camera, lighting and background stay the same. This is the same idea as
ElevenLabs Recast, built on the open model
[Wan2.2-Animate-14B](https://github.com/Wan-Video/Wan2.2) (Apache 2.0, released
Sep 19, 2025) in its **replacement mode**.

This folder is a thin, tested wrapper. It runs Wan2.2's own two steps, checks
that each step wrote its files, and refuses to run without consent.

## How it works

1. **Preprocess** (`preprocess_data.py --replace_flag`): finds the person,
   tracks pose and face, cuts a mask (SAM2) and keeps the background. It writes
   `src_face.mp4`, `src_pose.mp4`, `src_bg.mp4` and `src_mask.mp4`.
2. **Generate** (`generate.py --task animate-14B --replace_flag
   --use_relighting_lora`): draws the new character into the scene, driven by
   that motion and relit to match the shot.

## Requirements

- An NVIDIA GPU machine (a cloud GPU is fine). It will not run on a phone.
- Upstream does not state how much VRAM Animate needs. It is a 14B model, so
  plan for a large data-centre GPU. `--low-vram` offloads to CPU, but upstream
  only documents those flags for other tasks, so treat it as an experiment.
- Python 3.10+, PyTorch 2.4+, git, and enough disk for the 14B weights
  (upstream does not state the download size).
- One person in the source shot. Upstream mask extraction is single-person only.

## Setup (on the GPU machine)

```bash
cd 30-video-recast
./setup.sh          # clones Wan2.2, installs it, downloads the weights, runs doctor
python -m recast doctor
```

`doctor` checks the GPU, PyTorch, the Wan2.2 code and the weights, and prints
what is missing.

## Run

```bash
python -m recast run \
  --video shot.mp4 \
  --reference new_actor.jpg \
  --out recast.mp4 \
  --consent
```

Useful options:

- `--dry-run` prints the exact two commands without running them.
- `--resolution 1280 720` sets the processing area (upstream default).
- `--fps -1` keeps the source frame rate (default 30).
- `--refert-num 5` uses more frames for temporal guidance (upstream recommends 1 or 5).
- `--no-relighting` skips the relighting LoRA.

## Consent

`run` refuses to start without `--consent`. Only replace people who agreed to
it, and only use a reference image of someone who agreed to appear. Putting
someone in a video without permission is a deepfake and is illegal in many
places.

## Tests

```bash
pip install pytest
pytest
```

The 15 tests replace Wan2.2 with a fake that writes the same files. They check
the exact flags sent to both upstream scripts, the consent gate, input checks,
and that a step which fails or skips a file stops the run. They need no GPU.

## What is proven, and what is not

- **Proven here:** the command lines match the flags in upstream
  `generate.py` and `preprocess_data.py` (read from source on 2026-11-22), and
  the wrapper's control flow is tested.
- **Not proven:** a real run. No GPU was available, so neither upstream step
  has run through this wrapper, and the output quality is unknown.
