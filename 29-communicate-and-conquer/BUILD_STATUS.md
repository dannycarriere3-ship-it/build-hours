# Communicate & Conquer — MAX7 AUTO Truth Report

## Pipeline
`SCAN → AUDIT → FIND WEAKNESS → PATCH → STATIC TEST → HOSTILE TEST → PACKAGE → HASH`

## MAX7 changes
- Added explicit `gate_resolved` state so a timed-out gate cannot reopen indefinitely.
- Made replay reset the gate resolution state.
- Replaced the fixed `/ 2.0` input transform with viewport-aware mapping into the 1280×720 design space.
- Removed resolved projectiles from the active projectile collection after impact, preventing permanent projectile accumulation and unnecessary update/draw work.
- Added `tests/verify_pipeline.py` for regression, hostile-pattern, duplicate-function, replay-reset, coordinate-scaling, projectile-lifecycle, and gameplay-contract checks.

## Verification
- `tests/verify_static.py`: PASS
- `tests/verify_automated.py`: PASS
- `tests/verify_pipeline.py`: PASS
- ZIP integrity: PASS
- SHA-256: generated for final package

## PROVEN in this environment
- Source modifications exist.
- Static checks execute and pass.
- Automated regression/hostile checks execute and pass.
- Final package is generated and hashable.

## NOT PROVEN
- Godot runtime launch.
- APK build.
- Android installation.
- Physical S25+ execution.
- Sustained 60 FPS on hardware.
- Frame-time/worst-frame trace.
- Thermal behavior.
- Physical touch latency.
- Final physical audio output quality.

## BLOCKED
No Godot executable or Android build/device toolchain is available in the current execution environment, so runtime/device evidence cannot be honestly promoted from static proof.

## Next automation target
Repeat the same pipeline from MAX7 as the new baseline, adding regression checks for every newly discovered failure while preserving the evidence gate.

## Provenance note (2026-09-28, static audit)
- Source ZIP `Communicate_Conquer_MAX11_AUTO_43_8vgn.zip` SHA-256 verified: b164371b9cc9d1e6cc2e75c422620d2deef6f43165e3297475094101f0a3b601.
- `extracted/` tree matches the ZIP. `build/` tree differs only by: explicit-vs-inferred `var` typing in `scripts/Main.gd` (semantically identical) and two added lines in `project.godot` (`config/icon`, `import_etc2_astc`).
- `cc-max11-debug.apk` SHA-256 verified: fa978b8718ac0fa546bfaac48f0a863c10556cd3747d3d05347b8209a6001299. Its embedded exported scene is byte-identical to `build/.godot/exported/133200997/export-bcb0d2eb5949c52b6a65bfe9de3e985b-Main.scn` — the APK was built from this `build/` tree.
- "MAX7" title above is historical (pipeline doc); the packaged source is labeled MAX11_AUTO_43.
- Known target-device risk (NOT fixed — needs rebuild + device test): `window/stretch/aspect="expand"` with fixed 2x draw into 1280x720 design space misaligns `_design_point` touch mapping and leaves an unpainted strip on 19.5:9 screens (S25+). See device test checklist stage 4.

---

## V2 extension (2026-09-29) — "plus fort", neutral versioning

Scope (per Danny): full V2 — modern units, missions, new mode, difficulty
tiers, roster rebalance. Hotel theme and all codenames dropped per retractions.

**Added (all in `scripts/Main.gd`, additive — no core-loop restructuring):**
- BRIEFING pre-phase: mission/mode/difficulty selection → DEPLOY. Loop is now
  BRIEFING → BREACH → RESERVES → BATTLE → OUTCOME → REPLAY → BRIEFING.
- 4 missions (VANGUARD PROTOCOL / GHOST HARVEST / IRONHOLD / NIGHT RAID) with
  distinct win conditions evaluated from real end-of-breach state; operation
  outcome requires battle win AND mission success.
- 3 modern units: REAPER UCAV (12s autonomous hunter), SPECTRE TEAM (15s area
  denial), AEGIS MBT (wide-blast shell, 1.4s reload, real friendly-fire risk).
- MODERN OPS mode: 5 escalating bomber waves replace the battle timer, with
  wave-clear detection and +1 artillery resupply.
- NORMAL/HARD difficulty: HARD is behavioral (breach flanking, bomber
  focus-fire, AA-evasion weave) — damage numbers unchanged.
- Roster rebalance: modern reserves earned by performance (intel≥5 / score≥400 /
  HP≥60 + mission bonuses), capped at 3. See `docs/V2-BALANCE.md`.

**Preserved:** original APKs untouched (`cc-max11-debug.apk`,
`cc-max11-fixed.apk`); pre-V2 source backed up at
`scripts/Main.gd.max11-backup`; package id unchanged
(`com.carriereroofing.communicateconquer`).

**Versioning:** `config/version="2.0"`, export `version/code=3`,
`version/name="2.0"`, output `../cc-max11-v2.apk`. No codename anywhere
(verified by `tests/verify_v2.py` negative checks).

**Verification (all executed):**
- `tests/harness_v2.gd`: 27/27 headless execution checks PASS
  (evidence: `../V2-HARNESS-EVIDENCE.txt`).
- `verify_static.py`, `verify_automated.py`, `verify_pipeline.py`,
  `verify_v2.py`: all PASS.
- Truth ledger per capability: `../V2-TRUTH-LEDGER.md`.
- A/B binary proof: decompressed `Main.gdc` from `cc-max11-v2.apk` contains
  MODERN OPS / REAPER / SPECTRE / AEGIS / GHOST HARVEST / OPERATION BRIEFING;
  the previous APK's does not.
- `cc-max11-v2.apk` SHA-256:
  `8ad11f3b32cf60c766d0f0178f214cad978ccec9add96531438f0a29849162bf`
  (apksigner v1+v2+v3, 1 signer, zero permissions).

**NOT proven:** on-device install / touch / FPS / thermal / audio on the S25+
— needs Danny's device run.
