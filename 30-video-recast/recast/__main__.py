"""Command line: `python -m recast doctor` and `python -m recast run`."""

from __future__ import annotations

import argparse
import shlex
import sys
from pathlib import Path

from recast.checks import doctor
from recast.commands import RecastJob
from recast.pipeline import RecastError, run_recast


def _paths(args) -> tuple[Path, Path]:
    return Path(args.wan_dir).resolve(), Path(args.ckpt_dir).resolve()


def cmd_doctor(args) -> int:
    wan_dir, ckpt_dir = _paths(args)
    checks = doctor(wan_dir, ckpt_dir)
    for c in checks:
        mark = "OK  " if c.ok else ("FAIL" if c.required else "WARN")
        print(f"[{mark}] {c.name}: {c.detail}")
    ready = all(c.ok for c in checks if c.required)
    print("\nReady to run." if ready else "\nNot ready. Fix the FAIL lines above (see README).")
    return 0 if ready else 1


def cmd_run(args) -> int:
    wan_dir, ckpt_dir = _paths(args)
    output = Path(args.out).resolve()
    job = RecastJob(
        video=Path(args.video).resolve(),
        reference=Path(args.reference).resolve(),
        output=output,
        wan_dir=wan_dir,
        ckpt_dir=ckpt_dir,
        work_dir=Path(args.work_dir).resolve() if args.work_dir else output.parent / f"{output.stem}_work",
        width=args.resolution[0],
        height=args.resolution[1],
        fps=args.fps,
        refert_num=args.refert_num,
        relighting=not args.no_relighting,
        low_vram=args.low_vram,
    )
    try:
        result = run_recast(job, consent=args.consent, dry_run=args.dry_run)
    except RecastError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    if result.dry_run:
        print(f"Dry run. These commands would run in {wan_dir}:\n")
        for cmd in result.commands:
            print(shlex.join(cmd) + "\n")
        return 0
    print(f"Done: {result.output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="recast", description="Replace the person in a video with a reference image (Wan2.2-Animate).")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp):
        sp.add_argument("--wan-dir", default="Wan2.2", help="Wan2.2 code checkout (default: ./Wan2.2)")
        sp.add_argument("--ckpt-dir", default="Wan2.2-Animate-14B", help="model weights folder (default: ./Wan2.2-Animate-14B)")

    d = sub.add_parser("doctor", help="check GPU, PyTorch, Wan2.2 code and weights")
    common(d)
    d.set_defaults(func=cmd_doctor)

    r = sub.add_parser("run", help="replace the person in a video")
    common(r)
    r.add_argument("--video", required=True, help="source video, one person in shot")
    r.add_argument("--reference", required=True, help="image of the new character")
    r.add_argument("--out", required=True, help="output .mp4 path")
    r.add_argument("--work-dir", help="where intermediate files go (default: next to --out)")
    r.add_argument("--resolution", type=int, nargs=2, default=[1280, 720], metavar=("W", "H"))
    r.add_argument("--fps", type=int, default=30, help="processing frame rate; -1 keeps the source rate")
    r.add_argument("--refert-num", type=int, default=1, help="frames used for temporal guidance; upstream recommends 1 or 5")
    r.add_argument("--no-relighting", action="store_true", help="skip the relighting LoRA")
    r.add_argument("--low-vram", action="store_true", help="offload to CPU (untested for Animate)")
    r.add_argument("--dry-run", action="store_true", help="print the commands without running them")
    r.add_argument("--consent", action="store_true", help="confirm everyone replaced, and the person in the reference image, agreed")
    r.set_defaults(func=cmd_run)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
