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
- Working branch: `renderer-proto` (pushed to origin). `main` is behind at `801ff22` (OG preview image) and is what the public site shows.
- Tests: `npm test` 508 pass at `8265c4e`. Build OK.
- 100-seed sims at `8265c4e`: skilled 100% clear, average 59%, weak 27%.
- Full Stage C (49–230 m, bands 75/125/180, SKIM 14 m) is in a PR from `devin/1795340000-stage-c-altitude` into `renderer-proto` (데븐 봇). Its sims: skilled 100%, average 68%, weak 35%.
- Open questions for 기현님: bring average clear back toward 74%? The average pilot's Ace kill rate fell from 56% to 46% under Stage C.

## Log

### 2026-11-23 (KST) · 데븐 봇 · devin/1795407698-aster-weapon-levels (`7e787c6`, `033a311`)
- All ten Survivors weapons visibly change at ranks 2–7; draft text, HUD, rendering and Lv7 + paired-buff evolutions follow the new cap. Per-rank damage and cooldown multipliers are gone. XP, enemy density and Stage C are unchanged.
- Integrated build passed; `npm test` 527/528. The existing six-seed Ace clear gate is retained: seed 11 previously cleared at 534.43 s and seed 128 at 561.85 s; both now time out at 600 s (Ace remaining HP 183.795 and 128.8, respectively).
- State: implementation pushed for [review](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/3), merge held for 밸런스 봇. Rank tuning is centralized in `src/data/items.ts`: first recover the Ace gates, then tune base DPS, XP and evolution pacing with the full horde.

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

### 2026-11-23 · 데븐 봇 · renderer-proto (claim)
- Vampire Survivors-style hordes: far more enemies on screen (swarm caps, gnat/regular spawn rates, horde behavior) and keeping 60 fps with them, on branch `devin/1795400000-survivors-horde`. Files: `src/data/phases.ts`, `src/swarm.ts`, `src/spawn-director.ts`, gnat movement in `src/stage-enemies.ts`, enemy instancing in `src/scene.ts`/`src/roster-visuals.ts`, related tests, golden hashes.
- State: in progress (데븐 봇). Not touching Stage C leftovers (recovery score thresholds, weapon climb/descent rates).

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
