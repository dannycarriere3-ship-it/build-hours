from pathlib import Path
import re, zipfile, hashlib, json, sys
root=Path(__file__).resolve().parents[1]
g=(root/'scripts/Main.gd').read_text()
proj=(root/'project.godot').read_text()

checks={}
def check(name, cond):
    checks[name]=bool(cond)

check('main_scene_exists',(root/'Main.tscn').exists())
check('main_scene_configured','run/main_scene="res://Main.tscn"' in proj)
check('core_loop',all(x in g for x in ['"BREACH"','"RESERVES"','"BATTLE"','"OUTCOME"','_replay()']))
check('ping_contract',all(x in g for x in ['wait_time = 5.0','autostart = true','one_shot = false']))
check('touch_input','InputEventScreenTouch' in g and 'touch_start' in g and 'touch_active' in g)
check('gate_touch_priority','gate_open and abs(delta_touch.x) <= 70.0' in g and '_choose_gate(0)' in g and '_choose_gate(1)' in g)
check('gate_timeout_resolves','gate_resolved = true' in g and 'not gate_resolved' in g)
check('gate_replay_reset','gate_resolved = false' in g)
# Updated 2026-09-29 (FOU pass): the old assertion pinned the pre-repair
# implementation ('end_point.x >= 1120.0' literal), which the Claude audit
# intentionally replaced with the shared PAUSE_BOX constant so touch and
# mouse test identical regions. Assert the repaired intent instead.
check('pause_touch','paused = not paused' in g and 'PAUSE_BOX.has_point(end_point)' in g)
check('projectile_delayed_resolution','projectile.t >= projectile.duration' in g)
check('projectile_cleanup','resolved_indices' in g and 'projectiles.remove_at' in g)
check('artillery_damage_on_impact','ARTILLERY IMPACT — BUNKER DAMAGED' in g and 'total_battle_damage += applied_damage' in g)
check('aa_stable_target','target_id' in g and 'b.id' in g)
check('resource_spend','artillery_used += 1' in g and 'aa_used += 1' in g)
check('replay_cleanup','projectiles.clear()' in g and 'impacts.clear()' in g and 'bombers.clear()' in g)
# Updated 2026-09-27: the old assertion pinned the P1 touch bug's implementation
# (physical-window scaling that misaligned touches on non-16:9 screens). The fix
# inverts the real canvas transform instead; assert the fixed pattern.
check('generic_resolution_scaling','get_canvas_transform().affine_inverse()' in g and '* 0.5' in g)
check('no_hardcoded_half_scale','return p / 2.0' not in g)
check('adaptive_quality','_update_quality_tier' in g and 'quality_tier' in g)
check('fps_config','Engine.max_fps = 60' in g and 'DisplayServer.VSYNC_ENABLED' in g)
check('mobile_renderer','renderer/rendering_method.mobile="mobile"' in proj)
check('audio_generator','AudioStreamGenerator' in g and '_play_tone' in g)
check('no_duplicate_update_projectiles',len(re.findall(r'^func _update_projectiles\(',g,re.M))==1)
check('no_duplicate_design_point',len(re.findall(r'^func _design_point\(',g,re.M))==1)
check('no_duplicate_start_breach',len(re.findall(r'^func _start_breach\(',g,re.M))==1)

# Hostile regression checks: fail if known fragile patterns return.
check('no_keyboard_lane_duplicate', 'event.keycode == KEY_LEFT' not in g and 'event.keycode == KEY_RIGHT' not in g)
check('no_projectile_permanent_retention','projectiles.remove_at' in g)
check('no_fixed_qhd_touch_transform','return p / 2.0' not in g)

check('bomber_active_lifecycle', '"active": true' in g and 'b.active = false' in g and 'not bool(b.get("active", true))' in g)
check('no_repeated_bomber_bunker_damage', 'if b.y > 520.0:' in g and 'b.active = false' in g)
check('pause_freezes_ping_timer', 'ping_timer.paused = true' in g and 'ping_timer.paused = false' in g)
check('dead_bomber_not_targeted', 'bool(b.get("active", true))' in g)
check('bunker_position_constant','const BUNKER_POS := Vector2(640.0, 505.0)' in g)
check('impact_updates_in_process','_update_impacts(delta)' in g and 'func _update_impacts(delta: float) -> void:' in g)
check('draw_does_not_mutate_impact_time','impact.t += get_process_delta_time()' not in g)
check('draw_uses_shared_bunker_position','draw_arc(BUNKER_POS' in g)
check('artillery_uses_shared_bunker_position','impact_pos.distance_to(BUNKER_POS)' in g)

failed=[k for k,v in checks.items() if not v]
print('PIPELINE AUDIT:', 'PASS' if not failed else 'FAIL')
for k,v in checks.items(): print(('PASS ' if v else 'FAIL ')+k)
if failed: sys.exit(1)

# MAX10 hostile lifecycle / terminal-state invariants
src = root / "scripts" / "Main.gd"
text = src.read_text()
checks = [
    ("bomber_ids_only_assigned_on_spawn", "next_bomber_id += 1" in text and "func _spawn_bomber" in text),
    ("bomber_ids_reset_for_new_battle", "next_bomber_id = 1" in text and "func _enter_battle" in text),
    ("inactive_bombers_compacted", 'bombers = bombers.filter(func(b): return bool(b.get("active", true)))' in text),
    ("terminal_battle_guard", 'if bunker_hp <= 0.0:\n        _finish_battle(false)\n        return' in text),
    ("terminal_guard_after_bomber_impact", 'camera_shake = 0.55\n            if bunker_hp <= 0.0:' in text),
    ("viewport_comment_matches_2x_profile", "scale it 2x into the 2560x1440" in text),
]
for name, ok in checks:
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        raise SystemExit(1)

# MAX11 hostile regression checks
assert 'if phase != "BATTLE":\n        return' in text, 'PASS projectile_phase_guard'
assert 'projectiles.clear()\n    impacts.clear()' in text, 'PASS outcome_clears_inflight_state'
assert 'ping_visual_time = 0.0' in text, 'PASS ping_visual_state'
assert 'if ping_visual_time >= 0.0:' in text, 'PASS ping_draw_uses_timer_state'
assert 'fmod(total_elapsed,PING_INTERVAL)' not in text, 'PASS ping_not_derived_from_global_elapsed'
assert 'audio_generator.buffer_length = 0.25' in text, 'PASS audio_buffer_duration'
assert 'max_frames := int(audio_generator.buffer_length' in text, 'PASS audio_duration_not_hard_capped'
assert 'Fixed 1280x720 design composition' in text, 'PASS composition_comment'

# V2 hostile regression checks (2026-09-29): new systems must not resurrect
# old failure modes, and must wire into the real loop (no dead code).
v2_checks = [
    ("v2_briefing_is_pre_phase", '"BRIEFING"' in text and 'elif phase == "BRIEFING":' in text),
    ("v2_replay_returns_to_briefing", '_replay()' in text and '_start_briefing()' in text),
    ("v2_missions_wired", 'MISSIONS[mission_id]' in text and 'mission_success' in text),
    ("v2_mission_fail_path_exists", 'mission_failed_early' in text and 'mission_success = false' in text),
    ("v2_modern_units_consume_reserve", 'reserve.drone -= 1' in text and 'reserve.specops -= 1' in text and 'reserve.armor -= 1' in text),
    ("v2_units_tracked", 'drone_used += 1' in text and 'specops_used += 1' in text and 'armor_used += 1' in text),
    ("v2_no_permanent_drone_retention", 'drones = drones.filter' in text),
    ("v2_no_permanent_specops_retention", 'specops_teams = specops_teams.filter' in text),
    ("v2_projectiles_cover_new_kinds", '"micro"' in text and '"tracer"' in text and '"shell"' in text and 'resolved_indices.append(i)' in text),
    ("v2_hard_is_behavioral", 'flank_t' in text and '"evade"' in text and 'lerpf(float(b.x), float(b.target)' in text),
    ("v2_no_hp_inflation", 'bunker_hp -= 12.0' in text and 'health -= 14.0' in text),
    ("v2_wave_victory_gated", 'wave >= BATTLE_WAVES' in text and '_finish_battle(bunker_hp > 0.0)' in text),
    ("v2_classic_timeout_preserved", 'if game_mode == "CLASSIC":' in text and 'phase_elapsed >= BATTLE_TIME' in text),
    ("v2_friendly_fire_real", 'AEGIS IMPACT — FRIENDLY FIRE ON OBJECTIVE' in text),
    ("v2_outcome_reports_mission", 'Mission: %s' in text),
    ("v2_no_duplicate_wave_spawner", len(re.findall(r'^func _update_wave_spawner\(', text, re.M)) == 1),
    ("v2_no_duplicate_update_drones", len(re.findall(r'^func _update_drones\(', text, re.M)) == 1),
    ("v2_no_duplicate_briefing", len(re.findall(r'^func _start_briefing\(', text, re.M)) == 1),
]
for name, ok in v2_checks:
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        raise SystemExit(1)
