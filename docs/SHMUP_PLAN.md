# ASTER // 1943-Style Vertical Shmup MVP Plan

Concrete design and implementation plan for turning the `pixel-spaceship` flight demo into a 1943-style vertical scrolling shoot-'em-up while preserving the software voxel-projected player ship, banking tilt, ground shadow, layered thruster flames, `#glow` bloom, seamless heightmap terrain (`VESPER-9`), and tactical HTML HUD.

**Target MVP scope**: 1 vertical-scrolling stage (`~115s`), 5 enemy types, 1 multi-part boss, 1 main weapon (Lv.1–3) + 2 swappable special weapons + 1 Nova Bomb, 8-segment Energy + Lives + Continue, `localStorage` high score, zero external assets or runtime dependencies.

---

## 1. Core Loop, Game States & Fixed Timestep

### Arena & Viewport Decision
Keep a fixed logical playfield of **`240 x 320` pixels** (`76,800 px`, `3:4` arcade ratio) rendered inside `#screen` and mirrored to `#glow` at `2x` (`480 x 640`).
- **Why fixed `240 x 320`**: Current `resize()` in `src/main.ts` yields `320 x 180` on 16:9 desktops, leaving only ~3.5 ship lengths vertically. `240 x 320` gives ~12 ship lengths of vertical dodging space (with player `scale = 0.7`), locks wave geometry identically across desktop and mobile portrait, keeps pixel count near the current `57.6k–129.6k` range, and leaves outer left/right `.experience` margins clear for HUD panels on widescreen monitors.

### State Machine (`src/game.ts`)
- `title`: Attract mode. Terrain auto-scrolls (`scrollZ += 24 * dt`); player ship hovers at `(120, 250)` with gentle idle sway and thruster flames. Overlay displays `ASTER // VESPER STRIKE`, `HI-SCORE`, and controls. Transitions to `playing` on `Space`, `Enter`, `Z`, `J`, click, or tap.
- `playing`: Active stage timeline (`stageTime` advances; `scrollZ += 32 * dt`). Wave script spawns formations, handles combat, pickups, combo decay, and respawn. Transitions to `boss` once `stageTime >= 115` and active non-boss enemies clear (hard trigger at `122s`).
- `boss`: `2.5s` warning phase (`WARNING // DREADNOUGHT DETECTED`), then boss enters to `y = 52`. Terrain keeps scrolling beneath. Boss destruction triggers a `1.8s` chain-explosion sequence and clears enemy bullets before transitioning to `stage_clear`.
- `paused` (overlay flag `paused: boolean` valid in `playing` and `boss`): Halts `stepGame()` while keeping the last rendered frame visible under `.screen-shade`. Toggled via `P`/`Escape`/HUD pause button, and **auto-enabled on `window` `blur`** so tab switching never costs a life.
- `game_over`: Entered when `energy <= 0` and `lives === 0`. Offers **Continue** (resets `score = 0`, increments `continuesUsed`, grants `3` lives + `8` energy + `2.5s` spawn invulnerability at current stage time/boss state) or **Restart** (`title` / fresh `playing` run).
- `stage_clear`: Tallies Clear Bonus (`5,000`), Bombs (`1,000 * bombs`), and Energy (`200 * energy`), updates `localStorage` high score if `continuesUsed === 0`, and offers `PLAY AGAIN`.

### Fixed Timestep
Preserve the existing `src/main.ts` fixed-step accumulator:
- `FIXED_DT = 1 / 60`; clamp raw frame delta `Math.min(0.05, Math.max(0, (now - lastTime) / 1000))`.
- Step headless simulation inside `while (accumulator >= FIXED_DT)` via `stepGame(state, input, FIXED_DT)`.
- Render once per `requestAnimationFrame` after stepping.

---

## 2. Controls & Input Arbitration (`src/input.ts`)

All devices populate a single `GameInput` struct (`moveX`, `moveY`, `pointerTarget`, `fire`, `bombPressed`, `pausePressed`, `startPressed`), plus `lastInputSource: 'keyboard' | 'mouse' | 'touch' | 'gamepad'` so an idle cursor never pulls the ship away from keyboard/gamepad input.

| Action | Keyboard | Mouse | Touch | Gamepad (`getGamepads()[0]`) |
| :--- | :--- | :--- | :--- | :--- |
| Move | `Arrows` / `WASD` (normalized diagonal) | Ship tracks cursor in arena coords (`<= 260 px/s` cap) | Relative drag (`anchorShip + delta * 1.15`, clamped) | Left stick (`0.15` deadzone) + D-pad (`buttons[12..15]`) |
| Fire | Hold `Z`, `Space`, or `J` | Hold Left Click (`button === 0`) | Auto-fire while touch active in `playing`/`boss` | Hold `A` (`buttons[0]`) or `RT` (`buttons[7] > 0.2`) |
| Bomb | Tap `X` or `K` (`!repeat`) | Right Click (`button === 2`, `contextmenu` prevented) | HUD `[BOMB]` button (bottom corner, `>= 44px` hit target) | Edge `X` (`buttons[2]`) or `B` (`buttons[1]`) |
| Pause | Tap `P` or `Escape` | HUD `[PAUSE]` button | HUD `[PAUSE]` button | Edge `Start` (`buttons[9]`) |
| Start / Confirm | `Enter`, `Space`, `Z`, `J` | Click overlay CTA / canvas | Tap overlay CTA / canvas | Edge `A` or `Start` |

- Movement speed: Keyboard/Gamepad max `165 px/s`; Mouse/Touch follow capped at `260 px/s` per tick (`~4.33 px/frame`) to prevent teleporting through bullet walls while staying snappy.
- Lateral velocity `vx` feeds `advanceBank(player.bank, clamp(vx / 165, -1, 1), dt)` from `src/flight.ts` so every input method produces the signature 3D banking tilt.

---

## 3. Weapons, Power-Ups, Bomb & Energy/Lives Model

### Energy & Lives (1943-Inspired)
- Player starts with **`lives = 3`** (max `5`), **`energy = 8`** (`maxEnergy = 8`, mapped 1:1 to the 8 `#thrust-bars` segments in `index.html`), and **`bombs = 2`** (max `5`).
- **Damage**: Enemy bullets deal `2` Energy; body collisions deal `3` Energy. Taking a hit grants `1.0s` invulnerability (`invulnTimer`) and halves the score multiplier.
- **Life loss**: When `energy <= 0`, player loses `1` life (`lives--`), emits an explosion + brief bullet-pushback pulse (`r = 72px`), drops Main Shot by 1 level (floor `Lv.1`), clears any active alt weapon, and respawns at `(120, 268)` with `8` Energy and `2.2s` blinking invulnerability. At `lives === 0`, enter `game_over`.

### Main Shot & Alternative Weapons
| Weapon | Trigger / Source | Pattern & Stats | Cadence |
| :--- | :--- | :--- | :--- |
| **Twin Pulse (Lv.1)** | Default | 2 parallel forward bolts (`x ± 5px`), `1 dmg` each, `vy = -340` | Every `8` ticks (`7.5/s`) |
| **Triple Fan (Lv.2)** | 1st `POW` | 2 center bolts (`1 dmg`) + 2 wing bolts at `±10°` (`1 dmg`) | Every `7` ticks (`8.6/s`) |
| **Heavy Wing (Lv.3)** | 2nd `POW` | Twin heavy center bolts (`1.5 dmg`) + 2 angled outer bolts at `±16°` (`1 dmg`) | Every `6` ticks (`10/s`) |
| **Laser (`L`)** | `L` capsule (`25s`) | Piercing twin cyan-amber plasma bolts (`x ± 4px`), `2.2 dmg` each, high DPS vs armor/boss | Every `6` ticks (`10/s`) |
| **Spread (`S`)** | `S` capsule (`25s`) | 5-way fan (`-28°, -14°, 0°, +14°, +28°`), `1 dmg` each, clears swarms fast | Every `8` ticks (`7.5/s`) |

- Collecting a matching `L` or `S` capsule while active refreshes the timer to `25s` and awards `+500` pts; collecting `POW` at Lv.3 awards `+1,000` pts. When the alt timer expires, firing seamlessly reverts to the player's current Main Shot level.

### Bomb / Special (`NOVA ROLL`)
- Consumes `1` bomb, triggers a `1.2s` barrel-roll animation (`rollAngle` from `src/flight.ts`), grants full invulnerability during the roll, and expands a radial plasma ring across the screen:
  - Cancels all active `enemyBullets` into `+25 pt` golden sparks.
  - Deals `12` damage to all active enemies (and each active boss part), plus `4` frames of camera shake and a bright `#glow` flash.

### Power-Up Drops (1943-Style)
- Dropped by red-trimmed **Squadron Leaders** (upon wiping a full `scout`/`weaver` formation) and **Elite/Gunship** kills.
- Pickups drift downward at `32 px/s` with slight sine sway (`±6 px`).
- **Shoot-to-cycle `WPN` capsules**: Shooting a `WPN` capsule cycles its face in order `POW -> L -> S -> E -> POW` (3 hits per step, capped to prevent accidental double-flips on rapid fire), preserving the 1943 tactical risk-reward choice.
  - `POW`: +1 Main Shot level (`Lv.1..3`).
  - `L`: Activates/refreshes Laser (`25s`).
  - `S`: Activates/refreshes Spread (`25s`).
  - `E`: Restores `+4` Energy (or `+1,500` pts if full).
  - `B` (fixed milestone drop from `interceptor` mid-bosses): `+1` Bomb (or `+2,000` pts if at max `5`).

---

## 4. Enemy Types, Formations, Wave Script & Bullet Patterns

### Enemy Roster (5 Types + 1 Boss)
| ID | Voxel Size | HP | Score | Movement & Role | Bullet Pattern |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `scout` | `15x17x8` | `1` | `100` | Enters in 5–7 ship V-formations or curved flanks (`115 px/s`), banks on turns | Single aimed `pellet` (`95 px/s`) on pass |
| `weaver` | `17x17x10` | `2` | `200` | Twin-pod octa-drone descending on sine wave (`amp 36px`), slowly spins | 2-way split `orb` volley (`85 px/s`) |
| `gunship` | `25x29x12` | `8` | `600` | Heavy twin-hull escort; enters top, pauses at `y = 72..96` for `4s` then exits | 5-way radial `orb` fan (`±44°`, `90 px/s`) |
| `turret` | `19x19x10` | `6` | `450` | Ground-mounted battery anchored to `scrollZ` (`vy = 32 px/s`), rotating top turret | Aimed 3-round `pellet` burst (`100 px/s`) |
| `interceptor` | `31x33x14` | `16` | `1,200` | Mini-boss swept-wing bomber; sweeps laterally across upper arena (`t = 45s, 88s`) | Alternating 8-way `ring` (`78 px/s`) & 3-way `lance` (`125 px/s`) |

### Enemy Bullets (High-Contrast Readability)
Every enemy projectile is rendered into `framePixels` with a **`1px` `#1f1510` ink rim** and bright white/amber/magenta core plus a soft `#glow` tint so shots never blend into Vesper-9's lava cracks or cyan mineral basins:
- **Pellet** (`4x4` diamond, warm yellow-white core): `90–110 px/s`.
- **Orb** (`6x6` pulsing circle, magenta-orange core): `75–95 px/s`.
- **Lance** (`3x7` oriented dart, hot amber core): `120–135 px/s`.
All patterns use shared emitters in `src/game.ts`: `emitAimed(x, y, count, spreadRad, speed, kind)`, `emitFan(x, y, count, arcRad, centerAngle, speed, kind)`, and `emitRing(x, y, count, offsetAngle, speed, kind)`.

### Data-Driven Wave Script (`src/waves.ts`)
Stages are pure arrays of `WaveEvent` records sorted by `time` (seconds):
```ts
export type WaveEvent = {
  time: number;
  enemy: EnemyKind;
  formation: 'vee' | 'line' | 'sine' | 'flank_left' | 'flank_right' | 'ground' | 'hover';
  count: number;
  interval: number;
  spawnX: number;
  dropOnClear?: DropKind;
  dropOnKill?: DropKind;
};
```
`advanceWaves(state, dt)` compares `state.stageTime` against `STAGE_01_WAVES[state.waveCursor]`, spawns entities with shared `waveId` so `onEnemyKilled` detects full-squadron clears (`remainingInWave === 0`) and spawns `dropOnClear` at the last enemy's position.

---

## 5. Stage 01 & Boss Specification

### Stage 01: `VESPER-9 // CRATER CORRIDOR` (`115s` + Boss)
- `00s–20s` **Opening Skirmish**: Two `scout` V-squadrons (left/right, `dropOnClear: 'POW'`) + `weaver` sine pair.
- `20s–45s` **Canyon Patrol**: First `turret` ground batteries scrolling over terrain + flanking `scout` wings + first `gunship` (`dropOnKill: 'E'`).
- `45s–65s` **Mid-Boss #1**: `interceptor` Ace Bomber escorted by `scout` wings (`dropOnKill: 'B'`).
- `65s–90s` **Crossfire Escalation**: Dual `gunship` overlap (`x = 68, 172`), triplet `turret` ridge line, intersecting `weaver` sine waves (`POW` + `E` drops).
- `90s–110s` **Gauntlet Climax**: Mid-Boss #2 `interceptor` (`dropOnKill: 'E'`) + fast `scout` swarm (`dropOnClear: 'POW'`).
- `110s–115s` **Pre-Boss Breather**: Calm `5s` flight, spawns one final `E` capsule if player energy `< 6`.
- `115s` **Boss Alarm -> Boss Fight (`45–60s`)**: `2.5s` warning siren banner (`WARNING // VESPER DREADNOUGHT`).

### Boss: `VESPER DREADNOUGHT` (`~78x64x22` multi-part voxel fortress)
Enters from `y = -48` to `y = 52`, then weaves horizontally between `x = 60` and `x = 180`:
- **Weak Points / Parts** (`160 HP` combined):
  - **Left Wing Pod (`35 HP`)** & **Right Wing Pod (`35 HP`)**: Independently targetable hitboxes (`22x24` each). Each fires 5-way `orb` fans and occasional aimed `lance` pairs. Destroying a pod triggers a `2,500 pt` sub-explosion, drops `'POW'` or `'E'`, and permanently disables that pod's weapons.
  - **Central Reactor Core (`90 HP`)**: Takes **`0.5x` armored damage** (grey metallic sparks) while *both* wing pods survive; opens/exposes at **`1.0x` damage** (orange flash) as soon as at least one pod is destroyed.
- **Boss Phases**:
  - **Phase 1 (`Core > 60%`)**: Wing pods alternate 5-way `orb` fans; core fires 3-round aimed `pellet` bursts.
  - **Phase 2 (`Core <= 60%` or >=1 pod broken)**: Core fires **8-way rotating spiral rings** alternating with a **dual twin-laser telegraph** (`0.85s` flickering red laser sight lines on `#glow`, then `0.65s` dense `lance` stream down both flanks).
  - **Phase 3 (`Core <= 25%` — Enrage)**: Continuous smoke/ember trail from hull; weaves faster; alternates spiral rings with rapid 3-way aimed `lance` spreads until `Core.hp <= 0` (`+10,000 pts`).

---

## 6. Scoring, Multipliers, High Score & HUD Adaptation

### Scoring & High Score
- **Combo Multiplier**: Starts at `1.0x`. Each kill refreshes a **`2.5s` combo timer** and adds `+0.2x` up to **`4.0x`**. Taking damage halves the multiplier (minimum `1.0x`).
- **1UP**: One-time bonus life awarded at **`50,000` points**.
- **Persistence**: Save `{ score, stage }` under `localStorage` key `'aster_shmup_highscore_v1'` wrapped in `try/catch` (and behind an optional `StorageLike` parameter for Node tests). Runs with `continuesUsed > 0` do not overwrite the arcade high score.

### HUD Changes (`index.html`, `src/style.css`, `src/main.ts`)
Keep the existing `ASTER` monospace sci-fi framing (`.screen-shade`, `.corner`, `.identity`, `.planet-label`, `.telemetry`, `#help`) and adapt its readouts:
- **Drop**: `.view-picker` (`01 OVERHEAD / 02 CHASE / 03 COCKPIT`), `#altitude`, `#speed`, `#heading`.
- **Topbar**:
  - Left: `.identity` -> `ASTER.` / `STRIKE UNIT / 01`
  - Center: `.transmission` -> `SECTOR 07 // VESPER-9` (pulses `WARNING // DREADNOUGHT` during boss intro).
  - Right: `SCORE` (7 digits), `HI` (7 digits), `MULT` (`x1.0`), and compact `[PAUSE]` button.
- **Bottom-Left (`.planet-label`)**: `VESPER—9 // STAGE 01`, **LIVES** icon row, **BOMBS** icon row, and boss HP bar when `state === 'boss'`.
- **Bottom-Right (`.telemetry`)**: `WEAPON` (`TWIN LV2` / `LASER 18S` / `SPREAD 12S`), `STAGE` (`042%` or `BOSS`), and `ENERGY` reusing the exact 8-bar `#thrust-bars` CSS gauge (turning red/pulsing at `<= 2`).
- **Overlays**: Minimal `.overlay-card` panels inside `.experience` for `Title`, `Paused`, `Game Over / Continue`, and `Stage Clear`. On coarse pointers (`touchMode`), show a bottom-corner `[BOMB]` touch button (`>= 44x44px`).

---

## 7. Rendering Pipeline & Module Refactor Map

### Render Order (Allocation-Free Hybrid Buffer)
Write all pixel-art layers into one pre-allocated `frame: ImageData` (`240 x 320`, `framePixels: Uint32Array`) and execute **`ctx.putImageData(frame, 0, 0)` once per frame**, followed by additive lighting on `#glow`:
1. **Terrain (`src/world.ts`)**: Write overhead relief terrain into `framePixels` using the existing `World.render` overhead formula (`(raised - 36) * 0.3` vertical parallax, `1.4` zoom) driven by `(camX, scrollZ)` where `camX = (player.x - 120) * 0.35`.
2. **Ground Shadows**: Stamp pre-baked `shadowMask` footprints directly onto `framePixels` by darkening terrain RGB (`* 0.55`), offset by `(clearance * 0.45, clearance * 0.35)` like `ShipSprite.draw()` lines 135–143 (`clearance = 0` for ground `turret`).
3. **Atmospheric Dust**: Draw the 34 two-layer drifting dust puffs from `World.drawDust()` directly onto `framePixels` (soft alpha mix) so clouds pass between terrain and flying craft.
4. **Thruster Flames & Embers**: Rasterize `ShipSprite`'s 3-pass flame core + exhaust particles directly into `framePixels` behind player/enemy nozzles (eliminating per-frame `rgba(...)` string creation).
5. **Voxel Crafts & Pickups (`src/voxel.ts`, `src/models.ts`)**:
   - **Player (`35x43x18`, `scale = 0.7`)**: Live `projectVoxelModel` into a reusable `80x80` scratch buffer (`pitch = 65°`, `lift = 1.4`, continuous `bank` + Nova `rollAngle`) + `outlineShip()` from `src/outline.ts`, then blit non-zero pixels to `framePixels`.
   - **Enemies, Pickups & Boss**: Blit from **pre-baked rotation/bank sprite caches** generated once at startup with the exact same `projectVoxelModel` + `outlineShip` pipeline (`16` yaw steps for `weaver`/`turret`, `9` bank steps for `scout`/`gunship`/`interceptor`, `12` spin steps for capsules, `5` tilt steps for Boss hull/pods + live rotating core turret). Apply solid white/amber hit-flash tint when `hitFlash > 0`.
6. **Bullets, Particles & Shockwaves**: Rasterize pixel-bordered bullets, debris shards, and expanding explosion/Nova rings directly into `framePixels`.
7. **Single Blit + `#glow` Pass**: `ctx.putImageData(frame, 0, 0)`, then clear `#glow` (`2x` scale) and draw additive `lighter` radial gradients for thruster exhaust, enemy orb glow, boss laser telegraphs, and explosions.

### Actual Files & Functions: Keep / Refactor / Drop
| File / Symbol | Action | Plan |
| :--- | :--- | :--- |
| `src/outline.ts` (`outlineShip`) | **Keep** | Reuse untouched for player, baked enemies, pickups, and boss silhouettes (`0xff1f1510`). |
| `src/flight.ts` (`advanceBank`, `rollAngle`) | **Refactor** | Keep `advanceBank` & `rollAngle`; replace yaw-flight (`Flight`, `advanceFlight`, `initialView`) with arena bounds/strafe helpers. |
| `src/world.ts` (`World.height`, overhead `render`, `drawDust`) | **Refactor** | Keep `512x512` heightmap/crater generation & `height(x, z)`; adapt `render`/`drawDust` to write `framePixels` via `(camX, scrollZ)`; drop `sky`, `makeSky()`, `planet()`, and chase/cockpit raycaster. |
| `src/ship.ts` (`ShipSprite`, `drawCockpit`) | **Refactor / Split** | Move face projection & baking to `src/voxel.ts`; move ship geometry + `models` to `src/models.ts`; drop `drawCockpit()` and per-ship offscreen `layer` canvas. |
| `src/main.ts`, `index.html`, `src/style.css` | **Refactor** | Make `main.ts` a thin loop/DOM shell; remove `rollCanvas`, `views`, `.view-picker`; wire `src/game.ts`, `src/input.ts`, `src/renderer.ts`, and shmup HUD. |
| `src/voxel.ts`, `src/models.ts`, `src/entities.ts`, `src/waves.ts`, `src/game.ts`, `src/renderer.ts`, `src/input.ts` | **Create** | Clean separation between headless simulation (`game`, `waves`, `entities`) and rendering/DOM (`voxel`, `models`, `renderer`, `input`). |

---

## 8. Collision & Entity Architecture

### Fixed-Capacity Pools (`src/entities.ts`)
No ECS framework. `GameState` owns pre-allocated object pools reset in-place (`entity.active = false`):
- `playerBullets[128]`, `enemyBullets[256]`, `enemies[48]`, `pickups[16]`, `particles[256]`, plus single `boss` struct with `parts: [leftPod, rightPod, core]`.
- Zero `Array.push` / `Array.filter` calls during gameplay (replacing the `.filter()` pattern in `src/ship.ts` line 103).

### Hitboxes & Checks
- **Player core vs. enemy bullets**: Forgiving circle radius **`r = 3.5px`** centered on cockpit (vs `~24x28px` rendered sprite) for fair arcade dodging.
- **Player vs. enemy hull**: `r = 6px` against enemy circle/AABB hitbox (`turret` ground batteries **do not** collide physically with the player craft flying overhead!).
- **Player vs. pickups**: Generous magnet/grab radius **`r = 16px`**.
- **Player bullets vs. enemies / boss / `WPN` capsules**: Circle-vs-AABB/circle checks (`<= 128 * 48 = 6,144` simple scalar checks worst case, `< 0.05 ms`—**no spatial grid needed** for MVP entity caps).

---

## 9. Performance Targets & Measurement

- **Frame Budget**: Steady **60 fps** (`<= 16.6 ms` total; target **`< 4.0 ms` CPU** for `stepGame` + `renderFrame` + `#glow` on a mid laptop, `< 8.0 ms` on mid mobile) at `240 x 320` internal resolution.
- **Hard Caps**: `128` player bullets, `256` enemy bullets, `48` enemies, `16` pickups, `256` particles. Pool overflow drops oldest non-boss particle or ignores spawn safely without crashing.
- **Allocation-Free Hot Loop**:
  - Pre-allocate `frame`, `framePixels`, `scratchPixels`, `scratchDepth`, all entity pools, and baked sprite caches at startup.
  - Eliminate existing per-frame allocations in `world.ts` (`new Uint32Array`, `new Int16Array`), `ship.ts` (`dirs.map`, `particles.filter`, `rgba(...)` template strings).
- **Measurement**:
  - Add `?perf=1` debug hook publishing rolling EMA & P95 of `simMs`, `terrainMs`, `voxelMs`, `fxMs`, `glowMs`, and active pool counts to `window.__SHMUP_PERF__`.
  - Add headless Node stress test simulating `7,200` ticks (`120s`) at near-cap load, asserting total wall time `< 100 ms` (`< 0.015 ms/tick`).

---

## 10. Implementation Milestones (1–3h Each)

1. **M1 — Scrolling Terrain & Shared Voxel Engine (`src/voxel.ts`, `src/world.ts`, `src/flight.ts`) [~2.5h]**
   - Drop sky/raycaster from `World`; render scrolling overhead terrain + dust directly into cached `framePixels`. Extract `projectVoxelModel` + `bakeSpriteCache` + `stampShadow` into `src/voxel.ts` keeping `outlineShip` and `advanceBank`.
   - *Done when*: `npm run build` & `npm test` pass; browser displays `240x320` scrolling Vesper-9 terrain, banking voxel player ship with shadow, flames, and `#glow` at 60 fps.
2. **M2 — Headless State Machine & Multi-Input (`src/game.ts`, `src/input.ts`) [~2h]**
   - Implement `GameState` (`title`, `playing`, `boss`, `paused`, `game_over`, `stage_clear`), `mulberry32` seeded RNG, and `src/input.ts` (keyboard, mouse follow/fire, touch relative drag/auto-fire, gamepad, input arbitration, blur auto-pause).
   - *Done when*: Node tests verify state transitions, diagonal normalization, and arena clamping; all active inputs steer the ship in browser.
3. **M3 — Weapons, Energy/Lives & Nova Bomb (`src/entities.ts`, `src/game.ts`, `src/renderer.ts`) [~2.5h]**
   - Wire `playerBullets[128]` & `particles[256]`, Main Shot Lv.1–3, `Laser` / `Spread` timers, `NOVA ROLL` bomb (`rollAngle` spin, bullet-clearing shockwave, invuln), and 8-Energy + 3-Lives respawn flow.
   - *Done when*: Node tests verify cooldowns, weapon timers, bomb cancellation, and death/respawn; shots and Nova Roll render cleanly into `framePixels` + `#glow`.
4. **M4 — 5 Enemy Models, Pre-Baked Caches & Power-Up Capsules (`src/models.ts`, `src/voxel.ts`) [~2.5h]**
   - Build voxel geometry for `scout`, `weaver`, `gunship`, `turret`, `interceptor`, and spinning capsules (`POW`, `L`, `S`, `E`, `B`); bake startup sprite caches; wire `enemies[48]`, `enemyBullets[256]`, `pickups[16]`, bullet emitters, and shoot-to-cycle capsules.
   - *Done when*: Unit test verifies all models generate valid non-empty faces & caches stay `< 1.5 MB`; debug spawn shows crisp inked enemies, high-contrast bullets, hit-flash, and pickups.
5. **M5 — Stage 01 Wave Script, Ground Turrets & Scoring/Combo (`src/waves.ts`, `src/game.ts`) [~2.5h]**
   - Implement `115s` Stage 01 `WaveEvent` table, formation paths (`vee`, `line`, `sine`, `flank`, `ground` anchored to `scrollZ`), `O(B*E)` collisions (`3.5px` player core), `1.0x–4.0x` combo multiplier, `50,000` pt 1UP, and `localStorage` high score.
   - *Done when*: Seeded Node simulation runs full `115s` wave timeline cleanly; Stage 01 plays end-to-end up to boss trigger in browser.
6. **M6 — Multi-Part Boss (`VESPER DREADNOUGHT`) & Stage Clear (`src/models.ts`, `src/game.ts`, `src/renderer.ts`) [~3h]**
   - Build 3-part boss (`LeftPod`, `RightPod`, `Core`), `2.5s` warning state, 3-phase AI (pod fans, spiral rings, telegraphed dual laser sweep, Phase 3 enrage), `0.5x` armored core rule, destruction sequence, and `stage_clear` bonus tally.
   - *Done when*: Node tests verify pod armor logic and phase transitions; boss fight is playable and clearable from Stage 01 in browser.
7. **M7 — HUD Adaptation & Game Overlays (`index.html`, `src/style.css`, `src/main.ts`) [~2h]**
   - Remove `.view-picker`/`drawCockpit`; update HUD (`SCORE`, `HI`, `MULT`, `LIVES`, `BOMBS`, `WEAPON`, `ENERGY` on `#thrust-bars`, boss HP bar, touch `[BOMB]`/`[PAUSE]`); add styled `Title`, `Paused`, `Game Over / Continue`, and `Stage Clear` overlays.
   - *Done when*: Layout is legible and unobstructed at `1280x720` and `390x844`; Continue & high score persistence work across reload.
8. **M8 — Perf Hooks, Deterministic Replays & Browser Smoke Checks (`tests/`, `?perf=1`) [~2h]**
   - Add `?perf=1` / `?seed=` / `?demo=` test hooks, `7,200`-tick Node stress benchmark, and headless Chromium screenshot/FPS check script.
   - *Done when*: `npm test` and `npm run build` pass with zero warnings; headless browser checks capture Title, Playing, Boss, and Game Over with P95 CPU frame time `< 6 ms`.

---

## 11. Test Plan

- **Unit Tests (`npm test`: `node --experimental-strip-types --test tests/*.test.mjs`)**:
  - Keep `tests/outline.test.mjs` and `tests/terrain.test.mjs` passing.
  - Adapt `tests/flight.test.mjs` for bounds clamping, normalized diagonal strafe, `advanceBank`, and `rollAngle`.
  - Add `tests/weapons.test.mjs` (Lv.1–3 fire rates, `L`/`S` expiry, Nova Bomb bullet clear + invuln, energy/lives/1UP) and `tests/collision.test.mjs` (`3.5px` hitbox fairness, boss pod armor, shoot-to-cycle `WPN` capsules, `localStorage` high score mock).
- **Deterministic Simulation Tests (Seeded RNG in Node)**:
  - Run `createGameState({ seed })` over scripted input tapes (`idle`, `full-stage-play`, `boss-kill`, `continue-run`) at `1/60` steps with zero DOM. Assert exact determinism across duplicate runs, pool bounds never exceeded, zero `NaN`s, and `7,200`-tick stress run `< 100 ms`.
- **Headless Chromium Screenshot & Perf Checks** *(note: Chromium/Playwright is not currently installed in this environment and must be added as a dev/CI tool when executing M8)*:
  - Launch preview build at `1280x720` and `390x844` with deterministic URL params (`?seed=1&demo=title|playing|boss|gameover&perf=1`), verify zero console errors, non-empty canvas + HUD bounds, and `window.__SHMUP_PERF__.p95FrameMs < 8`.
- **Manual Playtest Checklist**:
  - Verify Keyboard (`WASD`/Arrows, `Z`/`Space`/`J`, `X`/`K`, `P`), Mouse (follow + hold fire + switching back to WASD), Touch (relative drag + auto-fire + Bomb button), and Gamepad.
  - Check enemy bullet legibility over bright craters, boss laser telegraph fairness, blur auto-pause, Continue reset behavior, and high score persistence after refresh.

---

## 12. Risks & Open Questions

- **Terrain Bullet Contrast**: Vesper-9's bright orange lava cracks (`255, 166, 69`) and cyan mineral craters (`161, 224, 197`) in `src/world.ts` could mask bullets. *Mitigation*: Enforce `1px` `#1f1510` ink borders, pulsing white cores, and additive `#glow` halos on all enemy shots; darken terrain saturation slightly (`~10%`) during `playing`/`boss` if needed during M4/M5 playtesting.
- **Baking Memory vs. Rotation Smoothness**: Baking full `36 x 9` rotation/bank grids per enemy blows up startup memory. *Mitigation*: Bake only the active degree of freedom per enemy (`16` yaw steps for spinning/turret models, `9` bank steps for forward-facing craft -> `< 1.5 MB` total, `< 15 ms` startup).
- **Mouse vs. Keyboard Priority**: Unarbitrated mouse coordinates pull the player craft away during WASD play. *Mitigation*: Track `lastInputSource` and only apply `pointerTarget` after active mouse movement or pointer down.
- **Open Question — Desktop Framing**: Should `240 x 320` sit centered with dark `#0a0b18` wings housing the HUD (cleanest arcade framing, chosen in Section 1), or should terrain render full-bleed across wide screens while combat stays inside a centered `240px` corridor? Easy to toggle in `renderer.ts` without touching `game.ts`.
- **Open Question — Procedural Audio (Post-MVP)**: Existing demo has no sound. Adding zero-asset Web Audio retro SFX (fire, hit, explosion, pickup, boss siren) is ~120 lines and cleanly isolated behind an `onEvent` hook in `game.ts`, recommended right after M8 if desired.
