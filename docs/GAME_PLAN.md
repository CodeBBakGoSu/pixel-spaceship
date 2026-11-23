# ASTER // 3-View Arcade Loop Game Plan

> 과거 기획: 세 시점을 잇는 아케이드 루프 원안이다. 현재 Survivors 빌드 순서는 [위키](wiki/README.md)에서 확인한다.

Revision of the MVP into a fast arcade loop that uses **all three existing camera views** (`overhead`, `chase`, `cockpit`) as distinct, back-to-back gameplay segments over the Vesper-9 heightmap and voxel spacecraft.

**MVP Goal**: One tight `~105s` loop (`overhead -> chase -> cockpit + boss`) using 3 entity/obstacle types (`Drone`, `Rock Pillar / Energy Ring`, `Boss`), score + lives + 8-bar hull energy in the existing HUD, win/game-over screens, and endless faster loops (`Loop 2+`).

---

## 1. Gameplay Loop & Segment Flow (`src/game.ts`)

| Segment / State | Duration | Camera & Controls | Gameplay & Objective |
| :--- | :--- | :--- | :--- |
| `title` | Until input | Slow overhead scroll + idle ship | Existing HUD + compact start overlay (`Space` / Click / Tap to launch). |
| `overhead` (`01`) | `30s` | Fixed north-up `World.render` overhead (`camZ += 34*loopSpeed*dt`). 2D screen movement (`WASD`/Arrows/Mouse/Touch); `vx` drives `advanceBank`. Hold/auto fire. | Top-down shoot-'em-up. Blast waves of **Patrol Drones** firing slow high-contrast pellets. Full-wave clears award `+300` bonus. |
| `transition` (`1->2`) | `1.5s` | Ease `ShipSprite` (`pitch: 65°->36°`, `lift: 1.4->1.0`, `cy: 0.76h->0.59h`, `scale: 0.72->1.0`) + `0.6s` cross-fade into chase horizon. | Player invulnerable; short phase banner (`PHASE 02 // CANYON RUN`). |
| `chase` (`02`) | `35s` | `World.render` chase (`camOffset = 38`, `camHeightOffset = 18`). Forward auto-flight (`speed = 38*loopSpeed`); steer `x` (`[-55, 55]`) & `altitude`. | Canyon obstacle run. Dodge **Rock Pillars** (`-2` hull), fly through **Energy Rings** (`+250` pts, `+1` hull), shoot Drones ahead. |
| `transition` (`2->3`) | `1.5s` | Continuous glide on the existing voxel raycaster: `camOffset: 38->0`, `camHeightOffset: 18->2`, `ShipSprite` fades out as `drawCockpit` slides up. | Player invulnerable; short phase banner (`PHASE 03 // CORE ASSAULT`). |
| `cockpit` (`03`) | `35–45s` | `World.render` cockpit + `drawCockpit(ctx, pitch, aimX, aimY)`. Forward auto-flight; steer reticle/ship, fire twin converging bolts toward reticle. | **Boss Fight** (`24 HP` Dreadnought weaving ahead). Shoot destructible plasma orbs or dodge; burst exposed core in Phase 2 (`<50% HP`). |
| `win` / `game_over` | Until choice | Frozen/slow-scroll backdrop + overlay card | `win`: tally score + life bonus; choose **NEXT LOOP (`+20%` speed)** or **RESTART**. `game_over` (`lives === 0`): final score + **RESTART**. |

- **Fixed Timestep**: Keep `src/main.ts`'s `1/60s` accumulator (`Math.min(0.05, dt)` clamp) stepping pure `stepGame(state, input, 1/60, groundHeight)`.
- **Loop Scaling**: `loopSpeed = Math.min(1.8, 1 + (loop - 1) * 0.2)`; repeat runs preserve accumulated score and increment `loop`.

---

## 2. Core Contracts, Entities & Collisions (`src/game.ts`)

### Shared State & Camera Contracts
```ts
export type Segment = 'overhead' | 'chase' | 'cockpit';
export type GamePhase = 'title' | 'playing' | 'transition' | 'win' | 'game_over';
export type CameraState = {
  mode: Segment; x: number; z: number; yaw: number; altitude: number;
  pitch: number; camOffset: number; camHeightOffset: number; crossFade: number;
};
export type Entity = {
  kind: 'drone' | 'pillar' | 'ring' | 'boss_orb';
  x: number; z: number; alt: number; vx: number; vz: number;
  hp: number; waveId: number; bank: number; hitFlash: number;
};
export type GameState = {
  phase: GamePhase; segment: Segment; loop: number; score: number;
  lives: number; hull: number; phaseTime: number; transitionT: number;
  invulnTimer: number; aimX: number; aimY: number; rng: number;
  player: { x: number; y: number; z: number; altitude: number; bank: number; yaw: number; fireCooldown: number };
  camera: CameraState; entities: Entity[]; bullets: { x: number; y: number; z: number; alt: number; vx: number; vy: number; vz: number; friendly: boolean }[];
  boss: { active: boolean; hp: number; maxHp: number; x: number; z: number; alt: number; fireTimer: number; hitFlash: number };
};
```

### Health, Lives & Entity Caps (Simple Arrays, Zero ECS)
- **Player Health & Lives**: Start with `lives = 3`, `hull = 8` (`maxHull = 8`). Enemy shots, drone impacts, and rock pillars deal `2` hull damage and grant `1.0s` hit invulnerability (`invulnTimer`). Reaching `0` hull costs `1` life and respawns with `8` hull and `2.0s` blinking invulnerability until `lives === 0` (`game_over`).
- **Patrol Drone** (cap `8`): `2 HP`, `+100` pts (`+300` full-wave clear), `10px` radius (`overhead`) / `8` world-unit radius (`chase`).
- **Rock Pillar** (cap `8`): indestructible terrain column (`10` world-unit radius, top at `ground + 55`).
- **Energy Ring** (cap `4`): floating hoop (`14` world-unit pass-through radius at ring `z` crossing); grants `+250` pts and `+1` hull (capped at `8`).
- **Boss (`Dreadnought`)** (cap `1`): `24 HP`, hovers ahead at `ship.z + 110`. Phase 1 (`24..13 HP`) fires single wing orbs (`1 HP` destructible, `+50` pts); Phase 2 (`12..1 HP`) speeds up figure-8 weave and fires 3-orb spreads. Defeat awards `+2,000` pts + `500 * lives` clear bonus.
- **Bullets** (caps `32` player, `48` enemy): linear circle/AABB checks per tick (`<= 1,536` scalar checks, `< 0.02 ms`).

---

## 3. Feasibility Notes & Architecture Decisions

### 1) Shared Voxel Format & Pre-Baked Caches (`src/voxel.ts`)
`ShipSprite` in `src/ship.ts` hard-codes the player's `35x43x18` voxel grid in its constructor and re-projects all faces every frame into a full-screen `layer` canvas (`ImageData` + `Float32Array` depth buffer).
- **Refactor**: Extract `VoxelModel`, `buildFaces()`, and `projectModel()` (calling `outlineShip` from `src/outline.ts`) into `src/voxel.ts`.
- **Player vs. Enemies Strategy**:
  - Keep **live face projection** in `ShipSprite` **only for the player ship** (`1` craft), because `overhead -> chase` needs continuous `pitch` (`65° -> 36°`) and `advanceBank()` roll interpolation.
  - **Pre-bake enemy & obstacle sprites at startup** into small offscreen `HTMLCanvasElement` caches (`<= 8` active enemies/obstacles at once):
    - **Patrol Drone** (`17x19x9` voxels): `9` bank frames (`36x36` canvases, `~45 KB` total).
    - **Rock Pillar** (`14x14x36` voxels): `1` front-lit `28x64` canvas.
    - **Energy Ring** (`20x6x20` voxels): `1` glowing `40x40` ring canvas.
    - **Boss** (`48x36x16` voxels): `3` tilt frames (`96x72` canvases) + flashing core sprite.
  - At runtime, draw enemies/obstacles via `ctx.drawImage(sprite, ...)` scaled by perspective distance (`focal / depth`) — zero per-enemy depth buffers.

### 2) Consistent Mixed Rendering Order (`src/main.ts`)
Avoid rewriting `World.render` and `ShipSprite` into a monolithic pixel buffer; keep the existing `ImageData` + `2D` canvas split with one fixed back-to-front draw order per frame:
1. **Base Terrain / Sky (`ImageData`)**: `world.render(frame, cam)` -> `ctx.putImageData(frame, 0, 0)`. During the `0.6s` `overhead -> chase` cross-fade, blend a second `ImageData` buffer across the transition window.
2. **Atmospheric Dust (`2D ctx`)**: `world.drawDust(ctx, cam, time)` during `overhead`.
3. **Ground Shadows (`2D ctx`)**: Shadow silhouettes under airborne drones and player.
4. **Depth-Sorted Entities (`2D ctx`)**: In `chase` / `cockpit`, project world `(wx, wz, alt)` using the exact frustum math from `src/world.ts` (`horizon = h * 0.30 + pitch * 15`, `scale = h * 0.95 / dist`, `sx = w * 0.5 + right * (w / (1.6 * dist))`, `sy = horizon + (camHeight - alt) * scale`), sort far-to-near by `dist`, and `drawImage` baked sprites. Draw `ShipSprite.draw()` (flames + player hull) in `overhead` and `chase`.
5. **Bullets & Explosions (`2D ctx` + `#glow`)**: Pixel bolts/orbs (`1px` `#1f1510` ink rim + bright core for contrast over Vesper-9 craters) and spark bursts on `ctx`, plus additive radial blooms on `#glow`.
6. **Cockpit Overlay (`2D ctx`)**: `drawCockpit(ctx, pitch, aimX, aimY, slideY)` drawn last in `cockpit` and during `2->3` transition.

### 3) Camera Modes & Transitions (`src/world.ts`, `src/flight.ts`)
- **North-Up Overhead**: Parameterize `World.render(image, cam)` with `CameraState`. In `overhead`, lock world lookup north-up (`yaw = 0`), auto-scroll `cam.z`, and map screen lateral velocity `vx` into `advanceBank()`.
- **Bounded Chase / Cockpit Auto-Flight**: Auto-advance `ship.z += forwardSpeed * dt`. Clamp `x` to `[-55, 55]` and `altitude` to `[ground(x, z) + 22, 160]`; slave `yaw` to `±0.25 rad` proportional to lateral steer so upcoming obstacles and the boss stay ahead.
- **Smooth Transitions**: `overhead -> chase` eases `ShipSprite` `pitch` (`65°->36°`), `lift` (`1.4->1.0`), `cy` (`0.76h->0.59h`), and terrain cross-fade; `chase -> cockpit` smoothly interpolates `camOffset` (`38->0`) and `camHeightOffset` (`18->2`) on the existing raycaster while sliding `drawCockpit` upward from `h` to `0`.

---

## 4. HUD Reuse, Controls & Codebase Touchpoints

- **Controls**: Keep existing `src/main.ts` bindings — Keyboard (`WASD`/Arrows steer, `Space`/`Z` fire, `P` pause), Mouse (canvas-relative steer + hold click to fire), Touch (drag steer + auto-fire), Gamepad (left stick + `A`/`RT` fire). In `cockpit`, steering offsets the reticle `(aimX, aimY)` directly.

| Existing HTML / CSS Hook | Arcade MVP Role |
| :--- | :--- |
| `.view-picker` (`01 OVERHEAD` / `02 CHASE` / `03 COCKPIT`) | Converted from clickable buttons to read-only active phase pills (`aria-current="step"`). |
| `.planet-label` | Shows current segment (`VESPER—9 // OVERHEAD`, `CANYON RUN`, `CORE ASSAULT`) + `LOOP 01`. |
| `#altitude`, `#speed`, `#heading` | Replaced with `SCORE`, `LIVES`, and `PHASE TIME` (or `BOSS HP` during cockpit boss). |
| `#thrust-bars` (8 `<i>` bars) | Mapped 1:1 to player **HULL ENERGY** (`0..8`, pulses warning color at `<= 2`). |
| `.transmission` & `#help` | Phase banner / boss warning alert + auto-fading control hint; plus `.overlay` card for `Title`/`Win`/`Game Over`. |

| Existing File | Plan |
| :--- | :--- |
| `src/outline.ts` | **Keep** (`outlineShip` reused by `src/voxel.ts`). |
| `src/flight.ts` | **Refactor** (keep `advanceBank`, `rollAngle`; add north-up strafe & corridor flight helpers). |
| `src/world.ts` | **Refactor** (`World.render` & `drawDust` take `CameraState`; keep heightmap & raycaster intact). |
| `src/ship.ts` | **Refactor** (use `src/voxel.ts` for player `ShipSprite`; add `aimX, aimY, slideY` to `drawCockpit`). |
| `src/main.ts`, `index.html`, `src/style.css` | **Refactor** (wire `src/game.ts`, pre-baked caches, URL hooks, depth-sorted `2D` entity/bullet draw, HUD). |
| `src/game.ts`, `src/voxel.ts`, `src/models.ts` | **Create** (DOM-free state machine, shared voxel builder/cache, enemy/obstacle/boss models). |

---

## 5. Test Plan & URL Hooks

- **Headless State Machine (`src/game.ts`)**: Pure TypeScript (`mulberry32` seeded PRNG, zero DOM/Canvas imports).
- **URL Testing Hooks (`parseGameOptions(location.search)`)**:
  - `?segment=overhead|chase|cockpit|boss` — boot directly into any segment or the cockpit boss fight (`?segment=boss` opens in `cockpit` with boss spawned at full `24 HP`).
  - `?seed=<int>` — fix `mulberry32` PRNG seed for reproducible drone waves, pillars, and rings.
  - `?autoplay=1` — built-in deterministic pilot AI (lateral sine weave + ring tracking in `chase`, reticle sweep + continuous fire in `overhead`/`cockpit`) for unattended screenshots.
  - `?loop=<int>` — start at a specified loop speed multiplier (`1 + (loop - 1) * 0.2`).
- **Node Unit Tests (`npm test`: `node --experimental-strip-types --test tests/*.test.mjs`)**:
  - Keep `tests/outline.test.mjs` and `tests/terrain.test.mjs` green.
  - Update `tests/flight.test.mjs` and add `tests/game.test.mjs`: verify URL option parsing, `overhead -> transition -> chase -> transition -> cockpit -> boss -> win` timeline, smooth transition bounds, seeded determinism, collisions, lives/game-over, and loop speed increase.
- **Headless Chromium Screenshot Checks (`~/.cache/ms-playwright/chromium-1228`)**:
  - Serve built preview (`npm run build` + `vite preview`) and launch headless Chromium against:
    - `?segment=overhead&seed=1&autoplay=1` (capture after `2.5s`: scrolling terrain + drone wave + bolts)
    - `?segment=chase&seed=1&autoplay=1` (capture after `2.5s`: voxel canyon + pillars + ring + banking ship)
    - `?segment=cockpit&seed=1&autoplay=1` (capture after `2.5s`: cockpit overlay + reticle + terrain horizon)
    - `?segment=boss&seed=1&autoplay=1` (capture after `2.5s`: boss voxel craft + plasma orbs + boss HP HUD)
  - Verify at `1280x720` and `390x844`: zero console/page errors, non-blank canvas frames, distinct visuals per segment, and legible HUD without overlap.

---

## 6. Milestones (Ordered, 1.5–3h Each)

1. **M1 — Camera Parameterization & Shared Voxel Cache (`src/voxel.ts`, `src/models.ts`, `src/world.ts`)**
   - Extract `VoxelModel`, `projectModel()`, and `outlineShip()` into `src/voxel.ts`; pre-bake Drone, Pillar, Ring, and Boss canvases in `src/models.ts`; parameterize `World.render` & `drawDust` with `CameraState` + north-up `overhead`.
   - *Accept when*: `npm run build` & existing tests pass; startup bakes all sprite caches cleanly and `overhead` scrolls north-up with banking player ship.
2. **M2 — Headless State Machine & URL Hooks (`src/game.ts`, `src/flight.ts`, `tests/game.test.mjs`)**
   - Implement `createGame()`, `stepGame()`, `mulberry32`, segment timers, `transition` easing values, `autoplay` bot, and `parseGameOptions`.
   - *Accept when*: `npm test` passes unit tests for full segment progression, transitions, collisions, lives/game-over, loop repeat, and deterministic seeds.
3. **M3 — Overhead Combat & Chase Canyon Run (`src/main.ts`)**
   - Wire `overhead` drone waves + player twin fire + sparks/explosions, `chase` depth-sorted rock pillars + energy rings, and smooth `overhead -> chase` transition in the 2D draw loop.
   - *Accept when*: Playing from start transitions smoothly from `overhead` combat into `chase` pillar dodging and ring pickups at 60 fps.
4. **M4 — Cockpit Targeting, Boss Fight & Win/Restart (`src/ship.ts`, `src/game.ts`, `src/main.ts`)**
   - Add `chase -> cockpit` continuous camera glide + `drawCockpit` slide-up & reticle aiming, 2-phase Dreadnought boss with shootable orbs, and `win` / `game_over` restart + `Loop 2+` progression.
   - *Accept when*: Full loop `overhead -> chase -> cockpit -> boss -> win -> loop 2` plays end-to-end; `?segment=boss` boots straight to boss.
5. **M5 — HUD Adaptation & Headless Chromium Verification (`index.html`, `src/style.css`, `tests/`)**
   - Update HUD (`SCORE`, `LIVES`, `#thrust-bars` hull energy, phase pills, overlays); run `npm test`, `npm run build`, and capture Chromium (`~/.cache/ms-playwright/chromium-1228`) screenshots for all 4 URL hook views.
   - *Accept when*: `npm test` and `npm run build` pass cleanly and screenshots confirm legible HUD and distinct gameplay in every segment.

---

## 7. Later (Deferred Post-MVP)

- Procedural Web Audio SFX (shots, hits, ring chime, boss alarm, explosions).
- Power-up weapon capsules (`Spread`, `Laser`, `Smart Bomb`) and `localStorage` high-score persistence.
- Extra biome/palette shifts per loop (`Vesper-9` -> `Cryo` -> `Magma`) and chase boost pads.
