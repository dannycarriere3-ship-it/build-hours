# Communicate & Conquer — MAX3

A procedural Godot vertical slice built around:

`BREACH → RESERVES → BATTLE → OUTCOME → REPLAY`

## Gameplay contract

### BREACH
Move through three lanes, shoot enemies, collect intel/supplies, avoid hazards, build score/combo, and choose a tactical gate.

### RESERVES
Breach performance is converted into finite artillery and AA resources. This is a real state transition, not a score-only screen.

### BATTLE
Use artillery and AA against bomber threats while protecting the bunker. Actions consume the reserves earned in BREACH.

### OUTCOME
Victory/defeat reports the causal chain from breach performance to battlefield result.

### REPLAY
The run state is reset and a fresh breach starts.

## Mobile

- Swipe left/right: lane movement.
- Tap during BREACH: fire.
- Tap during BATTLE: target action.
- Tactical gate is touch-selectable.
- P: pause/resume during desktop testing.

## Performance

Configured for Godot Mobile renderer, QHD viewport, VSync, and 60 FPS ceiling. A runtime quality tier manager reduces decorative workload after sustained frame pressure and restores quality after sustained headroom.

This is not device proof. Device proof requires a built APK and measurements on the target phone.

## Truth discipline

Implemented/static checks are not represented as runtime or device proof. See `BUILD_STATUS.md`.
