# ASTER WING bot worklog

Shared log for the bots working on this repo, so each one knows what the other did.
Owner: 홍기현. Current bots: **비행기게임봇** (Grok Bot) and **데븐 봇**.

## Rules for every bot
1. Before you start: `git fetch`, read the top of this file, and check which branch and commit the other bot last touched.
2. After every piece of work, add an entry at the top of **Log** (newest first) in the same commit or right after it.
3. Each entry: date (KST), bot name, branch, commit hashes, what changed (1-3 lines), verification (tests/build/sim), and state (done / in progress / blocked / needs 기현님).
4. Say "in progress" when you claim an area, so the other bot doesn't touch the same files at the same time.
5. Never push to `main` without 기현님's OK (main auto-deploys to GitHub Pages). Never force-push or rewrite pushed history. Never commit `ref/frames` or `ref/clips`.
6. Keep determinism: render-only changes must keep replay hashes identical; gameplay changes update golden hashes on purpose and re-run `npm run sim -- --profile skilled|average|weak --seeds 100`.

## Current state
- [한국어 위키](wiki/README.md): 공개판·개발판·실험을 구분하는 진입점. 아래 수치와 작업 번호는 각 기준 커밋 당시 기록이며, 계획 작업 #7(스웜)은 GitHub PR #7(Ace 회피)과 다르다.
- 다음 기능(설계만 완료): P0 무기 자체의 강점과 약점 → P1 타격음·상자 잭팟·탄 궤적 → P2 패배 후 격납고 강화·일반 무기 풀 확장. [담당별 인수 기준](SURVIVORS_PLAN.md#pillars). 기존 #1·2·4·8 검증은 병행하며 세 기능의 체감·수치는 아직 측정하지 않음.
- Historical candidate code baseline: `renderer-proto` `0bc1f99` includes weapon Lv7 (`7446be4`), damage/mass-kill feedback (`e46b813`), horde (`8f41122`), Armored/Sting variants (`82c19c6`), and swarm events/recovery magnet (`77163bc`). The current continuous-flight candidate is isolated on `devin/1795524980-continuous-flight-10min` from `09e2890`; public `main` is unchanged.
- #7 is implemented and integrated by `0bc1f99`; timing, event geometry, and magnet rules are documented in both plans. On the combined tree based on this code, `npm test` passed 567/567 and `npm run build` passed (119 modules, 1.45 s). Actual 200/120-cap PC/phone FPS remains unverified.
- Pre-variant baseline only: integrated candidate `9d677b5` (ancestor of `8f41122`) at desktop Heat 0, seeds 1–100/profile; skilled / average / weak clear **100%/75%/26%**, Ace kills **99%/72%/2%**, median kills **3,677.5/3,591/3,373.5**, median peak Gnats **200** each. The pre-variant average median kills **3,591** was **91 above** the 3,500 upper planning target; these are not `0bc1f99` results.
- Historical feature-branch results: `82c19c6` variant run and `77163bc` swarm run are separately scoped in the log below, not reruns on integrated `0bc1f99`. The `77163bc` desktop Heat 0, 100-seed average median kills were **3,167.5**, within 2,500–3,500; this does not establish phase density or whole survival acceptance.
- The damage-feedback fixture measured **36.44 fps** in a SwiftShader VM after High→Low fallback; this software-renderer sample is not current hardware/device performance. The 100-seed simulations do not measure rendered FPS or phase density.
- Supplied feature-branch recordings document both variants and the #7 ring/V/orb-sweep demo; neither recording is integrated-snapshot validation or personally watched for this update. The all-weapon Lv2–7 screenshot acceptance remains unverified.
- Stage C and its pursuit follow-up are merged; the latest integrated pilot pursuit result is in `docs/BALANCE_NOTES.md`. Current plan order: #5 damage/mass-kill feedback merged; #6 Armored/Sting Gnat merged; #7 swarm event/recovery magnet merged.

## Log

### 2026-11-25 KST · 데븐 봇 · `devin/1795524980-continuous-flight-10min` (merge `33d640b`; Crosswing `6e53793`)
- Merged PR #12 minute waves/new enemies into the continuous-flight candidate while preserving PR #10/#16 touch cues, altitude-independent Magnet Core capture, midboss magnet payout, and continuous ceilings. Removed duplicate recovery-banner logic and refreshed only the Survivors replay golden (`fcc2e805…`); Legacy remains unchanged.
- Crosswing attack runs now leave render-only smoke derived from their planned start/crossing path, so the X remains readable without depending on frame history; the crosswing fixture spawns the intended pair.
- Verification so far: `npm run build` passed; focused replay 2/2; sortie-bosses 18/18; attack-trail/crosswing/new-enemy focused tests 17/17. Full suite and final browser evidence pending.
- State: integration candidate in progress; no `main` change or public deployment.

### 2026-11-25 KST · 데븐 봇 · `devin/1795524980-continuous-flight-10min` (merged PR #10 `870c3a1`; `950de04`)
- Kept the PR #16 shared touch-cue implementation (it already carries PR #10's dive-cue fixes) and merged PR #10 for history; `renderer-proto` conflicts were resolved in `091706f` with midboss magnets rolled once from the settle hook. The touch dive cue now also reads Stingray pass warnings (`manta.passEnd`), which previously showed `DIVE PASS` text without an arrow.
- Verification: `npm test` 762/762 on the conflict merge; touch-cue tests 19/19 and `npm run build` after `950de04`. Browser at 390×844/844×390 on `3eb82e3`: Diver + Aegis cues separate, unclipped, clear of ship/hostile fire; render Z = −sim Z with matching forward/rear. Unassisted Twin X crossing was not readable in sampled Top-view frames; natural simultaneous cues not observed.
- State: comparison candidate only; no final acceptance, no `main`/`renderer-proto`/Pages change.


### 2026-11-25 KST · 데븐 봇 · `devin/1795524980-continuous-flight-10min` (merge `091706f`; PR #11 `d21455a`)
- Merged the renderer-proto timed pickup/magnet integration into the continuous-flight candidate. Resolution keeps one midboss magnet roll in `settleSortieMiniboss`, adds non-carrier elite rolls outside boss leaders, and preserves altitude-independent Magnet Core outer-radius capture plus the expanded Survivors Ace ceiling.
- Verification after resolution: focused pickup/miniboss/replay suite passed 88/88; replay golden `a43beef8…` still matched with Legacy unchanged; `npm run build` passed (132 modules, 2.24s; nonfatal chunk advisory). Full suite and browser evidence are pending.
- State: merged and pushed on PR #13's branch; no `main` change or public deployment.


### 2026-11-25 KST · 데븐 봇 · `devin/1795524980-continuous-flight-10min` (`f01bc45`; base `dcca4ff`)
- Finished the continuous-flight integration review items: Magnet Core's expanded planar radius no longer has a separate altitude gate, non-carrier elite kills can roll magnet drops, phase-director degree bearings are converted before spawning, and Survivors Ace reengagement uses the expanded flight ceiling so high-altitude frontal firing lines are reachable. Mobile Aegis slots now fall back to compact widths, and dive occlusion checks continue past visible warnings until a covered warning is found.
- Verification: focused integration tests passed 83/83; replay hash regression passed 2/2 with only the intentional Survivors golden refreshed (`a43beef8…`) and Legacy unchanged; `npm run build` passed (132 modules, 2.63s; nonfatal chunk-size advisory). A full `npm test` rerun is in progress; browser/device evidence remains pending.
- State: implementation complete locally on the PR #13 integration branch; no `main` change or public deployment.


### 2026-11-25 KST · 데븐 봇 · `devin/1795538065-pr15-mobile-followup` (base `eed2087`; `f99d20d`, `e815833`, `b27c7e2`, `27f950c`, `5e8b123`, `0bf4b46`, `e8fb690`, `920b92c`, `a16ced3`, `e6cc023`, `48d4c71`, `4190f32`)
- Cherry-picked PR #15 follow-ups onto the current continuous-flight base containing merged PR #15; verified the radial `radius ± halfWidth` and vertical `alt ± halfWidth` collision semantics are unchanged. Shared mobile cues now account for the full touch-panel backdrop, real controls, and distinct edge-derived Aegis/dive slots; the Aegis cue uses the overhead render plane, and the dive cue follows active descent with a cockpit fallback.
- Verification: focused layout/Aegis tests passed 70/70; `npm run build` passed (132 modules, 2.27 s; nonfatal chunk-size advisory). No browser/device validation was performed.
- State: this new branch isolates the follow-up for review; the merged PR #15 branch remains at `61211d3` from the earlier push, and PR #10 remains at `870c3a1`.


### 2026-11-25 KST · 데븐 봇 · `devin/1795524980-continuous-flight-10min` (PR #14 tip `5ae6c27e0194dc404ad76c5e870afbfe37c02e5b`)
- Integrated the updated boss reapproach, carrier return, and Twin collision fixes while retaining the candidate's `{x,z,alt}` flight envelope and shared `SORTIE_BOSS_HIT_RADIUS` collision for ordinary and piercing shots. Collection integration now preserves cross-altitude baseline planar capture while Magnet Core's expanded radius remains altitude-gated; refreshed only the Survivors replay hash (`be8fcd6d…`), leaving Legacy unchanged.
- Verification: focused boss/replay 19/19; pickup/loadout/stage/VFX/replay 58/58; `npm run build` passed (132 modules, 1.79s; nonfatal chunk advisory); `npm test` 753/753. Mobile moving-screen review and balance/outcome measurement remain pending; no final acceptance claimed.


### 2026-11-25 (KST) - Devin bot - devin/1795534997-pr10-mobile-safe-cues (523f801, 6e628ba, 103cdcf, 0e13095, 39da42b, 1b22743; reviewed base 26a774b)
- Dive cue state is independent of HUD message selection, falls back to the cockpit aiming reference behind the camera, and detects the full physical touch backdrop. Shared placement accounts for audio/mute and all controls, searches obstacle edges, and reserves separate Aegis/threat slots.
- A 1 CSS-pixel clearance lets 160x44 and 48x40 slots fit at 360x844 without overlap. Focused tests passed 61/61; build passed (122 modules, 2.87s; nonfatal chunk-size advisory). State: locally verified, push pending; visual/device QA delegated.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795534997-pr10-mobile-safe-cues (`571d1b2`, `7a6adb5`; based on PR #10 `fa45f64`)
- Added a direction-only cue to the unused safe touch-panel area when the live dive warning's projected target is covered; the world target ring and gameplay verdict remain unchanged.
- Mobile layout/helper tests passed 57/57; build passed (122 modules, 2.64s; nonfatal chunk-size advisory). State: PR #10 visual QA pending.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795534997-pr10-mobile-safe-cues (`571d1b2`; based on PR #10 `fa45f64`)
- Added shared touch-safe cue placement and screen-direction helpers with 390×844 / 844×390 regression coverage; PR #10 and #15 UI wiring remains in progress.
- Mobile layout tests passed 57/57 and build passed (122 modules, 2.64s). State: in progress.


### 2026-11-25 (KST) · 데븐 봇 · `devin/1795531296-aegis-volume-pr13` (`fab05d1`, `8c85070`; base `b1fa90a`)
- Cherry-picked the shared touch-safe cue helper from PR #10. Added a compact mobile Aegis cue in a free control-panel slot only when projected world-boundary samples are off-screen or obscured by HUD, controls, or aircraft; inner/outer and upper/lower labels derive from the existing Aegis bounds. Collision, camera, and gameplay remain unchanged.
- Verification: focused Aegis/layout tests 61/61; `npm run build` passed (124 modules, 2.31 s; nonfatal chunk-size advisory). Latest continuous-flight base `b1fa90a` is already an ancestor and retains the same `radius ± halfWidth` / `player.alt ± halfWidth` verdict semantics. Mobile visual QA remains delegated.
- State: implementation complete; no public deployment.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795525221-selected-sortie-vfx (`027fdb5`, `6c069b0`; based on `1ef2fd9`)
- Restored ion wake continuity by connecting each live sample to its previous sample in the same normalized lane (including lane 0's omitted index). Dive-warning masks now use the scene's clipped segment projection, retaining visible corridors for offscreen targets and camera-plane crossings; added regressions for both cases.
- Regression repros against `1ef2fd9` failed 2/2; the focused VFX suite then passed 23/23. Build passed (121 modules, 2.18s); `git diff --check` was clean. Build preceded a test-only camera-fixture adjustment; production sources were unchanged afterward.
- State: two scoped fixes are verified and committed on the candidate branch; no gameplay changes, CI wait, merge, or visual review.


### 2026-11-24 23:25 KST · 데븐 봇 · devin/1795525221-selected-sortie-vfx (`8660bad`, `f53b12d`, `9132b3c`, `1076849`, `f2499f7`; based on `2437b8c`)
- Fixed five review regressions in separate commits: bomber formation IDs, authoritative Ace weapon IDs, lane-safe ion wakes, target-altitude dive masks, and camera-clipped rail/arc segments. Added focused regressions without changing gameplay state.
- Focused VFX suite passed 22/22; build passed (121 modules, 3.58s); `git diff --check` was clean. Initial PR #10 CI snapshot: 0 passed, 0 failed, 1 pending (`Devin Review`); no post-fix CI result yet.
- State: scoped fixes and this entry are complete on the candidate branch; no merge or public deployment. Visual/mobile comparison and physical-device verification remain unverified.


### 2026-11-24 22:43 KST · 데븐 봇 · devin/1795525221-selected-sortie-vfx (based on 09e2890)
- Corrected the VFX review gaps: only damage observers create H cues, fire accents and live trails use actual projectile positions, formation grouping stays open through its tick window, reduced motion suppresses optional movement, hazard masking protects bullets/dive corridors/boss silhouette, and terminal D04 advances after simulation stops.
- Added focused regression coverage; `node --experimental-strip-types --test tests/sortie-vfx.test.mjs` passed 17/17 and `npm run build` passed (121 modules, 2.21s).
- State: fixes complete on this branch; no commit, push, PR, or visual comparison.


### 2026-11-24 22:25 KST · 데븐 봇 · devin/1795525221-selected-sortie-vfx (based on 09e2890)
- Implemented the selected W01–W10 fire/hit and D01–D04 defeat visuals in a bounded render-only overlay, with authoritative outcome observers, pickup adapters, and density-based readability reductions.
- Added route, anchor, pool/cleanup, pickup-event, Ace-verdict, boss-silhouette, and replay-invariance coverage. npm test passed 637/637; npm run build passed (121 modules, 2.88s).
- State: done on this branch; no commit, push, PR, or visual comparison.


### 2026-11-25 00:02 KST · 데븐 봇 · devin/1795531296-aegis-volume-pr13 (기준 `ae1b94c`, commit `b71acc7`)
- Matched the renderer to PR #13's continuous-flight verdict: radial bounds `radius ± halfWidth` and altitude bounds `player.alt ± halfWidth`; added transparent boundary rings and supports without changing collision or simulation state.
- Verification: focused Aegis geometry test 1/1; `npm run build` (122 modules, 2.03s); oblique chase preview in `/home/ubuntu/screenshots/ss_d9da52db.png` and `/home/ubuntu/screenshots/ss_zoom_a8b87832.png`. State: in progress pending remote push and PR10 compatibility review.
- PR #10 compatibility review: not cherry-picked to its remote branch (`fa45f64`) because its Aegis verdict uses `hitWindow(state)` vertically, while PR #13's continuous-run verdict uses `player.alt ± halfWidth`; rendering the PR #13 outline there would misstate the judged bounds. No separate PR was opened pending approval.
- State: done on the pushed PR #13-derived renderer branch (`c742880`); collision, balance, and simulation remain unchanged.


### 2026-11-25 00:30 KST · 데븐 봇 · devin/1795531296-aegis-volume-pr13 (merge `aee37b8`, source `2a4d915`, base `b1fa90a`)
- Merged the continuous-flight base into the Aegis renderer; resolved the sole `docs/WORKLOG.md` conflict additively, retaining both sides' entries. Aegis activation and `radius ± halfWidth` / `player.alt ± halfWidth` verdict semantics are unchanged.
- Verification: `npm test` 648/648; `npm run build` passed (123 modules, 2.15 s). State: done.


### 2026-11-25 00:17 KST · 데븐 봇 · candidate validation follow-up
- The first full run found the intentional Survivors seeker behavior change no longer matched its previous seed-1 terminal hash. Reproduced both fidelity-rendering settings: both clear with identical hash `f0b5e5c44f5033d6edf2a94249970287cabe1d0b81635ec0d4ee5c3688ee569d`; refreshed only the Survivors hash. The Legacy golden remains unchanged and passed.
- Fixed the strict TypeScript optional seeker-velocity input; rebuilt the generated bundle and verified the new EN/KO quest copy is present with obsolete copy absent.
- Final verification: `npm test` passed 646/646; `npm run build` passed with 121 modules (`3.44s`).


### 2026-11-25 00:14 KST · 데븐 봇 · devin/1795531296-aegis-volume-pr13 (commit `54a2fd8`)
- Replaced scaled unit Aegis toruses with inner/outer TorusGeometry at the actual judged radii and a fixed 0.15 world-unit tube radius; renderer outline data is precomputed once.
- Verification: focused geometry suite 2/2, including rendered TorusGeometry bounds at both radii; `npm run build` (123 modules, 2.16s); `git diff --check` clean. State: done.


### 2026-11-25 00:08 KST · 데븐 봇 · review finding 0005
- Reproduced the pursuit failure with an elevated target 30 m above the player moving laterally at 40 units/s: the prior seeker lost the target at tick 28 with altitude still about 15 m short, then stopped climbing when it nulled vertical velocity.
- Survivors seekers now turn a 3D direction within the configured turn rate, cap vertical speed, account for the time needed to climb when choosing the lead point/horizontal speed, and retain their current trajectory when capture is lost. Legacy steering remains unchanged.
- Updated the vertical-flight regression to check the bounded 3D trajectory and added the receding-target intercept regression. Verification: the two targeted seeker tests passed 2/2.


### 2026-11-25 00:04 KST · 데븐 봇 · review finding 0004
- Reproduced both paths with receding elevated Survivors targets: Twin fired at altitude +35 while a target receded at 240 units/s and missed; Pods fired at altitude +35 while a target receded at 180 units/s and missed. The shots used current-range lead for their horizontal aim/vertical component rather than solving the moving 3D intercept.
- Twin Cannon and Wing Pods now solve a positive 3D intercept time and align horizontal and vertical projectile velocity to the same future point. Legacy aim behavior is unchanged.
- Verification: `node --test tests/friendly-intercept.test.mjs` passed 2/2; existing Twin Cannon and Wing Pods cases in `tests/loadout.test.mjs` passed 2/2.


### 2026-11-25 00:02 KST · 데븐 봇 · review finding 0003
- Reproduced level-five drone target acquisition across altitude: three bolts spawned at altitudes 110/120/130 toward a target 45 m above the player, but all had `vy=0` and the target remained at 100 HP after 90 ticks.
- Survivors drone bolts now use a normalized 3D direction to the acquired target; Legacy keeps its horizontal shot path.
- Verification: `node --test tests/drone-aim.test.mjs` passed 1/1; the existing level-five drone case in `tests/loadout.test.mjs` passed 1/1.


### 2026-11-25 00:02 KST · 데븐 봇 · devin/1795531296-aegis-volume-pr13 (기준 `ae1b94c`, commit `b71acc7`)
- Matched the renderer to PR #13's continuous-flight verdict: radial bounds `radius ± halfWidth` and altitude bounds `player.alt ± halfWidth`; added transparent boundary rings and supports without changing collision or simulation state.
- Verification: focused Aegis geometry test 1/1; `npm run build` (122 modules, 2.03s); oblique chase preview in `/home/ubuntu/screenshots/ss_d9da52db.png` and `/home/ubuntu/screenshots/ss_zoom_a8b87832.png`. State: in progress pending remote push and PR10 compatibility review.
- PR #10 compatibility review: not cherry-picked to its remote branch (`fa45f64`) because its Aegis verdict uses `hitWindow(state)` vertically, while PR #13's continuous-run verdict uses `player.alt ± halfWidth`; rendering the PR #13 outline there would misstate the judged bounds. No separate PR was opened pending approval.
- State: done on the pushed PR #13-derived renderer branch (`c742880`); collision, balance, and simulation remain unchanged.


### 2026-11-24 23:59 KST · 데븐 봇 · review finding 0002
- Reproduced with a Survivors state at the first Bill offer (tick 3600): weak bot seed 1 caused `state.bills.active` to become `null`; at the deadline `finishBillTick` returned `null`, interest stayed false, and XP scaling stayed 1. Weak seed 9 handled the Bill and correctly produced an unpaid expiry with interest and 0.75 XP scale, confirming the failure was on the ignored-Bill input path.
- `perceive` returns the original state for Survivors, so assigning the hidden-Bill view to it mutated simulation state. The bot now gets a shallow observation copy with a hidden Bill; Legacy retains its existing band-filtered perception.
- Verification: `node --test tests/bot-bills.test.mjs tests/bot-sim.test.mjs` passed 11/11.


### 2026-11-24 23:56 KST · 데븐 봇 · review finding 0001
- Reproduced Prism Lance on a Survivors state with the evolution equipped: `advanceRangedWeapons` emitted one beam from `{x:0,z:0,alt:125}` to `{x:0,z:562.5,alt:125}`. The old rail test asserted that one-beam behavior.
- Survivors Prism Lance now emits three terrain-clipped rays with distinct horizontal and vertical directions. Legacy's altitude-lane behavior remains unchanged; the regression test verifies the three charge/beam paths and clipping.
- Verification: `node --test --test-name-pattern='Prism Lance' tests/ranged-evolutions.test.mjs` passed 1/1.


### 2026-11-24 23:53 KST · 데븐 봇 · devin/1795524980-continuous-flight-10min (이전 후보 `ae1b94c`)
- Updated the Hangar unlock display name to Focus Lens in English and 초점 렌즈 in Korean. Replaced obsolete band labels with the actual cumulative conditions: 3 kills at a player/target height difference of at least 15 m across sorties, and 3 kills within 5 seconds spanning at least 30 m. The existing metric rules and kill recording already match those conditions.
- `src/i18n.ts` is the only checked-in locale source; the old generated `dist` bundle contained stale copy, and the Vite build regenerated it with the new strings and no stale phrases. The existing Galmuri11 subset covers all 33 distinct Hangul syllables in the changed Korean text; no font file change was needed.
- Verification: `node --test tests/i18n.test.mjs tests/loadout.test.mjs` passed 30/30; `npm run build` passed (121 modules, 1.85 s). The PR review fixes are being investigated separately before the candidate is pushed.


### 2026-11-25 00:14 KST · 데븐 봇 · devin/1795531296-aegis-volume-pr13 (commit `54a2fd8`)
- Replaced scaled unit Aegis toruses with inner/outer TorusGeometry at the actual judged radii and a fixed 0.15 world-unit tube radius; renderer outline data is precomputed once.
- Verification: focused geometry suite 2/2, including rendered TorusGeometry bounds at both radii; `npm run build` (123 modules, 2.16s); `git diff --check` clean. State: done.


### 2026-11-25 00:02 KST · 데븐 봇 · devin/1795531296-aegis-volume-pr13 (기준 `ae1b94c`, commit `b71acc7`)
- Matched the renderer to PR #13's continuous-flight verdict: radial bounds `radius ± halfWidth` and altitude bounds `player.alt ± halfWidth`; added transparent boundary rings and supports without changing collision or simulation state.
- Verification: focused Aegis geometry test 1/1; `npm run build` (122 modules, 2.03s); oblique chase preview in `/home/ubuntu/screenshots/ss_d9da52db.png` and `/home/ubuntu/screenshots/ss_zoom_a8b87832.png`. State: in progress pending remote push and PR10 compatibility review.
- PR #10 compatibility review: not cherry-picked to its remote branch (`fa45f64`) because its Aegis verdict uses `hitWindow(state)` vertically, while PR #13's continuous-run verdict uses `player.alt ± halfWidth`; rendering the PR #13 outline there would misstate the judged bounds. No separate PR was opened pending approval.
- State: done on the pushed PR #13-derived renderer branch (`c742880`); collision, balance, and simulation remain unchanged.


### 2026-11-24 23:37 KST · 데븐 봇 · devin/1795524980-continuous-flight-10min (기준 `09e2890`)
- Isolated the Legacy replay against detached `09e2890`: the first serialized-state difference at tick 0 was only the progress-metric schema (`multibandWithinFive`/`bandsKilled` vs `heightSpreadWithinFive`/`verticalKills`). Removing profile/daily/run metrics from the behavioral projection produced identical seed-1 simulation state through tick 6770/`clear` on both trees. Added mode-scoped Legacy metric creation/normalization; the Legacy golden is unchanged.
- Closed the rail endpoint, retained/Ace seeker range+cone, and terrain refresh/rise findings. Aegis now uses a bounded annular cylinder rather than a spherical shell; `scene.ts` still renders the flat `RingGeometry`. An exact-plane trial made seed 2026 lose at tick 30344 after Pods/Aegis was selected at 15784 and evolved at 24255, so the cylinder version was restored; VFX owner alignment of the vertical half-width remains needed.
- Verification: build passed (121 modules, 1.71 s); seed-2026 replay passed 1/1 and both replay-hash tests passed 2/2 after restoring the cylinder. Full `npm test` passed 640/640 on that same cylinder implementation before the planar trial; the planar trial failed those two cases and was reverted, so the full suite was not rerun after the exact revert. `git diff --check` is clean.
- State: candidate implementation is complete; Aegis visual-depth coordination remains a VFX-owner integration item. Browser/UI verification remains delegated.


### 2026-11-24 22:16 KST · 데븐 봇 · devin/1795524980-continuous-flight-10min (기준 `09e2890`)
- Migrated Survivors flight bounds, arena scale, terrain-relative start, maneuver exits, aim and weapon/hazard collision to continuous 3D while retaining Legacy branches. Added a player-to-spatial-point adapter and updated the altitude marker, rear-maneuver cue, and bot/autoplay paths to use the expanded space.
- Replaced altitude-layer Bills/unlock metrics, added profile/checkpoint v1 progress migration, and localized the new forward-kill/any-altitude Bill labels. Formation, collection, Ace behavior and VFX remain owner boundaries; no duplicate pickup/event logic was added.
- Verification: `npm run build` passed; full `npm test` ran 637 tests (636 pass, 1 fail: Legacy replay hash expected `1ba96a2d9956f3bcb8c10a6ccf51a4db02e523d41d6132b8fa2f4658a12942d5`, got `48bb808883d23acffac0eee329792c70`); `git diff --check` passed. Simulation and visual/browser validation remain pending.
- State: in progress; Legacy replay mismatch is unresolved; no commit or push. Collection/VFX PR #10/#11 remain unintegrated pending validated owner tips.


### 2026-11-24 21:56 KST · 데븐 봇 · devin/1795524980-continuous-flight-10min (기준 `09e2890`)
- Added pure continuous-space helpers in `src/spatial.ts` and focused coverage in `tests/spatial.test.mjs`; exports are `SpatialPoint`, `SpatialVector`, `playerSpatialPoint`, `add3d`, `subtract3d`, `scale3d`, `dot3d`, `lengthSquared3d`, `distanceSquared3d`, `distance3d`, `normalize3d`, `direction3d`, `pointSegmentDistanceSquared3d`, `segmentSphereIntersection3d`, and `spheresOverlap3d`.
- Read `physics-tuning`, the open-game shared contract, and `projectile-hitscan`. Simulation keeps `{x,z,alt}`; VFX uses the existing Z inversion only at its renderer boundary. Keep pickup/drop events and magnet collection under their owner; high-recovery progress will count settled pickups only.
- State: in progress; tests/build not run yet; no commit or push.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795524682-minute-waves-enemies (independent candidate based on `09e2890`)
- Review fixes: deterministic isolated introductions and 6:00–9:00 cleanup; only Crosswing pairs; continuous-altitude Manta; delayed/interrupted 3D Mender repair with dotted tether; reservation-first Diver; danger-interval threat budgets; increasing elite Aegis share/volley without changing Gnat HP.
- Delivery fixes: Manta captures player height, warns on a frozen 3D crossing, and exits horizontally at that altitude. Intro isolation cancels other tells/volleys, removes prior intro types, and retains an intro actor until its first accepted attack. Minute-six Crosswing/Twin Chaser warnings share a serialized slot even when threat reservation is delayed. Repair-only compatibility remains 2 hull at 105/225/345/465 seconds; those ticks no longer create phase spawn lulls or lull announcements.
- Replay terminal hashes were rebaselined for the intentional phase-spawn cadence change; the existing fidelity-on/off parity checks remain in the suite.
- Midboss call order: after the fixed tick advances and before regular spawns, the external owner polls `consumeMidbossCue(state)`; on a cue it starts the encounter, then calls `finishMidbossEncounter(state, {id, endedAt, outcome})` exactly once on the actual terminal tick. The owner checks `midbossSpawnsBlocked(state)` while the 15-second post-result rest runs. Threat callers pass `activeFromTick`/`activeUntilTick` for their tell and danger span; the API default covers the 3.75-second bolt lifetime. No carrier/reward path was changed.
- Red Kite is the Ace: first encounter remains 8:00 and its reengagement intensifies at 9:00; there is no boss-timing conflict.
- Verification: focused regressions 41/41; `npm test` 647/647; `npm run build` `✓ 124 modules transformed.` / `✓ built in 3.01s` (non-blocking >500 kB chunk advisory); `git diff --check` clean.
- Renderer visuals/screenshots, balance simulation, external cue consumption, and balance-bot handoff remain unverified. No merge or deployment.


### 2026-11-25 00:02 KST · 데븐 봇 · devin/1795525052-timed-pickup-magnet
- `85d3ebfc40fd280998568d3e44754666b641744e`: Survivors still retains the recovery state used to hold wave-spawn gating, but the HUD hides its inactive `RECOVERY · GLOBAL MAGNET` label; Legacy notice handling and translations remain available.
- Renderer cadence now follows `pendingFinish.settlementTick` and marks the scene dirty as settlement advances, then returns to the unchanged terminal `state.tick` after finish. This addresses the supplied trace where pickup samples progressed while rendered frames remained gated by the frozen stage clock.
- Added HUD-mode and render-cadence regressions; kept the Legacy recovery helper path covered. Verification: `npm test` passed 642/642; `npm run build` passed (122 modules); `git diff --check` passed. No fixture/server setup changed; no UI test or CI wait was run.


### 2026-11-24 23:36 KST · 데븐 봇 · devin/1795525052-timed-pickup-magnet
- `190d177db9ecf4bb9fd08786725d77c292ad7d9e`: Terminal capture settlement now handles pause/unpause before advancing. A blur/visibility pause one tick before arrival no longer pays or finalizes outside the normal frame path, where the profile is persisted.
- Added a regression covering the pause-only call, remaining paused, resume, and later physical arrival; no enemy or spawn behavior changes.
- Verification: `node --test tests/stage.test.mjs` passed 31/31; `npm run build` passed (120 modules); `git diff --check` passed. The PR `git_pr_checks` wait was canceled after 156 seconds without a result while the pause finding was handed off, so final CI status remains unknown. No UI tests or visual verification; no public deployment. State: candidate-only fix committed, push pending.


### 2026-11-24 23:29 KST · 데븐 봇 · devin/1795525052-timed-pickup-magnet
- `fef070aa13e7b35cdcd13cbade4953b9505c7a91`: Captured Survivors salvage advances during Ace defeat and through bounded capture-only terminal settlement; rewards pay at hull arrival while stage tick, outcome, and summary seconds stay at terminal time. Settlement does not simulate enemies or spawns, and captured pickups bypass terminal draft blocking.
- `90ead934e69ce533ff410820e58ceaeb95d3fed1`: Collector Swarm's initial duration derives from existing drone distance, pickup range, and pull speed (minimum one tick, capped to ordinary capture); captured deadlines remain immutable, with no range or damage retune.
- Verification: `npm test` passed 638/638; `npm run build` passed (120 modules); `git diff --check` passed. Updated the Survivors replay golden for the intentional settlement change; the legacy replay assertion remains unchanged. No UI tests or visual verification; PR #11 CI pending. State: candidate-only fixes complete, no public deployment.


### 2026-11-24 22:35 KST · 데븐 봇 · devin/1795525052-timed-pickup-magnet
- Applied §3 review fixes for Survivors captures: global magnet now snapshots eligible salvage into fixed-deadline curved arrivals, rewards only at hull arrival, ordinary contact checks 3D distance, drone collection requests capture, and trails appear only in the final segment. Legacy recovery and pickup handling were separated where practical; public `main` is untouched.
- Restored exact legacy pull/contact ordering and salvage object key order (the changed key order altered replay hashes despite identical field values); retained legacy drone altitude gating and trail lengths. Survivor timed captures remain run-scoped.
- Verification: `npm test` passed 634/634; `npm run build` passed (120 modules); `git diff --check` passed. Candidate was committed and pushed as `309e649` before the PR review; no public deployment.


### 2026-11-24 22:01 KST · 데븐 봇 · devin/1795525052-timed-pickup-magnet (based on `09e2890`)
- Implemented approved pickup §3 on the independent candidate: altitude-independent timed salvage, direct magnet drops and collection; public `main` remains untouched.
- Verification: `npm test` (632 passed) and `npm run build` passed. The configurable 5% drop chance is a balance-review candidate, not final; the baseline has no midboss defeat hook, so `dropMagnet` is available to its future owner.
- Candidate is uncommitted/unpushed; no public deployment.


### 2026-11-25 01:12 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review dive Twin collision fix; 26016f1)
- Reproduced the ordinary non-piercing dive Twin hull-edge miss before the fix. Ordinary dive segments now use the shared 3D sortie-boss contact helper; the piercing path bypasses the narrow strafe-band prefilter for dedicated bosses, keeping both paths on the same hull.
- The targeted ordinary/piercing dive regression passed 1/1; final focused tests passed 40/40, `npm test` 653/653, and `npm run build` passed (122 modules, 4.54s; Vite chunk-size advisory). No HP/firepower changes or balance sweep. Root fixes are separate commits `75f977a` and `26016f1`; push pending.


### 2026-11-25 01:12 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review boundary fix; 75f977a)
- Reproduced outside-to-inside arena projections (miniboss actor 343.299 units, Ace 107 units). Re-entry tests now assert under-10-unit movement for the miniboss, both escorts and Ace; natural in-arena bounds remain covered. Ace tests explicitly distinguish predicted Twin geometry windows from actual fire ticks, projectiles and hits.
- Combined follow-up tree verification: focused Ace/miniboss/strafe/replay tests 40/40; `npm test` 653/653; `npm run build` passed (122 modules, 4.54s; Vite chunk-size advisory); `git diff --check` clean. HP/firepower unchanged; no balance sweep. Boundary fix is committed; the separate dive Twin collision fix and follow-up push are pending.


### 2026-11-25 00:27 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (replay golden follow-up; f884192)
- The full suite exposed one Survivors replay-hash mismatch after the reviewed transport/collision changes (`c22dfa...` → `52ac4c...`); updated only the gameplay golden, with the legacy hash retained. Focused `tests/s7f-replay.test.mjs` passed 2/2; final `npm test` passed 649/649.
- `npm run build` passed (122 modules, 4.43s; Vite reported its >500 kB chunk advisory); source did not change after that build. `git diff --check` is clean. No balance simulation or visual/UI check. All fixes are local; push and CI verification pending.


### 2026-11-25 00:26 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review fix 0005; 4b1b5ec)
- `advancePiercingShot` used the ordinary 6-unit hit radius while non-piercing miniboss shots used the 3D sortie-boss sphere. A shared contact helper now applies the same sphere in both paths and bypasses the smaller altitude prefilter for dedicated bosses.
- Changed the existing ordinary-shot test and added a piercing Twin edge-hit regression at a 10-unit offset; `tests/sortie-bosses.test.mjs` passed 14/14 and `git diff --check` is clean. No balance values changed.


### 2026-11-25 00:24 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review fix 0004; 8259201)
- Replayed seed 1 through the 205s cue with `autopilotInput`, then held the natural player course straight without moving the actor; baseline entered a `line` state at 214s but sustained actual Twin range/cone/same-altitude geometry for only 110 ticks, not 3 seconds. The UI note's “no line” state-label detail was not reproduced; the firing opportunity gap was.
- Transport turn now steers to a player-local forward rejoin point and enters `line` only when Twin range/cone/altitude geometry is valid. `tests/sortie-bosses.test.mjs` passed 13/13, including the natural seed-1 flight; `git diff --check` is clean. HP/firepower unchanged.


### 2026-11-25 00:22 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review fix 0003; eab27c6)
- Reproduced seed 1 at the 205s cue with the pilot outside (x=2393, edge=1792): the transport spawned clipped near x=1653, 765 units from the pilot. `arenaPosition` now preserves player-local coordinates outside the arena and retains the existing in-arena clamp.
- Added an external-pilot spawn regression; `tests/sortie-bosses.test.mjs` passed 12/12 and `git diff --check` was clean. No balance values changed; finding 0004 remained in progress.


### 2026-11-25 00:20 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review fix 0002; 406c2bd)
- Reproduced an outside-arena pilot (x=2392, arena edge=1792): after ten seconds of approach Ace remained at x=1761 with 631-unit separation because the rejoin target was clamped back inside. Approach now clamps only while the pilot is in-arena; existing in-arena bound coverage is retained.
- Added the external-pilot regression; Ace/reengagement/checkpoint regressions passed 50/50 and `git diff --check` was clean. No balance values changed; findings 0004–0005 remained in progress.


### 2026-11-25 00:18 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (review fix 0001; 866deba)
- Reproduced a far transport receiving a generic fly-in entry after 156 far ticks; `advanceEnemies` skipped the sortieBoss entry for 240 ticks and `hurtEnemy` left HP unchanged. `relocateStragglers` now skips dedicated sortie-boss actors.
- Added a regression asserting far-actor recycling cannot leave the boss invulnerable; `tests/sortie-bosses.test.mjs` passed 11/11 and `git diff --check` was clean. No balance values changed; remaining review findings are still in progress.


### 2026-11-25 00:05 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (based on `09e2890`; implementation commit `587683981def20f8554a2aa9df0a7321de35c581`)
- Tightened Ace acceptance from natural 8:00 spawn: a real player twin trajectory reaches the Ace hull within five seconds, four first-minute windows sustain at least three seconds, and 9:00+ cadence is observed. The probe uses live range/cone/muzzle/lead/bolt-life/hull geometry on a forecast clone without damage or actor relocation; trimmed unused spatial exports while retaining used helper signatures.
- Verification: Ace reengagement 6/6; `npm test` 644/644; `npm run build` `✓ 122 modules transformed.` / `✓ built in 2.00s` (source unchanged after build); `git diff --check` clean. No balance simulation or visual/UI check.
- State: tests verified; implementation commit `587683981def20f8554a2aa9df0a7321de35c581` recorded by this log-only follow-up; push pending.


### 2026-11-24 23:32 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (based on `09e2890`; working tree)
- Review fixes: natural Ace player-hit opportunity and 12s→10s reengagement windows; arena bounds apply while the pilot is inside the arena, with terrain/ceiling checks. Added damageable escorts, repeating commander cross/recovery, rising-ground altitude guard, and consumed 3:35/6:45 swarms. Existing HP/firepower values are unchanged; Survivors replay golden updated.
- Read-only PR #12 contract alignment: consume exact `midboss` cue shape, send `defeated`/`escaped` completion at the actual tick, and spend threat with `{tick,source,points,bearing}`; only miniboss kills call the pickup hook with observation events. Tests exercise replaceable hooks; shared producer runtime remains separate.
- Verification: focused 40/40; `npm test` 645/645; `npm run build` `✓ 122 modules transformed.` / `✓ built in 3.25s`. No balance simulation or visual check. State: review pending; no commit or push.


### 2026-11-24 22:19 KST · 데븐 봇 · devin/1795525246-sortie-minibosses (based on `09e2890`; working tree)
- Implemented the 205/400-second replacement minibosses with existing evolution-carrier hull/reward behavior and adapters for `consumeMidbossCue`, `finishMidbossEncounter`, `trySpendThreat`, and `dropMagnet`; routed Ace attacks through the same threat hook and added reengagement with an actual first gun line and 12s→10s cadence.
- Added deterministic coverage for cue contracts, trajectories/collision, kill versus retreat, one-time rewards, reengagement windows, threat denial, and deadline damage. `npm test` passed 640/640; `npm run build` passed (122 modules, 3.55 s). No balance simulation or visual check was run.
- State: done; review pending, no commit or push.


### 2026-11-24 21:47 KST · 기획 봇 · devin/1795524446-approved-sortie-plan (기준 `2d543dd`)
- [10분 출격 승인본](wiki/SORTIE_10MIN.md)과 [검수 기준](wiki/SORTIE_10MIN.md#acceptance)을 위키·기획서에 연결했다.
- State: done (문서). 첨부 결정·수치와 링크 대조. 게임 코드·현행 도감 수치·공개판은 변경하지 않았다.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`2cc10e4`, based on `7da5db6`)
- Strengthened the 120Hz fire-tick regression: C must leave an accepted roll and zero hostile projectiles, while the deterministic phase-2 no-C twin reaches the same tick, clears the tell normally, and spawns both Ace missiles.
- Focused fire-tick test passed 1/1; test-only change, so no full-suite, build, or UI rerun.
- State: ready pushed; no production change.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`3e68ea0`, based on `444076d`)
- Final UI report on `444076d`: at forced 4fps, the prior tick 28823 was before window tick 28834; trusted C arrived 2.4ms after the scheduled cue, and the next frame at tick 28835 canceled the tell with zero missiles. An output-compensated C about 5ms after estimated acoustic tick 28836 also canceled. Measured cue spacing was 398.896ms vs 398.866ms scheduled at normal rate and 433.708ms vs 433.696ms at 4fps. `getOutputTimestamp` estimates the acoustic window at +25.9ms normal / -23.3ms at 4fps relative to the first near-window frame; this is a one-frame estimate, not a microphone-calibrated AV offset.
- In the overlap window, the 1650/2200Hz components measured -17.4dBFS against local residual levels of -44.7/-40.7dBFS; peak was -13.34dBFS with no clipping. The UI report described a neutral foreground chime and muffled background. Earlier automated listening disagreed, so this is capture-specific, not a universal audibility claim. W/S+Space, Shift+Space, C+Space grace, pause/mute/cancel/stale-source and initial 640Hz tests passed. Phoenix Lv5/Bomb Bay Lv1 no-key automatic spawning passed; unlock and bomb impact damage were not tested.
- The registered 57s video is silent; the supplied WAV is separate and unsynchronized: [viewer](https://app.devin.ai/sessions/f995748a1f3c4f929eeb74e526d39a42?testRecording=2cdc221c-302e-435a-8a53-9f57e5962f8e).
- Full `npm test` on `444076d` passed 628/628 (123.9s). The 120Hz regression was subsequently tightened from window-start to fire-tick cancellation and passed targeted 1/1; this changed tests only. No rebuild was needed: the production build on `444076d` passed (120 modules, 3.05s).
- State: final UI evidence and full suite recorded; awaiting clean review. No base merge or deployment.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`2005000`, based on `88fb590`)
- Fixed the carry/anchor overlap: accepted rAF elapsed plus carry still determines the number of fixed steps, while active Ace audio maps step i directly to the retained schedule time for `state.tick + i + 1`. Without an audio anchor, step times retain the rAF-prefix and hitstop-floor mapping; elapsed/FPS timing and the 0.2s cap are unchanged.
- Added the 120Hz zero-step/8.33ms-carry case: C at 1012.67ms now maps to 1016.67ms instead of the incorrect 1008.33ms and cancels at the fire tick. Tests also cover 90/144/240Hz counts, actual scheduled source timing at cue+2ms near fire, 4/20/40ms render costs, and retain the 4fps 12-step cap/cue regression.
- Focused Ace/flight/audio tests passed 68/68; build passed (120 modules, 3.05s); `git diff --check` was clean. Full suite and UI remain deferred until clean review; no base merge or deployment.
- State: implementation and focused verification complete; pushing with this Worklog entry.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`2bcfbe0`, based on `279f8bd`)
- Kept `previousTime` on the rAF timeline and mapped input boundaries through the retained CombatAudio tick/AudioContext/performance anchor; an actual scheduled source-start regression covers two audio updates/frame and 4/20/40ms render costs with C at cue+2ms. The 60Hz/10s clock test now retains all 600 ticks.
- A due action clears pending Space grace only when its `spaceAt` matches that request; C at 1175ms no longer consumes W+Space at 1190ms before the 1270ms chord deadline, preserving grace at fire tick 1200. Gameplay timing and the 0.2s elapsed cap are unchanged.
- Focused Ace/flight/audio tests passed 64/64; build passed (120 modules, 4.23s); `git diff --check` was clean. Full suite and UI/audio retest remain deferred pending clean review; no base merge or deployment.
- State: implementation and focused verification complete; pushing with this Worklog entry.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`ef94685`, based on `254d002`)
- Flight-clock rebasing now samples `performance.now()` immediately after every `updateAceLock` call (including render and pause sync), pairing the input-step anchor with the same frame's AudioContext anchor instead of reusing the earlier rAF timestamp.
- Focused tests passed 33/33; build passed (120 modules, 4.73s). Full suite and live UI/audio verification remain deferred.
- State: shared-anchor follow-up verified; pushing with this log entry.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`ed7a423`, based on `838e0dd`)
- Capped catch-up steps now use the accepted elapsed interval's prefix from the preceding frame/audio sync anchor, then rebase after audio update so discarded frame tails do not shift queued inputs. Same-step due flight actions drain together with prior C/roll-over-maneuver priority; future inputs remain queued.
- Added repeated 250ms/12-step low-FPS coverage, C at cue+2ms reaching the dodge window and canceling with a due J-turn, pause/reset clock rebase, and due/future arbitration checks. Focused tests passed 33/33; build passed (120 modules, 3.19s). Full suite and runtime UI/audio verification remain deferred.
- State: implementation and focused verification complete; pushing with this log update.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`ca9d716`, based on `c37631e`)
- Late Shift now resolves at the saved 80ms chord deadline; timestamp-ordered flight actions preserve earlier maneuvers, and C flushes an expired chord before queuing itself while retaining its pending-Space grace until consumption. The five-tick grace and 18-tick dodge window are unchanged.
- Focused tests passed 57/57; build passed (120 modules, 2.34s). Sound audit: `hit`/roster SFX route through the ducked effects bus (.06 tell/.02 window; harness hit at tick 28836 measured .02); active `FlightAudio.bus` and the Ace cue itself connect directly to master. In the supplied 0.95s prefire WAV, mixed RMS/peak were -24.64/-13.33dBFS; exact-frequency projections at WAV offsets 0.65s (1650Hz) and 0.715s (2200Hz) measured -17.44/-17.65dBFS against local mixed RMS -18.13/-18.26. The 11.98s overlap WAV measured -30.35/-13.29dBFS RMS/peak and repeats the same cue bands. Adjacent windows had little energy at those frequencies. These measurements are from mixed PCM, not isolated stems, apply only to the supplied captures, and do not establish universal audibility or source-isolated levels. No gain/timbre edit made.
- State: input fix and offline diagnosis complete; runtime listening/UI retest pending. Full suite deferred until UI retest.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (`ad09f1f`, based on `c81b644`)
- Guarded Ace-window flags against callbacks from removed voices, replay the missed low pip only on first audible setup, and timestamp queued defensive inputs at fixed-step boundaries; 80ms chord timing and the existing dodge/grace windows are unchanged.
- Tester’s `c81b644` sample measured the 1650Hz cue at 2.05s (scheduled 2.0527s), with the next visible window frame at 2.0898s and a preceding frame 41ms earlier (25–28fps). Focused tests passed 53/53 and `npm run build` passed (120 modules, 3.51s); both stale-callback regressions failed against `c81b644` before the guard. Full suite deferred until UI retest.
- State: implementation and focused checks complete; runtime audio/masking, AV-frame quantization, and weapon verification remain pending.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (UI report for `1b0518f`; tick-scheduled warning)
- UI-agent report on `1b0518f`: outer radius 143→53px over the first 18 ticks, 27.5px at the dodge window, and 22px at fire; same-tick `1b652cd` baseline was 49.5px and inside the ship. W/S+Space, Shift+Space and C passed; 320/375px layouts passed. Pitch rise was heard, but injected hits partly masked clarity. The reported 5–8fps machine delayed the cue by 11 ticks; 60fps comparison was not verified. Automatic weapons were not runtime-tested. Full `npm test` on `1b0518f` passed 605/605.
- Pre-scheduled Ace pulses and the dodge accent from simulation ticks, with clock-drift rebasing and cancellation of future sources/duck automation on pause, mute, cancellation and fire. The existing 40ms 640/850/1125/1490/1980Hz pulse bank, cadence, 18-tick window, cue gains, master/headroom/limiter, fire restore and gameplay are unchanged; the two-note accent is brighter (1650→2200Hz), and effects duck further to 0.02 only in the window. The schedule follows the logical tick; at low FPS the visible ring still waits for a rendered frame, so the audio can precede its first visible window frame by up to one frame.
- Verification on this candidate: focused combat-audio/Ace tests passed 40/40; build passed (120 modules, 2.57 s). The full suite and a live browser/audio listen were not repeated; post-push tester retest is pending. The PR8 owner supplied the Phoenix fixture URL and a combined Phoenix Lv5/Bomb Bay Lv1 checkpoint recipe; neither runtime setup was browser-verified here. P1 remains separate; no base merge or deployment.
- State: review and final audio/sync listening pending.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (reference-informed audio update)
- The tester's Forge reference confirms an incoming warning that rises from approximately 640Hz to 1980Hz. Updated only the cached Ace incoming-lock pulse bank to five 40ms tones (640/850/1125/1490/1980Hz), selected by lock progress through the existing pre-window edge.
- This is inspired by the incoming alarm's low-to-high urgency, not a literal copy of its 11Hz timing/rhythm and not the distinct player-target 990→1480Hz warble. Existing pulse cadence, 2.0 gain, 0.06 effects duck, separate 1050→1450Hz dodge-window cue, fire restoration, master/headroom/limiter and gameplay remain unchanged.
- Added regressions for all cached tone pitches/duration, progress selection, unchanged cadence/window timing, cache reuse, routing and lifecycle cleanup. Focused combat/flight audio tests passed 26/26; the production build passed (120 modules, 2.93 s). No browser capture or listening by this agent; the UI agent will retest the pushed tree. Logs: `/home/ubuntu/pixel-spaceship-ace-audio-final.log`, `/home/ubuntu/pixel-spaceship-ace-audio-build.log`.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (baseline `1b652cd`; renderer-proto `746f308`)
- Merged the latest `renderer-proto` tree into the PR7 worktree only, retaining PR8's automatic Phoenix/Bomb Bay weapons, C barrel roll, Shift+Space and W/S+Space behavior. Kept both sides' worklog entries; no commit, push, base merge or deployment.
- Revised only the Ace outer ring: the fixed reference ring keeps its existing radius; the large ring starts outside the projected aircraft when viewport space allows, contracts quickly early and eases more slowly toward the unchanged near-overlap/firing ticks. Added geometry coverage for ship enclosure, front-loaded contraction and viewport cap.
- P1 tip `96bd079` is not an ancestor of this base and remains untouched/untested. The supplied TestFlight link opens Devin for iOS, not the game; the correct lock-on sound reference has now arrived at https://forge.ui8.ai/share/frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24, and the UI agent's runtime/audio comparison is pending. No audio changes were made. Continuous play capture showing the ship-enclosing start, contraction and dodge cue remains pending for the tester.
- Verification: the initial focused run passed 293/294; only the merged Survivors replay golden differed. After updating the combined-tree hash to `9534f369d842378f776a2e2d009492e105360270a1319b24084c293ae84438c6`, the merged focused suite passed 294/294 (18.58 s). `npm run build` passed (120 modules, 2.33 s). Full `npm test` was not run.
- No browser recording or listening was performed. The logs are `/home/ubuntu/pixel-spaceship-pr7-merged-focused-final.log`, `/home/ubuntu/pixel-spaceship-pr7-merged-focused.log` and `/home/ubuntu/pixel-spaceship-pr7-merged-build.log`.
- State: review pending; baseline revision `1b652cd4b05e1abf69389e6a04e866ed83161d9e` remains available for same-moment comparison.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (source `c06e3c9`; final delivery)
- Retained verification on source `c06e3c9`: Korean HUD warning glyph coverage, English gun/missile fit at 320/375px, and cockpit W+Space/S+Space live-input pass.
- The audio cue is identifiable; the delivered WAV measured true peak −13.3 dBFS with no clipping. Listening reports conflict: the original isolated prefire check reported unmasked, while the AV-derived extract showed material masking. No unqualified clarity pass; final user listening judgment is pending.
- The registered session recording is video-only. The actual WAV was delivered separately and is not synchronized: [viewer](https://app.devin.ai/sessions/f995748a1f3c4f929eeb74e526d39a42?testRecording=f84a24ed-427b-410e-b514-7ef515659946).
- P1/PR8 are not integrated or tested; no base merge or deployment. PR7 threads 4667752243 and 4667752482 are resolved.
- State: final user listening judgment pending; this update is documentation only.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (base `3e07d43`; audio retest pending)
- The latest isolated prefire listen still found the warning materially masked by repeated hit clacking at the 0.15 effects duck. Raising the tell-wide duck to 0.06 and lock cue gains to 2.0/2.4; cadence, buffers, timing, master volume, headroom/limiter, and immediate fire restore remain unchanged.
- Verification: combat-audio/flight-audio tests passed 26/26; `npm run build` passed (120 modules, 1.98 s). The updated combined-mix headroom assertion passes at the new gains.
- Current browser audio retest remains pending; no commit or push.
- State: browser audio retest pending.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (base `2d1ccd6`; browser retest pending)
- Regenerated the Galmuri11 subset from the documented `galmuri@2.40.3` source under the existing OFL, adding the missing Korean warning glyphs. Shortened English Ace warnings to “GUNS · DODGE AS RINGS NEARLY MEET” / “MISSILE · DODGE AS RINGS NEARLY MEET”; kept the Korean near-overlap copy and aligned the README instruction. No dependency manifests changed.
- `aceTellFired` now restores the effects bus to unity immediately before the same-tick salvo muzzle callback; ordinary muzzle SFX still route through effects to master. The 0.15 tell duck, cadence, other lifecycle restores, rings, and controls are unchanged.
- Verification: focused audio/lock/chord/flight-audio/i18n/layout tests passed 108/108; `npm run build` passed (120 modules, 2.46 s). FontTools found all Korean warning glyphs; at 12 px both English strings (240/254 px) and Korean strings (224 px) fit the 274 px text width at 320 px and 329 px at 375 px.
- Prior cockpit W/S+Space live-input pass and the held 0.15 mix listen were reported as passing; the earlier capture found cues partly masked by hit/clacking. Browser visual/audio retest remains pending.


### 2026-11-24 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (implementation commit `1b3e0db`, parent `1f8e649`)
- Kept the Ace effects bus at 0.15 for the full audible tell, including pulse gaps, and restore it on fire/cancel/pause/mute/zero-volume/suspend; cue gain, master gain, headroom, limiter, cadence, dodge window, and controls are unchanged. Gun/missile HUD copy now says “DODGE WHEN THE TWO RINGS NEARLY OVERLAP” / “두 원이 거의 겹칠 때 회피”; current Ace plan copy matches.
- Verification: focused audio/Ace-lock/chord/flight-audio/i18n tests passed 57/57; `npm run build` passed (120 modules, 2.59 s). Prior cockpit W/S+Space live-input pass was reported; the `d5801c6` listen failed the clarity bar (cues audible but partly masked by hit/clacking). Corrected English/Korean HUD screenshots: `/home/ubuntu/ace-hud-en-overlap-1f8e649.png`, `/home/ubuntu/ace-hud-ko-overlap-1f8e649.png`; new browser audio listen pending.
- State: committed as `1b3e0db` on PR7 branch; browser mix retest pending.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (PR head `d5801c6`; base `4bbf4c6`)
- Brought the latest `renderer-proto` documentation into PR7 only; `git merge-tree` found only `docs/WORKLOG.md` conflicted, resolved by preserving the PR7 Ace entries and all base-side worklog entries. Changes since common base `b123ba6` are documentation; the P1 branch tip `96bd079` and PR8 branch tip `c070cad` are not ancestors of this base, and no gameplay/audio source was brought in from either.
- Verification: actual Chrome/Pulse capture on `d5801c6` phase-2 chase heard the short high-pitched pulses and rising two-note accent around 0:01–0:03; they are audible but partly masked by loud effects/clacking (`/home/ubuntu/ace-phase2-d5801c6.wav`). Final merged UI check is pending. No P1/PR8 code was cherry-picked.
- Controls: regression coverage on `d5801c6` confirms Space-first Shift across the fire tick resolves one roll, late accepted W/S+Space cancels only its salvo, and cooldown-blocked input still fires. Base changes contain no source or test files.
- State: in progress; final merged UI verification pending. No merge back to `renderer-proto`/`main` or deploy.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (PR head `1a0a5b2`; current `renderer-proto` ref `7d883ad`, not merged)
- Added dedicated synthesized Ace lock pulses (~40 ms, 1.25 kHz) accelerating from 12 to 6 simulation ticks, plus a one-shot rising two-note accent at the existing dodge-window edge. Ace cues bypass the effects bus but retain master/headroom/limiter; effects duck during each cue. Scheduler is keyed by boss/tell, tick-only, capped to one voice and catch-up cue, with no StageState/RNG changes; matching Ace startup warnings are suppressed while unrelated tells remain.
- Verification: focused audio/lock/chord tests 48/48; `npm run build` passed (120 modules, 2.08 s). Browser playback/listening remains pending; no P1 assets or external APIs were used.
- State: in progress; browser/audio listening remains pending. This is PR-only work; no base merge or deploy.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (PR head `1a0a5b2`; current `renderer-proto` ref `7d883ad`, not merged)
- Replaced the single Ace warning ring with a fixed viewport-scaled reference circle and a larger shrinking circle; the gap is near-overlap at the existing 18-tick dodge-window entry and exactly zero at fire. An observer-only fire cue preserves that final render frame; maneuver acceptance, input grace and key chords are unchanged.
- Verification: focused tests 21/21; `npm run build` passed (120 modules, 1.91 s). Screen rendering was not driven; audio hooks/assets were inspected only, with a beep/window-cue design pending review and no audio implementation.
- State: in progress; no commit, push, base merge or deploy. The current base ref advanced to `7d883ad` after PR head `1a0a5b2`; preserve it for the review handoff.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438662-ace-lock-dodge (PR head `c22c9c5`; base `b123ba6`)
- Preserved FlightChord's full 80 ms Space/Shift arbitration and passed unresolved W/S+Space intent to simulation. At a valid solid-warning fire tick, Ace defers at most five ticks only while a roll or maneuver can be accepted; only an accepted first-tick action cancels the salvo, while cooldown-blocked intent still fires. Phase 1/2 live attack fixtures continue to hold their release cone through the opening salvo.
- Verification: focused tests 19/19; `npm run build` passed (120 modules); full `npm test` exited 0 (the retained output has no TAP count); `git diff --check HEAD` clean. The `renderer-proto` documentation changes and approved Ace-lock fixes are integrated with no unresolved conflicts.
- State: in progress; browser/cockpit warning-position verification remains with the UI testing agent.


### 2026-11-23 23:15 KST · 데븐 봇 · devin/1795438706-auto-countermeasures (parent `cf53220`; renderer-proto `c6d2d16`, `ee908d4`, `4bbf4c6`)
- Merged the latest documentation-only renderer-proto delta into PR8, preserving additive worklog entries and upstream docs; no game source or test files changed.
- Verification: `git diff --check`; source/tests/build-input comparison with `cf53220` is empty. State: done; final PR8 integration.


### 2026-11-23 23:10 KST · 기획 봇 · devin/1795439573-aster-wing-wiki
- [자동 폭장·C롤 실험](wiki/HISTORY.md#auto-countermeasures)에 조작·폭탄창 자동 투하 영상 두 건을 연결했다. 인계 당시 PR #8은 충돌 상태였으며, 실물 모바일·자연 해금·완주는 미검증이다.
- State: done (실험 기록만 갱신). 개발판 조작과 해금 도감은 변경하지 않았다.


### 2026-11-23 (KST) · 기획 봇 · devin/1795439573-aster-wing-wiki (base `7d883ad`)
- [HTML 도감 파일](wiki/ASTER-WING-무기-버프-도감.html)의 개발판 링크와 위키 복귀 링크를 확인했다. `69f81c8` 기준 장비 명칭·시작 풀·무기/버프 단계별 수치·진화 조합, 격납고 가격·효과·랭크, 퀘스트 조건·집계, 상자·계열 보너스를 코드에 대조했다.
- [위키 홈](wiki/README.md)에서 현행 상세 기획·과거 원안 및 실험·기술 참고를 구분하고 각 문서에 돌아오는 길을 달았다. 옛 기록은 보존했다.
- [위키 홈](wiki/README.md)에서 인증이 필요한 웹 도감과 Git 원본을 구분했다. [웹 도감 네 탭 검증 영상](https://app.devin.ai/sessions/4278635e7a724fa497392840d7643666?testRecording=31df854a-fa53-4f2b-ab05-d1295ac749cc)은 Product Engineer의 브라우저 검증이며, 채팅 첨부 미리보기나 공개 게임 배포 검증은 아니다.
- State: done (문서 검수·정리).


### 2026-11-23 23:05 KST · 데븐 봇 · devin/1795438706-auto-countermeasures (`264b23a`; Bomb Bay `e104198`; renderer-proto `69f81c8`, `f544ee2`, `7d883ad`)
- UI session report for `264b23a`: Chrome keyboard/mouse weak-left and neutral C, Shift+Space, W/S+Space, twin-only no-rear-fire, inert X/K, and Phoenix auto-fire fixture passed; forced-touch Roll/Loop passed. Bomb Bay auto-fire passed at `e104198`; combat code is unchanged since.
- [Final UI recording](https://app.devin.ai/sessions/7f15ccc7bd4c4b0ea3c7555fd75b88a2?testRecording=9b4b7f3e-18ba-4e5e-b6c3-ee6367b6e79b). Checks used checkpoints/fixtures and forced touch; no physical mobile or natural-unlock playthrough.
- Merged docs-only renderer-proto updates, preserving additive worklog/history. Focused progression/evolutions/chests/stage tests passed 48/48 and build passed on `264b23a`; no rerun after docs-only integration. `git diff --check` passed. State: done; final UI evidence recorded.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438706-auto-countermeasures (parent `e104198`; review `4666747118`)
- Draft refills revalidate kept cards as well as new offers, replacing Flare Bay/Ordnance Rack when their unowned Phoenix/Bomb Bay is banished; an owned paired weapon keeps its valid buff. Replacements remain unique.
- Verification: focused progression/evolutions/chest/stage tests 48/48; `npm run build` passed (119 modules). State: done; UI evidence recorded in the latest entry.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438706-auto-countermeasures (`8824cfc`; merged `2e9770d`, `cc77357`)
- C normalizes nonzero combined steering to its sign and uses the remembered/default sign when neutral; stepStage regressions cover weak opposite input and neutral C. Shift+Space ailerons and W/S+Space selectors remain unchanged; the global roll threshold is untouched.
- Merged the docs-only `renderer-proto` updates, preserving its additive worklog and history. Verification: focused tests 65/65 and build passed on `8824cfc`; post-merge `git diff --check` passed. State: UI verification pending; PR branch integration.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795438706-auto-countermeasures (`eb21d00`, merge `d8d34fd`; renderer-proto `a77502d`)
- PR #8 review fixes: C follows current combined steering; Flare Bay/Ordnance Rack require their weapon to be owned or addable; skip Rear Guard only for full four-slot loadouts without a rear weapon, advancing the Bill schedule without a new failure penalty. Preserve historical manual-bomb migration.
- Merged latest `renderer-proto` into the PR branch, preserving its three wiki docs and in-progress planning-bot entry; resolved only the additive worklog overlap.
- Verification: focused regressions 57/57 and build passed; post-merge `npm test` 578/578 and `npm run build` passed (119 modules, 2.93 s). State: done locally; not pushed.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795439918-catalog-update → renderer-proto (base `cc77357`; integrated `69f81c8`; commit `f544ee2`)
- Finalized the standalone catalog with theme-safe Hangar/Quest styles, Korean status/audit copy, verified plan anchors, and the `위키 홈` link. Snapshot is `69f81c8`; the latest upstream changes were only `WORKLOG.md` and `wiki/HISTORY.md`, both preserved.
- Verification: catalog assertions/source audit, GitHub plan-anchor lookup, artifact compile and offline bundle; final packaged HTML rendered at 1440×1800 with no page JS/resource errors. No game code changed; meta/build suites were not rerun for this docs-only update.
- State: done (direct push to `renderer-proto`; no PR or `main`).


### 2026-11-23 22:56 KST · 기획 봇 · devin/1795439573-aster-wing-wiki
- [Ace 회피 후보 검증](wiki/HISTORY.md#ace-dodge): PR #7의 `1a0a5b2`에서 확인한 브라우저 조작과 자동 시간 제어 경계를 구분했다. PR은 열려 있고 개발판 병합·배포는 하지 않았다.
- State: in progress. HTML 최종본 게시 확인 전까지 기존 기획 문서는 유지한다.


### 2026-11-23 (KST) · 기획 봇 · devin/1795439573-aster-wing-wiki (base `81a0e2a`)
- [한국어 위키](wiki/README.md)에 공개판·개발판·실험 PR을 나누고, [시도·결정 이력](wiki/HISTORY.md)과 [무기·버프·격납고·해금 전체 목록](wiki/CATALOG.md)을 연결했다.
- [P1 상자 연출 검증](wiki/HISTORY.md#p1-96bd079)은 밸런스 봇이 확인한 `96bd079`에 한정한다. 다른 후보의 플레이 녹화와 분리했다.
- [후속 글꼴 후보](wiki/HISTORY.md#p1-font) `61154f5`에서는 시드 18의 한국어 ‘잭팟 ×5’와 보상 5개가 보인다. [이동 리플레이](wiki/HISTORY.md#p1-trail)에서는 잔상을 켜도 꺼도 일부 적탄이 가려졌다. 실기기 성능 미검증으로 통합 보류.
- State: in progress. 원격 버전·Pages 성공 배포·PR 상태 및 게임 데이터와 38개 항목을 대조했다. HTML 도감은 Product Engineer가 별도 반영하며, 확인 전에는 기존 기획 문서를 정리하지 않는다.


### 2026-11-23 (KST) · 기획 봇 · devin/1795438662-ace-lock-dodge (base `81a0e2a`)
- State: in progress. Ace 상호 락온 표식 및 발사 직전 배럴롤·반전 기동 회피 판정. 키 매핑·Seeker·P1 사운드는 변경하지 않는다.


### 2026-11-23 (KST) · 기획 봇 · devin/1795438706-auto-countermeasures (`70204b0`, base `81a0e2a`)
- 플레어·폭탄은 피닉스 플레어·폭탄창을 장착해야 자동 발사한다. 수동 탄약·버튼은 제거했고 기존 폭탄 투하 해금 기록은 이어진다. C는 단독 배럴롤이며 Shift+Space 및 W/S+Space는 그대로다.
- 검증: 테스트 574/574, 프로덕션 빌드 통과. 수동 병기 상태·입력 제거에 맞춰 Legacy/Survivors 골든을 갱신하고 두 모드에서 렌더링 유무에 따른 해시 일치를 확인했다.
- 데스크톱 Heat 0, 시드 1–100: 숙련/평균/초보 생존(시간 종료 포함) 100%/69%/26%, 에이스 격추 100%/69%/1%, 격추 수 중앙값 3,155/3,193.5/2,806. State: done (구현·로컬 검증).


### 2026-11-23 (KST) · 기획 봇 · devin/1795432111-first-clear-hangar (base `cfb3abf`)
- 일반 첫 클리어: 횟수 잠금 없이 후반 사격 압박과 선체·회수·XP 강화 차이로 조율한다. 무강화/강화 동일 시드 비교와 정산을 잇는 첫 승리 추적은 별개다.
- 격납고: Hawk 복셀 미리보기와 강화 8종의 아이콘·현재/다음 수치·가격·구매 상태를 정의했다. 신규 기체는 미정. [화면 사양](WEAPONS_BUFFS_PLAN.md#hangar) · [첫 클리어 검수](WEAPONS_BUFFS_PLAN.md#first-clear).
- 검증: 문서 링크·강화 8종의 최대 단계/첫 가격 대조, diff 검사, 테스트 576/576, 프로덕션 빌드 통과. 게임 코드·골든 해시 변경 없어 100시드 시뮬은 재실행하지 않았다. 첫 승리 곡선과 화면 사용성은 구현 후 검증 대상이다.
- State: done (설계).


### 2026-11-23 (KST) · 기획 봇 · devin/1795426562-learn-weapons-through-play (base `2564e31`)
- P0: 무기 10종의 강점·한계만 남기고 시연·추천 조합·식별 시험을 삭제했다. 같은 입력에서 전방 격추·측면 침입·Ace 실피해를 비교해 차이가 부족한 무기만 고친다.
- 검증: 테스트 576/576, 프로덕션 빌드, 문서 링크·역할표 및 diff 검사 통과. P1·P2 사양과 게임 코드는 그대로다. 무기 성능 비교는 후속 검수이며 이번에 실측하지 않았다.
- State: done (설계). [담당별 인수 기준](SURVIVORS_PLAN.md#pillars).


### 2026-11-23 (KST) · 기획 봇 · renderer-proto (설계 `fef50fd`, 통합 기준 `421ae44`)
- P0는 역할 배지 대신 실제 탄선·명중·남은 적으로 읽힌다. P2는 뱀서의 골드/PowerUp, 마늘/포 사례에 맞춰 크레딧 구매와 조건 해금을 분리한다. 첫 카드 예약 없이 기존 풀을 사용한다.
- 검증: 통합본 테스트 576/576·프로덕션 빌드·문서 앵커·diff 검사 통과. 신규 플레이어 무설명 검수와 P2 해금/구매 속도는 구현 후 측정한다. 게임 코드와 골든 해시 변경 없음.
- State: done (설계). [담당별 인수 기준](SURVIVORS_PLAN.md#pillars).


### 2026-11-23 (KST) · 기획 봇 · devin/1795425740-visible-weapon-roles (claim; base `0ff560f`)
- State: in progress. P0를 카드 역할 라벨 대신 실제 전투 효과로 수정. P2는 뱀서 기본 게임의 결과·골드·PowerUp·무기/캐릭터 해금 자료를 대조해 재설계. P1과 게임 코드는 범위 밖.


### 2026-11-23 (KST) · 데븐 봇 · renderer-proto integration
- Fresh fetch found `origin/renderer-proto` at `0ff560f`; its three changed paths were documentation only. Merged those updates while preserving the local Candidate 4 note; gameplay/test/tool files still match tested `81abe3a` exactly.
- Candidate 4 is the XP-comparison baseline only: phone weak median kills **2,462**, a strict **38-kill miss**; active weak Skirmish/Siege **50/86** are diagnostic overruns (full medians **46/81** pass). XP and survival settings are unchanged.
- `.github/workflows/deploy.yml` runs on pushes to `main` or manual dispatch, not `renderer-proto`; no branch CI is configured. State: local integration done; authorized remote update is limited to `renderer-proto`.


### 2026-11-23 (KST) · 기획 봇 · devin/1795425156-survivors-pillars → renderer-proto (base `0631118`, 설계 `d0c22e1`)
- 무기 10종의 역할·사각·보완 픽과 비교 장면, 이미 지급된 상자 결과별 연출, 패배 정산→첫 드래프트 시험 출격을 두 계획서에 반영. [워프 비컨 상점](https://github.com/CodeBBakGoSu/pixel-spaceship/blob/e25e9948187f25be650215efd9e9b8fe9627a7ce/docs/SHOP_PLAN.md)은 런 안의 회수품만 사용하므로 메타 경제와 분리함.
- 검증: 테스트 567/567 통과, 프로덕션 빌드 통과, 문서 링크의 내부 앵커·무기 10종 표·`git diff --check` 확인. 코드 변경이 없어 100시드 시뮬·실기기 플레이테스트는 재실행하지 않음.
- State: done (기획). Product Engineer는 P0부터 구현하고 밸런스 봇은 같은 입력에서 역할별 성능, 연출 보상 불변성, 첫 해금/구매까지 걸리는 판 수를 순서대로 검증.


### 2026-11-23 (KST) · 기획 봇 · devin/1795425156-survivors-pillars (claim; base `0631118`)
- State: in progress. Scope: Survivors and weapons/buffs plans only — weapon tradeoffs, chest and hit feedback, post-loss progression. No changes to gameplay, balance constants or Legacy.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795418657-renderer-proto-density-xp (base `0bc1f99`)
- Corrected the acceptance rule: Trial 1 phone weak at 2,401.5 is a strict 100-seed target miss; the 10-seed screen threshold does not relax the final target. Trial 2 changes only Storm mobile floor 92→104 and rate 480→600; PC and all other values remain at Trial 1.
- Trial 2 phone 10-seed full-density medians pass, but weak kills are 2,197.5, 252.5 below the 2,450 screen gate; no Trial 2 phone 100-seed runs were started. Paired baseline→Trial 2 weak mean delta is −368.3 kills; its symmetric descriptive decomposition is −174.194994 duration / −194.105006 KPM. Paired 100-seed baseline→Trial 1 weak mean delta is +104.89, but its 2,401.5 median remains a strict miss. The tracked results JSON preserves 10-seed three-way per-seed kills/duration/KPM/outcomes and 100-seed baseline/Trial 1/candidate-3 weak actual duration, normalized survival, actual KPM, outcomes, and phase-kill distributions.
- Candidate 4 direct 100-seed phone runs completed for all profiles, with floors 14/37/72/92/99 and unchanged mobile rates. All full-density medians pass; kills are skilled 2,625.5 and average 2,564 (pass), weak 2,462 (strict miss by 38). Weak active Skirmish/Siege medians are 50/86, above diagnostic bands 48/84; full medians 46/81 pass. Candidate 1 remains a comparison reference, not a recommendation. Candidate 4 is adopted as the XP-comparison baseline only; this does not meet the strict all-profile kill target and does not imply impossibility.
- Paired weak 100-seed mean changes: Candidate 4 minus Candidate 3 is +103.92 kills, +21.070 actual run seconds, +21.390 normalized-survival seconds, and +5.592 actual KPM; versus baseline, +210.57 kills, +24.679 actual seconds, +24.435 normalized-survival seconds, and +16.505 actual KPM. Phase deltas and per-seed records are in the tracked results JSON.
- Candidate 4 pre-integration checks: final swarm tests **20/20 passed**; the stale mobile Coast floor expectation (13) was updated to 14. `npm run build` passed (`✓ 119 modules transformed.`, `✓ built in 1.48s`). Candidate 3/4 outputs, XP metrics, and paired data are durable in `docs/density-balance-results.json`; full checks were pending at that point.
- Post-merge validation on `36443c1` (local candidate/telemetry commit `039174f`): `npm test` passed **576/576**, including the six `tests/run.test.mjs` Ace replays for seeds **1, 11, 27, 42, 128, 2026**; `npm run build` passed (`✓ 119 modules transformed.`, `✓ built in 2.03s`). Re-ran all six 100-seed profile/cap reports: each final JSON and CSV is byte-identical to the preserved Candidate 1 PC or Candidate 4 phone report. Exact JSON comparison confirms all 100 per-run state hashes, kills, ticks, outcomes, phase, XP, and summary metrics match. New reports are `sim-out/newbase-final-<profile>-100-from-1-heat-0-{desktop,mobile}.{json,csv}`. No push.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795418657-renderer-proto-density-xp (base `0bc1f99`)
- Implemented the new-base numeric trial: PC floors 22/44/90/130/166 and unchanged rates 70/160/320/480/600; phone floors 13/30/60/92/99 and rates 50/160/320/480/600. Added required platform fields, exact mobile-cap selection, canonical-cap floor scaling, and numeric/refill tests. Caps, packs, one-second refill, regular traffic, variants, swarm events, damage, and XP settings are unchanged.
- The 10-seed gate passed; all 100-seed full/active phase medians are within ±20% targets. Trial kill medians (skilled/average/weak): PC 3268/3189/3071; phone 2522/2467.5/2401.5. Phone weak is 98.5 below 2500. Integrated baseline and candidate JSON/CSV outputs remain preserved under `sim-out/integrated-*` and `sim-out/newbase-trial1-*`; findings are in `docs/BALANCE_NOTES.md`.
- Validation: swarm tests 20/20; six Trial 1 100-seed runs completed; `npm run build` passed; full `npm test` exited 0 after intentional Survivors-only seed-1 golden rebaseline (`cd87e5ab…07ca9` → `1cede402…f0e5905`; Legacy and Ace regression tests unchanged). Average clear/boss rates fell PC 78%/78% → 72%/72% and phone 74%/72% → 67%/66%; reported without weakening Ace criteria. Trial 1 remains a preserved comparison reference; its phone average/weak kills strictly miss. No commit, push, or PR.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795418657-renderer-proto-density-xp (base `0bc1f99`)
- Transferred the accepted sim-only phase occupancy/kill telemetry to the integrated base. The `Enemy` entries retain `kind: 'gnat'` plus optional variants; the Ace remains separate in `StageState.boss`, so living regulars and all Gnat variants count once, without the Ace. Added first credited XP, first draft, first level-up, and level-ups by tick 3600 observations; modal inputs are observed, level-ups use `stage.level` increments, and no XP behavior changed.
- Old-base Trial 1/2 rate/floor experiments are discarded and were not transferred; Trial 3 cadence was stopped before implementation. No spawn settings changed on this base. The 10-seed integrated reports are `sim-out/integrated-all-10-from-1-heat-0-{desktop,mobile}.{json,csv}`. Median kills (skilled/average/weak): desktop 3500.5/3313/2935; phone 2464.5/2554.5/2367.5. Density misses are desktop Siege for skilled/average (full/active 85/87 vs lower bound 88) and mobile Coast (active 25.5/25.5/29.5 vs upper bound 24); the other phase medians meet the ±20% bands. At that initial gate, the 10-seed misses deferred 100-seed work; the later integrated baseline is recorded in the following entry.
- XP medians (skilled/average/weak): first XP seconds 5.1/5.0/5.0 on both caps; first draft/level-up seconds 24.6/25.0/25.9 desktop and 24.6/25.5/26.5 phone; level-ups at 60 seconds 4.5/3.5/3.0 desktop and 4/3/3 phone. Pre-instrumentation seed-1 state hashes match post-instrumentation in all six profile/cap comparisons, so there is no tuned different outcome and baseline equals final for this measurement step.
- Validation: targeted telemetry/milestone tests 8/8; `npm test` 575/575; `npm run build` succeeded. Initial baseline measurement completed; later 100-seed baseline and candidate trials are documented above. No golden, commit, push, or PR.


### 2026-11-23 (KST) · 기획 봇 (데븐 봇 계열) · devin/1795417710-status-update (base `0bc1f99`; docs `8ac3a37`; landed via `27d6ba5`)
- Updated both plans for #7's integrated status while preserving the exact schedule and event/magnet rules. Added the `77163bc` feature-branch 100-seed report as historical evidence; kept `9d677b5` pre-variant and `82c19c6` variant metrics explicitly scoped. Removed the stale Stage C PR claim from the current summary without altering historical logs.
- The #7 playable-flow recording and branch statistics are supplied by WORKLOG at `77163bc`; this update did not personally watch the recording or treat it as integrated-snapshot validation. The average median kills are within range, but do not establish phase density or whole survival acceptance.
- Verification on combined tree `dd26738` (code baseline `0bc1f99`): `npm test` exit 0 — `# tests 567`, `# pass 567`, `# fail 0`; `npm run build` exit 0 — `✓ 119 modules transformed.`, `✓ built in 1.45s`; `git diff --check` exit 0. State: done; landed on `renderer-proto`.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795417618-swarm-events → renderer-proto
- Work `77163bc`, claim `86e2991`, base `d4e4911`; integrated by `0bc1f99`. Survivors alternates a two-band closing ring (escape altitude announced) and a 105-Gnat crossing V. Planning confirmed fixed starts at 1:50/3:35/5:15/6:45, durations 15/15/10/10 s. Each ends with a single global sweep of existing orbs, then 15 s without ordinary spawns. Chest/Bill schedules and phase repairs stay put; no ±40 s swarm exclusion.
- Feature-branch verification: 567/567 tests including all six Ace replays, production build OK. Survivors seed-1 golden deliberately updated to `cd87e5ab…07ca9`; Legacy unchanged. The supplied [playable-flow recording](https://app.devin.ai/sessions/245af8f813bf47df88fafc1bfc0f7a97?testRecording=1db81c86-8882-4bb0-b9d4-b200287038a7) reports a 72-member ring, 105-member V, and 34/105 orbs swept in the first two recoveries; touch cap 120 checked. This is feature-branch evidence, not integrated-snapshot validation, and was not personally watched for this update. Actual device performance was not measured.
- Desktop Heat 0, seeds 1–100 per pilot (skilled/average/weak) on `77163bc`: survival including timeouts 99%/78%/35%; Ace kills 99%/78%/1%; median kills 3,213.5/3,167.5/3,064.5; median level-ups 53/54/54. Peak Gnats 200 each. This run does not measure phase density or establish whole survival acceptance.
- State: done. Final difficulty and XP tuning belongs to 밸런스 봇. No PR or public deployment.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795417618-swarm-events (claim)
- Base `d4e4911` (Gnat variants integrated). Implementing §3.1 #7: timed ring/crossing formations and a one-shot global salvage pull at recovery, with HUD and regression tests.
- State: in progress. Scope: Survivors swarm director, Gnat event movement, salvage recovery and phase notices. Final tuning stays with 밸런스 봇.


### 2026-11-23 (KST) · 기획 봇 (데븐 봇 계열) · devin/1795417710-status-update (base `d4e4911`; correction commit `075ebd0`)
- Applied review corrections: restored #7 event geometry and one-shot global XP magnet behavior while keeping the fixed schedule, added separate `82c19c6` feature-branch simulation rows to both plans, and removed the stale Stage C PR line from the current WORKLOG summary. Checked the suspected text corruption; it is not present.
- Verification: `git diff --check` exit 0; no tests/build rerun for these prose-only corrections. State: done; authorized to land on `renderer-proto`.


### 2026-11-23 (KST) · 기획 봇 (데븐 봇 계열) · devin/1795417710-status-update (base `d4e4911`; docs commit `82b5b8a`)
- Updated both plans for the `d4e4911` baseline: #6 variants are integrated, #7 swarm/XP-magnet work is started but unmerged, pre-variant and feature-branch simulation results are separately scoped, and the all-weapon screenshot acceptance remains unverified. Restored the event geometry/magnet behavior and clarified the fixed schedule without changing chest/Bill timing.
- The variant recording was supplied as feature-branch evidence; it was not personally watched for this update and is not integration validation. The measured SwiftShader sample is 36.44 fps; actual current PC/phone performance remains unverified.
- Verification: prose-only corrections; `git diff --check` exit 0. No tests/build rerun. State: done; authorized to land on `renderer-proto`.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795416809-gnat-variants → renderer-proto
- Work branch `82c19c6`, claim `a2106c7`, base `8f41122`; merged into `renderer-proto` by `d4e4911`. Armored (Siege+, 3 HP/3 XP) and Sting (Skirmish+, ±8 m direct pursuit, 1 hull contact on the shared 1 s damage cooldown) replace standard swarm slots. Both keep the Gnat render batch and caps.
- Feature-branch verification: 561/561 tests, including six Ace replays; production build passes. Seed-1 Survivors golden deliberately updated to `b42b33e9…c813`; Legacy unchanged. [Browser comparison and live Siege/Storm footage](https://app.devin.ai/sessions/9286f5ebd5a84c4fbdc8c96c6e8abdf9?testRecording=746df89d-adb1-4f8a-9b2d-aaba9638c4b0) is feature-branch evidence, not an integration-snapshot check.
- Feature-branch desktop Heat 0, seeds 1–100 per profile (skilled/average/weak): clear including timeouts 100%/78%/24%; Ace kills 100%/76%/3%; median kills 3,510.5/3,411.5/3,302.5; peak Gnats 200 each. These results are separate from the pre-variant `9d677b5` baseline above.
- State: done. No balance tuning, #7, or public deployment.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795400000-survivors-horde → renderer-proto candidate
- Merged upstream `7446be4` into the horde task branch, preserving weapon Lv7/Ace pursuit and its regression tests alongside the horde. Seed-1 combined hashes: Legacy `cfe30dd…f3903`, Survivors `d0b796f…ce255a`.
- Verification: six Ace replays (seeds 1/11/27/42/128/2026) pass; `npm test` 556/556; build `✓ built in 1.42s`; 100-seed integrated results are in `docs/BALANCE_NOTES.md`.
- Final owner UI QA on integrated `9d677b5`: desktop **1,326 frames**, live **148–200**, **2,670 recycles**, zero render mismatches/over-cap; touch **806 frames**, live **108–120**, zero mismatches. Manual Twin Lv6→7 upgrade confirmed **6 bolts**, **3 pierce**, **1.3 scale**. Real-hardware FPS remains unverified; the public site was not changed. State: UI gate passed, candidate ready to land.


### 2026-11-23 · 데븐 봇 · devin/1795400000-survivors-horde → renderer-proto
- Commits: `49aff78`, `c5c477b`, upstream merge `3820811`, recycling `41e4504`, escort lifetime `51e3a72`, aft re-entry `9c3694f`.
- Gnat caps 200/120, phase floors with deterministic top-ups, homing/encircle packs, persistent wave Gnats recycled ahead in their band, silent over-cap cleanup. Aft Gnats beyond 0.6 × range for 1 s re-enter through off-screen fly-ins; regular traffic and 12 s bomber escort lifetime stay original. Protected altitude/recovery mechanics, orb merge and shot budgets unchanged.
- Verification: `npm test` 524/524, `npm run build` OK; 100 desktop Heat 0 seeds per pilot against growth baseline `1f1eb4b`: clears 100%/69%/51%, median kills 3,680.5/3,637.5/3,420.5, median peak Gnats 200 for each. Seed-1 replay hashes were rebaselined for deterministic aft re-entry.
- Owner browser verification on `b4611ba`: **1,543 frames**, desktop **165–200** live Gnats, zero render-count mismatches or over-cap frames; touch **107–120**, recycling and recurring formations observed. Hardware/real-phone FPS remain unverified (VM software GPU).
- State: horde implementation complete on the task branch; integrated-candidate validation is recorded above. Push to `renderer-proto` awaits UI verification. 밸런스 봇 owns tuning.
- Headless forward-contact median/minimum at t=540–570, seed 1, average pilot after browser-style seek: **21/0 → 35/15** versus `540735e` (±60°, 1.5 × Gnat range). Cockpit red polygons are the Ace crossing the 0.65 near plane; the same mesh crosses in upstream `1f1eb4b` with unchanged Ace/camera/render code. Investigated only; no fix.


### 2026-11-23 (KST) · 데븐 봇 · renderer-proto · weapon levels v2 integration
- Independently verified the balance handoff (`bc1f3fe`) for [PR #3](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/3): Ace replays 1/11/27/42/128/2026 all clear; `npm test` 545/545; `npm run build` passes.
- State: done for the renderer-proto integration. Preview uses the renderer-proto build; main and public deployment are unchanged.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795407698-aster-weapon-levels · weapon v2 balance (base `7f03b8a`)
- State: done — weapon numeric tables tuned, Lv1 unchanged. Twin Lv7 keeps six shots, two pierces and the original ±6° outer fan; inner muzzle offsets tighten to ±0.2/±0.6 so four central shots reach the Ace while outer shots retain flank coverage. Nominal DPS: old Lv1/new Lv1 = 1×2×60/21 = 5.714; old Lv5 = 1.42×6×60/18 = 28.4; new Lv7 = 1.988×6×60/18 = 39.76 (exactly 1.4×). No spawning, XP, enemy fire, Seeker vertical speed, Ace or bot edits.
- All ten weapons retain each Lv2–7 visible change from SURVIVORS_PLAN §4 / WEAPONS_BUFFS_PLAN §5.2: barrel/projectile/chain counts, pierce, widths/radii/range, lifetime, salvage attraction, repeat/afterimage, fire, and double orbit are unchanged. Only Twin's inner six-shot muzzle spacing changes. Numeric test expectations now use tuning helpers; new regression covers unchanged Lv1, Gnat/patrol fodder hit counts and Twin DPS anchor. Six Ace replay criteria and flank-hit assertions unchanged; only Survivors golden deliberately regenerated (`6198a775…` → `317fe8c5…`), Legacy unchanged.
- Verification: `npm test` 545/545; `npm run build` passes; each 100-seed sim exits 0. Ace kills skilled/average/weak = 100%/70%/1% (pre-v2 100%/66%/0%). Survival is report-only per requester. Six Ace kills (seeds 1/11/27/42/128/2026): 523.92/519.87/524.38/528.72/530.53/520.33 s. Final fetch confirms `origin/renderer-proto` (`b2fe031`) remains an ancestor, so combined = branch; no merge pushed. Stash reapplied cleanly after ff-only pull to `7f03b8a`. No visual screenshots captured; visible rank changes checked against data/logic and existing tests, not rendered.

Desktop Heat 0, seeds 1–100. Each cell is clear / Ace kill / timeout / survival (%); CLI clear includes live timeouts. Pre-v2 independently measured at `6ba58b8`; branch-before at `6a5deca` (checkpoint follow-up `7f03b8a` does not run in fresh sorties).

| Profile | Pre-v2 | Branch-before | Tuned |
| --- | --- | --- | --- |
| skilled | 100 / 100 / 0 / 100 | 100 / 40 / 60 / 100 | 100 / 100 / 0 / 100 |
| average | 73 / 66 / 7 / 73 | 63 / 9 / 54 / 63 | 71 / 70 / 1 / 71 |
| weak | 41 / 0 / 41 / 41 | 16 / 0 / 16 / 16 | 12 / 1 / 11 / 12 |


### 2026-11-23 (KST) · 데븐 봇 · devin/1795407698-aster-weapon-levels · balance hooks (`670211b`; verified at `e49660f`)
- Per Product Engineer follow-up, each weapon exposes seven `damageScale` and `cooldownScale` values in `src/data/items.ts` (all currently ×1). Lv1 stats, visible rank changes and Legacy stay unchanged. Weapon damage and cooldowns apply the scales; fixed pattern timing (e.g. time between Rail's two beams) does not.
- Ion Wake now applies its cooldown per target and trail lane. Overlap can land more than one hit, but extra segments on the same lane do not. New Plasma Ribbon samples still use a single lane.
- Checkpoint follow-up: resume migrates old scalar Ion cooldowns to lane deadlines while preserving immunity. Replay bots start fresh and do not load checkpoints.
- Build passed; 540/543 tests passed. In the six-seed Ace gate: 1/27/2026 clear, 11/42 time out with 60.745/29.0165 Ace HP left respectively, 128 loses at 504.03 s with 1069.04 Ace HP left.
- Desktop Heat 0, seeds 1–100 per pilot (skilled/average/weak; includes the current `renderer-proto` sim pursuit fix): Ace kills 40%/9%/0%, survival 100%/63%/16%, median level-ups 30/31/26. No merge pending balance tuning and a green gate; see [PR](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/3).


### 2026-11-23 (KST) · 데븐 봇 · devin/1795407698-aster-weapon-levels (`98a2284`, claim)
- State: historical trials, superseded by the completed balance entry above. Numeric assertion updates and deliberate Survivors golden regeneration authorized; six replay criteria unchanged. Survival gate subsequently removed by requester.
- Independently measured desktop 100-seed skilled/average/weak at pre-v2 `6ba58b8`: survival 100%/73%/41%, Ace kills 100%/66%/0%, timeouts 0%/7%/41%. At pulled `6a5deca`: survival 100%/63%/16%, Ace kills 40%/9%/0%, timeouts 60%/54%/16%. Upstream already merged the pursuit fix; local combined worktree fast-forwards to the same state.
- Trial 1 (uncommitted `items.ts`): survival 100%/55%/16%, Ace kills 99%/49%/0%, timeouts 1%/6%/16%. Build passes. Tests 535/543: six fixed-number/golden failures, seed 11 loses, and one fragment damage assertion fails. This is not accepted balance; survival targets not met. Initial test run exposed missing Three.js; `npm ci` restored dependencies without tracked package changes.
- Trial 2 front-loaded Lv2–6 damage/cadence, especially Twin, Seeker and rear ordnance: survival 100%/66%/19%, Ace kills 100%/61%/0%, timeouts 0%/5%/19%. Best measured weak survival remains 19%, below pre-v2 41%.
- Trial 3 narrowed Twin's Lv6/7 fan from 6° to 1° without changing nominal DPS: survival 100%/68%/18%, Ace kills 100%/65%/1%, timeouts 0%/3%/17%. All six replays clear at 521.13/532.73/535.25/527.55/534.68/543.00 s (seeds 1/11/27/42/128/2026). Tests 542/543, build passes; the retained flank-hit assertion correctly rejects the narrowed fan. Trial 3 is left uncommitted for inspection, not accepted as the solution.
- Weak death instrumentation outside repo matches all 100 CLI terminal hashes in trial 3: 29 deaths before Ace, 53 during Ace. Terminal hits: pre-Ace 26 hostile projectiles + 3 contact/hazard; during Ace 38 non-missile hostile projectiles + 14 Ace missiles + 1 contact/hazard. Ace-death median entry hull 10, median remaining Ace HP 816.16; all 53 have Twin Lv7. Stronger early ranks did not remove the late fight bottleneck. This does not prove all legal weapon settings impossible.
- Final fetch: `origin/renderer-proto` remains ancestor `b2fe031`. Remote tuning branch advanced to checkpoint-only `7f03b8a`; local measurements remain on `6a5deca`, not yet pulled. No production/UI visual check performed.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795407698-aster-weapon-levels (`7e787c6`, `033a311`)
- All ten Survivors weapons visibly change at ranks 2–7; draft text, HUD, rendering and Lv7 + paired-buff evolutions follow the new cap. Per-rank damage and cooldown multipliers are gone. XP, enemy density and Stage C are unchanged.
- Integrated build passed; `npm test` 527/528. The existing six-seed Ace clear gate is retained: seed 11 previously cleared at 534.43 s and seed 128 at 561.85 s; both now time out at 600 s (Ace remaining HP 183.795 and 128.8, respectively).
- Sim (100 seeds each, skilled/average/weak, before horde): survival 100%/65%/28% (previously 100%/73%/41%); Ace kills 37%/3%/0% (previously 100%/66%/0%); median level-ups 31/31/26. The sim's “clear” includes timeouts, so use Ace kills separately.
- Review fixes (`6c273cb`, `25803c9`): Twin keeps its center shots on target at range; Rail afterglow counts only damaging hits. Build passed and seeded clear gate is unchanged: 1/27/2026 clear, 11/42 time out (60.745/29.0165 Ace HP left), 128 loses at 504.03 s (1069.04 Ace HP left).
- State: implementation pushed for [review](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/3), merge held for 밸런스 봇. Rank tuning is centralized in `src/data/items.ts`: first recover the Ace gates, then tune base DPS, XP and evolution pacing with the full horde.


### 2026-11-23 (KST) · 데븐 봇 · balance/ace-pursuit-climb (`f40bcd5`; claim `58a08e1`; base `e46b813`)
- Ace kill drop after Stage C: sim pilot pursuit climb. The 22 m floor hypothesis was rejected: all 22 average timeout replays matched CLI hashes; 20 descended below 22 m and damaged the Ace in its SKIM band, including both aircraft at 14 m clearance. The real pursuit defect was `src/bot.ts` zeroing pursuit/dodge climb for a failed altitude scout window. Wider bands magnified the lost alignment time.
- Pass through the autopilot's pursuit/dodge climb; keep profile reaction delay, aim error, SKIM selection, dodge quality and maneuver use. Altitude rolls still govern discretionary band exploration. No Ace or Seeker tuning. A profile-scaled attenuation trial left average Ace kills at 66% and reduced weak clears to 22%, so it was not kept.
- Desktop Heat 0, seeds 1–100: before = `1f1eb4b` (player growth); pulled base `e46b813` adds render-only feedback. Clears include live timeouts. Average alignment rises 41.92% → 48.97%, altitude eligibility 75.18% → 86.81%, and Ace damage/sec 13.13 → 15.41; instrumented final hashes match all 100 CLI average runs.

| Profile | Clear before → after | Ace kill | Timeout | End HP median | Kills median | Level-ups median |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Skilled | 100% → 100% | 100% → 100% | 0% → 0% | 12 → 12.5 | 1057.5 → 1059.5 | 29 → 29 |
| Average | 73% → 76% | 66% → 75% | 7% → 1% | 5 → 9 | 1085.5 → 1046.5 | 30 → 29 |
| Weak | 41% → 23% | 0% → 0% | 41% → 23% | 0 → 0 | 1003.5 → 961.5 | 28 → 28 |

- Tradeoff: weak active pursuit reduces live-timeout survival (41% → 23%); the profile still cannot kill the Ace. No compensating survival or enemy tuning was added. Average lands exactly at the measured 75% always-pursue reference, below skilled's 100%.
- Verification: `npm test` 524/524, `npm run build` OK, three 100-seed sims exit 0, `git diff --check` clean. Six focused bot tests cover failed/successful altitude rolls, ascent/descent, dodge, reaction-held commands, absent/neutral controls, inactive stages and non-boss behavior. No existing tests or golden hashes changed; golden replay pilots use `autopilotInput`, not `createBot`.
- State: done; branch ready for review, not merged. Sim-pilot balance area released.


### 2026-11-23 (KST) · 데븐 봇 · balance/ace-pursuit-climb (claim; base `e46b813`)
- Ace kill drop after Stage C: sim pilot pursuit climb. Replace the boss-fight all-or-nothing climb gate with graded profile control; add bot regression tests and record 100-seed balance results. Files: `src/bot.ts`, `tests/bot-sim.test.mjs`, `docs/BALANCE_NOTES.md`, and this log. No Ace or Seeker changes.
- State: done; see completion above.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795407702-damage-numbers (`0781cd5`; claim `c86c9d3`)
- Pooled Canvas damage numbers (real Fire Control crits + large-hit emphasis), persisted option / `?damageNumbers=0`, merged hits, batched Gnat explosions, rolling 5-second kills beside ACE WIPE. WeakMap/WeakSet observers only; no hashed state, spawning, upgrades or gameplay tuning changed.
- Verify: `npm test` 518/518, build OK, `npm run sim -- --profile all --seeds 5` exit 0 (skilled/average/weak clears 100%/100%/60%; smoke only). Both existing replay goldens unchanged. Incomplete preinstalled node_modules lacked three/@types/three: repaired with npm install, restored package-lock.
- Chrome `?fixture=damage&mode=survivors&autoplay=1&view=chase&quality=high&lang=en`: synthetic repeatable 200-Gnat scene, real hurtEnemy calls, twelve kills / 45 ticks, big 12-damage hit, forced ACE WIPE for HUD review. Fixture-only render buffer is 200; production caps untouched. Screenshot: `/home/ubuntu/shots/damage-numbers-mass-kill.png` (outside repo).
- Idle Chrome sample (10 s after 2 s warm-up): numbers on **36.44 fps**, off **36.98 fps**. This machine runs SwiftShader with GPU disabled; requested High auto-fell to Low (424×279 buffer). **60 fps High acceptance not established; hardware PC check still needed.** Earlier CPU-contended sample discarded. Mobile/cockpit not visually checked.
- Placeholder constants (`src/data/combat-feedback.ts`): pool 96, new/frame 12, lifetime .9 s, rise 32 px/s, fonts 17/26 px, big threshold 8, merge .12 s, batch at 6 Gnats with 10 combined particles, counter 5 s. Existing crit RNG/2× damage unchanged.
- State: done (implementation), needs hardware performance verification; no push/merge.


### 2026-11-23 (KST) · 데븐 봇 · renderer-proto (claim)
- Damage numbers + mass-kill feedback on `devin/1795407702-damage-numbers`. Files: new render-only combat feedback logic/tests, `src/main.ts`, options UI, feedback styles, and this log. No simulation or spawn/upgrade changes.
- Verification: see completion above. State: done.


### 2026-11-23 · 데븐 봇 · renderer-proto (claim)
- Weapon levels v2 on `devin/1795407698-aster-weapon-levels`: render-visible rank mechanics and Lv7 cap for ten Survivors weapons; draft, evolution gates, combat effects and tests.
- State: implementation complete; see balance handoff above.


### 2026-11-23 (KST) · 데븐 봇 · devin/1795406694-aster-growth → renderer-proto (`a36ff13`; merge `3da3980`)
- Survivors weapon ranks raise damage and grow Twin Cannon from two bolts to a wider, piercing six-bolt volley. Draft cards show the gain before selection; flight confirms the selected upgrade.
- Verification: `npm test` 513/513, build OK, desktop Chrome passed. Survivors replay goldens updated on the Stage C base (legacy unchanged). 100 seeds per pilot: skilled/average/weak clears 100%/73%/41%; median level-ups 29/30/28, before horde changes.
- State: done. Balance handoff: damage scales 1/1.08/1.16/1.30/1.42, Twin bolts 2/2/4/4/6, outer yaw ±0.16 rad are placeholders. XP and evolution pacing unchanged; tune with the horde changes.


### 2026-11-23 · 기획 봇 (데븐 봇 계열, 게임 디자인) · renderer-proto (claim)
- Survivors build order: rewrite `docs/SURVIVORS_PLAN.md` and update `docs/WEAPONS_BUFFS_PLAN.md` with the prioritized next-build list, on branch `devin/1795407127-survivors-build-order`. Docs only; no code, no goldens.
- Plans around (does not redo) the in-progress horde and growth branches above.
- Commit `8e10887`: SURVIVORS_PLAN v2 (build order 1–9, density/XP/Lv7 targets, Gnat variants) + WEAPONS_BUFFS_PLAN v2 (current state at 211e757, weapon level v2 table to Lv7, phase status).
- Verify: `npm test` 512 pass, `npm run build` ok.
- State: done (기획 봇), merged into renderer-proto.


### 2026-11-23 (KST) · 데븐 봇 · devin/stage-c-followups → renderer-proto (`23e7b0a`; claims `f86de1f`, `6612520`; base `6bea116`)
- Recovery scoring uses fixedBand (midpoints 100/152.5 m; SKIM → LOW); boundary tests added. Bomber launch assertion now allows only one constant-derived descent tick; streamed-world climb asserts MID after a derived extension (108.777 m at 60 ticks, reaches MID at 80). Phoenix firebird vertical rate scales 28→42 m/s with ascent/descent/no-target tests.
- Seeker stays at 34 m/s with a retained-rate test. Its 34→51 change is held for the balance bot: isolated Survivors replay seed 128 flips from clear to loss at 522.6 s to an Ace gun bolt, Ace HP 927/1200. Recovery-only and Phoenix-only do not flip it. Dodge floor and Ace tuning unchanged.
- Golden replay hashes deliberately updated: legacy `d90af0cd6c2a0f1870a5ef048e06b47a627bd4094c471f239a23fa6219f48ef2` → `08be00a7bd57e95555ebdc92f6d27322071f10fcb60db0d7823520fede976da8`; survivors `21778f2848148fb697dc2991bc83f5d3fc4eb4c97ba14b7ac705669dbfcc0b33` → `b8cbb9fc980f3e8e4a37a97498585f06a95a3a7babf446632220406c1446bc2d`.
- Verification: full `npm test` 512/512; `npm run build` OK; `npm run sim -- --profile all --seeds 5` exits 0 (smoke only, not a balance measure; 100-seed balance run explicitly deferred to balance bot). package-lock restored; no ref/frames or ref/clips included.
- State: done. Followup claim cleared; Seeker balance work remains with the balance bot.


### 2026-11-23 · 데븐 봇 · devin/1795340000-stage-c-altitude → PR #1 into renderer-proto (`357dc33`, `a65974d`, `ae8b3dc`)
- Full Stage C: altitude 49–230 m (floor = sea + SKIM), bands 75/125/180, SKIM 14 m (10–18 m). Hostile vertical rates, flares, bombs and mines scale 1.5× to keep band-change timing. Flak half-height is 28 m. The Ace now reaches SKIM. The HUD ALT tape reads 180/125/75. Golden replay hashes were rebaselined.
- Verified: `npm test` 509/509, `npm run build`, 100-seed sims (skilled 100% / average 68% / weak 35%), in-browser climb to 229 m and SKIM at 49 m over the sea. Details are in `docs/BALANCE_NOTES.md` under "Stage C altitude model".
- State: done, waiting on review. Altitude/band code is free again once this merges.


### 2026-11-23 · 데븐 봇 · renderer-proto (claim)
- Full Stage C altitude model (altitude range 165→230 m, bands 75/125/180, SKIM 30→14 m) on a branch, PR into `renderer-proto`. Files: `src/bands.ts`, `src/stage-combat.ts`, `src/data/*`, altitude-dependent sim/HUD/render code, tests, `docs/BALANCE_NOTES.md`.
- State: done (데븐 봇), merged via PR #1 at `6bea116`; original Stage C claim cleared.


### 2026-11-23 · 비행기게임봇 · renderer-proto
- Pushed `renderer-proto` to origin at `8265c4e` (new branch, main untouched). Added this worklog.
- State: done.


### 2026-11-22 · 비행기게임봇 · s8-forge → renderer-proto (`9b2efad`, `355f991`, `3e2135d`, merge `8265c4e`)
- Forge-reference visuals: climb-readable chase/cockpit cameras, new palette, sky, altitude haze, jet-shaped shadows (A); one shared pixel terrain material for all views with coastlines, foam, sea glints, contours, forests, voxel clouds and cloud shadows (B); climb-angle flight model (32° up / 38° down) and lighter turn drag 0.22 (C-lite).
- Verified: 508 tests, build, 60 fps in chase/top/portrait, sims above.
- State: done; waiting on 기현님 playtest.


### 2026-11-22 · 비행기게임봇 · renderer-proto (`b045bbe`, `5dd58c3`, `fcfd396`)
- Twin cannon now answers ground AA from any altitude band; swarm density ramps from 4:00 toward 10:00 (peak ~99 enemies PC / 75 phone).
- State: done.


### 2026-11-21 · 비행기게임봇 · renderer-proto (`5a890c1` … `54e3cb6`)
- Stage 7a-7f: bank-to-turn flight, numeric instruments, banked cameras, flight audio, enemy roster and Red Kite Ace, streamed Reach with terrain-following SKIM, double flight speed, adaptive graphics quality, ElevenLabs SFX (paid plan, see AUDIO_CREDITS.md), WebGL context-loss recovery, Ion Wake shown as sparse motes.
- State: done.


### 2026-11-18 – 2026-11-20 · 비행기게임봇 · renderer-proto (`2010b34` … `ee94755`)
- Survivors rework: Three.js voxel renderer, deterministic Reach sortie, cockpit and rear mirror, enemy archetypes, weapons/buffs/evolutions, Bills and pilot progression, mobile sortie UI, combat feedback and balance passes. Plans in `docs/SURVIVORS_PLAN.md`, `docs/WEAPONS_BUFFS_PLAN.md`, `docs/BALANCE_NOTES.md`.
- State: done.


### 2026-11-24 · 데븐 봇 · devin/1795495663-ace-lock-radar-cue → renderer-proto
- Ace-lock warning uses one 1125Hz, 32ms band-limited square-like beep; the pulse gaps shorten. The final 1650/2200Hz accent is unchanged.
- Verification: focused audio/Ace/input tests 68/68; build 120 modules. Trusted C canceled the Ace attack with 0 shots. In the mixed WAV, the accent measures −17.4/−17.5dBFS with off-tone residual −45.9/−41.2dBFS; the preceding pulse ends 1.333ms before the accent, with peak −13.35dBFS and 0 clipped samples. Automated subjective flags for distortion/accent clarity were not corroborated by these measurements. The 57s viewer capture is silent; its separate WAV is unsynchronized: https://app.devin.ai/sessions/f995748a1f3c4f929eeb74e526d39a42?testRecording=ccdecfff-5e94-4857-9ae3-6fda9fb76db9
- State: renderer-proto-only update; no PR, main merge, or deployment.


### 2026-11-24 · Devin · devin/1795524682-minute-waves-enemies (review corrections; base `8e1c805`)
- Corrected candidate regressions: reset the phase director on restart; integrate escort clear-out movement; migrate legacy checkpoint threat/director/schedule/repair state; align Crosswing side frames and verify both paths cross; keep pending midboss cues from blocking spawns while preserving active/rest gates; and raise Manta above its captured player-height endpoint with terrain-aware climb ownership.
- Seed-3 `stepStage` Manta trace: reservation 260s (tick 15600), actual spawn tick 15600, first pass warning/attack tick 16246 (270.77s); pass start altitude 249.12, captured endpoint altitude 189.12, horizontal exit starts tick 16325 and completes tick 16380 at the captured height. The regression uses the natural seed-3 spawn and full stage loop, with firing/crossfire suppressed after the scheduled spawn to isolate its flight path; scheduled intro time is not asserted as actual spawn/attack time.
- Focused tests: new enemies 10/10, phase director 6/6, checkpoint 10/10, Crosswing path 1/1, midboss schedule 2/2, replay 2/2, swarm events 5/5.
- Full `npm test`: 652/653 passed. Remaining failure is the bot-sim survival-order assertion (`average` median 515.23s, `weak` median 552.72s); no balance retuning or weakened assertion was applied. `npm run build`: 124 modules transformed, built in 4.25s; existing >500 kB chunk advisory remains. `git diff --check` is clean.
- Reviewed the repo blueprint (`npm install` maintenance); no dependency or setup changes were made. Visual/UI rendering was not checked.
- State: independent candidate only; no merge or deployment.


### 2026-11-24 · Devin · devin/1795524682-minute-waves-enemies (Crosswing termination review)
- Reproduced the terrain stall with safe terrain until one fighter reached `finished` and its mate remained in `exit` (tick 108), then blocked the route; both phases remained `finished`/`exit` through tick 508. Reproduced mate-loss stall at the same split: after the exiting mate died, the finished survivor remained `finished` for 100 ticks.
- Added a finite path deadline aligned with the existing 258-tick threat window; a blocked attack aborts both active FSM paths instead of leaving a finished partner waiting forever. A finished fighter now enters its 60-tick recovery when its mate is absent.
- Focused Crosswing regressions: 4/4, including blocked-terrain abort and dead-mate recovery.
- State: independent candidate only; no merge or deployment.


### 2026-11-24 · Devin · devin/1795524682-minute-waves-enemies (Crosswing geometry and minute-six resume)
- Replaced Crosswing side-frame targets with tell-time position snapshots, one shared crossing point, and fixed opposite exits. Fighters now follow the warned crossing path, finish independently, and enter pair recovery only after both exit; a fighter whose mate dies before the shared point cancels its path.
- Seed-4 regression uses the natural seed-4 stage spawn and full `stepStage` loop, traces actual per-tick fighter segments, and asserts the traces intersect. Trace: reservation tick 8400 (140s), actual spawn tick 8400, first warning tick 8550 (142.5s), finish ticks 8666/8672, pair recovery tick 8672. Friendly weapons are disabled in this regression only so the pair survives long enough to exercise both paths.
- Legacy checkpoint migration now leaves the minute-six combined formation pending at exactly 360 seconds; the regression resumes that boundary and verifies the Crosswing pair and Twin Chaser spawn.
- Focused checks: Crosswing path 2/2; checkpoint 11/11. Full `npm test`: 655/655. `npm run build`: 124 modules transformed, built in 4.08s; the existing >500 kB chunk advisory remains. `git diff --check`: clean.
- Bot-sim investigation: the prior average/weak median-order failure is absent with the unchanged assertion after this correction. Same-seed traces show no hull-hit event while a Crosswing is active; late hits occur after the pairs are gone. The indirect reason the deterministic profile medians changed remains unverified; no balance tuning or assertion change was made.
- State: independent candidate only; no merge or deployment.


### 2026-11-25 14:26 KST · 데븐 봇 · devin/1795525052-timed-pickup-magnet (merged `201cbce` into `14a13e2`)
- Integrated the target's sortie minibosses with timed salvage. Midboss defeats roll the magnet stream once, not again as a chest carrier. Updated the combined Survivors replay golden; Legacy is unchanged.
- Verification: focused replay/miniboss tests 19/19; `npm test` 668/668; `npm run build` passed; staged diff clean. Conflict resolution complete; no balance tuning or deployment.





### 2026-11-25 14:48 KST · 데븐 봇 · devin/1795524682-minute-waves-enemies (merge f6f84c0 + d21455a)
- Integrated timed salvage, terminal capture settlement and magnet drops. Shared miniboss hooks now run the live magnet roll once on defeat; regular carriers and marked elites also roll on defeat. Expedition rests do not pull salvage, and altitude-independent Bill credit still uses the actual contact tick.
- `npm test` 699/699, `npm run build` and `git diff --check` passed. Legacy replay matches the target; the Survivors golden was updated for the combined gameplay. Desktop Heat 0 simulation (100 seeds/profile) is running; PR review pending.


### 2026-11-25 14:40 KST · 데븐 봇 · devin/1795524682-minute-waves-enemies (review of a641975)
- A full shared ledger incorrectly started the normal miniboss attack cooldown even though no escorts fired. Blocked volleys now retry at the shared spacing interval; an emitted volley still starts the normal cooldown.
- The regression reproduces a denied volley and confirms a single paid volley once room opens. `npm test` 683/683, `npm run build` and `git diff --check` passed; Survivors replay golden updated. Before timed-pickup integration, desktop Heat 0 skilled/average/weak recorded wins 100/100/98, losses 0/0/2 and timeouts 0/0/0 across 100 seeds each.


### 2026-11-25 14:30 KST · 데븐 봇 · devin/1795524682-minute-waves-enemies (merge 0674f91 + 201cbce)
- Integrated `renderer-proto`'s miniboss, Ace reengagement and arena changes. Actual miniboss actors consume the shared cues, use the same threat ledger as Ace and regular enemies, and block formations during the encounter and its 15-second rest.
- `npm test` 682/682, `npm run build` and `git diff --check` passed. The Survivors replay golden reflects the combined gameplay. The 100-seed/profile simulation is running; the PR remains open for review.
