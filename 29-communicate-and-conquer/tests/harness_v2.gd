# V2 execution harness — runs the REAL Main.gd game logic headless and proves
# every new V2 system by driving actual functions and asserting real state.
# No mocks: every check executes genuine code paths (spawns, updates,
# projectiles, wave spawner, mission evaluation).
extends SceneTree

var main: Node
var passed := 0
var failed := 0
var frame := 0
var ran := false

func _init() -> void:
	var ps: PackedScene = load("res://Main.tscn")
	main = ps.instantiate()
	root.add_child(main)

func _check(name: String, cond: bool) -> void:
	if cond:
		passed += 1
		print("PASS ", name)
	else:
		failed += 1
		print("FAIL ", name)

func _process(_delta: float) -> bool:
	frame += 1
	if frame < 5:
		return false
	if not ran:
		ran = true
		_run_tests()
		print("HARNESS: %d passed, %d failed" % [passed, failed])
	return true

func _fresh_battle() -> void:
	main._enter_battle()
	main.battle_fire_cooldown = 0.0
	main.bombers.clear()

func _run_tests() -> void:
	# 1 — game boots into BRIEFING (additive pre-phase, loop intact).
	_check("boot_to_briefing", main.phase == "BRIEFING")

	# 2 — briefing selection drives a real parameterized breach.
	main._select_mission(2)
	main._select_mode("MODERN OPS")
	main._select_difficulty("HARD")
	main._deploy()
	_check("deploy_param_breach",
		main.phase == "BREACH" and main.distance_target == 2600.0
		and main.game_mode == "MODERN OPS" and main.difficulty == "HARD")

	# 3 — classic mission: breach_complete wins on reaching the line.
	main.mission_id = 0
	main.difficulty = "NORMAL"
	main.game_mode = "CLASSIC"
	main._start_breach()
	main.intel = 0
	main._enter_reserves()
	_check("mission_classic_win", main.mission_success and main.phase == "RESERVES")

	# 4/5 — GHOST HARVEST intel quota: real win and real fail.
	main.mission_id = 1
	main._start_breach()
	main.intel = 6
	main._enter_reserves()
	_check("mission_intel_win", main.mission_success)
	main._start_breach()
	main.intel = 2
	main._enter_reserves()
	_check("mission_intel_fail", not main.mission_success)

	# 6 — IRONHOLD hp floor: real evaluation.
	main.mission_id = 2
	main._start_breach()
	main.health = 72.0
	main._enter_reserves()
	_check("mission_hp_win", main.mission_success)
	main._start_breach()
	main.health = 30.0
	main._enter_reserves()
	_check("mission_hp_fail", not main.mission_success)

	# 7/8 — NIGHT RAID time attack: forced extraction fails, fast breach wins.
	main.mission_id = 3
	main._start_breach()
	main.phase_elapsed = 40.0
	main._update_breach(0.016)
	_check("mission_time_expired", main.phase == "RESERVES" and not main.mission_success)
	main._start_breach()
	main.breach_objects.clear()
	main.distance = 2650.0
	main._update_breach(0.5)          # gate opens past 2700
	main._choose_gate(0)
	main.distance = 3499.0
	main._update_breach(0.2)          # crosses 3500 with gate resolved
	_check("mission_time_win", main.phase == "RESERVES" and main.mission_success)

	# 9/10 — HARD flanking is real behavior; NORMAL has none.
	main.mission_id = 0
	main.difficulty = "HARD"
	main._start_breach()
	main.breach_objects.clear()
	main.player_lane = 2
	main.breach_objects.append({"z": 1000.0, "lane": 0, "kind": "enemy", "alive": true, "pulse": 0.0, "flank_t": 2.0})
	main._update_breach(0.1)
	_check("hard_flank", int(main.breach_objects[0].lane) == 1)
	main.difficulty = "NORMAL"
	main._start_breach()
	main.breach_objects.clear()
	main.player_lane = 2
	main.breach_objects.append({"z": 1000.0, "lane": 0, "kind": "enemy", "alive": true, "pulse": 0.0, "flank_t": 2.0})
	main._update_breach(0.1)
	_check("normal_no_flank", int(main.breach_objects[0].lane) == 0)

	# 11 — HARD bombers genuinely focus-fire the objective.
	main.difficulty = "HARD"
	main._spawn_bomber()
	var hb: Dictionary = main.bombers[main.bombers.size() - 1]
	_check("hard_focus_fire", absf(float(hb.target) - 640.0) < 80.0)
	main.bombers.clear()

	# 12 — REAPER UCAV: deploy, autonomous hunt, real id-locked kill.
	main.difficulty = "NORMAL"
	main.game_mode = "CLASSIC"
	_fresh_battle()
	main._spawn_bomber()
	var db: Dictionary = main.bombers[0]
	var db_id := int(db.id)
	db.x = 640.0
	db.y = 200.0
	db.speed = 0.0                      # freeze: inactive afterwards ⟺ killed
	main.reserve.drone = 1
	main.selected_action = "DRONE"
	main._battle_action(Vector2(640, 300))
	_check("drone_deploys", main.drones.size() == 1 and int(main.reserve.drone) == 0)
	var score_before: int = main.battle_score
	for i in range(240):
		main._update_battle(1.0 / 60.0)
		main._update_projectiles(1.0 / 60.0)
	var db_dead := true
	for b in main.bombers:
		if int(b.id) == db_id and bool(b.get("active", true)):
			db_dead = false
	_check("drone_kills", db_dead and main.battle_score >= score_before + 3)

	# 13 — SPECTRE TEAM: zone denial, real id-locked kill.
	_fresh_battle()
	main._spawn_bomber()
	var sb: Dictionary = main.bombers[0]
	var sb_id := int(sb.id)
	sb.x = 600.0
	sb.y = 350.0
	sb.speed = 0.0
	main.reserve.specops = 1
	main.selected_action = "SPECOPS"
	main._battle_action(Vector2(600, 550))
	_check("specops_deploys", main.specops_teams.size() == 1 and int(main.reserve.specops) == 0)
	for i in range(240):
		main._update_battle(1.0 / 60.0)
		main._update_projectiles(1.0 / 60.0)
	var sb_dead := true
	for b in main.bombers:
		if int(b.id) == sb_id and bool(b.get("active", true)):
			sb_dead = false
	_check("specops_kills", sb_dead)

	# 14 — AEGIS shell: wide blast kills a cluster, no friendly fire at range.
	_fresh_battle()
	var armor_ids := []
	for pos in [Vector2(500, 200), Vector2(540, 220), Vector2(580, 200)]:
		main._spawn_bomber()
		var ab: Dictionary = main.bombers[main.bombers.size() - 1]
		ab.x = pos.x
		ab.y = pos.y
		ab.speed = 0.0
		armor_ids.append(int(ab.id))
	var hp_before: float = main.bunker_hp
	main.reserve.armor = 1
	main.armor_cooldown = 0.0
	main.selected_action = "ARMOR"
	main._battle_action(Vector2(540, 210))
	for i in range(60):
		main._update_battle(1.0 / 60.0)
		main._update_projectiles(1.0 / 60.0)
	var all_dead := true
	for b in main.bombers:
		if int(b.id) in armor_ids and bool(b.get("active", true)):
			all_dead = false
	_check("armor_aoe", all_dead and main.bunker_hp == hp_before and main.armor_cooldown > 0.0)

	# 15 — AA lock triggers genuine evasive behavior on HARD.
	main.difficulty = "HARD"
	_fresh_battle()
	main._spawn_bomber()
	var eb: Dictionary = main.bombers[0]
	eb.x = 600.0
	eb.y = 300.0
	eb.speed = 0.0
	main.reserve.aa = 1
	main.selected_action = "AA"
	main._battle_action(Vector2(600, 300))
	_check("aa_triggers_evade", float(eb.get("evade", 0.0)) == 1.0)
	main.difficulty = "NORMAL"

	# 16/17 — MODERN OPS wave machine: clear → break → next wave.
	main.game_mode = "MODERN OPS"
	main._start_breach()
	main._enter_reserves()
	main._enter_battle()
	_check("wave_init", main.wave == 1 and main.wave_total == 5 and main.bombers.is_empty())
	main.wave_spawned = main.wave_total
	main._update_battle(0.1)
	_check("wave_clear_break", main.wave_break > 0.0 and int(main.reserve.artillery) >= 1)
	main.wave_break = 0.05
	main._update_battle(0.1)
	_check("wave_advance", main.wave == 2 and main.wave_spawned == 0 and main.wave_total == 7)
	main.game_mode = "CLASSIC"

	# 18 — reserve rebalance: modern units earned by performance, never free.
	main.mission_id = 0
	main._start_breach()
	main.score = 500
	main.intel = 6
	main.health = 80.0
	main._enter_reserves()
	_check("reserve_earned", int(main.reserve.drone) == 1 and int(main.reserve.specops) == 1 and int(main.reserve.armor) == 1)
	main._start_breach()
	main.score = 100
	main.intel = 1
	main.health = 40.0
	main._enter_reserves()
	_check("reserve_not_free", int(main.reserve.drone) == 0 and int(main.reserve.specops) == 0 and int(main.reserve.armor) == 0)

	# 19 — operation outcome requires battle win AND mission success.
	main.mission_id = 1
	main.mission_success = false
	main._finish_battle(true)
	_check("battle_win_mission_fail", main.feedback == "BATTLE WON — MISSION FAILED")
	main.mission_success = true
	main._finish_battle(true)
	_check("operation_success", main.feedback == "OPERATION SUCCESS — MISSION COMPLETE")
	main._finish_battle(false)
	_check("operation_defeat", main.battle_result == "DEFEAT" and main.feedback == "OBJECTIVE LOST")

	# 20 — REPLAY returns to BRIEFING with incremented run number.
	var rn: int = main.run_number
	main._replay()
	_check("replay_to_briefing", main.phase == "BRIEFING" and main.run_number == rn + 1)

	# 21/22 — NIGHT RAID win check genuinely enforces the time limit.
	# Regression: the check once evaluated the reset timer and was always true
	# regardless of breach time (masked by the in-run forced extraction).
	main.mission_id = 3
	main._start_breach()
	main.phase_elapsed = 40.0
	main._enter_reserves()
	_check("time_win_enforced_fail", not main.mission_success)
	main._start_breach()
	main.phase_elapsed = 20.0
	main._enter_reserves()
	_check("time_win_enforced_pass", main.mission_success)

	# 23/24 — touch and mouse share identical gate hit boxes (shared constants).
	# Regression: the mouse boxes were offset and clipped vs the touch boxes
	# and the drawn rects (gate 1's mouse box clipped at x<995).
	main.mission_id = 0
	main._start_breach()
	main.gate_options = [{"type": "firepower"}, {"type": "discipline"}] as Array[Dictionary]
	main.gate_open = true
	main.gate_resolved = false
	main.gate_choice = -1
	var design_gate1 := Vector2(1000, 400)
	var vp_gate1: Vector2 = main.get_canvas_transform() * (design_gate1 * 2.0)
	var tp := InputEventScreenTouch.new()
	tp.pressed = true
	tp.position = vp_gate1
	main._input(tp)
	var tr := InputEventScreenTouch.new()
	tr.pressed = false
	tr.position = vp_gate1
	main._input(tr)
	_check("touch_gate1", main.gate_choice == 1)
	main.gate_open = true
	main.gate_resolved = false
	main.gate_choice = -1
	var mb := InputEventMouseButton.new()
	mb.pressed = true
	mb.button_index = MOUSE_BUTTON_LEFT
	mb.position = vp_gate1
	main._input(mb)
	_check("mouse_gate1", main.gate_choice == 1)

	# 25 — pause region identical for touch and mouse.
	main.gate_open = false
	main.paused = false
	var design_pause := Vector2(1200, 40)
	var vp_pause: Vector2 = main.get_canvas_transform() * (design_pause * 2.0)
	var tp2 := InputEventScreenTouch.new()
	tp2.pressed = true
	tp2.position = vp_pause
	main._input(tp2)
	var tr2 := InputEventScreenTouch.new()
	tr2.pressed = false
	tr2.position = vp_pause
	main._input(tr2)
	var paused_after_touch: bool = main.paused
	var mb2 := InputEventMouseButton.new()
	mb2.pressed = true
	mb2.button_index = MOUSE_BUTTON_LEFT
	mb2.position = vp_pause
	main._input(mb2)
	_check("pause_parity", paused_after_touch and not main.paused)

	# 26 — BATTLE tap mapping: taps resolve through the same single
	# viewport->design mapping the repaired mouse fire path uses.
	# (Headless cannot warp the OS mouse, so the fire action's polled path is
	# additionally guarded by verify_v2.py's static single-mapping checks;
	# this test proves the shared _design_point mapping behaviorally.)
	main._start_breach()
	main._enter_reserves()
	main._enter_battle()
	main.selected_action = "ARTILLERY"
	main.reserve.artillery = 3
	main.battle_fire_cooldown = 0.0
	main.projectiles.clear()
	var design_tap := Vector2(700, 400)
	var vp_tap: Vector2 = main.get_canvas_transform() * (design_tap * 2.0)
	var ttp := InputEventScreenTouch.new()
	ttp.pressed = true
	ttp.position = vp_tap
	main._input(ttp)
	var ttr := InputEventScreenTouch.new()
	ttr.pressed = false
	ttr.position = vp_tap
	main._input(ttr)
	var tap_target := Vector2(-9999, -9999)
	if not main.projectiles.is_empty():
		tap_target = main.projectiles[main.projectiles.size() - 1].target
	_check("battle_tap_mapping", tap_target.distance_to(main._design_point(vp_tap)) < 1.0)

	# 27 — FOU: touch anywhere spawns ripple ring + spark burst (data-driven).
	main._start_breach()
	main.ripples.clear()
	main.fx.clear()
	var vp_any: Vector2 = main.get_canvas_transform() * (Vector2(640, 360) * 2.0)
	var jt := InputEventScreenTouch.new()
	jt.pressed = true
	jt.position = vp_any
	main._input(jt)
	_check("touch_juice", not main.ripples.is_empty() and not main.fx.is_empty())

	# 28 — FOU: _explode builds shockwaves + debris; arrays stay hard-capped.
	main.shockwaves.clear()
	main.fx.clear()
	main.hitstop = 0.0
	main._explode(Vector2(640, 400), 1.0, true)
	_check("explode_fx", main.shockwaves.size() >= 2 and main.fx.size() > 0 and main.hitstop > 0.0)
	for i in range(600):
		main._explode(Vector2(640, 400), 1.0, false)
	_check("explode_capped", main.shockwaves.size() <= 48 and main.fx.size() <= 320)

	# 29 — FOU: hit-stop freezes the sim clock while fx keep animating.
	main.hitstop = 0.05
	var hs_fx_before: int = main.fx.size()
	var pe: float = main.phase_elapsed
	main._process(0.03)
	_check("hitstop_freezes_sim", main.phase_elapsed == pe and main.hitstop < 0.05)

	# 30 — FOU: kill registration feeds one shared combo chain (counter,
	# window reset, pop envelope, floating popup, escalating pitch path).
	main.combo = 0
	main.popups.clear()
	main._register_kill(Vector2(500, 300), "TEST KILL", 10, 1)
	_check("combo_register", main.combo == 1 and main.combo_timer > 2.0
		and main.combo_pop > 0.0 and not main.popups.is_empty())

	# 31 — FOU: combo window expiry genuinely resets the counter.
	main.combo = 4
	main.combo_timer = 0.01
	main.hitstop = 0.0
	main._process(0.05)
	_check("combo_expiry", main.combo == 0)

	# 32 — FOU: phase splash cards ride the existing transition var.
	main._start_breach()
	_check("splash_breach", main.splash_text == "BREACH" and main.transition > 0.0)
	main._enter_reserves()
	_check("splash_reserves", main.splash_text == "RESERVES" and main.transition > 0.0)
	main._enter_battle()
	_check("splash_battle", main.splash_text == "BATTLE" and main.transition > 0.0)

	# 33 — FOU: RESERVES unit cards are tappable; inspect toggles a detail popup.
	main._start_breach()
	main._enter_reserves()
	main.reserve_inspect = -1
	var card_c: Vector2 = main.RESERVE_CARDS[2].get_center()
	var vp_card: Vector2 = main.get_canvas_transform() * (card_c * 2.0)
	var rt := InputEventScreenTouch.new()
	rt.pressed = true
	rt.position = vp_card
	main._input(rt)
	var rr := InputEventScreenTouch.new()
	rr.pressed = false
	rr.position = vp_card
	main._input(rr)
	_check("reserves_inspect", main.reserve_inspect == 2)
	main._input(rt)
	main._input(rr)
	_check("reserves_inspect_toggle", main.reserve_inspect == -1)

	# 34 — FOU: battle taps plant an animated aim reticle at the tap point.
	main._enter_battle()
	main.reticles.clear()
	main.selected_action = "ARTILLERY"
	main.reserve.artillery = 3
	main.battle_fire_cooldown = 0.0
	main._battle_action(Vector2(700, 400))
	_check("battle_reticle", not main.reticles.is_empty())

	# 35 — FOU: artillery multi-kill posts a DOUBLE KILL banner.
	_fresh_battle()
	for pos in [Vector2(540, 210), Vector2(560, 220)]:
		main._spawn_bomber()
		var kb: Dictionary = main.bombers[main.bombers.size() - 1]
		kb.x = pos.x
		kb.y = pos.y
		kb.speed = 0.0
	main.banners.clear()
	main.reserve.artillery = 2
	main.selected_action = "ARTILLERY"
	main.battle_fire_cooldown = 0.0
	main._battle_action(Vector2(550, 215))
	for i in range(40):
		main._update_battle(1.0 / 60.0)
		main._update_projectiles(1.0 / 60.0)
	var saw_kill_banner := false
	for b in main.banners:
		if "KILL" in String(b.text):
			saw_kill_banner = true
	_check("multikill_banner", saw_kill_banner)

	# 36 — FOU: wave transitions slam a banner and sound the horn.
	main.game_mode = "MODERN OPS"
	main._start_breach()
	main._enter_reserves()
	main._enter_battle()
	main.banners.clear()
	main.tone_queue.clear()
	main.wave_spawned = main.wave_total
	main._update_battle(0.1)
	main.wave_break = 0.05
	main._update_battle(0.1)
	var saw_wave_banner := false
	for b in main.banners:
		if "WAVE 2" in String(b.text):
			saw_wave_banner = true
	_check("wave_banner", saw_wave_banner and not main.tone_queue.is_empty())
	main.game_mode = "CLASSIC"

	# 37 — FOU: victory queues a fanfare + arms the score count-up;
	# defeat queues a low descending sweep.
	main.score = 500
	main.battle_score = 40
	main._finish_battle(true)
	_check("victory_fanfare", not main.tone_queue.is_empty() and main.outcome_target > 0.0)
	main.tone_queue.clear()
	main._finish_battle(false)
	var sweep_queued := false
	for t in main.tone_queue:
		if float(t.freq) < 400.0:
			sweep_queued = true
	_check("defeat_sweep", sweep_queued)

	# 38 — FOU: breach tap-shoot fires a visible tracer streak.
	main.mission_id = 0
	main._start_breach()
	main.breach_shots.clear()
	main.breach_objects.clear()
	main.player_lane = 1
	main.breach_objects.append({"z": 150.0, "lane": 1, "kind": "enemy", "alive": true, "pulse": 0.0, "flank_t": 2.0})
	main.breach_fire_cooldown = 0.0
	main._breach_hit(main.breach_objects[0])
	_check("breach_tracer", not main.breach_shots.is_empty())

	# 39 — FOU: button press pops scale (juice registry on all pressables).
	main._start_briefing()
	var mb0: Button = main.mission_buttons[0]
	main._press_pop(mb0)
	var pop_set: bool = mb0.has_meta("pop") and float(mb0.get_meta("pop")) > 0.0
	main._process(0.3)
	var pop_decayed: bool = (not mb0.has_meta("pop")) and mb0.scale == Vector2.ONE
	_check("button_pop", pop_set and pop_decayed)
