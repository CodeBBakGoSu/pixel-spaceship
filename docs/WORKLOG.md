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
- 다음 기능(설계만 완료): P0 무기 자체의 강점과 약점 → P1 타격음·상자 잭팟·탄 궤적 → P2 패배 후 격납고 강화·일반 무기 풀 확장. [담당별 인수 기준](SURVIVORS_PLAN.md#pillars). 기존 #1·2·4·8 검증은 병행하며 세 기능의 체감·수치는 아직 측정하지 않음.
- Candidate code baseline: `renderer-proto` `0bc1f99` includes weapon Lv7 (`7446be4`), damage/mass-kill feedback (`e46b813`), horde (`8f41122`), Armored/Sting variants (`82c19c6`), and swarm events/recovery magnet (`77163bc`). Public `main` is unchanged.
- #7 is implemented and integrated by `0bc1f99`; timing, event geometry, and magnet rules are documented in both plans. On the combined tree based on this code, `npm test` passed 567/567 and `npm run build` passed (119 modules, 1.45 s). Actual 200/120-cap PC/phone FPS remains unverified.
- Pre-variant baseline only: integrated candidate `9d677b5` (ancestor of `8f41122`) at desktop Heat 0, seeds 1–100/profile; skilled / average / weak clear **100%/75%/26%**, Ace kills **99%/72%/2%**, median kills **3,677.5/3,591/3,373.5**, median peak Gnats **200** each. The pre-variant average median kills **3,591** was **91 above** the 3,500 upper planning target; these are not `0bc1f99` results.
- Historical feature-branch results: `82c19c6` variant run and `77163bc` swarm run are separately scoped in the log below, not reruns on integrated `0bc1f99`. The `77163bc` desktop Heat 0, 100-seed average median kills were **3,167.5**, within 2,500–3,500; this does not establish phase density or whole survival acceptance.
- The damage-feedback fixture measured **36.44 fps** in a SwiftShader VM after High→Low fallback; this software-renderer sample is not current hardware/device performance. The 100-seed simulations do not measure rendered FPS or phase density.
- Supplied feature-branch recordings document both variants and the #7 ring/V/orb-sweep demo; neither recording is integrated-snapshot validation or personally watched for this update. The all-weapon Lv2–7 screenshot acceptance remains unverified.
- Stage C and its pursuit follow-up are merged; the latest integrated pilot pursuit result is in `docs/BALANCE_NOTES.md`. Current plan order: #5 damage/mass-kill feedback merged; #6 Armored/Sting Gnat merged; #7 swarm event/recovery magnet merged.

## Log

### 2026-11-23 (KST) · 데븐 봇 · devin/1795427585-p0-weapon-roles (base `cfb3abfff30948e23e959c33e839df863922cb41`)
- P0 harness ready: deterministic 900-tick, seed-23 scripted comparisons for Twin forward Gnats, Pods side Sting Gnats, and Seeker locked Ace, using production acquisition and collision routines. This is a controlled mechanics comparison, not a survival simulation; P0 acceptance remains incomplete pending balance verification.
- Results (Twin/Pods/Seeker): forward kills ahead 30/0/30; side intrusions within 20m 30/0/9; Ace HP damage over 15s 448/0/26.25. The forward tie is saturation at the 30-target ceiling, not evidence of a targeting fault. Ace was available for all 900 ticks; Seeker fired 25 shots, hit 25 times, and dealt 1.05 HP per shot. P0 acceptance incomplete pending balance verification.
- Twin-only follow-up: Lv7 `damageScale` changed from 1.988 to 2. A production `acquireAndFire`/`advanceShots` regression verifies a single downward strafe against an ordinary 2-HP patrol one band below leaves Lv1 at 1 HP and kills at Lv6/Lv7. No Seeker or comparison-geometry changes; P0 acceptance remains incomplete.
- Verification: baseline `npm test` at df56cce passed 584/584. After the Twin fix and before golden update, `npm test` reported 585 tests: 584 passed, with only the expected seed-1 Survivors golden mismatch (old `1cede4023fb8ad248a8eef93bc7dc79f0da81989555e3f74a4f1be948f0e5905`, new `baca6f7d939a53a349e894beefb020891340ef1616163974f3064715efb78fec`); Legacy and all other tests, including Ace replay coverage, passed. Independent render parity: Legacy `cfe30ddaf2a97ef808244d507845819ea76ce2de6f2dd26661bc2e159ccf3903` and Survivors `baca6f7d939a53a349e894beefb020891340ef1616163974f3064715efb78fec` both matched with rendering disabled/enabled, phase `clear`. Updated the Survivors golden; `tests/s7f-replay.test.mjs` passed 2/2 and `npm run build` passed. No setup changes. State: harness ready; P0 acceptance incomplete pending balance verification.

### 2026-11-23 (KST) · 데븐 봇 · devin/1795427585-p0-weapon-roles (Twin baseline `f356e9a9094c4c13d52dd2c97b655718e15597ed`)
- Seeker-only provisional candidate: configured `WEAPONS.seeker.tuning.lockedAceDamageScale = 18`, applied only in the Ace explosion branch when a Seeker's `targetId` and `lockId` match the active Ace, the current player lock is ready for that Ace, and the Ace is vulnerable. The shared shot damage is unchanged; ordinary-enemy splash and Flak remain base damage, and `hurtAce` remains the final vulnerability gate. In-flight missiles still track after lock loss but deal base Ace damage unless the current lock qualifies at impact.
- The unchanged seed-23, 900-tick comparison reports forward kills 30/0/30 (Twin/Pods/Seeker; tie remains NOT MET), side intrusions 30/0/9 (Pods MET), and locked-Ace damage Twin 448 HP / 29.87 DPS vs Seeker 472.5 HP / 31.5 DPS (Seeker MET). The original forward fixture is unchanged; no spacing or moving-Ace acceptance measurements were made here.
- Verification: ranged/role tests 25/25; unchanged comparison CLI and `npm run build` passed. No full suite or replay-golden update in this step. State: Seeker multiplier is provisional for boss testing; P0 acceptance remains incomplete pending further balance verification.

### 2026-11-23 (KST) · 데븐 봇 · devin/1795427585-p0-weapon-roles (comparison measurement setup, pinned before CLI run)
- Preserve the original 30-target forward column exactly: ordinary 1-HP Gnats at x=0, z=120..700, 20 m longitudinal spacing, vz=-60 m/s. Add the representative production-derived line from `spawnSwarm` using `PHASES[0]` coast and its packSize 10; override only formation to line and band to middle (production splitBands remains false). Start each Gnat at its actual `entry.target`, take straight scripted velocity from `sampleFlyIn(entry, entry.arriveAt, ground)`, then clear entry. Record per-weapon initial positions/velocities and source path. `GNAT.spacing` (22) is lateral formation spacing, not longitudinal z spacing. Pilot/yaw remain fixed for 900 ticks.
- Add 240- and 480-target sensitivity columns over the same z=120..700 segment with spacing exactly `580/(count-1)`. They are sensitivity-only, not acceptance replacements. Every comparison verdict requires a unique strict lead; ties remain NOT MET. No fixture values will be changed after seeing outcomes.
- Add supplemental moving-Ace diagnostic only: real Ace at (0,120), real HP, seed 23, player at the fixed mid-band/yaw/input setup, 900 ticks beginning at boss-start tick 28,800 (480 s). Call production `advanceAce` before acquisition/fire every tick; initialize the ready lock once, then let `acquireAndFire` lose/reacquire it. Compare Seeker scale 1 baseline against provisional 18 only through temporary in-memory tuning with `try/finally` restoration. Record path, vulnerability/ready-lock ticks, actual damage/hits/shots, and player HP. This is supplemental, not a replacement for the stationary-Ace criterion. P0 remains incomplete.
- CLI measurements (seed 23, 900 ticks, fixed pilot): original forward 30-target column remains 30/0/30 kills while ahead for Twin/Pods/Seeker, a saturated tie and NOT MET. The production-derived line reports 7/6/10 kills ahead, 3/4/0 crossed alive, and 40/10/5 fired projectiles (Twin/Pods/Seeker): Seeker leads, so the strict Twin criterion is NOT MET. The measured line geometry is recorded below; each weapon run generated identical positions and velocities.

| Gnat | Initial x | Initial z | Exit vx | Exit vz |
|---:|---:|---:|---:|---:|
| 1 | 5.683869 | 285.644348 | 20.978289 | -60.464133 |
| 2 | -15.100677 | 278.433061 | 20.978289 | -60.464133 |
| 3 | -35.885223 | 271.221774 | 20.978289 | -60.464133 |
| 4 | -56.669768 | 264.010487 | 20.978289 | -60.464133 |
| 5 | -77.454314 | 256.799200 | 20.978289 | -60.464133 |
| 6 | -98.238860 | 249.587913 | 20.978289 | -60.464133 |
| 7 | -119.023405 | 242.376626 | 20.978289 | -60.464133 |
| 8 | -139.807951 | 235.165339 | 20.978289 | -60.464133 |
| 9 | -160.592497 | 227.954052 | 20.978289 | -60.464133 |
| 10 | -181.377043 | 220.742765 | 20.978289 | -60.464133 |

- Same-segment density sensitivity only: 240 targets at `580/239 = 2.4267782427` spacing produced Twin/Pods/Seeker kills 240/24/222 (strict Twin MET, not a replacement acceptance result); 480 at `580/479 = 1.2108559499` produced 350/26/406 (strict Twin NOT MET, Seeker leads). The original spacing/targets were not changed.
- Existing side result remains 30/0/9 intrusions (Pods MET). Fixed-Ace result remains Twin 448 HP/29.87 DPS, Pods 0, Seeker 472.5 HP/31.5 DPS (Seeker MET).
- Moving-Ace diagnostic (supplemental; no verdict): both runs had the same path, from (0,120,125) to (-72.118808,-36.267497,157.633333), distance 1122.557570. Each had 900 vulnerable ticks, only 62/900 ready-lock ticks, 5 Seeker shots and 5 Ace hits. Scale 1 dealt 5.25 HP (Ace 1200→1194.75); provisional 18 dealt 94.5 HP (1200→1105.5). Player HP was 10→7 in both. Lock availability and shot count are limited; this does not establish a moving-Ace acceptance result. P0 remains incomplete.

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
