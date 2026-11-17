# VAPOR WING (`@moglrd`) Video Analysis & Refactor Plan

> **Media inspection note**: All 33 gameplay clips (`ref/clips/clip_00.mp4`–`clip_32.mp4`, `8m02s` total) were watched directly as `.mp4` video. `ref/clips/quoted_jet.mp4` (`11.39s`, `38.95 MB`) exceeded tool video payload limits and was inspected via `ref/frames/quoted_*.jpg`, supplemented by `ref/frames/scene/*.jpg`. Grounded against branch `game-refactor-moglrd` (`src/*.ts`, `index.html`, `src/style.css`, `docs/GAME_PLAN.md`, `README.md`).

---

## 1. What the Video Shows (`VAPOR WING — A COURIER ON THE STARLANE`)

`@moglrd` evolved the original islands-and-clouds 3-view flight demo (`quoted_01..23.jpg`: free mouse-flight across `overhead`/`chase`/`cockpit` with contrails and MFD dashboard) into a portrait mobile **Star Fox + Gradius + 1943** courier campaign.

### 1.1 Game Structure & Complete `8m02s` Timeline

| Clip(s) | Global Time | Sector / Biome | Structure, Objectives & Key Events |
| :--- | :--- | :--- | :--- |
| `00` | `0:00–0:14` | **Title -> Kestrel Reach** | Title (`START`, `FLIGHT CHECK`, `SETTINGS`, `CONTROLS`); launches through warp ring into `FLIGHT CHECK` (`STEER`, `ALTITUDE`, `FIRE`, `SKIP`). |
| `01–04` | `0:15–1:02` | **Kestrel Reach** (Coast/Jungle) | Player toggles `TOP` -> `VIEW CHASE`; uses `[ ]`/`^`/`v` elevation brackets & `MSL` lock-on; `FLIGHT CHECK SKIPPED` -> `OPAL` & `GALE` radio intro. |
| `04–06` | `1:03–1:44` | **Kestrel Reach** (Sea Stacks) | Delta fighter waves, pink orbs, red `SUPPLY DRONE` (`P`/`B`/`S` drops), tall cylindrical **Sea Stacks**; cockpit toggle, `[ ] ^ v` strip, `NOVA BOMB` brief. |
| `06–09` | `1:43–2:20` | **The Atoll** (`ALL-RANGE MODE`) | Free-roam 360° bay (`clip_06 0:13`); destroy **4 Relay Pylons** (`+1500` each) with **Option Drone** (`clip_08`) -> **`PYLONS DOWN`** opens checkered **`EXIT` gold ring**. |
| `09–12` | `2:21–3:02` | **Base Canyon** (`ON THE LANE!`) | Jungle lane (`clip_09`) -> **`BASE CANYON`** corridor (`clip_10–11`) with **3 Blast Doors** (`BLAST DOOR. SHOOT THE LOCKS`) + barrel turrets -> Warp Gate (`VAPOR X2`). |
| `12` | `3:03–3:19` | **Ridge Station** (`WARP BEACON`) | Pause shop (`SALVAGE` upgrades + weapon selector); `WARP BEACON LIT` -> boost climb through clouds (`THAT IS THE LAST GATE ON THE SURFACE. PUNCH IT.`). |
| `13–14` | `3:20–3:31` | **Kestrel Orbit** (`SPACE LANE`) | `WARNING // ORBITAL CUSTOMS RING AHEAD`, Clear card (`RANK C`, `+50 SALVAGE`); switches to purple-blue asteroid belt; collects `[S] SHIELD`. |
| `14–18` | `3:32–4:44` | **Boss: `WARDEN`** | Orbital customs ring boss: Phase 1 destroys 4 yellow pods (`+2000`); Phase 2 **`THE EYE IS OPEN. HIT THE CORE`** (`WEAK POINT`) -> **`WARDEN DOWN`** (`+25k`, 2nd Option, `M`). |
| `18–20` | `4:45–5:07` | **Orbit Relay -> The Shoal** | Orbit shop -> `KESTREL ORBIT CLEAR` (`RANK A`, `+300 SALVAGE`) -> **`THE SHOAL`** green-nebula mining asteroids; **`KITE`** joins on left wing. |
| `20–24` | `5:08–6:14` | **The Shoal -> The Hollow** | `P`/`REPAIR` combat -> dives into crystal-lined **Hollow Tunnel** (`clip_22`: `CHASE/COCKPIT/TOP/CHASE`, tunnel Blast Door -> moon horizon `clip_23`) -> **`SHOAL OUTPOST`**. |
| `25–27` | `6:15–7:00` | **Sirocco** (Desert Planet) | Clear card (`RANK B`, `+150 SALVAGE`) -> ribbed dunes & palm oases; Kite peels off (`FUEL IS LOW`); **`OASIS DEPOT`** shop -> **`THE DUNE SEA`** (buried dome guns). |
| `28–31` | `7:00–7:53` | **Arch Canyon -> Ascent** | Sandstone rock arches, 3 Blast Doors, Kite rejoins, buried ruins (`GALE: A WHOLE CITY UNDER THE SAND.`); vertical `BOOST` climb -> `RANK C` (`+50 SALVAGE`). |
| `31–32` | `7:54–8:02` | **Iron Brigade** (`SPACE LANE`) | Crimson asteroid belt; green ally **`MOSS`** joins **`KITE`**; `VIEW CHASE` reveals giant flat grey **Cruisers** + fighters (`GALE: I WILL TELL THEM.`). |

### 1.2 Camera Views & Switching Rules
- **Player `VIEW` toggle**: Tapping `VIEW` works mid-flight to switch between `TOP` (overhead), `CHASE` (3D third-person), and `COCKPIT` (first-person), triggering a horizontal **scanline wipe** and brief `VIEW TOP` / `VIEW CHASE` / `VIEW COCKPIT` tag.
- **Scripted story switches**: Narrative transitions change camera automatically (`EXIT` ring exit -> `TOP`, `SPACE LANE` -> `CHASE`, `THE HOLLOW` entry -> `CHASE`/`COCKPIT`, `SIROCCO` arrival -> `TOP`, `IRON BRIGADE` -> `CHASE`).
- **3D altitude inside `TOP` view**: `CLIMB` and `DIVE` continue operating in overhead view. Targets display color-coded height cues (`clip_00`, `clip_06`): **red `[ ]`** = in-line, **cyan `^`** = climb to target, **orange `v`** = dive to target, echoed along the right-edge `ALT` ruler.

### 1.3 Enemies, Hazards & Boss
- **Air fighters & carriers**: Hovering pod skimmers, dark delta fighter formations, canyon saucer drones, and red/white **Supply Drones** (always drop `[P]`, `[B]`, or `[S]` capsules).
- **Ground & canyon hazards**: Island turrets, buried desert dune dome guns, canyon barrel turrets, **Sea Stacks** (`clip_05–06`), **4 Atoll Relay Pylons**, sandstone **Rock Arches**, crystal cave walls, and **Blast Doors** (`1–2` top locks turning orange -> green when destroyed).
- **Orbital enemies & Boss (`WARDEN`)**: Giant Iron Brigade **Cruisers** (`clip_31–32`); **Warden** is a rotating ring boss with 4 yellow outer energy pods (Phase 1) guarding an opening hexagonal core (`THE EYE IS OPEN. HIT THE CORE` + flashing `WEAK POINT` hex grid in Phase 2).

### 1.4 Weapons, Upgrades & Risk Loop
- **`TWIN` Gun**: `[P]` capsules raise weapon level (`POWER UP`: 2 parallel cyan bolts -> 4 wide -> dense streams); taking damage causes `POWER DOWN` (`-1` level).
- **`OPTION` Pods**: Up to 2 symmetrical wing drones (`clip_08`, `clip_16`) shadowing ship bank and echoing main fire.
- **`MSL` Lock-On**: Pausing `FIRE` or centering red-bracketed targets triggers `LOCK [ ]` + cyan button glow; pressing `MSL` launches smoke-trailed homing missiles from a recharging meter.
- **`BOOST` & `BOMB`**: Holding `BOOST` drains recharging `BST` for burst speed, twin orange afterburners, and pink/cyan wingtip **`VAPOR`** trails (`clip_12`, `clip_29`). Tapping `BOMB` spends a `BMB` stock (`Nova Bomb`) to clear enemy fire.
- **Warp Beacon Shop**: Flying through beacon gates opens a checkpoint upgrade menu spending **Salvage** (`SALVAGE YOU CARRY IS LOST IF YOU FALL`) on `HULL PLATING`, `CANNON` (starting power floor), `MISSILE RACK`, `THRUSTERS`, `SHIELD CELL`, and weapon toggle.

### 1.5 Touch Controls, HUD, Onboarding & Visual Juice
- **Portrait Mobile Layout (`~9:16`)**:
```text
+----------------------------------+
| HULL [][][][]  TWIN [--]  085445 |
| BST  [====]       x2      ♦295 |||
| MSL  [][][]             [MEDAL] A|
| CHASE                           L|
| +-----+ OPAL / GALE / WARDEN    T|  <- top dialogue strip
| | PIC | "...TEXT..."             |
| +-----+                          |
|                                  |  <- left '<' offscreen arrows
|           [ GAMEPLAY ]   (BOMB)  |
|             +      (VIEW)(BOOST) |
|   (STICK)   ^                    |
|  CLIMB/DIVE        (MSL) (FIRE!) |
+----------------------------------+
```
  - Bottom-left dotted analog stick (`CLIMB`/`DIVE` labels shown in 3D views).
  - Bottom-right thumb arc: large orange `FIRE`, yellow `BOOST`, pink `BOMB`, purple `VIEW`, cyan `MSL`.
- **Pixel HUD & Radio**:
  - Top-left: `HULL` segments (expandable), `BST`, `MSL`, `BMB`, and current view label (`TOP`/`CHASE`).
  - Top-center & Top-right: `TWIN` tier gauge + `x1.5`/`x2` combo; Score, `◆ Salvage`, `M`-medal chain (`200->5000`), `||` Pause; left-edge red `<` threat chevrons; right-edge vertical `ALT` ruler.
  - Radio dialogue box: crisp pixel portraits (`OPAL`, `GALE`, `KITE`, `WARDEN`) with audio text blips.
  - **`COCKPIT`**: canopy frame, green pitch ladder, `SPD`/`ALT`/`G`, circular **`RDR 220`** radar, `TWIN` wireframe schematic, `SHLD/ALLY/TERR/WARN` tabs, clock, yellow duck mascot, animated gloved hands on flight stick.
- **Visual Techniques & Pacing**:
  - Shared software voxel projection & sprite stacking (`outline` silhouettes, ground/water shadows, 3D column terrain raycasting, curved space-lane planet horizons, dithered cloud shadow layers).
  - Onboarding launches directly into interactive `FLIGHT CHECK` (`STEER -> ALTITUDE -> FIRE` + `SKIP`), then shifts beats every 15–30s with clear banners (`WARP BEACON LIT`), `RANK C/B/A` scorecards, expanding gold blast rings, white-dither hit flashes, and horizontal scanline wipes.

---

## 2. Gap Analysis vs. Our Current Game (`game-refactor-moglrd`)

| Area | Current Codebase (`src/*.ts`, `index.html`) | Video Target (`VAPOR WING`) |
| :--- | :--- | :--- |
| **Segment Flow** | `stepGame()` (`src/game.ts:190`) hardcodes `30s` `overhead` -> `35s` `chase` -> `12s` pre-boss `cockpit`. | Data-driven route blending lane waves, `ALL-RANGE` `4`-pylon clear -> `EXIT` ring, `BLAST DOOR` lock gates, and `WARP` shops. |
| **View Switching** | `updateHud()` (`src/main.ts`) treats `.view-pill` as read-only; view is locked to segment. | Player `VIEW` button cycles `TOP` / `CHASE` / `COCKPIT` anytime + scripted cuts with scanline wipe & view tag. |
| **`TOP` Depth** | `stepGame()` (`src/game.ts:237,255`) skips `alt` comparison in `overhead`; no height indicators. | `TOP` keeps `CLIMB`/`DIVE` altitude, right `ALT` ruler, and `[ ]`/`^`/`v` height-delta target brackets. |
| **Combat & Loop** | `0.2s` twin bolts only; fixed `hull=8`, `lives=3`, ring `+1 hull`, no pickups/upgrades. | `BOOST` (`bst` + trails), `BOMB` clear, `[P]` tiers (from Supply Drones), `Salvage` shop, optional `MSL`/Option. |
| **Biomes & Cockpit** | Single Vesper-9 palette (`World`); minimal `18px` `drawCockpit()` bottom bar. | Multi-biome (`Jungle` -> `Canyon` -> `Space/Orbit`); pitch ladder + `RDR` radar MFD inside `drawCockpit()`. |
| **Touch & Radio** | Full-canvas drag + auto-fire only (`src/main.ts:143-156`); static HTML corner boxes. | Thumbstick (`CLIMB/DIVE`) + `FIRE/BOOST/BOMB/VIEW` arc; radio portrait box (`OPAL`/`GALE`/`WARDEN`), Rank card. |

---

## 3. Scoped Refactor Plan (1–2 Hour Coding-Agent MVP vs. Later)

Keep `src/game.ts` 100% pure, DOM-free, and deterministic (`mulberry32`), preserving URL hooks (`?segment=`, `?seed=`, `?autoplay=1`, `?loop=`, `window.__game`).

### 3.1 Pure State & Data-Driven Route Script (`src/game.ts`, `src/camera.ts`) `[MVP]`
- Replace fixed segment timers in `stepGame()` with a declarative `SCRIPT: SegmentDef[]` table:
  1. `reach` (`defaultView: 'overhead'`, `biome: 'jungle'`, `goal: 'waves'`, `duration: 24`, Opal/Gale radio intro).
  2. `atoll` (`defaultView: 'chase'`, `biome: 'jungle'`, `goal: 'pylons'` — destroy `4` Pylons -> spawn `exit` gate ring).
  3. `canyon` (`defaultView: 'chase'`, `biome: 'canyon'`, `goal: 'doors'` — shoot locks on `2` Blast Doors -> `'shop'` `WARP BEACON`).
  4. `orbit` (`defaultView: 'cockpit'`, `biome: 'space'`, `goal: 'boss'` — `Warden` ring boss -> Stage Clear `RANK` & Next Loop).
- Add pure state fields to `GameState` & `GameInput`:
```ts
export type Biome = 'jungle' | 'canyon' | 'space';
export type ShopChoice = 'hull' | 'cannon' | 'boost' | 'launch';
export type DialogueBeat = { at: number; speaker: 'OPAL' | 'GALE' | 'WARDEN'; text: string };
export type SegmentDef = {
  id: 'reach' | 'atoll' | 'canyon' | 'orbit';
  defaultView: Segment;
  biome: Biome;
  goal: 'waves' | 'pylons' | 'doors' | 'boss';
  duration?: number;
  shopAfter?: boolean;
  beats: DialogueBeat[];
};
// Add to GameState:
biome: Biome; scriptIndex: number; objective: string; wipeT: number;
salvage: number; bst: number; bombs: number; weaponLv: 1 | 2 | 3; maxHull: number;
hitsTaken: number; dialogue: { speaker: string; text: string; timer: number } | null;
// GamePhase adds 'shop'; GameInput adds boost?, bomb?, toggleView?, shop?: ShopChoice.
```
- Keep **Stage Rank** calculation pure in `src/game.ts` on segment completion (`hitsTaken === 0 -> 'S'`, `<= 2 -> 'A'`, `<= 5 -> 'B'`, else `'C'`, awarding `RANK` salvage bonus before opening `'shop'` or advancing `biome`).
- Add `rank` & `salvage` readout to existing `window.__game` getter in `src/main.ts` for automated checks.

### 3.2 Manual `VIEW` Toggle, `TOP` Verticality & Combat Mechanics (`src/game.ts`, `src/render.ts`, `src/models.ts`) `[MVP]`
- **View switching & altitude**: On `input.toggleView` (`V` key / `VIEW` button), cycle `s.camera.mode` (`overhead -> chase -> cockpit -> overhead`) and trigger `s.wipeT = 0.35`. Allow `CLIMB`/`DIVE` altitude steering in all three modes, enforce `|b.alt - e.alt| < 18` in `overhead`, and export `elevationBracket(eAlt, pAlt)` returning `'inline' | 'above' | 'below'` for `drawEntities()` (`#ff5e66 [ ]`, `#6ef3ff ^`, `#ffaa4c v`).
- **`BOOST` & `BOMB`**: Holding `boost` (`Shift` / `BOOST`) drains `bst` (`1 -> 0` in `2s`, refills `+0.35/s`) for `1.55x` forward speed, extended flames (`visualFlight().boost = 1`), and pink/cyan wingtip vapor trails (`effects`). Pressing `bomb` (`X`/`K`/`BOMB`) triggers `rollAngle` (reusing `flight.ts`), clears hostile projectiles, and deals `2` dmg onscreen.
- **New voxel sprites (`src/models.ts`)**: Bake `supply` (red/white carrier dropping `'P'` capsule -> `weaponLv` `1..3` widening `TWIN` bolts; damage drops `1` tier), `pylon` (`4 HP` tower), `door` (striped gate + 2 shootable top locks), and 2-phase `Warden` ring boss (4 outer pods -> exposed flashing core).

### 3.3 Module Change Map `[MVP]`

| Module / File | Specific Changes (`[MVP]`) |
| :--- | :--- |
| `src/game.ts`, `src/camera.ts` | Add `SCRIPT`, `'shop'` phase, `toggleView`, `bst`/`bombs`/`weaponLv`/`salvage`, `elevationBracket()`, `dialogue` queue. |
| `src/flight.ts`, `src/ship.ts` | Reuse `rollAngle()` for Bomb; expand `drawCockpit()` (`h - 46` panel) with pitch ladder, `SPD`/`ALT`, `RDR` blip box, `TWIN` bar. |
| `src/world.ts` | Add `setBiome('jungle' \| 'canyon' \| 'space')`; in `'space'`, skip ground column raycast and render deep starfield backdrop. |
| `src/models.ts`, `src/render.ts` | Bake `supply`, `pylon`, `door`, `warden`/asteroids in `bakeSprites()`; draw `[ ]`/`^`/`v` brackets, lock gauges, and shockwaves in `drawEntities()`. |
| `src/main.ts`, `index.html`, `src/style.css` | Compact top HUD (`HULL`, `BST`, `BMB`, view, `TWIN`, `SCORE`, `SALVAGE`), right `ALT` gauge, `.radio-bar`, `.shop-card`, `RANK` clear card, scanline wipe curtain in `render()`, and portrait touch stick + `FIRE/BOOST/BOMB/VIEW` buttons. |

### 3.4 Deferred `[Later]` Scope
- Interactive 5-step `FLIGHT CHECK` tutorial; `MSL` homing lock-on missile launcher; `OPTION` wingpods and AI wingmates (`KITE`/`MOSS`); Sirocco desert dunes & crystal hollow tube renderer; `[M]` medal chain decay; cockpit animated gloved stick & duck ornament; procedural Web Audio SFX/music; `localStorage` high score.

---

## 4. Acceptance Criteria & Test Ideas (`tests/game.test.mjs`)

- **Acceptance Criteria**:
  1. Pressing `V` or tapping `VIEW` switches between `TOP`, `CHASE`, and `COCKPIT` mid-segment with a `0.35s` scanline wipe and continuous altitude control.
  2. `4` Atoll Pylons spawn an `EXIT` ring -> `Base Canyon` Blast Door locks open -> `WARP BEACON` spends Salvage -> `Kestrel Orbit` renders space + `Warden` boss -> `Rank` Clear card & Loop 2.
  3. Portrait mobile (`390x844`, `?touch=1`) and desktop (`1280x720`) drive steering, firing, boost, bomb, and view switching cleanly with zero overlap or console errors.
- **Unit & Simulation Tests (`npm test` -> `node --experimental-strip-types --test tests/*.test.mjs`)**:
  - `toggleView` cycles `'overhead' -> 'chase' -> 'cockpit' -> 'overhead'` and sets `wipeT > 0`.
  - `elevationBracket()` returns `'inline'` (`|dAlt| < 18`), `'above'`, or `'below'`; `overhead` bolts miss out-of-plane targets.
  - Scripted goals: destroying `4` pylons spawns `exit` ring; breaking `2` door locks opens the gate; `'shop'` purchase deducts `salvage` and applies upgrades; `Warden` pods -> core -> `'win'`.
  - `boost` drains/regenerates `bst`, `bomb` clears enemy bullets, `[P]` clamps `weaponLv` `1..3`, and `mulberry32` determinism passes an `autoplay` full run.
- **Headless Chromium (`~/.cache/ms-playwright/chromium-1228`)**: Screenshot `?segment=atoll`, `?segment=canyon`, `?segment=shop`, and `?segment=boss` with `?touch=1&autoplay=1&seed=1` at `390x844` and `1280x720`.
