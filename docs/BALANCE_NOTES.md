# ASTER WING balance notes

## Stage 1

New browser sorties use the phase director. The previous sortie is available with `?mode=legacy`, and the existing fixtures and replay entry point keep their previous defaults.

- The phase budgets from the design describe scheduled spawn opportunities. Terrain, formation size, live caps, and the pilot's route affect how many contacts arrive and get destroyed. Gnats have 1 HP, give 1 XP, and pass through the player unarmed.
- Regular kills give three times their legacy XP. Level costs use `14 + round(2.4 × current level)`. The first deck contains Twin Cannon, Wing Pods, and fallback cards. An overcharged or high-risk card grants two levels when the item has room. The high-risk pick costs one hull and is unavailable at one hull. A skip keeps the earned XP toward the next level.
- The long sortie has the 8:00 Warden arrival and 10:00 timeout so headless replays exercise every phase. Hull starts at 8 in this pass. Phase repair, chest and Bill rewards, and the unlock-quest pool enter in later stages.
- The six full-view replays cleared in 498.53–502.80 s with 522–553 kills and 21–22 level-ups. The 26–28 level-up target includes later reward sources and remains a tuning target.

The instanced Gnat airframe costs 16 triangles. At the caps it adds 1,280 desktop or 800 mobile triangles to the existing airframe budget. Player and hostile projectile pools allow 128 and 64 live projectiles respectively. Excess salvage orbs merge at 150 and keep their XP.

## Stage 2

The draft offers all ten weapons and ten buffs while unlock quests are pending. The gear tables in `src/data/items.ts` hold cooldowns, ranges, level scaling, and coverage. The following are starting values for playtesting.

- Echo overdrive accelerates non-Twin cooldowns only for the part of each cooldown that overlaps the reversal window. Overdrive Coil adds 30–90 ticks and strength. Seeker can release an extra volley after a loop. Phoenix can drop an extra flare after a J-turn.
- Salvage Beacon awards whole XP while carrying the fractional remainder forward. It also scales run credits and the chance of overcharged cards. A Fire Control crit doubles damage using the independent combat RNG.
- Headless Heat 0–5 increases regular enemy armor by 15% per tier before rounding. Gnats stay one-hit fodder. Heat unlocks and the other tier effects are part of Stage 4.
- The original full-view autoplay remains the legacy replay gate. In the new sortie, autoplay prioritizes Hull Plating and skips risky cards at four hull or less when a safe card is offered. The six full-view seeds cleared on both swarm caps in 496.78–509.62 s, earning 574–661 kills and 21–23 level-ups. The current Warden still goes down faster than the planned one-minute encounter.

### Headless simulation

Run `npm run sim -- --profile all --seeds 3 --from 1`. Add `--mobile` to use the 50-Gnat cap instead of 80 and `--heat H` for a provisional armor tier. Each batch prints a profile table and produces JSON and CSV in `sim-out/`.

For the batch, a **clear** means defeating the Warden or reaching the 10:00 timeout with positive hull. The game outcome, boss-clear rate, and timeout rate are reported separately. Duration measures time to the actual outcome. The survival percentiles use a common 600-second horizon for all surviving runs, so a fast boss kill cannot look like an early death. Bills paid is undefined until Bills are offered. Evolution counts are empty until evolution chests are active.

The Heat 0 check used seeds 1–3 on each cap. Both caps produced the same combat outcomes. Repeating the desktop command produced byte-identical JSON and CSV.

| Pilot | Boss clears | Median duration | Median end hull | Median kills | Median level-ups |
|---|---:|---:|---:|---:|---:|
| Skilled | 3/3 | 499.9 s | 10 | 616 | 22 |
| Average | 2/3 | 496.4 s | 2 | 583 | 23 |
| Weak | 0/3 | 398.1 s | 0 | 348 | 16 |

These nine runs per cap check determinism and survival ordering by skill. Final clear-rate estimates require the 100–200-seed tuning pass after the remaining combat rewards, Bills, and phase repairs.

### Rendering

With four weapons equipped, mounts add at most 288 triangles and three orbit drones add 108. On an RTX 4090, a headless Chromium production-build stress fixture ran 300 frame intervals per view at 1920×1080 and emulated 390×844. It replenished the full Gnat cap, 24 regular enemies, 150 orbs, roughly 174 projectiles, and 16 mines with the Warden present. TOP, CHASE, and COCKPIT held 60 FPS at both sizes. Desktop p95 was 16.8 ms and portrait p95 was 16.7 ms.

## Stage 3

The four carrier arrivals use the authored times and an isolated placement stream. They award 30 salvage XP and leave their cache in their altitude band. Supply caches roll 1, 3, or 5 upgrades. Evolution caches offer one eligible recipe with 1–2 bonus upgrades or three upgrades when the build has no completed pair. Each reward uses the chest stream and favors upgrading owned gear. Family bonuses count equipped weapons, including evolved forms, and apply the highest eligible tier.

The six full-view replays opened all four caches and evolved one or two weapons on both caps. They cleared in 494.45–507.62 s, with 618–691 kills and 24–25 level-ups. The same RTX 4090 stress fixture with four evolved weapons held 60 FPS in all three views. Desktop p95 stayed at or below 16.8 ms and emulated portrait at 16.7 ms. The chest batch adds at most 144 triangles and the fourth Collector drone costs 36.

## Stage 4

- New profiles draw from the five starter weapons and five starter buffs in the design. Quest progress makes new gear available on the next draft or cache roll and carries into later sorties. A daily sortie uses the KST date seed, fixed starter gear, base hull, Heat 0, and four slots of each type.
- The five Bills open at 1:00, 2:30, 4:15, 5:45, and 7:15. Progress comes from actual flight events. Unpaid Bills reduce XP by 25% until the next offer. Paid upgrades use the Bills stream. A retreat settles quest progress and pays half credits.
- The phase director starts each sortie at 10 hull, repairs two at each 15-second lull, and repairs one on carrier-cache pickup. A 15% XP multiplier compensates for terrain, missed pickups, and Bill interest while keeping the level-cost curve.
- The Warden arrives at 8:00. Three pods fire different salvos during the shield cycle. The core opens at 9:48 after the pods are destroyed. Heat 4 adds a middle relay. The sortie clock stops at 10:00.
- Heat now uses cumulative effects from the design. Heat 1 grants 15% armor, Heat 2 speeds hostile salvos, Heat 3 reduces attraction radius, Heat 4 adds a relay, and Heat 5 adds carrier escorts. The reward multiplier is 15% per tier.

All six full-view seeds cleared on each cap in 592.40–599.68 s, with 708–765 kills and 26–27 level-ups. The Warden was active for 112.40–119.68 s. The RTX 4090 stress fixture held 60 FPS in all views at 1920×1080 and emulated 390×844, with p95 at or below 16.8 ms on both caps.

## Balance pass

The first 18-seed trial used seeds 1001–1018. Clear rates were 100% skilled, 94% average, and 22% weak, with weak median survival at 539 s. Three hull damage and 80% of the original regular-enemy fire interval still left the average and weak pilots above the survival targets. The final fire interval is **62%**, and hostile hits cost **3 hull**. The weak pilot uses **0.46 rad** aim error and **0.04 dodge quality**. It still steers, collects salvage, and uses flight abilities with the same input interface as the other pilots.

The final comparison used **100 fresh-profile seeds per pilot per cap** at Heat 0, seeds 1–100. A clear includes a Warden defeat or a living 10:00 timeout. Actual run length and survival percentiles are both shown. The latter use the 600-second survival horizon for surviving runs.

| Cap | Pilot | Clears | Warden defeats | Live timeouts | Survival p10 / median / p90 | Median run | Median end hull | Median kills | Median level-ups | Bills paid |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Desktop 80 | Skilled | 93% | 90% | 3% | 600 / 600 / 600 s | 592.7 s | 9 | 753.5 | 26 | 55.8% |
| Desktop 80 | Average | 63% | 62% | 1% | 537.2 / 600 / 600 s | 590.8 s | 6 | 710.5 | 26 | 54.2% |
| Desktop 80 | Weak | 6% | 1% | 5% | 97.9 / 273.2 / 549.0 s | 273.2 s | 0 | 208 | 12.5 | 45.4% |
| Mobile 50 | Skilled | 93% | 90% | 3% | 600 / 600 / 600 s | 592.7 s | 9 | 753.5 | 26 | 55.8% |
| Mobile 50 | Average | 63% | 62% | 1% | 537.2 / 600 / 600 s | 590.8 s | 6 | 710.5 | 26 | 54.2% |
| Mobile 50 | Weak | 6% | 1% | 5% | 97.9 / 273.2 / 549.0 s | 273.2 s | 0 | 208 | 12.5 | 45.4% |

The batches produced identical per-seed combat results across caps. The JSON and CSV reports under `sim-out/` include death-phase and hull distributions, gear reached, and evolution counts. The JSON also records each replay hash. To reproduce a batch, run `npm run sim -- --profile skilled --seeds 100 --from 1`, substituting the pilot and adding `--mobile` for that cap.

The six full-view replays still cleared with 26–28 level-ups and 710–790 kills in 590.90–596.28 s, for Warden fights of 110.90–116.28 s. The final stress check held 60 FPS in all views with desktop p95 of 16.7 ms and emulated portrait p95 at or below 16.8 ms.

## Stage 6

The existing post-hit damage cooldown is now defined as 60 simulation ticks. It blocks hull damage from hostile bolts, mines, flak, and enemy contact. Bolts continue through the protected ship and can still hit the Aegis, drones, or terrain. Mines and enemy contact keep their existing removal rules. Terrain still limits flight altitude. Graze, muzzle, impact, and damage-direction events use no gameplay RNG and sit outside the replay state.

Heat 0, seeds 1–100 per profile and cap. The baseline is Stage 5 (`51a42c4`). A clear includes a Warden defeat or a living 10:00 timeout. The survival median uses the common 600-second horizon for surviving sorties.

| Cap | Profile | Clear before → after | Median survival before → after | Median end hull before → after |
|---|---|---:|---:|---:|
| Desktop 80 | Skilled | 93% → 93% | 600.0 → 600.0 s | 9 → 9 |
| Desktop 80 | Average | 63% → 63% | 600.0 → 600.0 s | 6 → 6 |
| Desktop 80 | Weak | 6% → 6% | 273.2 → 273.2 s | 0 → 0 |
| Mobile 50 | Skilled | 93% → 93% | 600.0 → 600.0 s | 9 → 9 |
| Mobile 50 | Average | 63% → 63% | 600.0 → 600.0 s | 6 → 6 |
| Mobile 50 | Weak | 6% → 6% | 273.2 → 273.2 s | 0 → 0 |

Every seed kept its terminal outcome and remaining hull. The average pilot's median kills rose from 710.5 to 711.5 on both caps. The bots stayed in their target ranges with the existing damage, fire intervals, and skill profiles.

The renderer uses two instanced projectile batches per camera pass. A bolt costs two triangles for its head and up to eight for its trail. The shared burst pool holds 120 quads. At 64 hostile bolts the ceiling is 880 triangles, with 48 nearest drop lines. The 192-shot legacy ceiling is 2,160 triangles. Chromium on an RTX 4090 held 60 FPS over 300 frames per view at 1920×1080 and emulated 390×844 with the Warden, 24 regulars, full Gnat caps, 192 projectiles, and 16 mines. Frame p95 was 16.7–16.8 ms.

## Stage 7a

- Hold Shift and press Space to roll, including while boost is held. Space followed by Shift within 80 ms also rolls. Space alone selects the existing reversal. On touch, tap ROLL with the stick held for a barrel to that side or with the stick neutral for an aileron roll in the last turn direction.
- Roll parries a same-band bolt on ticks 0–23, including every Warden bolt shape. A parry consumes the bolt and leaves one XP. The barrel also lets bolts pass on ticks 24–26. Terrain clearance, mines, and contact damage retain their existing rules. The cooldown is 78 ticks from activation.
- A sustained full turn reaches 1.5 rad of bank. A 180° turn takes 92 ticks at cruise and 81 boosted, compared with 97 and 82 at `ee94755`. A bank above 60° can lower altitude by up to 5.5 m. The plane recovers that offset on roll-out, within the existing band and terrain limits.
- The flight model intentionally changes hashes for steered replays. Both Legacy and Survivors cleared all six full-view seeds on each swarm cap, and replaying the recorded inputs reproduced each terminal hash. Legacy cleared in 122.47–131.83 s and Survivors in 589.55–596.48 s. The straight no-turn, no-roll trace retains its baseline hash.

The first roll-enabled 100-seed desktop batch cleared 96% skilled, 92% average, and 9% weak. The weak median was 209.4 s. The final average pilot uses 0.09 roll use and 0.37 dodge quality. The weak pilot uses 0.06 roll use, 0.08 dodge quality, and 0.43 rad aim error. Roll windows and authored hostile damage stayed fixed.

Heat 0, seeds 1–100 per profile. Desktop (80 Gnats) and mobile (50) gave the same combat results. Peak live Gnats fell from 42 to 41, below both caps.

| Profile | Clears before → after | Warden defeats before → after | Median survival before → after | Median end hull before → after |
|---|---:|---:|---:|---:|
| Skilled | 93% → 96% | 90% → 95% | 600.0 → 600.0 s | 9 → 10.5 |
| Average | 63% → 65% | 62% → 64% | 600.0 → 600.0 s | 6 → 5.5 |
| Weak | 6% → 5% | 1% → 2% | 273.2 → 276.4 s | 0 → 0 |

Chromium with ANGLE Vulkan on an RTX 4090 ran 300 frame intervals per view at 1920×1080 and emulated 390×844. The stress fixture held the Warden, 24 regular enemies, the full 80/50 Gnat cap, 192 projectiles, and 16 mines. Each view held 60 FPS. Desktop p95 was 16.8 ms TOP and 16.7 ms CHASE and COCKPIT. Emulated portrait was 16.8 ms across all views.
