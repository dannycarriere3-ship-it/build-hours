#!/usr/bin/env bash
# Installs Wan2.2 and downloads the Wan2.2-Animate-14B weights next to this script.
# Run it on the GPU machine, not on your phone. Commands follow the upstream README.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d Wan2.2 ]; then
  git clone https://github.com/Wan-Video/Wan2.2.git
fi

# Upstream: torch >= 2.4.0. If flash_attn fails to build, install the rest first
# and flash_attn last.
pip install -r Wan2.2/requirements.txt
pip install -r Wan2.2/requirements_animate.txt

pip install "huggingface_hub[cli]"
huggingface-cli download Wan-AI/Wan2.2-Animate-14B --local-dir ./Wan2.2-Animate-14B

python -m recast doctor
