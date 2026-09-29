extends Node2D

# COMMUNICATE & CONQUER — maximum vertical slice reconstruction
# Core loop: BREACH -> RESERVES -> BATTLE -> OUTCOME -> REPLAY
# This build is intentionally asset-free: all visuals are procedural Godot draw calls.
# Mandatory recurring tactical ping: 5.0 seconds, autostart, one_shot=false.

const W := 1280.0
const H := 720.0
const PING_INTERVAL := 5.0
const MAX_RUN_TIME := 45.0
const BATTLE_TIME := 55.0
const BUNKER_POS := Vector2(640.0, 505.0)
const BATTLE_WAVES := 5
# Shared UI hit boxes (design coordinates) — single source of truth for BOTH
# touch and mouse input paths, so both test identical regions. Values match
# the rects drawn in _draw_gate_overlay() and _draw_hud_frame().
const GATE_BOXES := [Rect2(215, 300, 400, 190), Rect2(655, 300, 400, 190)]
const PAUSE_BOX := Rect2(1120, 0, 160, 95)

# V2 mission table. Each mission is a briefing-selectable configuration that
# re-parameterizes the real BREACH simulation (spawn weights, distance, time
# limit) and defines a genuine win condition evaluated at real transitions.
# "win" kinds: breach_complete | intel_quota | hp_floor | time_attack.
const MISSIONS := [
	{"id":0,"title":"VANGUARD PROTOCOL","desc":"Classic run. Breach the line, convert, defend.",
	"distance_target":3500.0,"breach_time_limit":0.0,
	"w_enemy":0.25,"w_intel":0.25,"w_supply":0.25,"w_hazard":0.25,
	"objective":"Complete the breach","win":"breach_complete","quota":0.0,
	"bonus":{"artillery":0,"aa":0,"drone":0,"specops":0,"armor":0},
	"battle_pressure":1.0},
	{"id":1,"title":"GHOST HARVEST","desc":"Intel sweep. Collect 6+ intel before the breach ends.",
	"distance_target":3500.0,"breach_time_limit":0.0,
	"w_enemy":0.20,"w_intel":0.40,"w_supply":0.20,"w_hazard":0.20,
	"objective":"Collect 6 intel","win":"intel_quota","quota":6.0,
	"bonus":{"artillery":0,"aa":0,"drone":1,"specops":0,"armor":0},
	"battle_pressure":1.0},
	{"id":2,"title":"IRONHOLD","desc":"Short brutal breach. Finish with 50+ HP. Heavy air pressure.",
	"distance_target":2600.0,"breach_time_limit":0.0,
	"w_enemy":0.30,"w_intel":0.15,"w_supply":0.20,"w_hazard":0.35,
	"objective":"Finish breach with 50+ HP","win":"hp_floor","quota":50.0,
	"bonus":{"artillery":0,"aa":2,"drone":1,"specops":0,"armor":0},
	"battle_pressure":1.35},
	{"id":3,"title":"NIGHT RAID","desc":"Timed infiltration. Breach the line in under 32 seconds.",
	"distance_target":3500.0,"breach_time_limit":32.0,
	"w_enemy":0.30,"w_intel":0.20,"w_supply":0.25,"w_hazard":0.25,
	"objective":"Breach in under 32s","win":"time_attack","quota":32.0,
	"bonus":{"artillery":1,"aa":0,"drone":0,"specops":1,"armor":0},
	"battle_pressure":1.0},
]

var phase := "BREACH"
var phase_elapsed := 0.0
var total_elapsed := 0.0
var score := 0
var combo := 0
var health := 100.0
var intel := 0
var reserve := {"artillery": 0, "aa": 0}
var selected_action := "ARTILLERY"
var battle_result := ""
var run_number := 1
var ping_count := 0
var last_ping := 0.0
var ping_visual_time := -1.0
var gate_bonus_artillery := 0
var gate_bonus_aa := 0
var ping_timer: Timer
var feedback := "MOVE • SHOOT • DODGE • COLLECT"
var feedback_timer := 0.0
var camera_shake := 0.0
var flash := 0.0
var transition := 0.0
var rng := RandomNumberGenerator.new()
var touch_start := Vector2.ZERO
var touch_active := false
var quality_fps := 0.0
var quality_accum := 0.0
var quality_frames := 0
var quality_tier := 3
var quality_stable_time := 0.0
var quality_pressure_time := 0.0
var paused := false
var breach_fire_cooldown := 0.0
var battle_fire_cooldown := 0.0
var projectiles: Array[Dictionary] = []
var audio_player: AudioStreamPlayer
var audio_generator: AudioStreamGenerator

# Breach state
var player_x := 640.0
var player_lane := 1
var lane_x := [360.0, 640.0, 920.0]
var breach_objects: Array[Dictionary] = []
var distance := 0.0
var gate_options: Array[Dictionary] = []
var gate_open := false
var gate_choice := -1
var gate_banner := ""
var gate_time_left := 0.0
var gate_resolved := false
var total_battle_damage := 0.0
var artillery_used := 0
var aa_used := 0

# V2 extension state: mission/mode/difficulty selection, modern-unit entities,
# wave-mode battle state, and per-mission breach parameterization.
var game_mode := "CLASSIC"          # CLASSIC | MODERN OPS
var difficulty := "NORMAL"          # NORMAL | HARD
var mission_id := 0
var mission_success := false
var mission_failed_early := false
var drones: Array[Dictionary] = []
var specops_teams: Array[Dictionary] = []
var armor_cooldown := 0.0
var drone_used := 0
var specops_used := 0
var armor_used := 0
var wave := 0
var wave_spawned := 0
var wave_total := 0
var wave_timer := 0.0
var wave_break := 0.0
var distance_target := 3500.0
var breach_time_limit := 0.0
var spawn_w := {"enemy":0.25,"intel":0.25,"supply":0.25,"hazard":0.25}
var battle_pressure := 1.0
var briefing_overlay: ColorRect
var briefing_panel: Panel
var briefing_summary: Label
var mission_buttons: Array[Button] = []
var mode_buttons: Array[Button] = []
var diff_buttons: Array[Button] = []
var deploy_button: Button

# Battle state
var battle_score := 0
var bunker_hp := 100.0
var bomber_timer := 0.0
var bomber_next := 4.0
var bombers: Array[Dictionary] = []
var impacts: Array[Dictionary] = []
var battle_message := ""
var battle_message_timer := 0.0
var battle_spawn_timer := 0.0
var next_bomber_id := 1

# FOU spectacle state — all plain Dictionary arrays (headless-testable), hard
# capped so runaway spawns can never degrade the 60fps S25+ target.
var fx: Array[Dictionary] = []            # particles: p/v/life/max_life/color/size/grav
var shockwaves: Array[Dictionary] = []    # expanding rings: p/life/max_life/max_r/color/width
var ripples: Array[Dictionary] = []       # touch ripple rings: p/life/max_life/max_r/color
var popups: Array[Dictionary] = []        # floating score text: p/text/life/max_life/color/size
var banners: Array[Dictionary] = []       # slam-in cards: text/sub/life/max_life/color
var reticles: Array[Dictionary] = []      # battle aim markers: p/life/max_life
var breach_shots: Array[Dictionary] = [] # breach tracers: a/b/t/dur
var tone_queue: Array[Dictionary] = []    # scheduled tones: freq/dur/gain/delay
var hitstop := 0.0                        # brief sim freeze on heavy kills (fx keep animating)
var combo_timer := 0.0                    # kill-chain window; expiry resets combo
var combo_pop := 0.0                      # HUD pop envelope on combo increment
const COMBO_WINDOW := 2.5
var splash_text := ""                     # phase title card, driven by `transition`
var splash_sub := ""
var reserve_inspect := -1                 # RESERVES card under inspection (-1 = none)
# Tappable unit cards in RESERVES — single source of truth for input AND draw.
const RESERVE_CARDS := [Rect2(80, 260, 208, 190), Rect2(312, 260, 208, 190), Rect2(544, 260, 208, 190), Rect2(776, 260, 208, 190), Rect2(1008, 260, 208, 190)]
const RESERVE_UNITS := [
    {"key":"artillery","name":"ARTILLERY","desc":"Long-range barrage.\nTap a target; shells arc in and\nclear air threats in the blast zone."},
    {"key":"aa","name":"AA BATTERY","desc":"Interceptor missiles.\nLocks the hostile nearest your tap\nand hunts it down. Best vs fast movers."},
    {"key":"drone","name":"REAPER UCAV","desc":"Autonomous hunter.\nLoiters 12s, firing micro-missiles\non its own. Fire-and-forget."},
    {"key":"specops","name":"SPECTRE TEAM","desc":"Ground insertion.\nDenies a 240m zone for 15s.\nDeploy on the ground band."},
    {"key":"armor","name":"AEGIS MBT","desc":"Heavy shell, huge blast, 1.4s reload.\nDANGER: the blast damages the\nobjective too. Aim clear of the bunker."},
]
var outcome_count := 0.0                  # victory score count-up (animated)
var outcome_target := 0.0
var defeat_fade := 0.0                    # defeat desaturation envelope 0..1
var ember_cd := 0.0
var lowhp_warn_cd := 0.0
var juice_buttons: Array[Button] = []     # every pressable gets scale-pop + flash

# UI
var title_font: Font
var body_font: Font
var ui_root: Control
var phase_label: Label
var headline_label: Label
var sub_label: Label
var reserve_label: Label
var objective_label: Label
var feedback_label: Label
var action_buttons: Array[Button] = []
var overlay: ColorRect
var outcome_panel: Panel
var outcome_title: Label
var outcome_body: Label
var replay_button: Button

func _ready() -> void:
    # S25+ target: native high-quality Mobile renderer with a hard 60 FPS ceiling.
    Engine.max_fps = 60
    DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED)
    rng.randomize()
    title_font = ThemeDB.fallback_font
    body_font = ThemeDB.fallback_font
    _configure_input()
    ping_timer = Timer.new()
    ping_timer.name = "PingTimer"
    ping_timer.wait_time = 5.0
    ping_timer.autostart = true
    ping_timer.one_shot = false
    ping_timer.timeout.connect(_on_ping_timer_timeout)
    add_child(ping_timer)
    _build_audio()
    _build_ui()
    # Keep the authored 1280x720 composition and scale it 2x into the 2560x1440
    # logical viewport configured for the MAX mobile profile.
    ui_root.position = Vector2.ZERO
    ui_root.size = Vector2(W, H)
    ui_root.scale = Vector2(2.0, 2.0)
    _start_briefing()
    queue_redraw()

func _process(delta: float) -> void:
    if paused:
        if ping_timer and not ping_timer.is_stopped():
            ping_timer.paused = true
        _update_ui()
        queue_redraw()
        return
    if ping_timer and ping_timer.paused:
        ping_timer.paused = false
    _update_tone_queue(delta)
    _update_fx(delta)
    _update_juice_buttons(delta)
    if hitstop > 0.0:
        # Hit-stop: the sim freezes for a beat on heavy kills while particles,
        # shockwaves, popups and banners keep animating — impact you can feel.
        hitstop -= delta
        _update_ui()
        queue_redraw()
        return
    total_elapsed += delta
    phase_elapsed += delta
    feedback_timer = max(0.0, feedback_timer - delta)
    camera_shake = max(0.0, camera_shake - delta * 5.0)
    flash = max(0.0, flash - delta * 4.0)
    transition = max(0.0, transition - delta * 0.85)
    if combo_timer > 0.0:
        combo_timer -= delta
        if combo_timer <= 0.0:
            combo = 0
    if ping_visual_time >= 0.0:
        ping_visual_time += delta
        if ping_visual_time > 0.9:
            ping_visual_time = -1.0
    breach_fire_cooldown = max(0.0, breach_fire_cooldown - delta)
    battle_fire_cooldown = max(0.0, battle_fire_cooldown - delta)
    _update_projectiles(delta)
    _update_impacts(delta)

    if phase == "BREACH":
        _update_breach(delta)
    elif phase == "BRIEFING":
        pass
    elif phase == "RESERVES":
        _update_reserves(delta)
    elif phase == "BATTLE":
        _update_battle(delta)
    elif phase == "OUTCOME":
        _update_outcome(delta)

    _update_ui()
    quality_accum += delta
    quality_frames += 1
    if quality_accum >= 0.5:
        quality_fps = quality_frames / quality_accum
        quality_accum = 0.0
        quality_frames = 0
        _update_quality_tier()
    queue_redraw()


func _configure_input() -> void:
    if not InputMap.has_action("move_left"):
        InputMap.add_action("move_left")
    if not InputMap.has_action("move_right"):
        InputMap.add_action("move_right")
    if not InputMap.has_action("fire"):
        InputMap.add_action("fire")
    var a := InputEventKey.new()
    a.physical_keycode = KEY_A
    InputMap.action_add_event("move_left", a)
    var d := InputEventKey.new()
    d.physical_keycode = KEY_D
    InputMap.action_add_event("move_right", d)
    var left := InputEventKey.new()
    left.physical_keycode = KEY_LEFT
    InputMap.action_add_event("move_left", left)
    var right := InputEventKey.new()
    right.physical_keycode = KEY_RIGHT
    InputMap.action_add_event("move_right", right)
    var space := InputEventKey.new()
    space.physical_keycode = KEY_SPACE
    InputMap.action_add_event("fire", space)
    var mouse_fire := InputEventMouseButton.new()
    mouse_fire.button_index = MOUSE_BUTTON_LEFT
    InputMap.action_add_event("fire", mouse_fire)

# -----------------------------------------------------------------------------
# LOOP / PHASES
# -----------------------------------------------------------------------------

func _start_breach() -> void:
    phase = "BREACH"
    phase_elapsed = 0.0
    distance = 0.0
    score = 0
    combo = 0
    health = 100.0
    intel = 0
    reserve = {"artillery": 0, "aa": 0, "drone": 0, "specops": 0, "armor": 0}
    gate_bonus_artillery = 0
    gate_bonus_aa = 0
    player_lane = 1
    player_x = lane_x[player_lane]
    breach_objects.clear()
    gate_options.clear()
    gate_open = false
    gate_choice = -1
    gate_time_left = 0.0
    gate_resolved = false
    total_battle_damage = 0.0
    artillery_used = 0
    aa_used = 0
    # V2: mission parameterization + modern-unit / wave state reset.
    var m: Dictionary = MISSIONS[mission_id]
    distance_target = float(m.distance_target)
    breach_time_limit = float(m.breach_time_limit)
    spawn_w = {"enemy": float(m.w_enemy), "intel": float(m.w_intel), "supply": float(m.w_supply), "hazard": float(m.w_hazard)}
    if difficulty == "HARD":
        # Genuinely denser hostile mix on HARD (behavioral pressure, not HP).
        spawn_w.enemy = minf(0.45, spawn_w.enemy + 0.05)
        spawn_w.hazard = minf(0.45, spawn_w.hazard + 0.05)
        var tot: float = spawn_w.enemy + spawn_w.intel + spawn_w.supply + spawn_w.hazard
        for k in spawn_w:
            spawn_w[k] = spawn_w[k] / tot
    battle_pressure = float(m.battle_pressure)
    mission_success = false
    mission_failed_early = false
    drones.clear()
    specops_teams.clear()
    armor_cooldown = 0.0
    drone_used = 0
    specops_used = 0
    armor_used = 0
    wave = 0
    wave_spawned = 0
    wave_total = 0
    wave_timer = 0.0
    wave_break = 0.0
    ping_count = 0
    ping_visual_time = -1.0
    projectiles.clear()
    impacts.clear()
    bombers.clear()
    fx.clear()
    shockwaves.clear()
    ripples.clear()
    popups.clear()
    banners.clear()
    reticles.clear()
    breach_shots.clear()
    tone_queue.clear()
    hitstop = 0.0
    combo_timer = 0.0
    combo_pop = 0.0
    splash_text = ""
    splash_sub = ""
    reserve_inspect = -1
    paused = false
    quality_tier = 4
    quality_pressure_time = 0.0
    quality_stable_time = 0.0
    feedback = "MISSION: %s — %s" % [String(m.title), String(m.objective)]
    _splash("BREACH", String(m.objective))
    for i in range(13):
        _spawn_breach_object(520.0 + i * 235.0)

func _enter_reserves() -> void:
    # Capture the TRUE breach duration before the phase timer resets. The
    # time_attack win condition must be evaluated against the real run time —
    # evaluating it after the reset made the check always true regardless of
    # breach time (the in-run forced extraction masked this broken evaluation).
    var breach_elapsed := phase_elapsed
    phase = "RESERVES"
    phase_elapsed = 0.0
    _splash("RESERVES", "PERFORMANCE BECOMES FIREPOWER")
    # V2: evaluate the mission win condition against real end-of-breach state.
    var m: Dictionary = MISSIONS[mission_id]
    var w: String = String(m.win)
    if mission_failed_early:
        mission_success = false
    elif w == "breach_complete":
        mission_success = true
    elif w == "intel_quota":
        mission_success = intel >= int(float(m.quota))
    elif w == "hp_floor":
        mission_success = health >= float(m.quota)
    elif w == "time_attack":
        mission_success = breach_elapsed <= float(m.quota)
    else:
        mission_success = true
    # Performance -> force conversion. This is the defining mechanic.
    # V2 rebalance: the roster economy now includes the modern units. Drone,
    # spec-ops and armor reserves are earned by battlefield performance
    # (intel / score / preserved health) plus mission bonuses — never free.
    reserve.artillery = clampi(1 + int(score / 90.0) + int(intel / 2) + gate_bonus_artillery, 1, 10)
    reserve.aa = clampi(int(score / 150.0) + int(intel / 4) + gate_bonus_aa, 0, 6)
    reserve.drone = clampi((1 if intel >= 5 else 0) + int(m.bonus.drone), 0, 3)
    reserve.specops = clampi((1 if score >= 400 else 0) + int(m.bonus.specops), 0, 3)
    reserve.armor = clampi((1 if health >= 60.0 else 0) + int(m.bonus.armor), 0, 3)
    if game_mode == "MODERN OPS":
        reserve.drone = mini(3, int(reserve.drone) + 1)
    if health < 35.0:
        reserve.artillery = max(1, reserve.artillery - 1)
        feedback = "DAMAGED RUN — RESERVES REDUCED"
    else:
        feedback = "BREACH COMPLETE — YOUR PERFORMANCE BECOMES YOUR ARMY"
    if not mission_success:
        feedback += "  •  MISSION FAILED: " + String(m.objective)

func _enter_battle() -> void:
    phase = "BATTLE"
    phase_elapsed = 0.0
    bunker_hp = 100.0
    battle_score = 0
    bomber_timer = 0.0
    bomber_next = 3.5
    bombers.clear()
    impacts.clear()
    battle_message = "DEFEND THE OBJECTIVE"
    battle_message_timer = 2.0
    selected_action = "ARTILLERY"
    total_battle_damage = 0.0
    artillery_used = 0
    aa_used = 0
    drone_used = 0
    specops_used = 0
    armor_used = 0
    armor_cooldown = 0.0
    next_bomber_id = 1
    lowhp_warn_cd = 0.0
    _splash("BATTLE", "MODERN OPS — 5 WAVES" if game_mode == "MODERN OPS" else "DEFEND THE OBJECTIVE")
    # V2: MODERN OPS replaces the timed defense with escalating waves.
    if game_mode == "MODERN OPS":
        wave = 1
        wave_spawned = 0
        wave_total = 3 + wave * 2
        wave_timer = 0.0
        wave_break = 0.0
        battle_message = "MODERN OPS — WAVE 1/%d" % BATTLE_WAVES
        battle_message_timer = 2.5
        _spawn_banner("WAVE 1 / %d" % BATTLE_WAVES, "MODERN OPS", Color(1.0, 0.72, 0.35, 1.0), 2.2)
        _horn_wave()
    else:
        _spawn_bomber()

func _finish_battle(victory: bool) -> void:
    # Entering OUTCOME is terminal for battle simulation. Discard in-flight
    # commands so they cannot mutate bunker/threat state after the battle ends.
    projectiles.clear()
    impacts.clear()
    bombers = bombers.filter(func(b): return bool(b.get("active", true)))
    phase = "OUTCOME"
    phase_elapsed = 0.0
    battle_result = "VICTORY" if victory else "DEFEAT"
    transition = 1.0
    flash = 1.0 if victory else 0.4
    splash_text = ""
    splash_sub = ""
    # FOU: the outcome cinematic — victory earns a count-up, ember field and
    # fanfare; defeat earns a slow desaturating fade and a low sweep.
    outcome_count = 0.0
    defeat_fade = 0.0
    ember_cd = 0.0
    if victory:
        outcome_target = float(score + battle_score)
        _fanfare_victory()
        _burst(Vector2(640, 700), 40, 220.0, 1.6, Color(1.0, 0.8, 0.35, 1.0), 5.0, -160.0)
        _burst(Vector2(640, 700), 24, 180.0, 1.8, Color(0.45, 1.0, 0.7, 1.0), 4.5, -140.0)
    else:
        outcome_target = 0.0
        _sweep_defeat()
    # V2: the operation succeeds only if the battle is won AND the mission
    # objective was met — two real win conditions, one outcome.
    if victory and mission_success:
        feedback = "OPERATION SUCCESS — MISSION COMPLETE"
    elif victory:
        feedback = "BATTLE WON — MISSION FAILED"
    else:
        feedback = "OBJECTIVE LOST"
    _play_tone(720.0 if victory else 120.0, 0.28, 0.18)

func _replay() -> void:
    run_number += 1
    _play_tone(520.0, 0.10, 0.16)
    _start_briefing()

# -----------------------------------------------------------------------------
# V2 — BRIEFING (mission / mode / difficulty selection, additive pre-phase)
# -----------------------------------------------------------------------------

func _start_briefing() -> void:
    phase = "BRIEFING"
    phase_elapsed = 0.0
    splash_text = ""
    splash_sub = ""
    feedback = "SELECT MISSION • THEATER MODE • DIFFICULTY"
    _refresh_briefing()
    queue_redraw()

func _select_mission(i: int) -> void:
    if i < 0 or i >= MISSIONS.size():
        return
    mission_id = i
    _play_tone(420.0 + i * 90.0, 0.09, 0.16)
    _refresh_briefing()

func _select_mode(m: String) -> void:
    game_mode = m
    _play_tone(520.0, 0.09, 0.16)
    _refresh_briefing()

func _select_difficulty(d: String) -> void:
    difficulty = d
    _play_tone(360.0, 0.09, 0.16)
    _refresh_briefing()

func _deploy() -> void:
    _play_tone(660.0, 0.14, 0.20)
    _start_breach()

func _refresh_briefing() -> void:
    for i in range(mission_buttons.size()):
        var m: Dictionary = MISSIONS[i]
        var mark := "▶ " if i == mission_id else "    "
        mission_buttons[i].text = "%s%d. %s\n%s — Objective: %s" % [mark, i + 1, String(m.title), String(m.desc), String(m.objective)]
    for i in range(mode_buttons.size()):
        var label := "CLASSIC" if i == 0 else "MODERN OPS"
        mode_buttons[i].text = ("▶ " if game_mode == label else "    ") + label
    for i in range(diff_buttons.size()):
        var label := "NORMAL" if i == 0 else "HARD"
        diff_buttons[i].text = ("▶ " if difficulty == label else "    ") + label
    var m: Dictionary = MISSIONS[mission_id]
    var extra := ""
    if game_mode == "MODERN OPS":
        extra = " • Wave defense, 5 waves, +1 drone task force"
    if difficulty == "HARD":
        extra += " • Smarter hostiles: flanking, focus-fire, evasive"
    briefing_summary.text = "MISSION: %s\nMODE: %s%s\nBrief your run, then deploy." % [String(m.title), game_mode, extra]

# -----------------------------------------------------------------------------
# BREACH
# -----------------------------------------------------------------------------

func _pick_spawn_kind() -> String:
    # Weighted pick driven by the active mission config (spawn_w).
    var r := rng.randf()
    var acc := 0.0
    for k in ["enemy", "intel", "supply", "hazard"]:
        acc += float(spawn_w[k])
        if r <= acc:
            return k
    return "hazard"

func _spawn_breach_object(z: float) -> void:
    breach_objects.append({
        "z": z,
        "lane": rng.randi_range(0, 2),
        "kind": _pick_spawn_kind(),
        "alive": true,
        "pulse": rng.randf_range(0.0, TAU),
        "flank_t": 0.0
    })

func _update_breach(delta: float) -> void:
    distance += delta * 230.0
    if gate_open:
        gate_time_left = max(0.0, gate_time_left - delta)
        if gate_time_left <= 0.0:
            _choose_gate(1)
            gate_resolved = true
            feedback = "GATE WINDOW CLOSED — DISCIPLINE SELECTED"
            feedback_timer = 1.0
    if Input.is_action_just_pressed("move_left"):
        player_lane = max(0, player_lane - 1)
    if Input.is_action_just_pressed("move_right"):
        player_lane = min(2, player_lane + 1)
    player_x = lerp(player_x, lane_x[player_lane], min(1.0, delta * 12.0))

    for obj in breach_objects:
        if not obj.alive:
            continue
        obj.z -= delta * 230.0
        obj.pulse += delta * 4.0
        # HARD: hostiles flank — nearby enemies drift toward the player's lane.
        if difficulty == "HARD" and obj.kind == "enemy" and obj.z < 1500.0 and obj.z > 0.0:
            obj.flank_t = float(obj.flank_t) + delta
            if obj.flank_t > 1.2:
                obj.flank_t = 0.0
                if obj.lane < player_lane:
                    obj.lane = int(obj.lane) + 1
                elif obj.lane > player_lane:
                    obj.lane = int(obj.lane) - 1
        if obj.z < -100.0:
            obj.z += 3100.0
            obj.lane = rng.randi_range(0, 2)
            obj.kind = _pick_spawn_kind()
            obj.alive = true
            obj.flank_t = 0.0
            obj.nm = false
        # Near-miss: a hostile screaming past the adjacent lane — whoosh, no damage.
        if obj.alive and not bool(obj.get("nm", false)) and (obj.kind == "enemy" or obj.kind == "hazard") and obj.z < 230.0 and obj.z > 60.0 and abs(int(obj.lane) - player_lane) == 1:
            obj.nm = true
            feedback = "NEAR MISS"
            feedback_timer = 0.6
            camera_shake = maxf(camera_shake, 0.18)
            _queue_tone(340.0, 0.08, 0.10, 0.0)
            _queue_tone(240.0, 0.10, 0.10, 0.07)
        if obj.z < 210.0 and obj.z > 70.0 and obj.lane == player_lane:
            if Input.is_action_just_pressed("fire") and obj.kind == "enemy" and breach_fire_cooldown <= 0.0:
                breach_fire_cooldown = 0.16
                _breach_hit(obj)
            elif obj.kind == "intel":
                obj.alive = false
                intel += 1
                var ipts := 45 + combo * 5
                score += ipts
                combo += 1
                combo_timer = COMBO_WINDOW
                combo_pop = 0.28
                var ipos := _breach_obj_pos(obj)
                _burst(ipos, 12, 110.0, 0.7, Color(0.35, 0.9, 1.0, 1.0), 3.5, 60.0)
                _spawn_popup(ipos + Vector2(0, -26), "+%d INTEL" % ipts, Color(0.5, 0.95, 1.0, 1.0), 19)
                _play_tone(_combo_pitch(920.0), 0.07, 0.18)
                feedback = "+INTEL  •  RESERVE MULTIPLIER"
                feedback_timer = 1.1
            elif obj.kind == "supply":
                obj.alive = false
                score += 35
                combo += 1
                combo_timer = COMBO_WINDOW
                combo_pop = 0.28
                var spos := _breach_obj_pos(obj)
                _burst(spos, 12, 110.0, 0.7, Color(1.0, 0.82, 0.35, 1.0), 3.5, 60.0)
                _spawn_popup(spos + Vector2(0, -26), "+35 SUPPLY", Color(1.0, 0.88, 0.5, 1.0), 19)
                _play_tone(_combo_pitch(520.0), 0.07, 0.18)
                feedback = "+SUPPLY  •  COMBO"
                feedback_timer = 1.0
            elif obj.kind == "hazard" and not Input.is_action_pressed("fire"):
                obj.alive = false
                health -= 14.0
                combo = 0
                combo_timer = 0.0
                camera_shake = 0.7
                _explode(Vector2(player_x, 575.0), 0.45, false)
                _play_tone(140.0, 0.15, 0.22)
                feedback = "IMPACT — DODGE FAILED"
                feedback_timer = 1.0
                if health <= 0:
                    _enter_reserves()
                    return

    # V2: timed mission — the breach window can expire before the line is reached.
    if breach_time_limit > 0.0 and phase_elapsed >= breach_time_limit:
        mission_failed_early = true
        feedback = "TIME EXPIRED — FORCED EXTRACTION"
        feedback_timer = 1.5
        _enter_reserves()
        return

    # Gate appears near the end; player must choose one of two modifiers.
    if distance > distance_target - 800.0 and not gate_open and not gate_resolved:
        gate_open = true
        gate_resolved = false
        gate_time_left = 4.5
        gate_options = [
            {"title":"FIREPOWER", "desc":"+2 artillery • -10 health", "type":"firepower"},
            {"title":"DISCIPLINE", "desc":"+1 AA • +60 score", "type":"discipline"}
        ]
    if distance > distance_target and not gate_open:
        _enter_reserves()
    elif distance > distance_target and gate_open and gate_choice >= 0:
        _enter_reserves()

func _breach_hit(obj: Dictionary) -> void:
    var pos := _breach_obj_pos(obj)
    var points := 80 + combo * 10
    obj.alive = false
    score += points
    combo += 1
    combo_timer = COMBO_WINDOW
    combo_pop = 0.28
    if breach_shots.size() < 24:
        breach_shots.append({"a": Vector2(player_x, 575.0), "b": pos, "t": 0.0, "dur": 0.12})
    _burst(Vector2(player_x, 560.0), 6, 90.0, 0.18, Color(1.0, 0.9, 0.5, 1.0), 4.0, 0.0)
    _explode(pos, 0.35, false)
    _spawn_popup(pos + Vector2(0, -30), "+%d" % points, Color(1.0, 0.85, 0.45, 1.0), 20)
    _play_tone(_combo_pitch(680.0), 0.05, 0.22)
    feedback = "TARGET DOWN  •  +%d" % points
    feedback_timer = 0.9
    flash = 0.7

func _choose_gate(index: int) -> void:
    if not gate_open or index < 0 or index >= gate_options.size():
        return
    gate_choice = index
    gate_open = false
    gate_resolved = true
    var t = gate_options[index].type
    _play_tone(420.0 + index * 120.0, 0.09, 0.18)
    if t == "firepower":
        gate_bonus_artillery = 2
        health = max(1.0, health - 10.0)
        score += 20
        feedback = "FIREPOWER GATE — HEAVY BATTERY ONLINE"
    else:
        gate_bonus_aa = 1
        score += 60
        feedback = "DISCIPLINE GATE — AIR DEFENSE READY"

# -----------------------------------------------------------------------------
# RESERVES
# -----------------------------------------------------------------------------

func _update_reserves(_delta: float) -> void:
    # Automatic handoff after a readable tactical beat; no dead screen.
    if phase_elapsed > 3.4:
        _enter_battle()

# -----------------------------------------------------------------------------
# BATTLE
# -----------------------------------------------------------------------------

func _spawn_bomber() -> void:
    # V2 HARD: bombers fly genuine focus-fire — converging on the objective
    # with higher speed, instead of drifting on random headings.
    var tgt := rng.randf_range(420.0, 840.0)
    var spd := rng.randf_range(65.0, 100.0)
    if difficulty == "HARD":
        tgt = BUNKER_POS.x + rng.randf_range(-60.0, 60.0)
        spd *= 1.25
    bombers.append({
        "x": rng.randf_range(90.0, 1190.0),
        "y": -60.0,
        "speed": spd,
        "hp": 1,
        "active": true,
        "id": next_bomber_id,
        "target": tgt,
        "phase": rng.randf_range(0.0, TAU),
        "evade": 0.0
    })
    next_bomber_id += 1

func _update_battle(delta: float) -> void:
    # Once the objective is destroyed, stop all further battle simulation in
    # the same frame. This prevents a defeated state from receiving extra
    # bomber spawns, movement, or damage before OUTCOME is entered.
    if bunker_hp <= 0.0:
        _finish_battle(false)
        return
    bomber_timer += delta
    battle_message_timer = max(0.0, battle_message_timer - delta)
    armor_cooldown = max(0.0, armor_cooldown - delta)
    if game_mode == "MODERN OPS":
        _update_wave_spawner(delta)
    else:
        if bomber_timer >= bomber_next:
            bomber_timer = 0.0
            bomber_next = rng.randf_range(3.5, 6.0)
            _spawn_bomber()

    for b in bombers:
        if not bool(b.get("active", true)):
            continue
        b.y += b.speed * delta
        # V2 HARD: genuine focus-fire — bombers steer onto the objective, and
        # weave evasively while an AA interceptor is inbound on them.
        var weave := 20.0
        if difficulty == "HARD":
            b.x = lerpf(float(b.x), float(b.target), minf(1.0, delta * 0.45))
            if float(b.get("evade", 0.0)) > 0.0:
                weave = 70.0
                b.evade = float(b.evade) - delta
        b.x += sin(total_elapsed * 1.7 + b.phase) * delta * weave
        if b.y > 520.0:
            b.active = false
            b.y = 900.0
            bunker_hp -= 12.0
            _explode(Vector2(b.x, 520.0), 0.6, true)
            _play_tone(95.0, 0.16, 0.24)
            battle_message = "AIR STRIKE HIT — %d%% INTEGRITY" % int(bunker_hp)
            battle_message_timer = 1.5
            camera_shake = 0.55
            if bunker_hp <= 0.0:
                _finish_battle(false)
                return

    # Retire inactive threats so long battles do not accumulate stale bomber
    # dictionaries that can never participate in gameplay again.
    bombers = bombers.filter(func(b): return bool(b.get("active", true)))

    _update_drones(delta)
    _update_specops(delta)

    # Low-integrity warning: red pulse + heartbeat tones while the bunker bleeds.
    if bunker_hp < 35.0 and bunker_hp > 0.0:
        lowhp_warn_cd -= delta
        if lowhp_warn_cd <= 0.0:
            lowhp_warn_cd = 1.0
            _queue_tone(180.0, 0.12, 0.13, 0.0)
            _queue_tone(138.0, 0.16, 0.13, 0.16)

    if Input.is_action_just_pressed("fire"):
        # Same mapping as every other pointer path: viewport px -> design
        # space via _design_point. (The old code fed the canvas-space mouse
        # position back through _design_point, applying the canvas transform
        # twice and desyncing mouse fire from touch taps.)
        var mouse := _design_point(get_viewport().get_mouse_position())
        _battle_action(mouse)

    # Auto resolve at timeout (CLASSIC only — MODERN OPS resolves on waves).
    if game_mode == "CLASSIC":
        if phase_elapsed >= BATTLE_TIME:
            _finish_battle(bunker_hp > 0.0)
        elif bunker_hp <= 0.0:
            _finish_battle(false)
    elif bunker_hp <= 0.0:
        _finish_battle(false)

func _update_wave_spawner(delta: float) -> void:
    # MODERN OPS: escalating waves replace the fixed battle timer. A wave is
    # cleared when every spawned bomber is destroyed or has struck; clearing
    # a wave resupplies +1 artillery. Victory after BATTLE_WAVES cleared.
    if wave_break > 0.0:
        wave_break -= delta
        if wave_break <= 0.0:
            wave += 1
            wave_spawned = 0
            wave_total = 3 + wave * 2
            wave_timer = 0.0
            battle_message = "MODERN OPS — WAVE %d/%d" % [wave, BATTLE_WAVES]
            battle_message_timer = 2.0
            _spawn_banner("WAVE %d INCOMING" % wave, "MODERN OPS", Color(1.0, 0.72, 0.35, 1.0), 2.2)
            _horn_wave()
        return
    if wave_spawned < wave_total:
        wave_timer += delta
        var interval: float = maxf(1.1, 3.2 - float(wave) * 0.4) / battle_pressure
        if wave_timer >= interval:
            wave_timer = 0.0
            wave_spawned += 1
            _spawn_bomber()
    elif bombers.is_empty():
        if wave >= BATTLE_WAVES:
            _finish_battle(bunker_hp > 0.0)
        else:
            wave_break = 3.0
            reserve.artillery = mini(10, int(reserve.artillery) + 1)
            battle_message = "WAVE %d CLEARED — +1 ARTILLERY RESUPPLY" % wave
            battle_message_timer = 2.0
            _spawn_banner("WAVE %d CLEARED" % wave, "+1 ARTILLERY RESUPPLY", Color(0.45, 1.0, 0.7, 1.0), 2.0)
            _play_tone(880.0, 0.14, 0.18)

func _nearest_active_bomber(p: Vector2, max_dist: float) -> int:
    var best := -1
    var best_d := max_dist
    for i in range(bombers.size()):
        if not bool(bombers[i].get("active", true)):
            continue
        var d := Vector2(bombers[i].x, bombers[i].y).distance_to(p)
        if d < best_d:
            best = i
            best_d = d
    return best

func _update_drones(delta: float) -> void:
    # REAPER UCAV: loitering strike drone. Patrols overhead and fires a real
    # micro-missile (travel + id-locked resolution) at the nearest hostile.
    for d in drones:
        d.life = float(d.life) - delta
        d.x = 640.0 + sin(total_elapsed * 1.3 + float(d.ph)) * 320.0
        d.y = 250.0 + sin(total_elapsed * 2.1 + float(d.ph)) * 40.0
        d.cd = float(d.cd) - delta
        if d.cd <= 0.0 and float(d.life) > 0.0:
            var bi := _nearest_active_bomber(Vector2(d.x, d.y), 1400.0)
            if bi >= 0:
                d.cd = 1.1
                var bp := Vector2(bombers[bi].x, bombers[bi].y)
                projectiles.append({"kind":"micro","start":Vector2(d.x,d.y),"target":bp,"target_id":bombers[bi].id,"t":0.0,"duration":0.28})
                _play_tone(1150.0, 0.06, 0.14)
    drones = drones.filter(func(d): return float(d.get("life", 0.0)) > 0.0)

func _update_specops(delta: float) -> void:
    # SPECTRE TEAM: deployed area-denial. Engages the nearest hostile inside
    # its zone with a real tracer round (travel + id-locked resolution).
    for t in specops_teams:
        t.life = float(t.life) - delta
        t.cd = float(t.cd) - delta
        if t.cd <= 0.0 and float(t.life) > 0.0:
            var tp := Vector2(t.x, t.y)
            var bi := _nearest_active_bomber(tp, 240.0)
            if bi >= 0:
                t.cd = 0.9
                var bp := Vector2(bombers[bi].x, bombers[bi].y)
                projectiles.append({"kind":"tracer","start":tp + Vector2(0, -20),"target":bp,"target_id":bombers[bi].id,"t":0.0,"duration":0.12})
                _play_tone(520.0, 0.05, 0.12)
    specops_teams = specops_teams.filter(func(t): return float(t.get("life", 0.0)) > 0.0)

func _battle_action(target: Vector2) -> void:
    if battle_fire_cooldown > 0.0:
        return
    battle_fire_cooldown = 0.20
    if target.y < 120.0 or target.y > 610.0:
        return
    target.x = clampf(target.x, 0.0, W)
    _spawn_reticle(target)
    if selected_action == "ARTILLERY":
        if reserve.artillery <= 0:
            battle_message = "NO ARTILLERY REMAINING"
            battle_message_timer = 1.2
            return
        reserve.artillery -= 1
        artillery_used += 1
        battle_score += 1
        projectiles.append({"kind":"artillery","start":Vector2(640,610),"target":target,"t":0.0,"duration":0.32,"damage":18.0})
        _burst(Vector2(640, 610), 8, 130.0, 0.3, Color(1.0, 0.75, 0.35, 1.0), 5.0, 0.0)
        _play_tone(180.0, 0.08, 0.20)
        battle_message = "ARTILLERY IN FLIGHT"
        battle_message_timer = 0.8
    elif selected_action == "AA":
        if reserve.aa <= 0:
            battle_message = "NO AA BATTERY AVAILABLE"
            battle_message_timer = 1.2
            return
        reserve.aa -= 1
        aa_used += 1
        var best = -1
        var best_d = 99999.0
        for i in range(bombers.size()):
            var d = Vector2(bombers[i].x, bombers[i].y).distance_to(target)
            if d < best_d:
                best = i
                best_d = d
        if best >= 0 and best_d < 280.0:
            var bomber_id: int = bombers[best].id
            var bp := Vector2(bombers[best].x, bombers[best].y)
            projectiles.append({"kind":"aa","start":Vector2(1120,560),"target":bp,"target_id":bomber_id,"t":0.0,"duration":0.22})
            battle_score += 1
            _burst(Vector2(1120, 560), 6, 110.0, 0.25, Color(0.4, 0.95, 1.0, 1.0), 4.0, 0.0)
            _play_tone(980.0, 0.08, 0.20)
            battle_message = "AA LOCK — INTERCEPTOR IN FLIGHT"
            # V2 HARD: a locked hostile weaves evasively while the interceptor
            # is inbound — real behavior, not a stat change.
            if difficulty == "HARD":
                bombers[best].evade = 1.0
        else:
            battle_message = "AA SEARCH — NO VALID LOCK"
        battle_message_timer = 1.0
    elif selected_action == "DRONE":
        # REAPER UCAV — loitering autonomous strike drone (12s patrol).
        if reserve.drone <= 0:
            battle_message = "NO UCAV AVAILABLE"
            battle_message_timer = 1.2
            return
        reserve.drone -= 1
        drone_used += 1
        drones.append({"x":640.0,"y":250.0,"life":12.0,"cd":0.0,"ph":rng.randf_range(0.0,TAU)})
        _burst(Vector2(640, 250), 6, 100.0, 0.3, Color(0.4, 0.9, 1.0, 1.0), 4.0, 0.0)
        _play_tone(760.0, 0.12, 0.20)
        battle_message = "REAPER UCAV DEPLOYED — AUTONOMOUS HUNT"
        battle_message_timer = 1.2
    elif selected_action == "SPECOPS":
        # SPECTRE TEAM — area-denial deployment on the ground band.
        if target.y < 430.0 or target.y > 620.0:
            battle_message = "SPECTRE NEEDS GROUND — TAP LOWER"
            battle_message_timer = 1.2
            return
        if reserve.specops <= 0:
            battle_message = "NO SPECTRE TEAM AVAILABLE"
            battle_message_timer = 1.2
            return
        reserve.specops -= 1
        specops_used += 1
        specops_teams.append({"x":target.x,"y":548.0,"life":15.0,"cd":0.0})
        _burst(Vector2(target.x, 548.0), 8, 90.0, 0.5, Color(0.95, 0.7, 0.35, 1.0), 4.0, 200.0)
        _play_tone(440.0, 0.12, 0.20)
        battle_message = "SPECTRE TEAM INSERTED — ZONE DENIAL ACTIVE"
        battle_message_timer = 1.2
    elif selected_action == "ARMOR":
        # AEGIS MBT — heavy shell, wide blast, slow reload, friendly-fire risk.
        if reserve.armor <= 0:
            battle_message = "NO AEGIS SHELL AVAILABLE"
            battle_message_timer = 1.2
            return
        if armor_cooldown > 0.0:
            battle_message = "AEGIS RELOADING — %.1fs" % armor_cooldown
            battle_message_timer = 0.8
            return
        reserve.armor -= 1
        armor_used += 1
        armor_cooldown = 1.4
        battle_score += 1
        projectiles.append({"kind":"shell","start":Vector2(640,560),"target":target,"t":0.0,"duration":0.5,"damage":45.0})
        _burst(Vector2(640, 560), 12, 170.0, 0.35, Color(1.0, 0.6, 0.3, 1.0), 6.0, 0.0)
        camera_shake = maxf(camera_shake, 0.3)
        _play_tone(140.0, 0.14, 0.24)
        battle_message = "AEGIS SHELL IN FLIGHT — WIDE BLAST"
        battle_message_timer = 1.0
    else:
        battle_message = "UNSUPPORTED COMMAND"
        battle_message_timer = 0.8

func _on_ping_timer_timeout() -> void:
    last_ping = total_elapsed
    if phase != "BATTLE":
        return
    ping_count += 1
    ping_visual_time = 0.0
    _tactical_ping()

func _tactical_ping() -> void:
    # Ping creates a tactical window and repositions threat pressure.
    if phase != "BATTLE":
        return
    _play_tone(760.0, 0.12, 0.14)
    battle_message = "TACTICAL PING #%d — THREAT WINDOW UPDATED" % ping_count
    battle_message_timer = 1.4
    if bombers.size() < 5:
        _spawn_bomber()

# -----------------------------------------------------------------------------
# FEEL / AUDIO / PERFORMANCE
# -----------------------------------------------------------------------------

func _build_audio() -> void:
    audio_generator = AudioStreamGenerator.new()
    audio_generator.mix_rate = 22050
    audio_generator.buffer_length = 0.25
    audio_player = AudioStreamPlayer.new()
    audio_player.stream = audio_generator
    audio_player.volume_db = -10.0
    add_child(audio_player)
    audio_player.play()

func _play_tone(freq: float, duration: float, gain: float) -> void:
    if audio_player == null or not audio_player.playing:
        return
    var playback := audio_player.get_stream_playback() as AudioStreamGeneratorPlayback
    if playback == null:
        return
    var max_frames := int(audio_generator.buffer_length * audio_generator.mix_rate * 0.9)
    var frames: int = min(int(duration * audio_generator.mix_rate), max_frames)
    for i in range(frames):
        if not playback.can_push_buffer(1):
            break
        var t := float(i) / float(audio_generator.mix_rate)
        var env: float = 1.0 - float(i) / max(1.0, float(frames))
        var sample: float = sin(TAU * freq * t) * gain * env
        playback.push_frame(Vector2(sample, sample))

func _update_impacts(delta: float) -> void:
    for impact in impacts:
        impact.t += delta
    impacts = impacts.filter(func(x): return x.t < 0.9)

func _update_projectiles(delta: float) -> void:
    if phase != "BATTLE":
        return
    var resolved_indices: Array[int] = []
    for i in range(projectiles.size()):
        var projectile: Dictionary = projectiles[i]
        projectile.t += delta
        var u: float = clamp(projectile.t / projectile.duration, 0.0, 1.0)
        projectile.current = projectile.start.lerp(projectile.target, u)
        projectiles[i] = projectile
        if projectile.t >= projectile.duration and not projectile.get("resolved", false):
            projectile.resolved = true
            if projectile.kind == "artillery":
                var impact_pos: Vector2 = projectile.target
                impacts.append({"p":impact_pos,"t":0.0,"r":10.0})
                _explode(impact_pos, 0.55, false)
                var hit_count := 0
                for b in bombers:
                    if bool(b.get("active", true)) and b.y < 800.0 and Vector2(b.x,b.y).distance_to(impact_pos) < 115.0:
                        b.active = false
                        b.y = 900.0
                        hit_count += 1
                if impact_pos.distance_to(BUNKER_POS) < 145.0:
                    var applied_damage := float(projectile.damage)
                    bunker_hp = max(0.0, bunker_hp - applied_damage)
                    total_battle_damage += applied_damage
                    battle_score += 4
                    battle_message = "ARTILLERY IMPACT — BUNKER DAMAGED"
                    battle_message_timer = 1.1
                elif hit_count > 0:
                    var apts := hit_count * 2
                    battle_score += apts
                    _register_kill(impact_pos, "ARTILLERY IMPACT — %d AIR TARGET HIT" % hit_count, apts, hit_count)
                else:
                    battle_message = "ARTILLERY IMPACT — NO DIRECT HIT"
                    battle_message_timer = 1.1
            elif projectile.kind == "aa":
                impacts.append({"p":projectile.target,"t":0.0,"r":6.0})
                var target_id: int = int(projectile.get("target_id", -1))
                var intercepted := false
                var kill_pos: Vector2 = projectile.target
                for b in bombers:
                    if bool(b.get("active", true)) and int(b.id) == target_id and b.y < 800.0:
                        kill_pos = Vector2(b.x, b.y)
                        b.active = false
                        b.y = 900.0
                        intercepted = true
                        break
                if intercepted:
                    battle_score += 4
                    _explode(kill_pos, 0.4, false)
                    _register_kill(kill_pos, "AA IMPACT — BOMBER DESTROYED", 4)
                else:
                    _play_tone(420.0, 0.12, 0.18)
                    battle_message = "AA IMPACT — TARGET LOST"
                    battle_message_timer = 1.0
            elif projectile.kind == "micro":
                # REAPER micro-missile: id-locked kill on the painted hostile.
                impacts.append({"p":projectile.target,"t":0.0,"r":5.0})
                var target_id: int = int(projectile.get("target_id", -1))
                var killed := false
                var kill_pos: Vector2 = projectile.target
                for b in bombers:
                    if bool(b.get("active", true)) and int(b.id) == target_id and b.y < 800.0:
                        kill_pos = Vector2(b.x, b.y)
                        b.active = false
                        b.y = 900.0
                        killed = true
                        break
                if killed:
                    battle_score += 3
                    _explode(kill_pos, 0.3, false)
                    _register_kill(kill_pos, "REAPER STRIKE — HOSTILE DOWN", 3)
                else:
                    _play_tone(420.0, 0.10, 0.16)
                    battle_message = "REAPER STRIKE — TARGET LOST"
                    battle_message_timer = 1.0
            elif projectile.kind == "tracer":
                # SPECTRE tracer: id-locked kill inside the denial zone.
                impacts.append({"p":projectile.target,"t":0.0,"r":4.0})
                var target_id: int = int(projectile.get("target_id", -1))
                var neutralized := false
                var kill_pos: Vector2 = projectile.target
                for b in bombers:
                    if bool(b.get("active", true)) and int(b.id) == target_id and b.y < 800.0:
                        kill_pos = Vector2(b.x, b.y)
                        b.active = false
                        b.y = 900.0
                        neutralized = true
                        break
                if neutralized:
                    battle_score += 3
                    _explode(kill_pos, 0.3, false)
                    _register_kill(kill_pos, "SPECTRE ENGAGEMENT — HOSTILE NEUTRALIZED", 3)
                else:
                    _play_tone(420.0, 0.08, 0.14)
                    battle_message = "SPECTRE ENGAGEMENT — NO EFFECT"
                    battle_message_timer = 1.0
            elif projectile.kind == "shell":
                # AEGIS heavy shell: wide blast, real friendly-fire risk.
                var impact_pos: Vector2 = projectile.target
                impacts.append({"p":impact_pos,"t":0.0,"r":16.0})
                _explode(impact_pos, 0.9, true)
                var hit_count := 0
                for b in bombers:
                    if bool(b.get("active", true)) and b.y < 800.0 and Vector2(b.x,b.y).distance_to(impact_pos) < 200.0:
                        b.active = false
                        b.y = 900.0
                        hit_count += 1
                if impact_pos.distance_to(BUNKER_POS) < 145.0:
                    var applied_damage := float(projectile.damage)
                    bunker_hp = max(0.0, bunker_hp - applied_damage)
                    total_battle_damage += applied_damage
                    battle_score += 2
                    battle_message = "AEGIS IMPACT — FRIENDLY FIRE ON OBJECTIVE"
                    battle_message_timer = 1.1
                elif hit_count > 0:
                    var spts := hit_count * 3
                    battle_score += spts
                    _register_kill(impact_pos, "AEGIS IMPACT — %d HOSTILES DESTROYED" % hit_count, spts, hit_count)
                else:
                    battle_message = "AEGIS IMPACT — NO DIRECT HIT"
                    battle_message_timer = 1.1
            resolved_indices.append(i)

    # Resolved projectiles must leave the active collection; otherwise every
    # command creates permanent draw/update work and can degrade long battles.
    for i in range(resolved_indices.size() - 1, -1, -1):
        projectiles.remove_at(resolved_indices[i])

func _update_quality_tier() -> void:
    # Frame-time protection: visual quality changes only after sustained pressure.
    if quality_fps < 53.0:
        quality_pressure_time += 0.5
        quality_stable_time = 0.0
    elif quality_fps >= 59.0:
        quality_stable_time += 0.5
        quality_pressure_time = max(0.0, quality_pressure_time - 0.25)
    else:
        quality_pressure_time = max(0.0, quality_pressure_time - 0.1)
        quality_stable_time = max(0.0, quality_stable_time - 0.1)
    if quality_pressure_time >= 2.0:
        quality_tier = max(1, quality_tier - 1)
        quality_pressure_time = 0.0
    elif quality_stable_time >= 8.0:
        quality_tier = min(4, quality_tier + 1)
        quality_stable_time = 0.0

# -----------------------------------------------------------------------------
# FOU — SPECTACLE SYSTEMS (all data-driven Dictionary arrays; no nodes, no
# textures; every spawn is quality-scaled and hard-capped for the S25+ target)
# -----------------------------------------------------------------------------

func _spawn_fx(p: Vector2, vel: Vector2, life: float, color: Color, size: float, grav: float = 0.0) -> void:
    if fx.size() >= 320:
        return
    fx.append({"p": p, "v": vel, "life": life, "max_life": life, "color": color, "size": size, "grav": grav})

func _burst(p: Vector2, count: int, speed: float, life: float, color: Color, size: float, grav: float = 0.0) -> void:
    var n: int = mini(count, 2 + quality_tier * 2)
    for i in range(n):
        var a := rng.randf_range(0.0, TAU)
        var s := rng.randf_range(speed * 0.35, speed)
        _spawn_fx(p, Vector2(cos(a), sin(a)) * s, rng.randf_range(life * 0.6, life), color, rng.randf_range(size * 0.6, size * 1.4), grav)

func _spawn_shockwave(p: Vector2, max_r: float, life: float, color: Color, width: float = 4.0) -> void:
    if shockwaves.size() >= 48:
        return
    shockwaves.append({"p": p, "life": life, "max_life": life, "max_r": max_r, "color": color, "width": width})

func _spawn_ripple(p: Vector2, color: Color = Color(0.5, 0.9, 1.0, 0.8), max_r: float = 64.0, life: float = 0.55) -> void:
    if ripples.size() >= 96:
        return
    ripples.append({"p": p, "life": life, "max_life": life, "max_r": max_r, "color": color})

func _spawn_popup(p: Vector2, text: String, color: Color = Color(1, 0.9, 0.5, 1), size: int = 20) -> void:
    if popups.size() >= 96:
        return
    popups.append({"p": p, "text": text, "life": 1.1, "max_life": 1.1, "color": color, "size": size})

func _spawn_banner(text: String, sub: String = "", color: Color = Color(1, 0.85, 0.45, 1), life: float = 2.2) -> void:
    if banners.size() >= 6:
        banners.remove_at(0)
    banners.append({"text": text, "sub": sub, "life": life, "max_life": life, "color": color})
    camera_shake = maxf(camera_shake, 0.28)

func _spawn_reticle(p: Vector2) -> void:
    if reticles.size() >= 24:
        reticles.remove_at(0)
    reticles.append({"p": p, "life": 0.6, "max_life": 0.6})

func _touch_juice(p: Vector2) -> void:
    # Every touch anywhere: expanding ripple ring + spark burst + soft tick.
    _spawn_ripple(p)
    _burst(p, 10, 150.0, 0.5, Color(0.55, 0.9, 1.0, 1.0), 3.5, 0.0)
    _play_tone(1250.0, 0.03, 0.05)

func _queue_tone(freq: float, dur: float, gain: float, delay: float) -> void:
    if tone_queue.size() >= 32:
        return
    tone_queue.append({"freq": freq, "dur": dur, "gain": gain, "delay": delay})

func _update_tone_queue(delta: float) -> void:
    for i in range(tone_queue.size() - 1, -1, -1):
        var t: Dictionary = tone_queue[i]
        t.delay = float(t.delay) - delta
        if float(t.delay) <= 0.0:
            _play_tone(float(t.freq), float(t.dur), float(t.gain))
            tone_queue.remove_at(i)
        else:
            tone_queue[i] = t

func _fanfare_victory() -> void:
    var notes := [523.0, 659.0, 784.0, 1046.0, 784.0, 1318.0]
    for i in range(notes.size()):
        _queue_tone(notes[i], 0.13, 0.18, 0.12 * float(i))

func _sweep_defeat() -> void:
    var f := 320.0
    for i in range(8):
        _queue_tone(f, 0.11, 0.16, 0.09 * float(i))
        f *= 0.82

func _horn_wave() -> void:
    _queue_tone(110.0, 0.22, 0.22, 0.0)
    _queue_tone(146.0, 0.22, 0.20, 0.16)
    _queue_tone(110.0, 0.32, 0.22, 0.34)

func _explode(p: Vector2, power: float, big: bool = false) -> void:
    # The one explosion every impact funnels through: fire debris with real
    # gravity, rising smoke, staggered shockwave rings, white-hot core flash,
    # camera kick, screen flash, and a stacked thump+boom+crackle. Big hits
    # (AEGIS, objective strikes) add a 55ms hit-stop freeze.
    var n_base: int = int(10.0 + power * 22.0)
    _burst(p, n_base, 120.0 + power * 260.0, 0.7, Color(1.0, 0.62, 0.22, 1.0), 5.0, 420.0)
    _burst(p, n_base / 2, 60.0 + power * 120.0, 1.1, Color(0.22, 0.22, 0.26, 0.9), 7.0, -60.0)
    _spawn_shockwave(p, 60.0 + power * 160.0, 0.45, Color(1.0, 0.75, 0.35, 0.9), 5.0)
    _spawn_shockwave(p, 40.0 + power * 90.0, 0.60, Color(1.0, 0.95, 0.85, 0.7), 3.0)
    _spawn_fx(p, Vector2.ZERO, 0.12, Color(1, 1, 1, 1), 30.0 + power * 60.0, 0.0)
    camera_shake = maxf(camera_shake, 0.25 + power * 0.55)
    flash = minf(1.0, flash + 0.15 + power * 0.35)
    _play_tone(58.0, 0.20, 0.26)
    _queue_tone(95.0, 0.14, 0.20, 0.03)
    _queue_tone(1400.0 + rng.randf_range(-200.0, 200.0), 0.05, 0.08, 0.02)
    if big:
        hitstop = maxf(hitstop, 0.055)
        _spawn_shockwave(p, 120.0 + power * 220.0, 0.7, Color(1, 1, 1, 0.5), 2.0)

func _combo_pitch(base: float) -> float:
    # One semitone up per combo step, capped — kill tones escalate with the chain.
    return base * pow(1.059463, float(mini(combo, 12)))

func _register_kill(p: Vector2, label: String, points: int, kills: int = 1) -> void:
    # Every kill in every mode feeds one shared combo chain with a 2.5s window.
    combo += kills
    combo_timer = COMBO_WINDOW
    combo_pop = 0.30
    _spawn_popup(p + Vector2(0, -26), "+%d" % points, Color(1.0, 0.85, 0.45, 1.0), 20)
    _burst(p, 8, 140.0, 0.55, Color(1.0, 0.8, 0.35, 1.0), 4.0, 320.0)
    _play_tone(_combo_pitch(680.0), 0.06, 0.20)
    if label != "":
        battle_message = label
        battle_message_timer = 1.1
    if kills >= 3:
        _spawn_banner("MULTI KILL x%d" % kills, "COMBO x%d" % combo, Color(1.0, 0.72, 0.35, 1.0), 1.6)
        _play_tone(_combo_pitch(880.0), 0.10, 0.18)
    elif kills == 2:
        _spawn_banner("DOUBLE KILL", "COMBO x%d" % combo, Color(1.0, 0.78, 0.4, 1.0), 1.6)
        _play_tone(_combo_pitch(880.0), 0.10, 0.18)
    elif combo == 3:
        _spawn_banner("TRIPLE KILL", "COMBO x3", Color(1.0, 0.8, 0.42, 1.0), 1.6)
    elif combo == 5:
        _spawn_banner("RAMPAGE", "COMBO x5", Color(1.0, 0.62, 0.32, 1.0), 1.7)
    elif combo >= 8 and combo % 4 == 0:
        _spawn_banner("UNSTOPPABLE", "COMBO x%d" % combo, Color(1.0, 0.42, 0.36, 1.0), 1.8)

func _splash(title: String, sub: String = "") -> void:
    # Phase title card, animated by the existing `transition` var.
    splash_text = title
    splash_sub = sub
    transition = 1.0

func _press_pop(b: Button) -> void:
    # Scale-pop on press for every juice button; decayed in _update_juice_buttons.
    b.pivot_offset = b.size * 0.5
    b.set_meta("pop", 0.22)

func _update_juice_buttons(delta: float) -> void:
    for b in juice_buttons:
        if b.has_meta("pop"):
            var t: float = float(b.get_meta("pop"))
            if t > 0.0:
                t = maxf(0.0, t - delta)
                if t <= 0.0:
                    b.remove_meta("pop")
                    b.scale = Vector2.ONE
                else:
                    b.set_meta("pop", t)
                    var s: float = 1.0 + 0.22 * sin((t / 0.22) * PI)
                    b.scale = Vector2(s, s)
            else:
                b.remove_meta("pop")
                b.scale = Vector2.ONE

func _breach_obj_pos(obj: Dictionary) -> Vector2:
    var t: float = clampf((3500.0 - float(obj.z)) / 3500.0, 0.0, 1.0)
    return Vector2(float(lane_x[int(obj.lane)]), 198.0 + t * t * 420.0)

func _update_fx(delta: float) -> void:
    combo_pop = maxf(0.0, combo_pop - delta * 3.0)
    for p in fx:
        p.life = float(p.life) - delta
        p.p = (p.p as Vector2) + (p.v as Vector2) * delta
        p.v = (p.v as Vector2) + Vector2(0.0, float(p.grav)) * delta
    fx = fx.filter(func(x): return float(x.life) > 0.0)
    for r in shockwaves:
        r.life = float(r.life) - delta
    shockwaves = shockwaves.filter(func(x): return float(x.life) > 0.0)
    for r in ripples:
        r.life = float(r.life) - delta
    ripples = ripples.filter(func(x): return float(x.life) > 0.0)
    for p in popups:
        p.life = float(p.life) - delta
        p.p = (p.p as Vector2) + Vector2(0.0, -46.0) * delta
    popups = popups.filter(func(x): return float(x.life) > 0.0)
    for b in banners:
        b.life = float(b.life) - delta
    banners = banners.filter(func(x): return float(x.life) > 0.0)
    for r in reticles:
        r.life = float(r.life) - delta
    reticles = reticles.filter(func(x): return float(x.life) > 0.0)
    for s in breach_shots:
        s.t = float(s.t) + delta
    breach_shots = breach_shots.filter(func(x): return float(x.t) < float(x.dur))

func _update_outcome(delta: float) -> void:
    # Victory: score count-up + rising ember field. Defeat: slow fade.
    if battle_result == "VICTORY":
        if outcome_count < outcome_target:
            outcome_count = minf(outcome_target, outcome_count + delta * maxf(1.0, outcome_target) / 1.6)
        if phase_elapsed < 3.5:
            ember_cd -= delta
            if ember_cd <= 0.0:
                ember_cd = 0.08
                var ex := rng.randf_range(120.0, 1160.0)
                var ec := Color(1.0, 0.8, 0.35, 1.0) if rng.randf() < 0.6 else Color(0.45, 1.0, 0.7, 1.0)
                _spawn_fx(Vector2(ex, 720.0), Vector2(rng.randf_range(-30.0, 30.0), rng.randf_range(-260.0, -140.0)), rng.randf_range(1.0, 1.8), ec, rng.randf_range(2.5, 5.0), -60.0)
    else:
        defeat_fade = minf(1.0, defeat_fade + delta / 2.5)

func _reserve_tap(p: Vector2) -> void:
    for i in range(RESERVE_CARDS.size()):
        if RESERVE_CARDS[i].has_point(p):
            if reserve_inspect == i:
                reserve_inspect = -1
            else:
                reserve_inspect = i
                _touch_juice(RESERVE_CARDS[i].get_center())
                _play_tone(540.0 + float(i) * 110.0, 0.09, 0.18)
            return
    reserve_inspect = -1

func _mission_icon(idx: int, tint: Color) -> ImageTexture:
    # Procedural per-mission card icon, generated once at build — zero assets.
    var img := Image.create(56, 56, false, Image.FORMAT_RGBA8)
    img.fill(Color(0, 0, 0, 0))
    for y in range(56):
        for x in range(56):
            var on := false
            if idx == 0:  # VANGUARD chevron
                var d := absf(float(x) - 28.0) - (float(y) - 10.0) * 0.75
                on = y >= 10 and y <= 46 and d > -6.0 and d < 4.0
            elif idx == 1:  # GHOST diamond
                var dd := absf(float(x) - 28.0) + absf(float(y) - 28.0)
                on = dd < 19.0 and dd > 12.0
            elif idx == 2:  # IRONHOLD shield
                var in_rect := x >= 15 and x <= 41 and y >= 8 and y <= 36
                var in_tri := y > 36 and y <= 50 and absf(float(x) - 28.0) < (50.0 - float(y)) * 0.9
                on = in_rect or in_tri
            else:  # NIGHT RAID crescent
                var d1 := Vector2(float(x) - 28.0, float(y) - 28.0).length()
                var d2 := Vector2(float(x) - 35.0, float(y) - 23.0).length()
                on = d1 < 18.0 and d2 > 14.0
            if on:
                img.set_pixel(x, y, tint)
    return ImageTexture.create_from_image(img)

# -----------------------------------------------------------------------------
# UI
# -----------------------------------------------------------------------------

func _build_ui() -> void:
    ui_root = Control.new()
    ui_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    ui_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
    # The world is drawn at 2x (draw_set_transform in _draw); scale the UI
    # identically so buttons/labels render at their authored design positions.
    ui_root.scale = Vector2(2.0, 2.0)
    add_child(ui_root)

    phase_label = _label("BREACH", Vector2(34, 24), Vector2(260, 38), 20)
    headline_label = _label("VANGUARD RECON", Vector2(34, 62), Vector2(700, 58), 38)
    sub_label = _label("", Vector2(36, 118), Vector2(800, 34), 16)
    reserve_label = _label("", Vector2(930, 28), Vector2(315, 190), 16)
    objective_label = _label("", Vector2(34, 650), Vector2(900, 38), 18)
    feedback_label = _label("", Vector2(300, 635), Vector2(680, 45), 20)
    feedback_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER

    # V2: five command actions — the rebalanced roster (2 legacy + 3 modern).
    var defs := [
        ["ARTILLERY", "ARTILLERY"], ["AA", "AA"], ["DRONE", "DRONE"],
        ["SPECOPS", "SPECOPS"], ["ARMOR", "ARMOR"]
    ]
    for i in range(defs.size()):
        var b := _make_button(defs[i][0], Vector2(308.0 + i * 134.0, 570), Vector2(128, 54), 14)
        b.pressed.connect(_set_action.bind(String(defs[i][1])))
        action_buttons.append(b)

    overlay = ColorRect.new()
    overlay.color = Color(0.01,0.015,0.025,0.84)
    overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    overlay.visible = false
    overlay.mouse_filter = Control.MOUSE_FILTER_STOP
    ui_root.add_child(overlay)

    outcome_panel = Panel.new()
    outcome_panel.position = Vector2(350, 190)
    outcome_panel.size = Vector2(580, 340)
    outcome_panel.visible = false
    overlay.add_child(outcome_panel)

    outcome_title = _label("OUTCOME", Vector2(42, 34), Vector2(500, 60), 46, outcome_panel)
    outcome_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    outcome_body = _label("", Vector2(50, 105), Vector2(480, 120), 18, outcome_panel)
    outcome_body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    replay_button = _make_button("REPLAY", Vector2(190, 250), Vector2(200, 58), 20, outcome_panel)
    replay_button.pressed.connect(_replay)

    _set_button_style(action_buttons[0])
    _set_button_style(action_buttons[1])
    _set_button_style(action_buttons[2])
    _set_button_style(action_buttons[3])
    _set_button_style(action_buttons[4])
    _set_button_style(replay_button)

    _build_briefing_ui()

func _build_briefing_ui() -> void:
    briefing_overlay = ColorRect.new()
    briefing_overlay.color = Color(0.008,0.014,0.022,0.88)
    briefing_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    briefing_overlay.visible = false
    briefing_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
    ui_root.add_child(briefing_overlay)

    briefing_panel = Panel.new()
    briefing_panel.position = Vector2(200, 60)
    briefing_panel.size = Vector2(880, 600)
    briefing_overlay.add_child(briefing_panel)

    var t := _label("OPERATION BRIEFING", Vector2(60, 24), Vector2(760, 44), 34, briefing_panel)
    t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    _label("MISSION", Vector2(60, 84), Vector2(300, 26), 18, briefing_panel)
    var icon_tints := [Color(0.85,0.70,0.30,1), Color(0.35,0.85,1.0,1), Color(1.0,0.60,0.30,1), Color(0.70,0.55,1.0,1)]
    for i in range(MISSIONS.size()):
        var b := _make_button("", Vector2(80, 118 + i * 64), Vector2(720, 56), 14, briefing_panel)
        b.alignment = HORIZONTAL_ALIGNMENT_LEFT
        b.add_theme_icon_override("icon", _mission_icon(i, icon_tints[i]))
        b.expand_icon = true
        b.pressed.connect(_select_mission.bind(i))
        _set_button_style(b)
        mission_buttons.append(b)
    _label("THEATER MODE", Vector2(60, 392), Vector2(300, 26), 18, briefing_panel)
    var modes := ["CLASSIC", "MODERN OPS"]
    for i in range(modes.size()):
        var b := _make_button("", Vector2(80 + i * 370, 424), Vector2(350, 48), 15, briefing_panel)
        b.pressed.connect(_select_mode.bind(modes[i]))
        _set_button_style(b)
        mode_buttons.append(b)
    _label("DIFFICULTY", Vector2(60, 484), Vector2(300, 26), 18, briefing_panel)
    var diffs := ["NORMAL", "HARD"]
    for i in range(diffs.size()):
        var b := _make_button("", Vector2(80 + i * 370, 516), Vector2(350, 48), 15, briefing_panel)
        b.pressed.connect(_select_difficulty.bind(diffs[i]))
        _set_button_style(b)
        diff_buttons.append(b)
    briefing_summary = _label("", Vector2(80, 576), Vector2(520, 60), 13, briefing_panel)
    deploy_button = _make_button("DEPLOY", Vector2(640, 576), Vector2(160, 56), 20, briefing_panel)
    deploy_button.pressed.connect(_deploy)
    _set_button_style(deploy_button)
    _refresh_briefing()

    # Every pressable gets scale-pop juice on press (button_down fires first).
    juice_buttons = action_buttons + mission_buttons + mode_buttons + diff_buttons
    juice_buttons.append(deploy_button)
    juice_buttons.append(replay_button)
    for jb in juice_buttons:
        jb.pivot_offset = jb.size * 0.5
        jb.button_down.connect(_press_pop.bind(jb))

func _set_action(a: String) -> void:
    selected_action = a
    _play_tone(700.0, 0.05, 0.12)

func _label(text_value: String, pos: Vector2, size: Vector2, font_size: int, parent: Node = null) -> Label:
    var l := Label.new()
    l.text = text_value
    l.position = pos
    l.size = size
    l.add_theme_font_size_override("font_size", font_size)
    l.add_theme_color_override("font_color", Color(0.86,0.91,0.96,1))
    l.add_theme_color_override("font_shadow_color", Color(0,0,0,0.65))
    l.add_theme_constant_override("shadow_offset_x", 2)
    l.add_theme_constant_override("shadow_offset_y", 2)
    (parent if parent else ui_root).add_child(l)
    return l

func _make_button(text_value: String, pos: Vector2, size: Vector2, font_size: int, parent: Node = null) -> Button:
    var b := Button.new()
    b.text = text_value
    b.position = pos
    b.size = size
    b.add_theme_font_size_override("font_size", font_size)
    (parent if parent else ui_root).add_child(b)
    return b

func _set_button_style(b: Button) -> void:
    var normal := StyleBoxFlat.new()
    normal.bg_color = Color(0.055,0.08,0.11,0.96)
    normal.border_color = Color(0.25,0.58,0.82,0.75)
    normal.set_border_width_all(1)
    normal.corner_radius_top_left = 8
    normal.corner_radius_top_right = 8
    normal.corner_radius_bottom_left = 8
    normal.corner_radius_bottom_right = 8
    var hover := normal.duplicate()
    hover.bg_color = Color(0.09,0.17,0.23,1)
    var pressed := normal.duplicate()
    pressed.bg_color = Color(0.12,0.28,0.36,1)
    b.add_theme_stylebox_override("normal", normal)
    b.add_theme_stylebox_override("hover", hover)
    b.add_theme_stylebox_override("pressed", pressed)
    b.add_theme_color_override("font_color", Color(0.86,0.94,1,1))

func _update_ui() -> void:
    phase_label.text = "%s  /  RUN %02d  •  %02d FPS  •  Q%d%s" % [phase, run_number, int(round(quality_fps)), quality_tier, "  •  PAUSED" if paused else ""]
    if paused:
        headline_label.text = "PAUSED"
        sub_label.text = "TAP / SPACE TO RESUME"
        objective_label.text = "GAME STATE FROZEN — FRAME-TIME SAFE"
    elif phase == "BRIEFING":
        var m: Dictionary = MISSIONS[mission_id]
        headline_label.text = "OPERATION BRIEFING"
        sub_label.text = "V2 THEATER COMMAND  •  CHOOSE YOUR FIGHT"
        objective_label.text = "%s  •  %s  •  %s" % [String(m.title), game_mode, difficulty]
        reserve_label.text = "ROSTER\nARTILLERY • AA\nDRONE • SPECOPS • ARMOR"
        # Deploy charging animation: pulsing gold border.
        var dpulse := 0.5 + 0.5 * sin(total_elapsed * 5.0)
        var dsb := deploy_button.get_theme_stylebox("normal") as StyleBoxFlat
        if dsb != null:
            dsb.border_color = Color(1.0, 0.78, 0.32, 0.55 + 0.45 * dpulse)
            dsb.set_border_width_all(2 + int(dpulse * 2.0))
        # Selected mission card pulse glow.
        for i in range(mission_buttons.size()):
            var msb := mission_buttons[i].get_theme_stylebox("normal") as StyleBoxFlat
            if msb != null:
                if i == mission_id:
                    var mp := 0.5 + 0.5 * sin(total_elapsed * 4.0 + float(i) * 0.9)
                    msb.border_color = Color(0.42, 0.9, 1.0, 0.6 + 0.4 * mp)
                    msb.set_border_width_all(3)
                else:
                    msb.border_color = Color(0.25, 0.58, 0.82, 0.75)
                    msb.set_border_width_all(1)
    elif phase == "BREACH":
        headline_label.text = "VANGUARD RECON"
        sub_label.text = "BREAK THE LINE  •  PERFORMANCE BECOMES FORCE"
        objective_label.text = "DISTANCE %04dm     HP %03d     SCORE %04d     COMBO x%d" % [int(distance), int(health), score, combo]
        reserve_label.text = "NEXT: RESERVES\nARTILLERY + AA from run performance"
    elif phase == "RESERVES":
        headline_label.text = "THEATER COMMAND"
        sub_label.text = "YOUR BREACH HAS BEEN CONVERTED INTO BATTLEFIELD RESERVES"
        objective_label.text = "ARTILLERY  %d       AA  %d       INTEL  %d" % [reserve.artillery, reserve.aa, intel]
        reserve_label.text = "HANDOFF\nBATTLE IN %.1fs" % max(0.0, 3.4-phase_elapsed)
    elif phase == "BATTLE":
        headline_label.text = "THEATER DEFENSE"
        sub_label.text = "FORTIFIED OBJECTIVE  •  REPEL THE BOMBER WAVE"
        var wave_txt := ""
        if game_mode == "MODERN OPS":
            wave_txt = "     WAVE %d/%d" % [wave, BATTLE_WAVES]
        objective_label.text = "BUNKER %03d%%     THREATS %02d     PING %02d     BATTLE SCORE %02d%s" % [int(max(0,bunker_hp)), bombers.size(), ping_count, battle_score, wave_txt]
        reserve_label.text = "RESERVES\nARTILLERY  %d\nAA  %d\nDRONE  %d\nSPECOPS  %d\nARMOR  %d" % [reserve.artillery, reserve.aa, reserve.drone, reserve.specops, reserve.armor]
        # Selected command action glows gold.
        var defs := ["ARTILLERY", "AA", "DRONE", "SPECOPS", "ARMOR"]
        for i in range(action_buttons.size()):
            var asb := action_buttons[i].get_theme_stylebox("normal") as StyleBoxFlat
            if asb != null:
                if defs[i] == selected_action:
                    asb.border_color = Color(1.0, 0.8, 0.35, 0.95)
                    asb.set_border_width_all(3)
                else:
                    asb.border_color = Color(0.25, 0.58, 0.82, 0.75)
                    asb.set_border_width_all(1)
    else:
        headline_label.text = battle_result
        sub_label.text = "THE LOOP IS COMPLETE — YOUR NEXT RUN STARTS FROM WHAT YOU LEARNED"
        var m: Dictionary = MISSIONS[mission_id]
        objective_label.text = "RUN %02d     SCORE %04d     BATTLE SCORE %02d     PINGS %02d" % [run_number, score, battle_score, ping_count]
        reserve_label.text = "%s\n%s • %s\nMission: %s" % [String(m.title), game_mode, difficulty, "SUCCESS" if mission_success else "FAILED"]

    feedback_label.text = feedback if feedback_timer <= 0.0 else feedback
    feedback_label.visible = phase != "OUTCOME" and phase != "BRIEFING"
    for b in action_buttons:
        b.visible = phase == "BATTLE"
    briefing_overlay.visible = phase == "BRIEFING"
    overlay.visible = phase == "OUTCOME"
    outcome_panel.visible = phase == "OUTCOME"
    if phase == "OUTCOME":
        outcome_title.text = battle_result
        var m: Dictionary = MISSIONS[mission_id]
        var shown := int(outcome_count) if battle_result == "VICTORY" else score
        outcome_body.text = "Mission: %s — %s\n%s • %s\n\nFINAL SCORE: %d\nResources spent: %d artillery • %d AA • %d drone • %d specops • %d armor\nBunker integrity: %d%%\n\nBREACH → RESERVES → COMMAND → BATTLE\nThe result of your run became the resources you commanded." % [String(m.title), "SUCCESS" if mission_success else "FAILED", game_mode, difficulty, shown, artillery_used, aa_used, drone_used, specops_used, armor_used, int(max(0,bunker_hp))]

# -----------------------------------------------------------------------------
# DRAWING — all visual assets are generated at runtime.
# -----------------------------------------------------------------------------

func _draw() -> void:
    # Fixed 1280x720 design composition; all art is vector/procedural for zero asset streaming.
    var shake_off := Vector2.ZERO
    if camera_shake > 0.0:
        shake_off = Vector2(rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0)) * camera_shake * 12.0
    draw_set_transform(shake_off, 0.0, Vector2(2.0, 2.0))
    draw_rect(Rect2(0,0,W,H), Color("070d14"), true)
    _draw_cinematic_background()
    if phase == "BREACH":
        _draw_breach()
    elif phase == "BRIEFING":
        _draw_briefing_backdrop()
    elif phase == "RESERVES":
        _draw_reserves()
    elif phase == "BATTLE":
        _draw_battle()
    else:
        _draw_outcome_backdrop()
    _draw_fx()
    _draw_splash()
    _draw_combo_hud()
    _draw_hud_frame()
    _draw_projectiles()
    if paused:
        draw_rect(Rect2(0,0,W,H), Color(0.01,0.02,0.03,0.58), true)
        draw_string(title_font, Vector2(470,360), "PAUSED", HORIZONTAL_ALIGNMENT_LEFT, 340, 44, Color(0.80,0.94,0.98,1))
        draw_string(body_font, Vector2(430,410), "P / TAP TOP-RIGHT TO RESUME", HORIZONTAL_ALIGNMENT_LEFT, 420, 16, Color(0.52,0.72,0.78,1))
    if flash > 0.0:
        draw_rect(Rect2(0,0,W,H), Color(0.70,0.90,1.0,flash*0.075), true)

func _draw_fx() -> void:
    # Shockwave rings (eased expansion, fading alpha).
    for r in shockwaves:
        var t: float = 1.0 - float(r.life) / float(r.max_life)
        var rad: float = float(r.max_r) * (1.0 - pow(1.0 - t, 3.0))
        var a: float = float(r.life) / float(r.max_life)
        var c: Color = r.color
        draw_arc(r.p, rad, 0, TAU, 48, Color(c.r, c.g, c.b, c.a * a), float(r.width), true)
    # Particles (fire, smoke, sparks, embers).
    for p in fx:
        var a: float = clampf(float(p.life) / float(p.max_life), 0.0, 1.0)
        var c: Color = p.color
        draw_circle(p.p, float(p.size) * (0.4 + 0.6 * a), Color(c.r, c.g, c.b, c.a * a))
    # Touch ripple rings.
    for r in ripples:
        var t: float = 1.0 - float(r.life) / float(r.max_life)
        var rad: float = float(r.max_r) * t
        var a: float = (1.0 - t) * 0.85
        var c: Color = r.color
        draw_circle(r.p, rad, Color(c.r, c.g, c.b, a), false, 3.0)
        draw_circle(r.p, rad * 0.6, Color(c.r, c.g, c.b, a * 0.5), false, 2.0)
    # Floating score popups.
    for s in popups:
        var a: float = clampf(float(s.life) / float(s.max_life) * 1.5, 0.0, 1.0)
        var c: Color = s.color
        draw_string(body_font, (s.p as Vector2) + Vector2(-100, 0), s.text, HORIZONTAL_ALIGNMENT_CENTER, 200, int(s.size), Color(c.r, c.g, c.b, a))
    _draw_banners()
    # Battle aim reticles: rotating ticks + contracting ring.
    for r in reticles:
        var t: float = clampf(float(r.life) / float(r.max_life), 0.0, 1.0)
        var p: Vector2 = r.p
        var rot: float = (1.0 - t) * 1.2
        var rad: float = 34.0 * (0.5 + 0.5 * t) + 8.0
        for k in range(4):
            var a0: float = rot + float(k) * PI * 0.5
            var d0 := Vector2(cos(a0), sin(a0))
            draw_line(p + d0 * (rad - 12.0), p + d0 * (rad + 6.0), Color(1.0, 0.45, 0.3, 0.9 * t + 0.1), 3.0, true)
        draw_arc(p, rad, 0, TAU, 40, Color(1.0, 0.5, 0.32, 0.55 * t + 0.1), 2.0, true)
        draw_circle(p, 3.0, Color(1.0, 0.6, 0.4, 0.9))

func _draw_banners() -> void:
    var y := 250.0
    for b in banners:
        var t: float = 1.0 - float(b.life) / float(b.max_life)
        var slam: float = clampf(t / 0.18, 0.0, 1.0)
        var fade: float = 1.0 - clampf((t - 0.7) / 0.3, 0.0, 1.0)
        var sc: float = lerpf(2.4, 1.0, 1.0 - pow(1.0 - slam, 3.0))
        var fs: int = int(44.0 * sc)
        var c: Color = b.color
        var col := Color(c.r, c.g, c.b, c.a * minf(slam * 1.4, 1.0) * fade)
        draw_string(title_font, Vector2(140, y), b.text, HORIZONTAL_ALIGNMENT_CENTER, 1000, fs, col)
        if String(b.sub) != "":
            draw_string(body_font, Vector2(340, y + 34), b.sub, HORIZONTAL_ALIGNMENT_CENTER, 600, 18, Color(0.85, 0.9, 0.93, fade))
        y += 96.0

func _draw_splash() -> void:
    if splash_text == "" or transition <= 0.0:
        return
    var t: float = clampf(1.0 - transition, 0.0, 1.0)
    var appear: float = clampf(t / 0.22, 0.0, 1.0)
    var fade: float = 1.0 - clampf((t - 0.62) / 0.38, 0.0, 1.0)
    var e: float = 1.0 - pow(1.0 - appear, 3.0)
    var fs: int = int(lerpf(96.0, 64.0, e))
    var a: float = minf(appear * 1.6, 1.0) * fade
    draw_rect(Rect2(0, 296, W, 128), Color(0.01, 0.02, 0.03, 0.62 * a), true)
    draw_rect(Rect2(240, 296, W - 480, 1), Color(0.83, 0.69, 0.22, 0.8 * a), true)
    draw_rect(Rect2(240, 422, W - 480, 1), Color(0.83, 0.69, 0.22, 0.8 * a), true)
    draw_string(title_font, Vector2(140, 372), splash_text, HORIZONTAL_ALIGNMENT_CENTER, 1000, fs, Color(0.95, 0.97, 1.0, a))
    if splash_sub != "":
        draw_string(body_font, Vector2(340, 404), splash_sub, HORIZONTAL_ALIGNMENT_CENTER, 600, 17, Color(0.62, 0.78, 0.82, a))

func _draw_combo_hud() -> void:
    if combo < 2 or (phase != "BREACH" and phase != "BATTLE"):
        return
    var fs: int = 26 + int(combo_pop * 90.0)
    var a: float = clampf(0.35 + 0.65 * (combo_timer / COMBO_WINDOW), 0.0, 1.0)
    draw_string(title_font, Vector2(440, 118), "x%d COMBO" % combo, HORIZONTAL_ALIGNMENT_CENTER, 400, fs, Color(1.0, 0.72, 0.32, a))

func _draw_projectiles() -> void:
    for projectile in projectiles:
        var q: float = clamp(projectile.t / max(0.01, projectile.duration), 0.0, 1.0)
        var p: Vector2 = projectile.start.lerp(projectile.target, q)
        var k := String(projectile.kind)
        var trail_c := Color(0.95, 0.78, 0.38, 1.0)
        var head_c := Color(1.0, 0.88, 0.52, 1.0)
        var w := 7.0
        if k == "aa" or k == "micro":
            trail_c = Color(0.38, 0.95, 1.0, 1.0)
            head_c = Color(0.7, 1.0, 1.0, 1.0)
            w = 4.0
        elif k == "tracer":
            trail_c = Color(1.0, 0.6, 0.25, 1.0)
            head_c = Color(1.0, 0.85, 0.5, 1.0)
            w = 4.0
        elif k == "shell":
            trail_c = Color(1.0, 0.45, 0.2, 1.0)
            head_c = Color(1.0, 0.7, 0.4, 1.0)
            w = 9.0
        var segs := 4
        for s in range(segs):
            var q0: float = clampf(q - float(s + 1) * 0.06, 0.0, 1.0)
            var q1: float = clampf(q - float(s) * 0.06, 0.0, 1.0)
            var sa: float = (1.0 - float(s) / float(segs)) * 0.5
            draw_line(projectile.start.lerp(projectile.target, q0), projectile.start.lerp(projectile.target, q1), Color(trail_c.r, trail_c.g, trail_c.b, sa), w, true)
        draw_circle(p, w + 2.0, Color(head_c.r, head_c.g, head_c.b, 0.35))
        draw_circle(p, w * 0.7, Color(head_c.r, head_c.g, head_c.b, 0.95))
        draw_circle(p, w * 0.35, Color(1, 1, 1, 0.95))
        if q < 0.3:
            var ma: float = 1.0 - q / 0.3
            draw_circle(projectile.start, 14.0 * ma + 4.0, Color(1.0, 0.9, 0.6, 0.7 * ma))

func _draw_cinematic_background() -> void:
    # Layered atmospheric backdrop: cheap geometry, no textures, no particle nodes.
    draw_rect(Rect2(0,0,W,H), Color("08121b"), true)
    draw_circle(Vector2(970,300), 520, Color(0.03,0.24,0.34,0.09))
    draw_circle(Vector2(970,300), 340, Color(0.05,0.34,0.42,0.07))
    # horizon bands
    for i in range(7):
        var y := 145.0 + i * 76.0
        var a := 0.035 + i * 0.006
        draw_line(Vector2(0,y), Vector2(W,y), Color(0.22,0.56,0.64,a), 1.0, true)
    # animated scan streaks
    for i in range(14):
        var x := fmod(i * 173.0 + total_elapsed * (18.0 + float(i%3)*8.0), W + 160.0) - 80.0
        var y := 150.0 + fmod(i * 71.0, 500.0)
        draw_line(Vector2(x,y), Vector2(x+32,y), Color(0.34,0.80,0.90,0.11), 2.0, true)
    # sparse airborne particles
    for i in range(8 + quality_tier * 4):
        var x := fmod(i * 97.0 + total_elapsed * (7.0 + float(i%4)*3.0), W)
        var y := 120.0 + fmod(i * 53.0, 520.0)
        var r := 0.9 + float(i%3)*0.45
        draw_circle(Vector2(x,y), r, Color(0.42,0.82,0.90,0.10 + 0.035*sin(total_elapsed*1.4+i)))
    # cinematic vignette
    draw_rect(Rect2(0,0,W,72), Color(0,0,0,0.30), true)
    draw_rect(Rect2(0,H-74,W,74), Color(0,0,0,0.38), true)
    draw_rect(Rect2(0,0,48,H), Color(0,0,0,0.20), true)
    draw_rect(Rect2(W-48,0,48,H), Color(0,0,0,0.20), true)

func _draw_hud_frame() -> void:
    draw_rect(Rect2(1165,22,82,44),Color(0.035,0.07,0.09,0.94),true)
    draw_rect(Rect2(1165,22,82,44),Color(0.25,0.58,0.70,0.55),false,1)
    draw_rect(Rect2(1190,34,7,20),Color("b8e8ef"),true)
    draw_rect(Rect2(1210,34,7,20),Color("b8e8ef"),true)
    # Fine tactical frame and corner brackets.
    var c := Color(0.25,0.72,0.82,0.34)
    draw_line(Vector2(26,106),Vector2(26,158),c,2)
    draw_line(Vector2(26,106),Vector2(92,106),c,2)
    draw_line(Vector2(W-26,106),Vector2(W-26,158),c,2)
    draw_line(Vector2(W-92,106),Vector2(W-26,106),c,2)
    draw_line(Vector2(26,H-112),Vector2(26,H-62),c,2)
    draw_line(Vector2(26,H-62),Vector2(92,H-62),c,2)
    draw_line(Vector2(W-26,H-112),Vector2(W-26,H-62),c,2)
    draw_line(Vector2(W-92,H-62),Vector2(W-26,H-62),c,2)
    # live status strip
    draw_rect(Rect2(28,132,260,3), Color(0.12,0.60,0.70,0.42), true)
    draw_rect(Rect2(W-290,132,260,3), Color(0.12,0.60,0.70,0.42), true)

func _draw_breach() -> void:
    # High-speed reconnaissance corridor with strong perspective.
    var horizon := Vector2(W*0.5,178)
    var floor := PackedVector2Array([Vector2(80,650),Vector2(W-80,650),Vector2(W*0.62,205),Vector2(W*0.38,205)])
    draw_colored_polygon(floor, Color("0a1820"))
    # City / fortification silhouettes
    for i in range(18):
        var side := -1.0 if i%2==0 else 1.0
        var x := 30.0 + float(i/2)*145.0
        if side > 0: x = W - x
        var h := 55.0 + float((i*37)%120)
        draw_rect(Rect2(x,178-h,72,h), Color(0.025,0.075,0.095,0.92), true)
        for w in range(2):
            draw_rect(Rect2(x+12+w*25,190-h,8,10), Color(0.25,0.62,0.67,0.14), true)
    # Perspective lane guides
    for x in lane_x:
        draw_line(horizon, Vector2(x,650), Color(0.20,0.68,0.75,0.28), 2.0, true)
    for i in range(11):
        var t := float(i)/10.0
        var y: float = lerp(220.0,650.0,t*t)
        var half: float = lerp(120.0,570.0,t)
        draw_line(Vector2(W*0.5-half,y),Vector2(W*0.5+half,y),Color(0.20,0.46,0.53,0.20),1.0,true)
    # Speed strips — intensity grows with run distance.
    var inten := 0.10 + 0.25 * clampf(distance / maxf(1.0, distance_target), 0.0, 1.0)
    for i in range(12):
        var x := fmod(i*139.0 + distance*2.8, 1240.0)+20.0
        var y := 230.0 + fmod(i*83.0 + distance*0.65, 370.0)
        draw_line(Vector2(x,y),Vector2(x-18,y+42),Color(0.32,0.84,0.92,inten),2.0,true)
    for obj in breach_objects:
        if not obj.alive or obj.z < -100 or obj.z > 3500:
            continue
        var t: float = clamp((3500.0-obj.z)/3500.0,0.0,1.0)
        var y: float = 198.0 + t*t * 420.0
        var scale: float = 0.25 + t * 1.25
        var x: float = lane_x[obj.lane]
        _draw_breach_object(obj.kind,Vector2(x,y),scale,obj.pulse)
    _draw_player_drone(Vector2(player_x,575))
    # Tap-shoot tracers: muzzle-to-target streaks with a hot head.
    for s in breach_shots:
        var st: float = clampf(float(s.t) / float(s.dur), 0.0, 1.0)
        var a: Vector2 = s.a
        var b: Vector2 = s.b
        var head: Vector2 = a.lerp(b, st)
        draw_line(a, head, Color(0.6, 0.95, 1.0, 0.8 * (1.0 - st * 0.5)), 3.0, true)
        draw_circle(head, 6.0, Color(0.85, 1.0, 1.0, 0.9))
    # progress rail
    draw_rect(Rect2(360,620,560,4),Color(0.07,0.18,0.22,1),true)
    draw_rect(Rect2(360,620,560*clamp(distance/max(1.0,distance_target),0.0,1.0),4),Color(0.22,0.80,0.92,0.92),true)
    if breach_time_limit > 0.0:
        var left: float = max(0.0, breach_time_limit - phase_elapsed)
        draw_string(body_font,Vector2(360,608),"EXTRACTION IN %.1fs" % left,HORIZONTAL_ALIGNMENT_LEFT,300,15,Color(1.0,0.75,0.35,1))
    if gate_open:
        _draw_gate_overlay()

func _draw_player_drone(p: Vector2) -> void:
    var pulse := 0.5 + 0.5*sin(total_elapsed*9.0)
    draw_circle(p,38+8*pulse,Color(0.16,0.76,0.92,0.06))
    draw_circle(p+Vector2(0,18),9,Color(0.25,0.90,1.0,0.20))
    draw_colored_polygon(PackedVector2Array([p+Vector2(-25,12),p+Vector2(0,-20),p+Vector2(25,12),p+Vector2(0,20)]),Color("bfeef4"))
    draw_colored_polygon(PackedVector2Array([p+Vector2(-13,7),p+Vector2(0,-12),p+Vector2(13,7),p+Vector2(0,12)]),Color("1b5363"))
    draw_line(p+Vector2(-25,12),p+Vector2(-42,25),Color(0.35,0.90,1,0.85),4)
    draw_line(p+Vector2(25,12),p+Vector2(42,25),Color(0.35,0.90,1,0.85),4)
    draw_circle(p,4,Color(0.90,1,1,1))

func _draw_breach_object(kind: String,p: Vector2,s: float,pulse: float) -> void:
    if kind == "enemy":
        draw_circle(p,26*s,Color(0.95,0.18,0.13,0.08))
        draw_rect(Rect2(p-Vector2(18,13)*s,Vector2(36,26)*s),Color("6f1d22"),true)
        draw_rect(Rect2(p-Vector2(12,8)*s,Vector2(24,5)*s),Color(0.93,0.36,0.25,0.55),true)
        draw_circle(p+Vector2(8,-2)*s,4*s,Color("ffd17a"))
        draw_line(p+Vector2(-22,14)*s,p+Vector2(22,14)*s,Color(0.96,0.33,0.25,0.55),2)
    elif kind == "intel":
        var r := (15.0+sin(pulse)*3.0)*s
        draw_circle(p,r*1.8,Color(0.10,0.75,0.95,0.055))
        draw_circle(p,r,Color(0.12,0.74,0.94,0.16))
        draw_circle(p,r*0.52,Color("4ce6ff"))
        draw_line(p-Vector2(9,0)*s,p+Vector2(9,0)*s,Color("d9fbff"),2)
        draw_line(p-Vector2(0,9)*s,p+Vector2(0,9)*s,Color("d9fbff"),2)
    elif kind == "supply":
        draw_circle(p,23*s,Color(0.92,0.68,0.18,0.07))
        draw_rect(Rect2(p-Vector2(16,14)*s,Vector2(32,28)*s),Color("9b7425"),true)
        draw_line(p-Vector2(11,0)*s,p+Vector2(11,0)*s,Color("ffe69a"),3)
        draw_line(p-Vector2(0,11)*s,p+Vector2(0,11)*s,Color("ffe69a"),2)
    else:
        var pts := PackedVector2Array([p+Vector2(-20,14)*s,p+Vector2(0,-18)*s,p+Vector2(20,14)*s])
        draw_colored_polygon(pts,Color("b7352a"))
        draw_line(p+Vector2(-9,4)*s,p+Vector2(8,-6)*s,Color("ffd17a"),3)
        draw_circle(p,24*s,Color(0.92,0.24,0.16,0.06))

func _draw_gate_overlay() -> void:
    draw_rect(Rect2(175,155,930,390),Color(0.015,0.025,0.038,0.97),true)
    draw_rect(Rect2(175,155,930,390),Color(0.25,0.76,0.86,0.78),false,2)
    draw_rect(Rect2(205,185,870,1),Color(0.28,0.68,0.76,0.28),true)
    draw_string(title_font,Vector2(220,235),"TACTICAL FORK",HORIZONTAL_ALIGNMENT_LEFT,780,30,Color("d9f9ff"))
    draw_string(body_font,Vector2(220,265),"Your last decision becomes a battlefield modifier.",HORIZONTAL_ALIGNMENT_LEFT,780,15,Color(0.58,0.73,0.78,1))
    for i in range(gate_options.size()):
        var x := 215.0 + i*440.0
        var accent := Color("ef9d58") if i==0 else Color("4ce6ff")
        draw_rect(Rect2(x,300,400,190),Color(0.035,0.07,0.09,1),true)
        draw_rect(Rect2(x,300,400,190),Color(accent.r,accent.g,accent.b,0.65),false,2)
        draw_circle(Vector2(x+38,338),9,Color(accent.r,accent.g,accent.b,0.95))
        draw_string(title_font,Vector2(x+62,347),gate_options[i].title,HORIZONTAL_ALIGNMENT_LEFT,310,25,accent)
        draw_string(body_font,Vector2(x+28,392),gate_options[i].desc,HORIZONTAL_ALIGNMENT_LEFT,340,18,Color("d2dce1"))
        draw_string(body_font,Vector2(x+28,463),"TAP / CLICK TO COMMIT",HORIZONTAL_ALIGNMENT_LEFT,340,13,Color(0.47,0.63,0.68,1))

func _draw_reserves() -> void:
    draw_string(title_font,Vector2(120,180),"FORCE GENERATION",HORIZONTAL_ALIGNMENT_LEFT,600,30,Color("d9f9ff"))
    draw_string(body_font,Vector2(120,207),"BREACH PERFORMANCE → COMMAND AUTHORITY",HORIZONTAL_ALIGNMENT_LEFT,600,15,Color(0.48,0.69,0.74,1))
    draw_string(body_font,Vector2(120,232),"TAP A CARD TO INSPECT",HORIZONTAL_ALIGNMENT_LEFT,600,14,Color(0.55,0.75,0.8,0.9))
    # Tappable unit cards — hit boxes are the shared RESERVE_CARDS const.
    var keys := ["artillery", "aa", "drone", "specops", "armor"]
    for i in range(5):
        var r: Rect2 = RESERVE_CARDS[i]
        var sel := reserve_inspect == i
        var cnt: int = int(reserve.get(keys[i], 0))
        draw_rect(r, Color(0.035, 0.075, 0.09, 0.97), true)
        var bc := Color(0.16, 0.48, 0.55, 0.45)
        var bw := 1
        if sel:
            var pu: float = 0.5 + 0.5 * sin(total_elapsed * 6.0)
            bc = Color(1.0, 0.78, 0.35, 0.55 + 0.45 * pu)
            bw = 3
        elif cnt > 0:
            bc = Color(0.35, 0.85, 0.7, 0.6)
            bw = 2
        draw_rect(r, bc, false, bw)
        _draw_reserve_icon(keys[i], r.position + Vector2(104, 62))
        draw_string(title_font, r.position + Vector2(0, 112), String(RESERVE_UNITS[i].name), HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 17, Color("d9f9ff"))
        draw_string(title_font, r.position + Vector2(0, 162), "x%d" % cnt, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 34, Color("4ce6ff") if cnt > 0 else Color(0.4, 0.45, 0.48, 1))
        draw_string(body_font, r.position + Vector2(0, 184), "TAP TO INSPECT", HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 12, Color(0.5, 0.62, 0.66, 0.8))
    # Detail popup for the inspected card.
    if reserve_inspect >= 0:
        var u: Dictionary = RESERVE_UNITS[reserve_inspect]
        var pr := Rect2(290, 468, 700, 118)
        draw_rect(pr, Color(0.02, 0.05, 0.07, 0.96), true)
        draw_rect(pr, Color(1.0, 0.78, 0.35, 0.7), false, 2)
        draw_string(title_font, pr.position + Vector2(24, 38), String(u.name), HORIZONTAL_ALIGNMENT_LEFT, 650, 22, Color("ffd98a"))
        var lines: PackedStringArray = String(u.desc).split("\n")
        for li in range(lines.size()):
            draw_string(body_font, pr.position + Vector2(24, 64 + li * 20), lines[li], HORIZONTAL_ALIGNMENT_LEFT, 650, 15, Color(0.78, 0.86, 0.88, 1))
        draw_string(body_font, pr.position + Vector2(24, 64 + lines.size() * 20), "IN RESERVE: %d — TAP CARD AGAIN TO CLOSE" % int(reserve.get(String(u.key), 0)), HORIZONTAL_ALIGNMENT_LEFT, 650, 13, Color(0.55, 0.7, 0.74, 1))
    draw_string(title_font,Vector2(120,608),"YOUR RUN HAS WEIGHT",HORIZONTAL_ALIGNMENT_LEFT,500,28,Color("4ce6ff"))
    draw_string(body_font,Vector2(120,636),"Accuracy, survival and intelligence",HORIZONTAL_ALIGNMENT_LEFT,500,18,Color("c9d6db"))
    draw_string(body_font,Vector2(120,658),"become finite battlefield power.",HORIZONTAL_ALIGNMENT_LEFT,500,18,Color("c9d6db"))
    draw_string(body_font,Vector2(700,632),"BATTLE DEPLOYS IN %.1fs" % max(0.0,3.4-phase_elapsed),HORIZONTAL_ALIGNMENT_LEFT,400,17,Color(0.52,0.77,0.82,1))
    draw_rect(Rect2(700,648,450,6),Color(0.08,0.17,0.20,1),true)
    draw_rect(Rect2(700,648,450*clamp(phase_elapsed/3.4,0.0,1.0),6),Color("4ce6ff"),true)

func _draw_reserve_icon(key: String, c: Vector2) -> void:
    if key == "artillery":
        draw_circle(c, 16, Color("788b92"))
        draw_line(c, c + Vector2(24, -20), Color("c1cbd0"), 6)
        draw_circle(c + Vector2(24, -20), 4, Color("ffe69a"))
    elif key == "aa":
        draw_circle(c, 13, Color("4bd9ec"))
        draw_line(c, c + Vector2(0, -30), Color("9df5ff"), 4)
        draw_arc(c + Vector2(0, -30), 12, PI, TAU, 16, Color("9df5ff"), 3)
    elif key == "drone":
        draw_colored_polygon(PackedVector2Array([c + Vector2(-20, 6), c + Vector2(0, -12), c + Vector2(20, 6), c + Vector2(0, 12)]), Color("9fd8e8"))
        draw_circle(c, 4, Color(0.3, 1.0, 0.85, 1))
    elif key == "specops":
        draw_rect(Rect2(c - Vector2(10, 4), Vector2(20, 26)), Color("c98a3a"), true)
        draw_circle(c + Vector2(0, -14), 8, Color("e8b96a"))
        draw_line(c + Vector2(-14, 6), c + Vector2(14, 6), Color("8a5f24"), 4)
    else:
        draw_rect(Rect2(c - Vector2(22, 8), Vector2(44, 20)), Color("8a4a3a"), true)
        draw_line(c + Vector2(10, -4), c + Vector2(34, -12), Color("d98a6a"), 6)
        draw_circle(c - Vector2(12, 12), 5, Color("ffb37a"))

func _draw_battle() -> void:
    # Theater map: layered terrain, command grid, objective and air threat layer.
    draw_rect(Rect2(0,145,W,500),Color("071d1a"),true)
    # terrain cells
    for row in range(8):
        for col in range(11):
            var x := 28.0 + col*116.0
            var y := 175.0 + row*56.0
            var shade := 0.025 + float((row+col)%3)*0.012
            draw_rect(Rect2(x,y,96,42),Color(0.05,0.18+shade,0.15,0.75),true)
    # command routes
    draw_line(Vector2(80,270),Vector2(510,420),Color(0.23,0.75,0.63,0.30),3)
    draw_line(Vector2(1190,255),Vector2(760,410),Color(0.90,0.36,0.25,0.25),3)
    # bunker aura and structure
    var bp := Vector2(640,505)
    for r in [135.0,105.0,82.0]:
        draw_arc(bp,r,0,TAU,64,Color(0.28,0.83,0.68,0.08),2)
    draw_rect(Rect2(bp-Vector2(92,60),Vector2(184,120)),Color("26383a"),true)
    draw_rect(Rect2(bp-Vector2(68,43),Vector2(136,86)),Color("111c20"),true)
    draw_rect(Rect2(bp-Vector2(42,25),Vector2(84,50)),Color("1a2b2d"),true)
    draw_line(bp-Vector2(26,31),bp+Vector2(26,31),Color("9aa8a5"),7)
    draw_circle(bp,7,Color("65efc5"))
    # integrity segmented bar
    for i in range(20):
        var seg := Rect2(500+i*14,632,11,8)
        var active := i < int(20.0*bunker_hp/100.0)
        draw_rect(seg,Color("42d6a4") if active else Color(0.10,0.16,0.16,1),true)
    draw_string(body_font,Vector2(500,660),"FORTIFIED OBJECTIVE",HORIZONTAL_ALIGNMENT_CENTER,280,15,Color(0.53,0.72,0.68,1))
    # bombers with contrails
    for b in bombers:
        if not bool(b.get("active", true)) or b.y > 700: continue
        var p := Vector2(b.x,b.y)
        draw_line(p+Vector2(0,-65),p+Vector2(0,-10),Color(0.95,0.32,0.22,0.13),5)
        draw_circle(p,30,Color(0.95,0.25,0.17,0.055))
        draw_colored_polygon(PackedVector2Array([p+Vector2(-27,5),p+Vector2(-7,-10),p+Vector2(0,-7),p+Vector2(8,-10),p+Vector2(29,5),p+Vector2(8,13),p+Vector2(0,10),p+Vector2(-8,13)]),Color("b9c2c5"))
        draw_circle(p,5,Color("ff6a45"))
    # impacts are simulation state; animation advances in _process, not in _draw.
    for impact in impacts:
        var rr: float = impact.r + impact.t*145.0
        var a: float = max(0.0,1.0-impact.t*1.5)
        draw_circle(impact.p,rr,Color(1.0,0.57,0.20,a*0.34),false,4)
        draw_circle(impact.p,rr*0.22,Color(1,0.82,0.45,a*0.30))
    if battle_message_timer > 0.0:
        draw_rect(Rect2(300,165,680,58),Color(0.01,0.035,0.04,0.94),true)
        draw_rect(Rect2(300,165,680,58),Color(0.22,0.72,0.66,0.35),false,1)
        draw_string(title_font,Vector2(325,202),battle_message,HORIZONTAL_ALIGNMENT_CENTER,630,18,Color("baf8e9"))
    if ping_visual_time >= 0.0:
        var pulse: float = clamp(ping_visual_time / 0.9, 0.0, 1.0)
        draw_arc(BUNKER_POS,90+pulse*220,0,TAU,72,Color(0.25,0.86,1,0.75*(1-pulse)),3)
        draw_arc(BUNKER_POS,90+pulse*150,0,TAU,72,Color(0.30,1,0.74,0.24*(1-pulse)),2)
    # V2: modern-unit entities + wave banner.
    _draw_modern_units()
    if game_mode == "MODERN OPS":
        draw_string(title_font,Vector2(440,148),"WAVE %d / %d" % [wave, BATTLE_WAVES],HORIZONTAL_ALIGNMENT_LEFT,400,22,Color("ffd17a"))
        if wave_break > 0.0:
            draw_string(body_font,Vector2(480,640),"NEXT WAVE IN %.1fs" % wave_break,HORIZONTAL_ALIGNMENT_LEFT,320,16,Color(0.95,0.75,0.45,1))
    # Low-integrity red pulse warning.
    if bunker_hp < 35.0 and bunker_hp > 0.0:
        var wp: float = 0.5 + 0.5 * sin(total_elapsed * 7.0)
        draw_rect(Rect2(0, 0, W, H), Color(0.75, 0.06, 0.06, 0.05 + 0.09 * wp), true)
        if wp > 0.35:
            draw_string(title_font, Vector2(440, 152), "INTEGRITY CRITICAL", HORIZONTAL_ALIGNMENT_CENTER, 400, 24, Color(1.0, 0.3, 0.25, 0.5 + 0.5 * wp))

func _draw_briefing_backdrop() -> void:
    # The briefing overlay (Controls) carries the selection UI; the world
    # behind it stays a dimmed tactical backdrop. The overlay is slightly
    # translucent so the radar sweep and drifting blips bleed through the margins.
    draw_rect(Rect2(0,0,W,H),Color("04090e"),true)
    for i in range(10):
        var y := 90.0 + i * 60.0
        draw_line(Vector2(60,y),Vector2(W-60,y),Color(0.16,0.42,0.50,0.10),1.0,true)
    # Radar sweep (left margin, clear of the panel).
    var ctr := Vector2(105, 420)
    var ang: float = fmod(total_elapsed * 0.9, TAU)
    draw_arc(ctr, 85, 0, TAU, 64, Color(0.2, 0.6, 0.7, 0.28), 1.5)
    draw_arc(ctr, 57, 0, TAU, 48, Color(0.2, 0.6, 0.7, 0.22), 1.5)
    draw_arc(ctr, 29, 0, TAU, 32, Color(0.2, 0.6, 0.7, 0.22), 1.5)
    draw_line(ctr, ctr + Vector2(cos(ang), sin(ang)) * 85.0, Color(0.35, 0.9, 1.0, 0.55), 2.0, true)
    for i in range(5):
        var ba: float = fmod(float(i) * 1.256 + 0.4, TAU)
        var br: float = 22.0 + float((i * 37) % 55)
        var bp := ctr + Vector2(cos(ba), sin(ba)) * br
        var dd: float = absf(fmod(ang - ba + TAU, TAU))
        var blip_a: float = clampf(1.0 - dd / 2.0, 0.08, 1.0)
        draw_circle(bp, 4, Color(0.5, 1.0, 0.9, blip_a))
    # Drifting signal blips across the backdrop.
    for i in range(6 + quality_tier * 2):
        var bx := fmod(float(i) * 211.0 + total_elapsed * 14.0, W + 60.0) - 30.0
        var by := 80.0 + fmod(float(i) * 97.0, 560.0)
        draw_circle(Vector2(bx, by), 2.2, Color(0.35, 0.75, 0.85, 0.10 + 0.06 * sin(total_elapsed * 1.7 + float(i))))

func _draw_modern_units() -> void:
    # REAPER UCAVs on patrol.
    for d in drones:
        var p := Vector2(d.x, d.y)
        var life_f: float = clampf(float(d.life) / 12.0, 0.0, 1.0)
        draw_circle(p, 26, Color(0.30,0.85,1.0,0.10))
        draw_colored_polygon(PackedVector2Array([
            p + Vector2(-22, 6), p + Vector2(-6, -4), p + Vector2(0, -2),
            p + Vector2(6, -4), p + Vector2(22, 6), p + Vector2(6, 10),
            p + Vector2(0, 8), p + Vector2(-6, 10)]), Color("9fd8e8"))
        draw_circle(p + Vector2(0, -2), 4, Color(0.30,1.0,0.85,0.9))
        draw_arc(p, 34, 0, TAU * life_f, 40, Color(0.30,0.85,1.0,0.55), 2)
    # SPECTRE teams with denial radius.
    for t in specops_teams:
        var p := Vector2(t.x, t.y)
        var life_f: float = clampf(float(t.life) / 15.0, 0.0, 1.0)
        draw_arc(p, 240.0, 0, TAU, 72, Color(0.95,0.62,0.25,0.10 + 0.08 * life_f), 2)
        draw_rect(Rect2(p - Vector2(14, 18), Vector2(28, 36)), Color("c98a3a"), true)
        draw_circle(p + Vector2(0, -24), 7, Color("e8b96a"))
        draw_line(p + Vector2(0, -18), p + Vector2(0, -2), Color("8a5f24"), 4)
        draw_string(body_font, p + Vector2(-34, 34), "SPECTRE", HORIZONTAL_ALIGNMENT_LEFT, 90, 12, Color(0.95,0.75,0.45,0.85))
    # AEGIS reload indicator near the objective.
    if armor_cooldown > 0.0:
        var p := Vector2(760, 560)
        draw_arc(p, 18, -PI / 2.0, -PI / 2.0 + TAU * (1.0 - armor_cooldown / 1.4), 32, Color(0.95,0.45,0.30,0.8), 4)
        draw_string(body_font, p + Vector2(-30, 40), "AEGIS", HORIZONTAL_ALIGNMENT_LEFT, 70, 12, Color(0.95,0.60,0.40,0.85))

func _draw_outcome_backdrop() -> void:
    draw_rect(Rect2(0,0,W,H),Color("050b11"),true)
    for i in range(12):
        var x := 70.0+i*105.0
        var h := 80.0+float((i*43)%240)
        draw_rect(Rect2(x,620-h,70,h),Color(0.04,0.11,0.14,0.9),true)
        draw_line(Vector2(x+12,620-h+15),Vector2(x+58,620-h+15),Color(0.20,0.55,0.62,0.18),2)
    var win := battle_result == "VICTORY"
    draw_circle(Vector2(640,370),180,Color(0.15,0.75,0.65,0.07) if win else Color(0.85,0.20,0.16,0.07))
    draw_arc(Vector2(640,370),180,0,TAU,96,Color(0.35,0.92,0.82,0.25) if win else Color(0.95,0.32,0.22,0.22),2)
    # Defeat: slow desaturating fade that settles over the scene.
    if not win and defeat_fade > 0.0:
        draw_rect(Rect2(0,0,W,H), Color(0.10,0.085,0.085, defeat_fade * 0.72), true)
        if defeat_fade > 0.55:
            var fa: float = (defeat_fade - 0.55) / 0.45
            draw_string(title_font, Vector2(440, 300), "SIGNAL LOST", HORIZONTAL_ALIGNMENT_CENTER, 400, 40, Color(0.75, 0.3, 0.25, fa))
func _design_point(p: Vector2) -> Vector2:
    # Map physical window coordinates into the fixed 1280x720 design space.
    # Inverts the REAL canvas transform (stretch scale + letterbox offset via
    # get_canvas_transform), then removes the 2.0 draw scale used by _draw().
    # Correct under every stretch aspect (expand/keep/disabled) and window size:
    # event.position arrives in physical viewport px; the canvas transform maps
    # canvas -> viewport, so its inverse maps viewport -> canvas exactly.
    var canvas_p := get_canvas_transform().affine_inverse() * p
    return canvas_p * 0.5

func _input(event: InputEvent) -> void:
    if event is InputEventKey and event.pressed and not event.echo:
        if event.keycode == KEY_P:
            paused = not paused
            return
        if paused:
            return
        if phase == "BATTLE":
            if event.keycode == KEY_1:
                selected_action = "ARTILLERY"
            elif event.keycode == KEY_2:
                selected_action = "AA"
            elif event.keycode == KEY_3:
                selected_action = "DRONE"
            elif event.keycode == KEY_4:
                selected_action = "SPECOPS"
            elif event.keycode == KEY_5:
                selected_action = "ARMOR"
    if event is InputEventScreenTouch:
        if event.pressed:
            touch_start = _design_point(event.position)
            touch_active = true
            _touch_juice(touch_start)
        elif touch_active:
            var end_point := _design_point(event.position)
            var delta_touch := end_point - touch_start
            touch_active = false
            if phase == "BREACH" and gate_open and abs(delta_touch.x) <= 70.0 and abs(delta_touch.y) <= 70.0:
                if GATE_BOXES[0].has_point(end_point):
                    _choose_gate(0)
                    return
                elif GATE_BOXES[1].has_point(end_point):
                    _choose_gate(1)
                    return
            if PAUSE_BOX.has_point(end_point) and abs(delta_touch.x) <= 70.0 and abs(delta_touch.y) <= 70.0:
                paused = not paused
                return
            if phase == "BREACH" and abs(delta_touch.x) > 45.0 and abs(delta_touch.x) > abs(delta_touch.y):
                if delta_touch.x < 0:
                    player_lane = max(0, player_lane - 1)
                else:
                    player_lane = min(2, player_lane + 1)
            elif phase == "BREACH" and abs(delta_touch.x) <= 45.0 and abs(delta_touch.y) <= 45.0:
                if breach_fire_cooldown <= 0.0:
                    breach_fire_cooldown = 0.16
                    for obj in breach_objects:
                        if obj.alive and obj.kind == "enemy" and obj.lane == player_lane and obj.z < 340.0:
                            _breach_hit(obj)
                            break
            elif phase == "BATTLE":
                _battle_action(_design_point(event.position))
            elif phase == "RESERVES":
                _reserve_tap(end_point)
    if event is InputEventMouseButton and event.pressed:
        # Identical hit boxes to the touch path (shared GATE_BOXES/PAUSE_BOX
        # constants) — previously the mouse boxes were offset and clipped
        # relative to both the touch boxes and the drawn rects.
        var p = _design_point(event.position)
        _touch_juice(p)
        if PAUSE_BOX.has_point(p):
            paused = not paused
            return
        if gate_open:
            if GATE_BOXES[0].has_point(p):
                _choose_gate(0)
            elif GATE_BOXES[1].has_point(p):
                _choose_gate(1)
        elif phase == "RESERVES":
            _reserve_tap(p)
