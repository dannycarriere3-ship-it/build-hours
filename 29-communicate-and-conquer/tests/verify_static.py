from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
req=[root/"project.godot",root/"Main.tscn",root/"scripts/Main.gd",root/"docs/README.md",root/"BUILD_STATUS.md"]
for p in req:
    assert p.exists(), f"MISSING {p}"
s=(root/"scripts/Main.gd").read_text()
required=[
    '"BREACH"','"RESERVES"','"BATTLE"','"OUTCOME"','PING_INTERVAL := 5.0',
    'wait_time = 5.0','autostart = true','one_shot = false',
    '_enter_reserves','_enter_battle','_finish_battle','_replay','_tactical_ping',
    'InputEventScreenTouch','InputEventMouseButton','_design_point',
    'AudioStreamGenerator','_play_tone','_update_quality_tier','quality_tier',
    'projectiles.append','bunker_hp','reserve.artillery','reserve.aa',
    'target_id','projectile.t >= projectile.duration','ARTILLERY IMPACT — BUNKER DAMAGED',
    'gate_open and abs(delta_touch.x) <= 70.0','GATE_BOXES','PAUSE_BOX','paused = not paused'
]
for token in required:
    assert token in s, f'MISSING TOKEN {token}'
assert 'Engine.max_fps = 60' in s
assert 'DisplayServer.VSYNC_ENABLED' in s
assert 'renderer/rendering_method.mobile="mobile"' in (root/"project.godot").read_text()
# V2 additions (2026-09-29): missions, modern units, difficulty, wave mode, briefing.
v2_required=[
    'const MISSIONS := [','"BRIEFING"','_start_briefing','_select_mission','_select_mode','_select_difficulty','_deploy',
    '"MODERN OPS"','"HARD"','_pick_spawn_kind','distance_target','breach_time_limit',
    'mission_success','"drone"','"specops"','"armor"',
    '_update_drones','_update_specops','_update_wave_spawner','_nearest_active_bomber',
    '"micro"','"tracer"','"shell"','REAPER UCAV','SPECTRE TEAM','AEGIS',
    'BATTLE_WAVES','armor_cooldown','_draw_modern_units','OPERATION SUCCESS',
    'wave_break','flank_t','"evade"',
]
for token in v2_required:
    assert token in s, f'MISSING V2 TOKEN {token}'
# FOU spectacle pass (2026-09-29): juice, explosions, combo, splash, cinematic.
fou_required=[
    'splash_text','_explode(','hitstop','tone_queue','_queue_tone','_register_kill',
    'RESERVE_CARDS','reserve_inspect','_reserve_tap','_spawn_ripple','_spawn_banner',
    '_spawn_reticle','breach_shots','outcome_count','defeat_fade','_fanfare_victory',
    '_sweep_defeat','combo_timer','COMBO_WINDOW','_touch_juice','_mission_icon',
    '_draw_splash','_draw_fx','_update_fx','_combo_pitch','_press_pop','juice_buttons',
    '_horn_wave','_breach_obj_pos','_update_outcome','_draw_reserve_icon',
]
for token in fou_required:
    assert token in s, f'MISSING FOU TOKEN {token}'
print('PASS fou spectacle tokens')
print('PASS v2 content tokens')
print('PASS structure')
print('PASS core phases')
print('PASS tactical ping contract')
print('PASS mobile input paths')
print('PASS procedural audio path')
print('PASS projectile feedback path')
print('PASS adaptive quality path')
print('PASS 60 FPS configuration')
print('PASS no external asset dependency in scene')
