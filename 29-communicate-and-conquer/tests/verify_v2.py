# V2 design-contract verification (2026-09-29).
# Style matches tests/verify_static.py and tests/verify_automated.py.
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
g = (root / "scripts/Main.gd").read_text()
proj = (root / "project.godot").read_text()
preset = (root / "export_presets.cfg").read_text()

checks = {}

def check(name, cond):
    checks[name] = bool(cond)

# Mission table: 4 missions, distinct win kinds, sane parameters.
missions = re.findall(r'\{"id":(\d+),"title":"([^"]+)"', g)
check("four_missions", len(missions) == 4 and [m[0] for m in missions] == ["0", "1", "2", "3"])
for kind in ['"breach_complete"', '"intel_quota"', '"hp_floor"', '"time_attack"']:
    check("win_kind_" + kind.strip('"'), kind in g)
check("mission_distances_sane", '"distance_target":3500.0' in g and '"distance_target":2600.0' in g)
check("mission_time_limit_sane", '"breach_time_limit":32.0' in g)
check("mission_weights_sum", all(
    abs(sum(float(x) for x in w) - 1.0) < 0.001
    for w in re.findall(r'"w_enemy":([\d.]+),"w_intel":([\d.]+),"w_supply":([\d.]+),"w_hazard":([\d.]+)', g)
))

# Modern-unit roster: 3 new units, distinct mechanics, real costs.
check("three_modern_units", all(x in g for x in ['"DRONE"', '"SPECOPS"', '"ARMOR"']))
check("drone_loiter_mechanic", '"life":12.0' in g and '"micro"' in g)
check("specops_zone_mechanic", '"life":15.0' in g and '"tracer"' in g and '240.0' in g)
check("armor_reload_mechanic", 'armor_cooldown = 1.4' in g and '"shell"' in g)
check("armor_blast_radius", 'distance_to(impact_pos) < 200.0' in g)
check("five_action_buttons", '["DRONE", "DRONE"]' in g and 'KEY_5' in g)

# Difficulty: behavioral, not inflation.
check("hard_flank_mechanic", 'obj.flank_t' in g)
check("hard_focus_fire_mechanic", 'lerpf(float(b.x), float(b.target)' in g)
check("hard_evade_mechanic", 'bombers[best].evade = 1.0' in g)
check("damage_values_unchanged", 'bunker_hp -= 12.0' in g and 'health -= 14.0' in g)

# Mode: wave machine with real victory gate.
check("five_waves", 'const BATTLE_WAVES := 5' in g)
check("wave_escalation", '3 + wave * 2' in g)
check("wave_resupply", '+1 ARTILLERY RESUPPLY' in g)

# V2 versioning: neutral, no codename, package id unchanged.
check("version_name_2", 'version/name="2.0"' in preset)
check("version_code_3", 'version/code=3' in preset)
check("export_target_v2", 'export_path="../cc-max11-v2.apk"' in preset)
check("package_id_unchanged", 'com.carriereroofing.communicateconquer' in preset)
check("project_version_2", 'config/version="2.0"' in proj)
for bad in ["BEBE NOEL", "BÉBÉ NOËL", "bebe-noel", "YAPODA", "HOTEL"]:
    check("no_leftover_" + bad.lower().replace(" ", "_").replace("É", "e"), bad not in g and bad not in proj)

# Repairs (Claude audit 2026-09-29): win check, hit-test parity, fire mapping.
check("win_uses_breach_elapsed", "var breach_elapsed := phase_elapsed" in g
      and "mission_success = breach_elapsed <= float(m.quota)" in g)
check("no_double_canvas_mapping", "get_global_mouse_position" not in g)
check("fire_uses_viewport_mouse", "_design_point(get_viewport().get_mouse_position())" in g)
check("shared_hit_box_consts", "const GATE_BOXES :=" in g and "const PAUSE_BOX :=" in g)
check("gate_boxes_match_drawn", "Rect2(215, 300, 400, 190)" in g and "Rect2(655, 300, 400, 190)" in g)
check("both_paths_use_shared_boxes", g.count("GATE_BOXES[") >= 4 and g.count("PAUSE_BOX.has_point") >= 2)

failed = [k for k, v in checks.items() if not v]
print("V2 CONTRACT:", "PASS" if not failed else "FAIL")
for k, v in checks.items():
    print(("PASS " if v else "FAIL ") + k)
if failed:
    raise SystemExit(1)
