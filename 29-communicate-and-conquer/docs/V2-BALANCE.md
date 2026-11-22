# CC V2 — Unit Roster Rebalance (2026-09-29)

The V2 roster keeps the two legacy actions untouched and adds three modern-era
units. Every unit costs finite reserves earned by breach performance — nothing
is free. Costs, effects and counters were set against the legacy baseline.

## Legacy (unchanged mechanics)

| Unit | Cost | Effect | Cooldown | Notes |
|---|---|---|---|---|
| ARTILLERY | 1 artillery | Blast r=115, kills bombers in radius | 0.20s | Friendly fire: 18 dmg to bunker within r=145 |
| AA | 1 AA | Id-locked interceptor, single bomber kill | 0.20s | Needs lock within 280px of tap |

## Modern units (new)

| Unit | Cost | Effect | Duration / Cooldown | Counter / risk |
|---|---|---|---|---|
| REAPER UCAV (drone) | 1 drone | Loitering autonomous hunter; micro-missile every 1.1s at nearest hostile, id-locked kill | 12s loiter | Missiles can miss a maneuvering (HARD-evading) target; finite loiter |
| SPECTRE TEAM (specops) | 1 specops | Area denial: tracer every 0.9s at nearest hostile within 240px, id-locked kill | 15s deployment | Must be placed on the ground band; zone is static |
| AEGIS MBT (armor) | 1 armor | Heavy shell, blast r=200, kills all hostiles in radius | 1.4s reload | Friendly fire: 45 dmg to bunker within r=145 — worse than artillery |

## Reserve economy (rebalanced)

Artillery and AA conversion formulas are unchanged (legacy balance preserved).

New reserves are earned, never granted:

| Reserve | Earned when | Cap |
|---|---|---|
| drone | intel ≥ 5 at breach end (+ mission bonus) | 3 |
| specops | score ≥ 400 at breach end (+ mission bonus) | 3 |
| armor | health ≥ 60 at breach end (+ mission bonus) | 3 |
| MODERN OPS mode | +1 drone task force on deployment | 3 |

Mission bonuses: GHOST HARVEST +1 drone, IRONHOLD +2 AA +1 drone,
NIGHT RAID +1 artillery +1 specops.

## Difficulty (behavioral, not inflation)

Damage numbers are identical on NORMAL and HARD (bunker −12 per strike,
player −14 per hazard). HARD is harder because hostiles act smarter:

- Breach: enemies inside 1500m flank toward the player's lane every 1.2s;
  hostile spawn mix densifies (+5% enemy, +5% hazard, renormalized).
- Battle: bombers fly focus-fire (steer onto the objective, 1.25× speed);
  a bomber locked by AA weaves evasively (3.5× lateral amplitude, 1s).

## Balance rationale

- REAPER is the best sustained single-target DPS but cannot stop a wide wave
  alone (1.1s per kill vs. escalating spawn intervals).
- SPECTRE is the best static defense but cannot reposition; wasted against
  focus-fire that converges away from its zone.
- AEGIS is the best burst AoE but the 1.4s reload and 45 friendly-fire damage
  punish careless taps near the bunker.
- No unit dominates: each has a real counter in the simulation.
