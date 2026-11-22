# Verification checklist

Static checks for this package:

1. `project.godot` exists and points to `res://Main.tscn`.
2. `Main.tscn` points to `res://scripts/Main.gd`.
3. Main script contains all five phases: BREACH, RESERVES, BATTLE, OUTCOME and REPLAY behavior.
4. `PING_INTERVAL` is exactly 5.0.
5. No external textures, fonts, audio or network services are required.
6. The project contains no fabricated runtime proof.

Runtime checks to execute in Godot:

- Launch project.
- Complete a breach by reaching the end.
- Verify reserve conversion.
- Verify gate choice changes reserves.
- Enter battle.
- Fire artillery and AA; verify counts decrease.
- Allow at least one 5-second tactical ping to occur.
- Destroy/avoid bombers and preserve bunker OR allow bunker destruction.
- Verify OUTCOME.
- Press REPLAY and verify a fresh BREACH begins with incremented run number.
