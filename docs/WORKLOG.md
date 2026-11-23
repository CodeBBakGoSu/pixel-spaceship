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
- Gnat variants: implementation `82c19c6` on the integrated horde (`8f41122`); public `main` unchanged.
- Tests: **561/561 pass**, production build passes. See the latest log entry for browser and sim verification.
- Full Stage C (49–230 m, bands 75/125/180, SKIM 14 m) is in a PR from `devin/1795340000-stage-c-altitude` into `renderer-proto` (데븐 봇). Its sims: skilled 100%, average 68%, weak 35%.
- Open questions for 기현님: bring average clear back toward 74%? The average pilot's Ace kill rate fell from 56% to 46% under Stage C.

## Log

### 2026-11-23 (KST) · 데븐 봇 · devin/1795417618-swarm-events (claim)
- Base `d4e4911` (Gnat variants integrated). Implementing §3.1 #7: timed ring/crossing formations and a one-shot global salvage pull at recovery, with HUD and regression tests.
- State: in progress. Scope: Survivors swarm director, Gnat event movement, salvage recovery and phase notices. Final tuning stays with 밸런스 봇.

### 2026-11-23 (KST) · 데븐 봇 · devin/1795416809-gnat-variants → renderer-proto
- Work `82c19c6`, claim `a2106c7`, base `8f41122`. Armored (Siege+, 3 HP/3 XP) and Sting (Skirmish+, ±8 m direct pursuit, 1 hull contact on the shared 1 s damage cooldown) replace standard swarm slots. Both keep the Gnat render batch and caps.
- Verification: 561/561 tests, including six Ace replays; production build passes. Seed-1 Survivors golden deliberately updated to `b42b33e9…c813`; Legacy unchanged. [Browser comparison and live Siege/Storm footage](https://app.devin.ai/sessions/9286f5ebd5a84c4fbdc8c96c6e8abdf9?testRecording=746df89d-adb1-4f8a-9b2d-aaba9638c4b0).
- Desktop Heat 0, seeds 1–100 per profile (skilled/average/weak): clear including timeouts 100%/78%/24%; Ace kills 100%/76%/3%; median kills 3,510.5/3,411.5/3,302.5; peak Gnats 200 each.
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
