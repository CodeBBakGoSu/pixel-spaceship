# ASTER WING — Survival Rework Plan

Design plan for 기현님’s approval. Baseline is `801ff22` on `origin/main`.
Implementation starts only after this plan is approved. Numbers below are
starting targets for the first playable slice, not locked balance.

This document merges two independent planning passes (agy / Gemini, and
Codex on gpt-6.2-sol). Section 13 records the disagreements and the choice
made in each case.

---

## 1. Pitch and north star

You fly the same ASTER WING through a swarm that closes in from every
bearing. Guns fire automatically while you bank, climb, dive, and loop
back through salvage to build a loadout mid-run. Top view is for gathering
and reading the whole fight, chase is for terrain and boost escapes, and
cockpit is for lining up a weak point. A timed climb to orbit brings the
Warden into a fight your flying and upgrades prepared you for.

This is still a flight game, not a sprite standing inside a damage ring.
If steering, altitude, and view changes do not change the outcome of a
run, the design has failed.

---

## 2. What we keep, change, and cut

| Current game (`801ff22`) | Decision |
|---|---|
| Four scripted phases in `SCRIPT` (Reach → Atoll pylons → Canyon doors → Orbit) | Replace with one survival sortie. Reach, Atoll, and Canyon become places in a single surface arena. A timed transfer goes to Orbit. Cut the four-pylon exit gate and the three-door sequence. Optional relays and a canyon ring keep those landmarks useful. |
| Manual fire (`Space` / `J` / `Z` / FIRE) | All equipped weapons auto-fire on their own cooldowns. Cut the fire bind. Steering the plane lines up forward weapons. |
| `P` capsules and weapon level loss on hit | Cut power-down. Salvage diamonds are XP. Upgrades come from paused level-up choices and stay after a hit. Reuse capsule / supply visuals for repair and bomb crates. |
| Boost and Nova Bomb | Keep both as manual decisions. Boost spends a regenerating meter. Start with two bombs, stock cap three. |
| 8 hull and 3 lives | Keep 8 hull and brief hit immunity. Zero hull ends the sortie. In-run repairs only; no respawn. |
| Score, salvage, S/A/B/C rank, faster loops | Keep score and the clear rank (S = 0 hits, A = 1–2, B = 3–5, C otherwise). Salvage is XP and appears on the result card. Cut faster follow-on loops. Fresh seed or retry the same seed. |
| OPAL / GALE / WARDEN radio | Keep portraits and short event cues (first salvage, local opportunity, transfer, exposed core). No mission-gate chatter. |
| Three views, wipe, climb/dive, voxel plane, fighter cockpit, biomes | Keep. Each view gets one explicit tactical advantage. |
| Warden ring, four pods, then core | Keep the encounter. Adapt it to a crowd fight with a hard deadline. Add a short boss-death breakup (the current win branch has none). |
| Seeded autoplay, URL hooks, EN/KO, Galmuri11 | Keep and extend. Retire `loop`. Document new fixture aliases for old `segment` names. |

Adopt automatic attacks, rising density, field XP, paused build choices,
and two in-run weapon evolutions. Cut campaign gates, permanent power, and
a meta-progression shop. No backend, no audio in this pass, no paid
services. Never commit `ref/` media.

---

## 3. Core loop

**Recommend a nine-minute active-flight cap.** A typical first clear
should take eight to nine minutes. That is long enough for two evolutions
and a Warden fight, and short enough for a browser session. (The alternate
10:00 clock plus a post-clock boss was rejected as too long for this
rework; see §13.)

Launch: Twin Cannon I, 8 hull, 2 bombs, full boost, 0 XP, Top view. Show
the existing skippable guide on first launch. Weapons start firing when a
contact enters their arc. First salvage loop should earn a draft around
0:30–0:45.

| Active time | Pacing | Director starting budget |
|---|---|---|
| 0:00–1:00 | Open Reach. Patrols from two readable bearings. First diamonds land just below or ahead of the path. First upgrade before the craft is encircled. | 0.30 spawn credits/sec, up to 8 normals |
| 1:00–2:00 | Flank interceptors. First supply drone at 1:40 (repair + XP). A low pass near Atoll is worth more salvage than staying at cruise. | 0.60/sec, up to 14 |
| 2:00–3:00 | Arm two optional Atoll relay batteries at 2:10 after a radio cue. Alternating low/high patrols. Players start choosing forward damage vs crowd coverage. | 0.90/sec, up to 20 |
| 3:00–4:00 | Heavies enter. GALE flags the optional Canyon relay. 3:40 supply drops a bomb (stock cap 3). | 1.20/sec, up to 26 |
| 4:00–5:00 | Pressure from three bearings with one lane left open. A focused build can earn its first evolution. | 1.45/sec, up to 32 |
| 5:00–6:00 | High interceptors and low salvage pockets. Last scheduled supply at 5:40 (repair). Encourage a boost escape and a return pass. | 1.70/sec, up to 40 |
| 6:00–7:00 | Peak surface density. OPAL calls departure 20s ahead. Last salvage pass, or save boost and a bomb for orbit. | 2.00/sec, up to 48 |
| 7:00–8:00 | Timed transfer to Orbit with the current build and collected XP. Three seconds with no attackers, then Warden at 7:30. | 0.80/sec until 7:30, then 0.60/sec with up to 12 adds |
| 8:00–9:00 | Warden alternates pod/core attacks with relief intervals. Visible countdown in the last 15s. Keep one escape lane between patterns. | 0.80/sec, up to 16 adds, plus reserved boss hazards |

**Economy.** Patrol = 1 XP, interceptor = 2, heavy or battery = 3, supply
drone = 5. Kills leave physical salvage at the world position; only
collected salvage counts. A ram or despawn yields none. Score starts at
100 / 200 / 300 for those ranks, 25,000 for Warden, and 10 per collected
XP. Supplies at 1:40 and 5:40 also repair 2 hull (up to max).

**Director.** One credit buys a patrol, two an interceptor, three a
heavy. Batteries and supplies have a small fixed budget. Bank at most
four credits and release at most one new group per 0.5s so a saturated
minute cannot dump a backlog. Table counts are ceilings for normals and
include local batteries and supplies. Boss hazards have reserved slots.

**Transfer at 7:00.** Finish surface contacts and pickups, resolve any
loss, then transfer a surviving player exactly once before opening earned
drafts. Keep hull, boost, bombs, loadout, level, XP, score, and collected
salvage. Surface enemies, shots, and uncollected drops stay behind. Keep
the current view. The wipe runs on the active clock and freezes with a
draft.

**Win / lose.** Destroy Warden’s core with hull remaining at or before
9:00 to win. Zero hull loses immediately. 9:00 with a live Warden is a
timeout loss. On a shared tick, priority is: fatal damage, then core
kill, then timeout, then a level-up prompt. Pause and drafts freeze the
active clock. Result cards show time, kills, score, salvage, and final
build. Fly Again starts a fresh seed; Retry Seed replays the same setup.

---

## 4. Combat and weapons

**Eight equipment entries.** Six automatic weapons and two utilities share
four slots. Twin Cannon occupies the first slot for the whole run. Equip
up to three weapons total and up to two utilities. Three weapon ranks and
two utility ranks. Duplicate picks improve the installed item. Weapons
fire independently.

| Equipment | Rank I | Later ranks |
|---|---|---|
| Twin Cannon (starter) | Frequent cyan bolts in a forward arc (~0.4s volley). Auto-aims at eligible contacts within ±35° yaw, 155 m horizontal, 18 m altitude. | Shorter interval, then a wider four-bolt volley. |
| Seeker Missiles | Slow tracking missile in a broad forward arc. Corrects altitude within a bounded turn rate. Fills the unused cockpit MSL readout with charge / ready state, not a fake ammo count. | Faster acquisition, then a second missile. |
| Rail Cannon | Short charge, tight forward line that pierces up to three aligned contacts. | Shorter charge, then higher impact. |
| Wing Pods | Short-range volleys into the side and rear, alternating sides. | More rear coverage, then faster cooldown. |
| Ion Wake | Short-lived damaging exhaust behind the flight path. Turn back and pull pursuers through it. Boost can widen or refresh the trail. | Longer persistence, then a slow on ordinary enemies. |
| Flak | Airburst at a nearby forward cluster, bounded targets in the same altitude band. | Larger radius, then a higher target cap. |
| Boost Injector (utility) | +15% boost recharge after release. | +30%. |
| Salvage Tractor (utility) | +6 m horizontal pickup attraction in every view. | +12 m total. Altitude tolerance unchanged. |

**Evolutions (two, each once).** Twin Cannon III + Boost Injector II →
**Vector Cannon** (converging center bolts, wider outer bolts). Seeker
Missiles III + Salvage Tractor II → **Relay Missiles** (a surviving
missile can acquire one second target). The pairings make a real slot
choice.

**Geometry.** Range, bearings, and hits use world coordinates and are
identical in every view. Twin picks the nearest eligible forward contact.
Rail favors the line with the most eligible targets. An active cockpit
designation takes priority for Twin and Rail when it fits that weapon’s
geometry. Rail commits at charge start; the lock bonus applies only if
the same designation is still valid when it fires. Co-planar weapons deal
full damage within `|Δalt| ≤ 18`, glancing to about 34, and miss beyond
that, so climb and dive stay mandatory unless the build covers vertical
gaps with Seekers or Flak. Tune base damage so a competent unevolved
build can still kill Warden.

**Boost and bomb.** Keep the current ~1.55× speed, 0.50/s drain, 0.35/s
refill. A bomb spends one stock, plays the existing roll, clears hostile
shots within 145 m horizontally, deals 3 damage to normals within that
radius and 32 m vertically, and grants 0.7 s protection. Warden takes no
direct bomb damage; pods and core follow their ordinary rules. Resolve
the bomb before hostile contact damage on the same tick.

---

## 5. Level-up and build choices

Start at level 1. From level `L`, the next level costs `6 + 4 × (L − 1)`
XP. Surplus XP carries. Recheck loadout and XP before each further draft
so a large pickup can fund several choices without precomputing offers
that may become illegal. Level 12 is the first tuning cap; a strong
sortie should see about eight to eleven choices. At the cap or when the
legal pool is empty, mark the meter MAX and keep adding collected salvage
to the tally and score.

On a non-terminal tick that crosses the threshold, freeze spawn,
movement, shots, boost, lock dwell, and the run timer. Show three
distinct legal cards when available. The first draw offers Twin Cannon II
plus two of the five new weapons from the seed. Later drafts reserve a
slot for an eligible evolution, otherwise for an installed item that can
improve, then sample the remaining legal pool without replacement. Show
fewer cards if the pool is smaller. No reroll, banish, skip, or in-run
shop.

Each card shows icon, name, current → next rank, one concrete effect, and
the next evolution requirement where relevant. Pick by tap, keys 1–3, or
focus and confirm. Match the choice to the current draft ID so stale taps
and key repeats are ignored. 0.3 s input grace on open, so a held fire or
a late tap cannot take card 1 by accident. One vertical card stack in
portrait, at least 48 CSS px per target, safe-area reserved title. Touch
flight controls are inert while the modal is open. Clear held boost and
pending bomb/view on entry; require a fresh press. Process queued drafts
one at a time. Reopen or resize keeps the same offers.

---

## 6. Arena and camera

**One connected surface arena and one orbital finale.** Start in a
roughly 300 m radius airspace with a soft perimeter. Reach is the open
shore and the safest broad turn. Atoll is a low basin with two optional
relay batteries; killing one stops its suppressing fire and leaves a
high-value salvage pocket. Canyon is an optional short notch with two
climbable ridges and a single relay ring. Threading the ring within 14 m
of its marked altitude, once per run, awards 4 salvage plus 35 percentage
points of boost (up to full). Leave an open bypass at least 75 m wide at
full boost. Entering any surface region is voluntary and does not change
the clock or the director.

Use the existing jungle heightmap for Reach and Atoll. Stamp two bounded
ridges and the canyon palette into the surface arena’s terrain data at
init, and feed the *same* ground heights to overhead rendering, forward
raycasting, clearance, and collision. The current forward renderer adds
canyon wall height separately; using that draw path alone would create
phantom walls or invisible hits. Flight bands start around 75 / 110 /
145 m (low / cruise / high) with a continuous range around 55–165 m.
Skip blocked low spawn positions. Rising terrain is marked early; a
swept clearance hit applies ordinary damage and keeps the player on the
safe side, with steering and climb still available. Orbit reuses the
space sky, a soft boundary, and Warden patterns in multiple altitude
bands, with no ground collision.

| View | Tactical advantage | When it pays off |
|---|---|---|
| **TOP** | North-up coverage of encirclement and salvage routes. Horizontal attraction extends from 24 m to 48 m. In every view, attraction is horizontal only within ±14 m altitude; collect at 8 m horizontal while inside that band. | A turning pass over low Atoll diamonds while patrols close from two bearings. |
| **CHASE** | Full airframe, horizon, near-ground shadow, and forward clearance make narrow routes and stacked altitude bands readable. Flight assist reduces boost drain by 25% with the same turn response and top speed. | Boost through the Canyon ring at its stamped altitude, or use the longer burn to outrun orbit interceptors. |
| **COCKPIT** | After 0.6 s on a forward contact within ±16° yaw, 150 m slant range, and ±14 m altitude, the HUD designator holds a world-space lock. Twin and Rail deal 1.5× to that target while locked. | Climb or dive to finish an exposed Warden pod or core in a shorter pass. Fire stays automatic. |

`V` / VIEW cycles the same three views. The scanline wipe leaves steering
and edge warnings live and grants **no** invulnerability. Heading,
speed, altitude, projectiles, and hit volumes are unchanged. Break
cockpit lock on exit, target death, or lost line-up. Latch the damage
bonus on a shot and apply it only to that shot’s designated target.
Short-lived silhouette or edge warnings cover rear and above/below
contacts in the forward views. A player may stay in one view and clear,
but a switched route must show a measurable salvage, boost, or precision
benefit. Camera changes stay player-directed, including during the Orbit
transfer.

Ground scrape (`clearance` too low) flashes PULL UP, applies a small
hull hit on a cooldown, and bounces the craft up. It is never an instant
crush unless hull is already gone.

---

## 7. Enemies and Warden

| Enemy | Pattern and counter |
|---|---|
| Patrol drone | Common pursuer in groups of 2–4. Holds a coarse lane and fires one warned pellet. Enter its band to clear it, or climb through a gap. |
| Interceptor | Thin, fast silhouette. Telegraphs a dive or flank, turns wide after overshooting. Boost across its approach or use side/rear weapons. |
| Heavy gunship | Slow high-HP silhouette, usually at cruise, with a telegraphed three-shot fan limited by nearby shot budgets. Rail can pierce escorts on a tight line. |
| Relay battery | Reuse the Atoll pylon as a stationary low-layer target. Clear it to make the basin safer and collect its drops. |
| Supply drone | Reuse the red/white hull. Predictable altitude and retreat; a short detour for XP and repair or a bomb. |

**Warden** keeps the ring and four destructible pods (above, below, and
to the sides), geometry attached to its own heading. Spawn at 7:30 about
160 m ahead, with a boundary-safe fallback. Starting HP: 16 per pod, 40
core. The ring holds a readable position while it telegraphs fan volleys
and slow, destroyable orbs (warning ≥ 1 s, also on radar and edge cues).
Keep a navigable altitude band between volleys. The protected core opens
only after all four pods break, then alternates short burst windows and
a sweeping orb pattern. In the first tuning pass the opened core stays
damageable between patterns, giving every competent build a fair ~90 s
clock. Add pressure stays below peak surface density. Boss hazards have
reserved spawn slots.

**Boss-death explosion.** The current win branch queues a generic burst
and freezes; there is no death animation. Add a short (~0.8 s) pixel
breakup using existing burst and ring art, started from the terminal
event and animated on the render clock over the frozen winning scene,
before the clear card. Cap debris. Respect reduced motion. No new
slow-motion simulation phase.

---

## 8. Controls, HUD, and i18n

- **Desktop.** A/D or arrows turn; W/S or up/down climb and dive; mouse
  offset remains an existing steering alternative. Shift boost, X bomb,
  V view, P pause, Enter launch. On the result card, Enter starts a new
  sortie and R retries the seed. Keys 1–3 (or focused buttons) in a
  draft. Gamepad stick steering stays; bind boost / bomb / view / confirm
  to available buttons. No fire hold.
- **Portrait.** Keep the left steer/climb stick and the right BOOST,
  BOMB, and VIEW buttons. **Remove the FIRE button** and give that space
  to larger action targets (360 px already crowds the row). Pause stays
  in its separate safe-area corner. Menu taps must not become flight
  inputs. Steering and boost can be held together.
- **HUD.** Prioritize countdown, level/XP bar, hull, boost, bombs, and
  current view. Compact loadout and score sit in existing status zones.
  Warden health, radio, and the short objective strip keep their own
  rows. Keep the ALT ruler and bracket cues outside cockpit. Use shape
  and altitude markers as well as color.
- **Cockpit.** Keep canopy, pitch ladder, speed / heading / altitude
  tapes, warning lamps, radar sweep, airframe, gauges, and the cached
  pixel pipeline. The weapons MFD shows fitted ranks and readiness.
  Seeker shows cooldown / ready instead of a stock count. BMB remains
  bomb stock. Glass priority goes to the designator, lock progress, and
  altitude alignment. Draft details go to the HTML modal, not a flood of
  canopy labels.
- **Guide and language.** Update the preflight and pause Help cards:
  auto-fire, salvage XP, level choices, and what each view is for.
  Define BMB and the altitude cues. Extend the typed EN/KO dictionary
  for gear, HUD labels, prompts, outcomes, and radio. Keep live
  switching, `aster.lang`, and `?lang=`. Rebuild the local Galmuri11
  subset for new glyphs, keep the OFL license, and use the same font for
  canvas and DOM. Prove EN/KO layouts before release.
- **Layout.** Extend the pure rectangle math in `src/layout.ts` for the
  XP strip, grouped threat cues, and draft cards. Cockpit and touch
  controls stay below the flight picture; radio and objective stay
  above; the draft keeps reachable choices at 360 px.

---

## 9. Technical approach

Do not rewrite the software renderer or `CockpitDisplay`. Keep `src/game.ts`
pure, DOM-free, and deterministic.

| Touchpoint | Work |
|---|---|
| `src/game.ts` | Keep the 60 Hz, command-based state machine. Replace `SCRIPT`, wave clears, and mission transitions with an integer active tick, surface/orbit arena, director state, draft state, loadout, and terminal outcome. Add phases `level_up` and a render-only death hold. Keep collision and bomb rules next to the simulation. |
| New `src/director.ts` | Minute budgets, valid spawn locations, fixed supplies, and the 7:00 transfer. |
| New `src/loadout.ts` | XP costs, legal offers, item/rank specs, cooldowns, and evolution prerequisites. Weapon emission can live here until a measured hotspot needs a narrower helper. |
| `src/flight.ts`, `src/camera.ts`, `src/world.ts` | Keep `advanceBank`, yaw/altitude, and shared projection. Render stamped regional terrain from one ground-sample contract. Replace projection-dependent aim/hit tolerances with a view-independent world cone plus the three declared aids. Aspect and language never affect spawns, hit volumes, or RNG. |
| `src/models.ts`, `src/voxel.ts`, `src/ship.ts`, `src/render.ts` | Reuse baked enemy and boss sprites; live voxel projection stays on the player craft. Bake pickup / ordnance icons once. Project and cull before depth sort into reusable scratch. |
| `src/cockpit.ts`, `src/cockpit-display.ts`, `src/cockpit-pixels.ts` | Feed simulation lock and ranked weapon status to the display. Keep cached canopy, 20 Hz MFD refresh, integer-pixel pitch ladder, and dirty-zone redraw. |
| `src/main.ts`, `index.html`, `src/style.css`, `src/layout.ts`, `src/i18n.ts` | One input path for flight and draft choices. Preserve overlays, focus management, and safe areas. Update the guide, README, and URL examples. |

**Spawn, collision, and caps.** Place groups in eight fixed bearing
sectors about 120–175 m out, inside valid bounds and clearance. Reject
positions that are too close and keep at least one sector open for
escape. Telegraph rear/side entries for ≥ 1.25 s with the same cues in
every view. Do not reset spawn timers on a view change. Use `x, z, alt`
distance and swept bolts.

First-playable hard caps: 48 normal hostiles, one Warden with four pod
targets, 12 boss hazards, 120 friendly shots, 72 hostile shots, 80
salvage orbs (including grouped values), 24 persistent weapon areas, 48
visual effects. At cap, refuse extra normal spawns before they can deal
damage, and never overwrite an active hazard next to the player.
Coalesce nearby salvage into the closest compatible altitude cluster
with conserved XP. If the pool is full and no cluster is compatible,
merge the closest same-band pair before placing the new drop. Keep XP
totals exact until pickup or surface departure.

Start with bounded reusable collections and one XZ bucket pass for
near-neighbor checks. Filter by altitude/range before costly target
scoring. The current `copy()` clones every entity and shot each tick;
measure it under the new caps. If cloning dominates, give the browser
tick runner privately owned reusable buffers and keep
`stepGame(previous, inputs, tick, ground)` input-pure for tests, with a
parity test between the two.

**Frame target.** 60 fps in dense waves, all three views, at 1280×720
desktop and 390×844 portrait (DPR 3), plus layout checks at 360×780 and
430×932. A three-trial 60 Hz lab gate should hold at least 59 fps median
with p95 frame intervals ≤ 20 ms under the cap-pressure fixture. Trim
cosmetic glow and trail stamps first; do not cut telegraphs, hit rules,
or director density.

**Determinism and capture.** Keep Mulberry32. Store independently derived
director and draft RNG states so rendering and menu redraws cannot move a
spawn. A fresh human run takes a seed at launch and records it.
`?seed=` and Retry Seed reuse it. Repeatable results require the same
tick inputs, including draft and view choices. Keep diagnostics on
`window.__game` (tick, seed, view, XP, build, choice IDs, outcome, counts).

Replace the pylon/door autoplay policy with a pilot that turns into safe
gaps, banks back through nearby salvage, follows altitude cues, spends
boost or a bomb to escape, and lines up Warden. It picks deterministic
legal upgrades without advancing active time. View policy: TOP when a
dense gem cluster is nearby, CHASE when clearance is tight or boost is
needed, COCKPIT when an elite, battery, or Warden is the current job.

Keep `?seed=1&view=chase&autoplay=1&touch=1&lang=ko&t=SECONDS`. `view`
sets the starting camera. `t` seeks to a bounded absolute active-flight
time with deterministic bot inputs and stops early at an outcome.
Without `autoplay=1`, control is human after seeking. Ordinary visits
still open on the title. Fixtures `?fixture=draft|swarm|warden` start
with visible offers, a dense wave, or Warden, each with a declared time,
build, and seed (default seed 1). An explicit fixture wins over a legacy
segment; an explicit view wins over the preset view. Legacy `segment`
names become spawn presets for the same surface (or orbital) clock.
`?segment=boss` aliases the Warden fixture. Ignore `loop`. Document the
changed meaning in the README.

---

## 10. Test plan

The current 97-test suite is the coverage baseline. Keep terrain, voxel,
outline, and still-valid layout, cockpit math, language, and flight
assertions. Replace tests that encode removed route gates, faster loops,
or manual weapon power-down.

| Coverage | Acceptance |
|---|---|
| State and time | Title → flight → draft → flight, pause/resume, one transfer at 7:00, Warden at 7:30, clear / death / timeout, exact last-tick tie order. Frozen states cannot spend cooldown, boost, or run time. Pickup or fatal hit on the transfer boundary; an open draft cannot transfer twice. Retry reproduces the seed. |
| Director and pickups | Minute budgets, spawn ranges, altitude warning windows, hard caps, reserved boss shots. Kill, merge, collect, and surface departure conserve XP. Large pickups and queued drafts. |
| Loadout and input | Legal three-card draws, unique IDs, fit and rank caps, both evolution recipes, no stale choice on double tap, no held bomb after draft. Auto-fire uses world-space ranges and admits learnable altitude misses. |
| Views and flight | Repeated V cycling keeps movement and cooldowns continuous apart from the declared assists. TOP reaches salvage farther, CHASE consumes less boost with equal steering, a valid COCKPIT dwell strengthens the designated hit. Equal-seed fights match across viewport aspect ratios. Canyon clearances, fence, collision, and both bypasses. |
| Boss and autoplay | Four independently placed pods block the core. Seeded full runs hash identically. A recorded win and loss replay exactly. The death breakup plays once without mutating score, clock, or outcome. |
| UI and performance | Extend layout tests for desktop and three portrait sizes, including safe-area insets and the draft modal. Browser-check level-up, late-wave combat in all views, orbit, boss, and outcome in EN and KO. Stress the declared budgets for three measured samples per view. Distinguish real-device / Safari results from Chromium emulation when those become available. |

After approval, run `npm test` and `npm run build` at the playable and
release gates, and use the built app for browser checks. Record seed,
fixture, viewport, DPR, browser, and frame timing with late-run captures.

---

## 11. Implementation milestones

No work starts until the owner approves this plan.

| Order and effort | Deliverable and done condition |
|---|---|
| 1 · 2.5 h | Replace route state with a survival clock, bounded Reach arena, and initial seeded patrol director. Keep the three projections and continuous climb. Headless tests prove pause, restart, and exact tick boundaries. |
| 2 · 3 h | **First playable slice.** A 2–3 minute Reach fixture in the same run engine: Twin auto-fire, salvage, first paused draft, Wing Pods I, boost/bomb, and a result. Reachable from the title during development. Verify one-thumb flight and the first draft on portrait. |
| 3 · 2.5 h | Ship the three view aids, clearance/altitude cues, and offscreen threat warnings *in the slice*. Compare a route that gathers in TOP, escapes under boost in CHASE, and takes an aligned shot in COCKPIT against the same seed played TOP-only. Measure collected XP, boost duration, and damage to the designated target. Do this before adding more arena or weapons. |
| 4 · 2.5 h | Finish Wing Pod upgrades and add Flak and Rail in the same timer system. Fix lane collisions and budget area effects. |
| 5 · 2.5 h | Complete Seeker, Ion Wake, both utilities, and the two evolutions. Verify legal deck exhaustion, slot caps, queued drafts, and deterministic offer IDs. |
| 6 · 3 h | Add Atoll relay batteries, Canyon geometry and ring, and the full surface schedule. Validate clearances, altitude bands, bypasses, and bounded spawn/salvage pressure. |
| 7 · 2.5 h | Timed orbital transfer and Warden pods/core. A fresh build and a carried build both reach a playable Warden fixture. |
| 8 · 2 h | Outcome priority, rank/result, boss breakup, and full autoplay. Replay a seeded clear and a timeout on the same input/tick path. |
| 9 · 2.5 h | EN/KO cockpit status, guide, HUD, and draft layout. Rebuild the Galmuri subset. Check desktop plus three portrait sizes. |
| 10 · 2.5 h | Profile the worst late-wave fixtures in all views. Cut visual and draw overhead to hit the frame gate without dropping cues or density. |
| 11 · 2 h | Play full seed runs for pacing and fairness on desktop and touch. Tune offers, damage, and Warden time-to-kill. Finish README hooks, tests, and production-build verification. |

---

## 12. Risks and open questions

**The biggest risk is blind-side swarm damage making CHASE and COCKPIT
too hard to use.** Players will camp in TOP if the forward views feel
unsafe, and the “all three views matter” requirement fails. Validate
this in the first playable slice, before the full roster or arena.
Compare the same seed and build in all three views on desktop and
portrait. A pilot should see threat bearing and altitude before taking a
hit, find a viable escape without switching, and gain the advertised
benefit from a deliberate switch. If a forward view fails that check,
change spawn angle, warning duration, or group spacing before raising
density. Do not paper over it with shared bonuses or a mandatory camera
lock.

Secondary risks: auto-fire clearing the screen while the player steers
aimlessly, and late-run canvas cost. Test whether line-up, altitude
changes, and return passes actually increase salvage and damage. Cap and
merge entities; profile a dense fixture before orbit art polish.

**Open question for 기현님 (one decision):** approve this design for the
main game — including the nine-minute cap, no fire button, optional
surface landmarks, and the tight eight-item / two-evolution roster — or
name the parts to change. Remaining tuning comes from the playable
slice. No meta-progression shop and no audio in this pass. Implementation
starts only after approval.

---

## 13. Proposal choices (agy vs Codex)

Both planners were given the same brief, independently, with instructions
not to edit the repo. The merged plan above prefers Codex (gpt-6.2-sol)
on structure and scope, and takes specific systems from agy where they
were clearer or already match this codebase.

| Topic | agy | Codex (sol) | Picked |
|---|---|---|---|
| Run length | 10:00 clock, then Warden (~11–11.5 min total) | 9:00 hard cap; transfer 7:00, Warden 7:30, timeout at 9:00 | **Sol.** Tighter browser session, a hard deadline, and a fair ~90 s boss window. 10:00+boss is the fallback if two evolutions cannot fit. |
| Arena | Forced biome schedule (Reach → Canyon → Orbit); pylons optional | One surface arena; Reach / Atoll / Canyon are optional places; one timed Orbit transfer | **Sol.** Keeps the landmarks without rebuilding the old four-phase gate structure. |
| Roster | 6 weapons + 6 passives, max 4+4, six evolutions, 2 rerolls | 6 weapons + 2 utilities in 4 slots, two evolutions, no reroll | **Sol.** Smaller, cost-conscious set. Enough for build variety. |
| Omni weapon | Nova Pulse Ring (expanding ring around the ship) | Flak (forward airburst in-band) | **Sol (Flak).** A personal damage ring would undermine “you fly, you don’t stand in garlic.” |
| Fire button | Keep FIRE as optional Focus (tighter spread / steer reticle) | Remove FIRE; steering lines up shots; bigger mobile buttons | **Sol.** Portrait already crowds at 360 px. Cockpit lock covers precision. Focus can return later if lock-on feels weak. |
| View switch safety | 0.35 s pulse shield on a view change | No invulnerability on switch | **Sol.** A free i-frame would make view-cycling a damage cancel. |
| CHASE bonus | +15% speed and +40% boost recharge when low | 25% less boost drain, same top speed and turn | **Sol.** Easier to tune; CHASE should not simply be “faster everything.” Readability of stacked altitude stays a CHASE job. |
| Lives / loops | 8–16 expandable hull; Next Loop at 1.2× speed | 8 hull + repairs; cut faster loops; retry same seed | **Sol.** One life, fresh or retryed sorties. Loops were a shmup leftover. |
| Boss explosion | 2.2 s `boss_dying` slow-motion multi-burst | ~0.6 s breakup on the render clock over a frozen win | **Hybrid, closer to sol:** ~0.8 s, existing art, no new slow-mo sim phase. |
| Draft rules | 2 rerolls, fallback repair/bomb cards, 56 px targets | No reroll, reserved evolution slot, XP formula, queued drafts, stale-tap rejection | **Sol**, plus agy’s 0.3 s input grace. |
| URL hooks | Keep `?loop=`, add `?level=N` | Retire `loop`, add `?fixture=draft\|swarm\|warden`, remap legacy `segment` | **Sol.** Better for capture and tests. |
| Milestones | Six larger steps; first slice is a full 10:00 run; view bonuses after the full arsenal | Eleven smaller steps; 2–3 min Reach slice first; prove three-view tactics before more weapons or arena | **Sol.** The view risk has to be tested early. |
| Autoplay views | TOP on gem clusters, CHASE when low, COCKPIT on elites / Warden | Safe-gap pilot, salvage return, Warden line-up, deterministic drafts | **Both.** Sol locomotion and draft rules, plus agy’s view policy. |
| Altitude bands | Explicit low/mid/high (65/105/145) and co-planar falloff | Bands around 75/110/145 and world-space altitude checks | **Both.** Sol’s terrain-contract warning, agy’s clear falloff so climb/dive stay mandatory. |

Shared agreements used as-is: auto-fire, one life, keep boost and bombs,
keep the fighter cockpit and all three views, keep Warden / rank / radio
/ EN-KO / seeded capture hooks, no meta shop, no audio in this pass, and
the same headline risk (forward views becoming unusable in a swarm).
