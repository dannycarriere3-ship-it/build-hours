from pathlib import Path
p=Path(__file__).parent/'Main.gd'
s=p.read_text()
# We'll replace drawing functions wholesale while preserving gameplay/UI.
start=s.index('func _draw() -> void:')
end=s.index('func _input(event: InputEvent) -> void:')
new=r'''func _draw() -> void:
    # Native 1080p composition; all art is vector/procedural for zero asset streaming.
    draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.5, 1.5))
    draw_rect(Rect2(0,0,W,H), Color("070d14"), true)
    _draw_cinematic_background()
    if phase == "BREACH":
        _draw_breach()
    elif phase == "RESERVES":
        _draw_reserves()
    elif phase == "BATTLE":
        _draw_battle()
    else:
        _draw_outcome_backdrop()
    _draw_hud_frame()
    if flash > 0.0:
        draw_rect(Rect2(0,0,W,H), Color(0.70,0.90,1.0,flash*0.075), true)

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
    for i in range(24):
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
        var y := lerp(220.0,650.0,t*t)
        var half := lerp(120.0,570.0,t)
        draw_line(Vector2(W*0.5-half,y),Vector2(W*0.5+half,y),Color(0.20,0.46,0.53,0.20),1.0,true)
    # Speed strips
    for i in range(12):
        var x := fmod(i*139.0 + distance*2.8, 1240.0)+20.0
        var y := 230.0 + fmod(i*83.0 + distance*0.65, 370.0)
        draw_line(Vector2(x,y),Vector2(x-18,y+42),Color(0.32,0.84,0.92,0.18),2.0,true)
    for obj in breach_objects:
        if not obj.alive or obj.z < -100 or obj.z > 3500:
            continue
        var t := clamp((3500.0-obj.z)/3500.0,0.0,1.0)
        var y := 198.0 + t*t * 420.0
        var scale := 0.25 + t * 1.25
        var x := lane_x[obj.lane]
        _draw_breach_object(obj.kind,Vector2(x,y),scale,obj.pulse)
    _draw_player_drone(Vector2(player_x,575))
    # progress rail
    draw_rect(Rect2(360,620,560,4),Color(0.07,0.18,0.22,1),true)
    draw_rect(Rect2(360,620,560*clamp(distance/3500.0,0.0,1.0),4),Color(0.22,0.80,0.92,0.92),true)
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
    # command columns
    for i in range(3):
        var x := 120.0 + i*235.0
        draw_rect(Rect2(x,260,190,250),Color(0.035,0.075,0.09,0.95),true)
        draw_rect(Rect2(x,260,190,250),Color(0.16,0.48,0.55,0.45),false,1)
        draw_rect(Rect2(x+22,420,146,5),Color(0.08,0.17,0.20,1),true)
    for i in range(reserve.artillery):
        var x := 145.0 + (i%4)*48.0
        var y := 330.0 + (i/4)*48.0
        draw_circle(Vector2(x,y),15,Color("788b92"))
        draw_line(Vector2(x,y),Vector2(x+22,y-18),Color("c1cbd0"),5)
    for i in range(reserve.aa):
        var x := 380.0 + (i%4)*48.0
        var y := 330.0 + (i/4)*48.0
        draw_circle(Vector2(x,y),13,Color("4bd9ec"))
        draw_line(Vector2(x,y),Vector2(x,y-28),Color("9df5ff"),4)
    draw_string(title_font,Vector2(610,300),"YOUR RUN HAS WEIGHT",HORIZONTAL_ALIGNMENT_LEFT,500,31,Color("4ce6ff"))
    draw_string(body_font,Vector2(610,350),"Accuracy, survival and intelligence\nare no longer score alone.\nThey become finite battlefield power.",HORIZONTAL_ALIGNMENT_LEFT,500,21,Color("c9d6db"))
    draw_string(body_font,Vector2(610,475),"BATTLE DEPLOYS IN %.1fs" % max(0.0,3.4-phase_elapsed),HORIZONTAL_ALIGNMENT_LEFT,400,17,Color(0.52,0.77,0.82,1))
    draw_rect(Rect2(610,500,450,6),Color(0.08,0.17,0.20,1),true)
    draw_rect(Rect2(610,500,450*clamp(phase_elapsed/3.4,0.0,1.0),6),Color("4ce6ff"),true)

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
        if b.y > 700: continue
        var p := Vector2(b.x,b.y)
        draw_line(p+Vector2(0,-65),p+Vector2(0,-10),Color(0.95,0.32,0.22,0.13),5)
        draw_circle(p,30,Color(0.95,0.25,0.17,0.055))
        draw_colored_polygon(PackedVector2Array([p+Vector2(-27,5),p+Vector2(-7,-10),p+Vector2(0,-7),p+Vector2(8,-10),p+Vector2(29,5),p+Vector2(8,13),p+Vector2(0,10),p+Vector2(-8,13)]),Color("b9c2c5"))
        draw_circle(p,5,Color("ff6a45"))
    # impacts
    for impact in impacts:
        impact.t += get_process_delta_time()
        var rr := impact.r + impact.t*145.0
        var a := max(0.0,1.0-impact.t*1.5)
        draw_circle(impact.p,rr,Color(1.0,0.57,0.20,a*0.34),false,4)
        draw_circle(impact.p,rr*0.22,Color(1,0.82,0.45,a*0.30))
    impacts = impacts.filter(func(x): return x.t < 0.9)
    if battle_message_timer > 0.0:
        draw_rect(Rect2(300,165,680,58),Color(0.01,0.035,0.04,0.94),true)
        draw_rect(Rect2(300,165,680,58),Color(0.22,0.72,0.66,0.35),false,1)
        draw_string(title_font,Vector2(325,202),battle_message,HORIZONTAL_ALIGNMENT_CENTER,630,18,Color("baf8e9"))
    if fmod(total_elapsed,PING_INTERVAL) > PING_INTERVAL-0.70:
        var pulse := fmod(total_elapsed,PING_INTERVAL)/0.70
        draw_arc(bp,90+pulse*220,0,TAU,72,Color(0.25,0.86,1,0.75*(1-pulse)),3)
        draw_arc(bp,90+pulse*150,0,TAU,72,Color(0.30,1,0.74,0.24*(1-pulse)),2)

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
'''
p.write_text(s[:start]+new+s[end:])
