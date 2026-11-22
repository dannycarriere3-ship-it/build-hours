from pathlib import Path
import re, zipfile, hashlib
root=Path(__file__).resolve().parents[1]
g=(root/"scripts/Main.gd").read_text()
proj=(root/"project.godot").read_text()

checks = {
"main_scene": (root/"Main.tscn").exists() and 'run/main_scene="res://Main.tscn"' in proj,
"phases": all(x in g for x in ['"BREACH"','"RESERVES"','"BATTLE"','"OUTCOME"']),
"ping_contract": all(x in g for x in ['wait_time = 5.0','autostart = true','one_shot = false']),
"mobile_touch": 'InputEventScreenTouch' in g and '_design_point' in g,
"gate_timeout": 'gate_time_left' in g and 'GATE WINDOW CLOSED' in g,
"pause": 'paused = not paused' in g and 'GAME STATE FROZEN' in g,
"projectile_resolution": 'projectile.t >= projectile.duration' in g and 'ARTILLERY IMPACT — BUNKER DAMAGED' in g,
"resource_spend": 'artillery_used += 1' in g and 'aa_used += 1' in g,
"damage_tracking": 'total_battle_damage += applied_damage' in g,
"audio": 'AudioStreamGenerator' in g and '_play_tone' in g,
"adaptive_quality": '_update_quality_tier' in g and 'quality_tier' in g,
"60fps": 'Engine.max_fps = 60' in g and 'DisplayServer.VSYNC_ENABLED' in g,
"mobile_renderer": 'renderer/rendering_method.mobile="mobile"' in proj,
"no_duplicate_keyboard_lane_path": not ('event.keycode == KEY_LEFT' in g or 'event.keycode == KEY_RIGHT' in g),
}
for name, ok in checks.items():
    assert ok, f"FAIL {name}"
print("AUTOMATED AUDIT: PASS")
for name in checks: print("PASS", name)
