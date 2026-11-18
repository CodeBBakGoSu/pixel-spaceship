# ASTER WING — Stage 1 Plan

Design plan for 기현님’s approval. Baseline `801ff22` on `origin/main`.
This revises the previous survival plan: **build only Stage 1** first.
The Z axis is the differentiator. Numbers are starting playtest targets.
Implementation starts only after approval.

---

## 1. Stage-1 scope

**One 2:30 sortie over Reach.** The existing title launches the same
plane into a bounded coastal arena (about 240 m radius) using the
current jungle heightmap and art. Low flight paths run over water so
ground clearance is readable. Take off in TOP at cruise altitude with
8 hull, one life, full boost, two Nova Bombs, and Twin Cannon I.

| Active time | What happens |
|---|---|
| 0:00–0:40 | Clear a cruise-level patrol, then meet two contacts on similar bearings in **different altitude bands**. Turn back and match salvage height. At most six patrols at once. |
| 0:40–1:45 | Mix patrols with a diving interceptor. Groups on different bearings and bands, with one escape lane in every pattern. First draft around 0:40–0:55, a second before the last encounter. Cap ordinary enemies at 16. |
| 1:45–2:30 | An armored patrol arrives. Its vent must be hit once in LOW and once in HIGH. Escorts cap at 10 while it is active. |

At 2:30 the stage is clear if the armored patrol is down and the plane
is alive. Zero hull ends the run immediately. A live armored patrol at
2:30 is a timeout. Resolve damage and vent hits on the last tick before
the result, then any earned draft. Reuse the result card (hull, salvage,
same-seed retry). Rank S/A/B/C still comes from hits taken.

- **Two weapons.** Twin Cannon auto-fires forward. Drafted Wing Pods
  cover the sides and rear at short range. Both fire at their launch
  altitude. Twin II raises cadence; Twin III adds a paired volley; Wing
  Pods II raises cadence.
- **Two drafts.** Patrol salvage = 1 XP, interceptor = 2. First draft
  costs 6 XP, the second 10 more. Show at most two legal cards (next
  Twin rank, and Wing Pods install or upgrade). One choice per draft.
  Surplus XP carries; the meter locks at level 3. The modal pauses the
  clock, movement, hazards, and boost. Clear held boost and pending
  bomb/view on open (0.3 s input grace).
- **Boost and bomb.** Keep the current boost feel. A bomb starts the
  Nova roll and clears nearby hostile shots **across bands**, but bomb
  *damage* to craft uses the same altitude window as ordinary fire.
  Stock stays at two for this stage.
- **Presentation.** Keep pixel/voxel silhouettes, fighter cockpit, title,
  Help, EN/KO, desktop bindings, and the portrait stick. Remove the
  fire bind and the touch FIRE button; give that space to a reachable
  VIEW button. No audio and no meta shop in this pass.

### Later (not Stage 1)

The full nine-minute run, Orbit transfer, Warden and its death sequence,
Atoll and Canyon routes, Seeker / Rail / Ion Wake / Flak, utilities,
evolutions, and extra enemy types.

---

## 2. Altitude model

Continuous height, three **spawn bands centered at 75, 110, and 145 m**,
35 m apart. Craft and salvage sit within about ±6 m of a center, with a
stable seeded offset so memorizing the three numbers is not enough. The
player may hold any height from about 55–165 m, with the existing
terrain floor. In code, `x,z` stay horizontal; `altitude` / `alt` is Z.

| Interaction | Rule |
|---|---|
| Ordinary fire | Twin acquires in a forward cone (~±30°, 135 m horizontal). Wing Pods use short side/rear arcs. Both need **|Δalt| ≤ 8 m** to acquire and deal damage. Bolts travel at launch height. If the only bearing in the cone is in the wrong layer, the gun holds. |
| Dodge and contact | Hostile shots travel at their firing altitude. Shots and body hits need planar overlap **and** |Δalt| ≤ 8 m. An interceptor warns at least 1.25 s before changing band, then resumes fire after it settles. A climb or dive can escape without a horizontal turn. |
| Salvage | Drops stay at the kill height. Horizontal pull (22 m) and collect (8 m) work only while **|Δalt| ≤ 8 m**. Leaving the window drops attraction. Same rule in every view. |
| Armored vent | Opens ~2.5 s on a ~7 s cycle from about 1:50. Seed picks low or high first, then alternates after a miss. After a hit, it opens only in the remaining band. A direct hit must pass the open vent within **±3 m**. Signal the approach at least 3 s, readable in the forward views. |

When the open vent is within about ±12° yaw and 140 m, holding |Δalt| ≤
3 m for **0.35 s** prioritizes that vent for Twin. Dwell is a world-space
lock, kept across view changes, reset if alignment breaks. A full-rate
climb crosses the six-metre window in under 0.2 s, so the player must
*settle* to score the hit.

**Miss feedback.** A steady wrong-layer target in the firing cone gets a
short cue. In CHASE and COCKPIT: `↑` climb or `↓` dive, and a dim streak
past the hull plus **SHOT LOW ↑** or **SHOT HIGH ↓** when a bolt crosses
the horizontal footprint at the wrong height (one cue per volley). A hit
keeps the existing bright impact. **TOP shows only CHECK ALT** — no
up/down, so the scene does not leak the correction.

This is deliberate. A drone, a diamond, and a projectile can share a TOP
map position while sitting on different flight paths. Camping cruise
misses later XP and cannot finish the two-band vent. Blind vertical
sweeps cross the vent too fast to settle. Choosing a layer in CHASE and
lining up in COCKPIT is the normal way to clear.

---

## 3. Three views

Views are different *information*, not damage or magnet bonuses.
Movement, boost, weapon damage, pickup reach, and collision volumes are
identical in every view. A clear does not require logging a camera
choice; it follows from the shots.

| View | Job | When to switch |
|---|---|---|
| **TOP** | Best 360° horizontal map. Choose a turn, find an escape lane, or take a bearing back to salvage. | When two contacts overlap on the map, or CHECK ALT fires — leave TOP to read height. |
| **CHASE** | Reads relative height and terrain at a glance: airframe, horizon, ground shadows, stacked bands. | Choose the lower or upper route, duck a volley, or fly a salvage return at the right height. Switch to COCKPIT once the precision target is ahead. |
| **COCKPIT** | Finish the approach. Signed altitude error and lock progress to settle on the vent or in-band target. | After the shot, go back to TOP for the next bearing or CHASE for the next climb or dive. |

A typical pass: TOP to find the open side of a pair → CHASE to see that
the open path is below an interceptor’s line → COCKPIT to settle on the
vent. Three different kinds of information.

`V` / VIEW cycles TOP → CHASE → COCKPIT → TOP. Immediate camera cut with
a thin ~0.15 s scanline accent; a second press advances without waiting.
Steering, stick, and boost stay live. Dwell, projectiles, and hazard
warnings carry across the switch. **No invulnerability** on a view
change.

---

## 4. UI for managing Z

**Options considered**

- Altitude chevrons on every TOP radar contact — easy to teach, but a
  skilled player could hunt bands from TOP alone.
- A side-profile strip or three mini-maps in TOP — strong overview, but
  it steals CHASE’s job and crowds portrait layout.
- Every enemy and gem marked on the ALT tape — precise when sparse,
  unreadable when an escape decision matters.
- Keep TOP horizontal; put selective height on CHASE/COCKPIT instruments
  and one precise track in the cockpit.

**Choice: TOP is blind to contact altitude.** TOP keeps own ALT, safety
warnings (PULL UP, perimeter), and a horizontal radar map, but it omits
target and salvage height, signed shot errors, and size/shadow tricks
that would leak Z. Overlapping contacts share one radar mark. A neutral
**CHECK ALT** cue tells a new pilot when to switch. This matches “top
view alone is not enough,” while still using ALT and radar properly in
the views that can act on height.

| Instrument | Stage-1 minimum |
|---|---|
| **ALT** | TOP: own altitude as one number. CHASE: existing ruler with three subdued band ticks (75 / 110 / 145) and the player marker. COCKPIT: existing right tape with own altitude and **one signed delta** to the selected target or vent (`+05 m`). |
| **Radar** | One radar in the existing nav zone or cockpit MFD, nose-up, with a north tick. TOP: all bearings to ~160 m, **no height pips**; overlapping contacts merge. Forward views: detailed forward contacts, one aggregated rear-rim warning for imminent traffic. Squares = hostiles, diamonds = salvage. At most one priority hostile and one salvage cluster get a small `^ / = / v` pip (`=` means inside the 8 m window). The vent’s tighter alignment uses the cockpit reticle, not a second pip language. |
| **Scene** | CHASE lets projection and shadows show layers, plus one short altitude cue for the chosen threat or salvage. COCKPIT: one aim box, brief dwell fill, locked bracket when ready. Cut floating `[ ] / ^ / v` sprite tags in TOP (they would make TOP self-sufficient). Preserve terrain and perimeter warnings in every view. |

In portrait, keep the right tape for digits and one mark; keep radar in
its own box above the touch controls or in the cockpit dash. Priority
cues stay inside the playfield and must not collide with objective,
radio, tape, or stick. Use shape as well as color. Copy goes through
`src/i18n.ts`; teach the glyphs in the skippable guide.

Implementation touchpoints: `src/game.ts` for layer checks and lock
state; `src/render.ts` / `src/main.ts` for view-appropriate cues;
`src/cockpit.ts` / `src/cockpit-display.ts` for the same tracked target
on the existing cached tapes and ~20 Hz MFD. Replace legacy TOP
altitude brackets and view-dependent hit tolerances on the Stage 1 path.

---

## 5. Stage-1 milestones

No work starts until the owner approves this plan.

| Effort | Deliverable |
|---|---|
| **3 h · First playable** | A short Reach fixture from the existing title. Fly two stacked patrol groups in all three cameras: in-band Twin hits, planar enemy shots, same-height salvage. Remove TOP target-height cues immediately. Prove a horizontal overlap can miss, dodge, or fail a pickup at the wrong height. |
| **2.5 h · Stage loop** | 2:30 clock, bounded spawn schedule, two paused drafts, Twin ranks and Wing Pods. Reuse title, pause, controls, and result. Held input must not fire a bomb or advance time. |
| **2.5 h · Precision encounter** | Two-band vent on the armored patrol, close-on-hit, world-space lock that survives camera changes. Check warning time, second-band accessibility, and last-tick outcome order. |
| **2.5 h · Instruments and touch** | Radar pips (forward views only), compact ALT states, one target cue, fluid V/VIEW, EN/KO guide. Check 1280×720 and 360×780, 390×844, 430×932 with safe-area insets, both languages. |
| **2.5 h · Replay and tune** | Seeded fixed-tick sim, fixtures below, autoplay that uses CHASE for bands and COCKPIT for lock. Verify replay, camera-invariant collisions, modal clock, warning lead, and 60 fps under Stage 1 caps. `npm test` and `npm run build` after approval. |

Fixtures use the same simulation. `?fixture=stack` at 0:30 with two
contacts at the same horizontal position, 75 m and 145 m.
`?fixture=draft` at 0:45 with six XP and two choices open.
`?fixture=vent` at 1:48, player at 110 m, first vent ahead at 149 m.
Keep `?seed=`, `?view=`, `?touch=1`, `?lang=`, `?t=`, `?autoplay=1`.
`t` seeks to an absolute active time; without autoplay, control returns
to the player. An explicit view sets the starting camera. Diagnostics
on `window.__game` include tick, altitude, draft IDs, vent hits, and
lock state.

---

## 6. Risks and open questions

**Biggest risk:** making altitude necessary but unfair, or leaking enough
Z into TOP that a skilled player never leaves it. Play matched
fresh-seed attempts on desktop and touch. A good switched route should
have time for a TOP turn, a CHASE band change, and a COCKPIT line-up.
Gate: on an initial six-seed set, at least four clears that use all
three views, and **zero good TOP-only clears** (both drafts collected,
salvage from two bands). If TOP-only or a blind vertical sweep still
clears, tighten geometry or vent timing **before** adding any height
info to TOP. Secondary risk: instrument clutter on a 360 px phone. If
the approach is covered, remove pips before adding another display.

**Open questions (2):**

1. Approve keeping **TOP blind to contact altitude** (own ALT and
   horizontal radar only; height pips live in CHASE/COCKPIT)? This is
   the recommendation. The alternative is coarse radar/ALT pips in TOP
   as well, which is easier to learn and easier to camp.
2. Is a **2:30 Reach sortie with a two-band armored vent** the right
   Stage 1 length and climax?

---

## 7. agy vs Codex (short)

Both were asked independently, planning only, with the current plan as
context. The merge prefers Codex on scope and on TOP being altitude-blind.

- **Stage length / roster:** agy wanted ~3:00, a Heavy Commander, Seeker
  Missiles, and one evolution. Codex wanted 2:30, Twin + Wing Pods only,
  and a two-band vent. **Picked Codex** (smaller first stage).
- **Hit window:** agy ±16 m with a glance band; Codex a hard ±8 m.
  **Picked Codex** (clearer “wrong layer” feel).
- **View bonuses:** agy kept light magnet / boost / lock-crit seasoning.
  Codex uses views as information only. **Picked Codex**, per the
  request to rethink views around altitude rather than small bonuses.
- **TOP Z UI (main disagreement):** agy recommended instrument-only TOP
  (radar `△/■/▽` + ALT band pips, no sprite tags). Codex recommended
  TOP blind to contact height, with ALT/radar height cues only in the
  forward views, plus CHECK ALT. **Picked Codex**, because the owner’s
  test is that top view alone must not be enough. If playtests show
  that is too harsh, the agy instruments can be added later.
- **Agreed and kept:** three bands, altitude-gated hits/salvage/dodge,
  visible high/low miss streaks, no view-switch i-frames, fluid V/VIEW,
  remove FIRE, no audio or meta shop, Orbit/Warden deferred to Later.
