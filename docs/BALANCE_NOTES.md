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

## Stage 7b

The desktop and mobile Heat 0 reports match Stage 7a byte for byte for all 100 seeds per profile. All six Legacy and six Survivors full-view replays per cap also match the Stage 7a terminal hashes. In Chromium, the same seed 11 Legacy input stream drew all three views with effects enabled and disabled. It cleared at tick 7,522 with the same terminal hash and different pixels.

Boost adds 12° in CHASE and 8° in COCKPIT over a 0.25 s attack and 0.5 s release. CHASE follows 40% of the ship bank, draws 16% closer on boost, and sinks 3 m. The cockpit and mirrored rear view follow the full bank on desktop. Phone camera bank caps at 25°. Reduced motion removes camera shake, boost lens changes, and camera roll. Wind streaks ease with boost, and the pooled wingtip ribbons appear above 1.1 times cruise speed or during a roll. Foam and dust start below 45 m of terrain clearance. Desktop uses half-resolution bloom inside the existing render buffer. Phone keeps the vignette and ten-step haze.

The production preview at port 5181 has fixed `?fixture=bank&bank=1.5`, `?fixture=boost`, `?fixture=trails`, `?fixture=low`, `?fixture=low&surface=land`, `?fixture=cloud`, `?fixture=hud`, and `?fixture=roll&cue=parry` scenes. Append `view=top|chase|cockpit`, `lang=en|ko`, or `touch=1` to select the view, language, and touch layout. Add `fx=0` to disable Stage 7b effects. The low-water fixture flies at a fixed 25 m of terrain clearance within the existing LOW band.

The final RTX 4090 Chromium run sampled 300 animation-frame intervals per view using `?fixture=bullets&stress=1&flight=boost`. The fixture sustained the Warden, 24 regular enemies, 80 desktop or 50 phone Gnats, 192 shots (64 hostile), and 16 mines while banking and boosting with live wingtip trails. Both 1920×1080 desktop (960×540 buffer) and 390×844 emulated portrait at DPR 3 (336×727 buffer) measured 60.00 FPS in every view. Frame p95 was 16.7 ms in TOP and CHASE and 16.8 ms in COCKPIT at both sizes.

## Stage 7f merge

Fidelity adds finer airframes and salvage sprites and lets the player select an adaptive render quality. Quality changes resize the Stage 7b post targets alongside the world buffer. The three-view replay gate retained all 24 Stage 7a hashes, and fidelity on/off tests retain the same terminal state. The 100-seed Heat 0 batch per pilot produced byte-identical JSON and CSV before and after integration on each cap. See the [Fidelity lane notes](lanes/S7f.md) for the model budgets and render quality settings.

| Pilot | Clears before → after | Warden defeats before → after | Median survival before → after | Median run | Median kills |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skilled | 96% → 96% | 95% → 95% | 600.0 → 600.0 s | 592.6 s | 744.5 |
| Average | 65% → 65% | 64% → 64% | 600.0 → 600.0 s | 590.4 s | 696 |
| Weak | 5% → 5% | 2% → 2% | 276.4 → 276.4 s | 276.4 s | 191.5 |

The integrated max-load boost fixture at High measured p95 frame times of 16.8/16.7/16.7 ms in desktop TOP/CHASE/COCKPIT, and 16.7/16.8/16.7 ms in emulated portrait. Chromium recorded 300 intervals per view using ANGLE Vulkan on an RTX 4090. Desktop used 1920×1080 and portrait 390×844. The desktop COCKPIT repeat averaged 59.8 FPS with one dropped interval after warming up. The other five view and viewport combinations averaged 60.0 FPS.

## Stage 7e merge

Red Kite replaces the Warden, which changes the terminal replay hashes once. The merge matches all four [Roster lane digests](lanes/S7e.md) across the six Legacy and six Survivors seeds on each cap. Recorded inputs reproduce the same hashes, and fidelity-on and fidelity-off runs still agree. Legacy clears took 110.53–125.13 s with 40–44 regular kills. Survivors cleared in 529.05–545.27 s with 696–797 regular kills.

The Ace and Aegis share the Fidelity voxel grid and quality switch. Their fine models retain the authored envelopes and use 1,490 and 292 triangles respectively. The banked rear feed keeps the forward camera's attitude while tracking a pursuer. The shared audio mixer leaves the default volume linear and caps peaks when multiple new enemy warnings overlap.

Each cap ran 100 seeds per pilot at Heat 0. Both caps gave the same combat results. A clear includes a boss kill or a live timeout.

| Profile | Clear incl. timeout before → after | Boss wins before → after | Median survival before → after | Median run length before → after | Median regular kills before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skilled | 96% → 99% | 95% → 99% | 600.0 → 600.0 s | 592.6 → 545.2 s | 744.5 → 780 |
| Average | 65% → 57% | 64% → 42% | 600.0 → 600.0 s | 590.4 → 570.0 s | 696 → 767 |
| Weak | 5% → 14% | 2% → 0% | 276.4 → 266.4 s | 276.4 → 266.4 s | 191.5 → 235.5 |

All 14 weak clears were live timeouts. Peak live Gnats grew from 41 to 49. Global tuning follows the World merge in Stage 7c.

High quality stayed active throughout the RTX 4090 boost stress samples with the Ace and the full swarm caps. P95 in desktop TOP/CHASE/COCKPIT was 16.7/16.8/16.7 ms and portrait was 16.7/16.7/16.7 ms. Desktop COCKPIT averaged 59.8 FPS and the other five combinations averaged 60.0 FPS.

## Stage 7d merge

The 1,792 m reference radius covers 10.24 times the original arena area. Terrain, spawns, and local NAV use signed world coordinates. Red Kite checks the current rally at deployment and picks a local intercept if the pilot has left it. Deployment, flight, and checkpoint repair use the same altitude resolver and preserve the saved LOW, MID, HIGH, and SKIM IDs. Older checkpoints migrate skimmers, turrets, and pending flak to the terrain-relative band.

The terrain, relative spawns, and Ace interception change the replay hashes. All six Legacy and six Survivors seeds cleared in all views on each cap and matched on recorded-input replay. Legacy cleared in 112.38–115.48 s with 35–41 kills. Survivors cleared in 527.55–554.42 s with 724–798 kills. Each digest uses the six terminal hashes in seed order, joined by newlines without a trailing newline.

| Mode | Desktop digest | Mobile digest |
| --- | --- | --- |
| Legacy | `af3d24241b3189d75139497318fd8c598b836eb61aa99f106b4232e013dd1e86` | `a00ae83151d156c620e7e5b91cdd072e8812829242868e665f76e9f45acc0ea3` |
| Survivors | `e927f67d2efcf11eb4f30e1f9303773ae88ea6f3b658a02cb5b250007f5f7e1f` | `35201c443e9c9941cab4175ca372392ab13f5cdfa8079f1d1c5b095a1eb3fd32` |

The isolated [World lane](lanes/S7d.md) used the Warden. Its 100-seed results per cap were as follows.

| Profile | Clear before → after | Boss kill before → after | Survival p10 / median / p90 before → after (s) | Median sortie before → after (s) | Median end HP before → after | Median kills before → after | Median level-ups before → after |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Skilled | 96% → 88% | 95% → 87% | 600.0 / 600.0 / 600.0 → 582.1 / 600.0 / 600.0 | 592.6 → 592.6 | 10.5 → 11 | 744.5 → 768 | 26 → 26 |
| Average | 65% → 38% | 64% → 38% | 542.5 / 600.0 / 600.0 → 190.6 / 585.0 / 600.0 | 590.4 → 585.0 | 5.5 → 0 | 696 → 697 | 25 → 25 |
| Weak | 5% → 5% | 2% → 0% | 87.2 / 276.4 / 567.2 → 88.7 / 199.0 / 519.5 | 276.4 → 199.0 | 0 → 0 | 191.5 → 133.5 | 12 → 9 |

The integrated batch uses Red Kite, seeds 1–100, and Heat 0. Both caps gave identical per-seed combat outcomes.

| Pilot | Clear before → after | Ace wins before → after | Median survival before → after | Median end hull before → after | Median kills before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skilled | 99% → 98% | 99% → 98% | 600.0 → 600.0 s | 12 → 10 | 780 → 779.5 |
| Average | 57% → 31% | 42% → 26% | 600.0 → 550.1 s | 2.5 → 0 | 767 → 765 |
| Weak | 14% → 8% | 0% → 0% | 266.4 → 193.1 s | 0 → 0 | 235.5 → 150 |

The integrated peak was 48 live Gnats. The average clear rate and weak median survival are below target and set the baseline for Stage 7c.

High quality max-load p95 in TOP/CHASE/COCKPIT was 16.7/16.8/16.8 ms at 1920×1080 and 16.7/16.7/16.7 ms in 390×844 emulation. The native RTX 4090 run sampled 300 frames in each view. Desktop COCKPIT averaged 59.6 FPS after two dropped intervals on the warmed repeat. A live remote SKIM run crossed a streamed chunk, climbed out of SKIM, then returned to 30 m clearance.

## Roster silhouette review

Open `?fixture=roster-sheet&kind=hound&lang=en` for a fixed three-quarter CHASE view from 88 m. The `kind` parameter accepts every enemy kind, plus `carrier` and `ace`. Use `lang=ko` for Korean or `touch=1` to force touch layout. The fixture holds the flight tick for comparable captures.

Hound uses tapered copper wings and a bright intake. Flanker has cyan twin booms, Harrier a pale swept frame, Diver navy and gold delta wings, Bomber broad olive wings with separated engines, and Turret a raised octagonal receiver with twin barrels. Their fine variants use the shared 2× voxel grid. The High full stress mix went from 17,852 to 18,026 triangles against a 21,000 cap. Low mobile stress fell from 8,626 to 8,520 against a 10,000 cap. The full replay records match the World merge byte for byte.

## Stage 7c flight and world scale

Cruise is 104 m/s, sustained boost is 182 m/s, and ignition starts at 202 m/s before easing to boost over 15 ticks. Player and Ace keep the same bank-to-turn response. A full-stick 180° turn still takes 92 ticks at cruise and 81 under boost. At established full bank, turn radius goes from 15.4 to 21.6 m at cruise and from 22.9 to 32.1 m under boost. The initial roll-in costs more space. Lateral displacement across a full turn from wings-level goes from 35.9 to 54.7 m at cruise and from 55.5 to 86.2 m under boost.

The barrel roll shifts 40 m in 42 ticks. The aileron roll stays on its flight line, and the roll immunity and parry timings are unchanged. Horizontal Immelmann, Split-S, and J-turn travel doubles. Altitude bands and vertical speeds keep their original values. Hound and Harrier tail bolts can catch a steady 104 m/s target, with the inclusive 8 m altitude hit window still in effect. Sustained boost can outrun those bolts. Ace missiles can still overtake boosted flight. Pickup attraction and collection scale with travel, and pull distance clamps to the remaining gap.

The 1,536 m world-site grid covers about 14.8 seconds of straight cruise per cell. Across the 100 tuning seeds the median trip to a cardinal neighbor is 15.0 s, with a 10th–90th percentile range of 11.0–19.2 s. Old checkpoints refresh stale site coordinates and retain claimed site IDs. Rendering streams 512 m chunks at up to six generations per draw. Inner tiles retain the shared 16 m gameplay surface, and the outer rings use stitched 64 and 128 m steps. Desktop and portrait fog reach up to 2,040 and 1,480 m respectively. Tactical radar covers 420 m and the NAV map covers 1,536 m. CHASE base setback grows 40% to preserve ship detail, and the cockpit camera stays attached to the airframe.

The desktop control line includes Shift+Space for roll in both languages. The portrait layout puts roll on its dedicated touch target.

### Balance method

Pilot sight and steering distances scale with speed. Threat and roll prediction still measure time to closest approach in seconds, using the actual horizontal collision radii. The average pilot uses less aim error and takes more opportunities to dodge, roll, change bands, and lead the Ace. The weak pilot lines up attacks more directly while collecting fewer pickups, rolling less often, and drafting less reliably. Weapon damage, armor, enemy HP, the 8:00 Ace entry, and the 10:00 deadline retain their pre-rescale values.

Tuning used seeds 1–100 at Heat 0. The first validation on seeds 1000–1099 reached 67% average clears and 12% weak clears, outside the targets. The next settings came from candidates already measured on the tuning range. Seeds 1000–1099 were rerun for comparison, and seeds 2000–2099 supplied an independent desktop check. Each range runs 100 seeds per profile. The tuning and original validation ranges run on both the 80 desktop and 50 mobile Gnat caps. A clear includes a boss victory or a live timeout. Survival counts those completed runs through the common 600 s time horizon.

Desktop and mobile gave identical per-seed combat outcomes on the two required ranges. The baseline in each row is the integrated World merge.

| Seeds | Pilot | Clear before → after | Ace wins before → after | Median survival before → after (s) | Median end hull before → after | Median level-ups before → after |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1–100 | Skilled | 98% → 95% | 98% → 94% | 600.0 → 600.0 | 10 → 13 | 26 → 26 |
| 1–100 | Average | 31% → 57% | 26% → 50% | 550.1 → 600.0 | 0 → 1.5 | 25 → 26 |
| 1–100 | Weak | 8% → 6% | 0% → 0% | 193.1 → 266.4 | 0 → 0 | 10 → 12.5 |
| 1000–1099 | Skilled | 94% → 98% | 94% → 96% | 600.0 → 600.0 | 10 → 12 | 26 → 26 |
| 1000–1099 | Average | 45% → 55% | 35% → 45% | 575.2 → 600.0 | 0 → 2 | 26 → 27 |
| 1000–1099 | Weak | 6% → 4% | 0% → 0% | 194.2 → 274.5 | 0 → 0 | 10 → 14 |

The additional desktop range, seeds 2000–2099, recorded 99% skilled, 53% average, and 6% weak clears. Skilled ended with a median 11.5 hull and weak survived a median 276.8 s. Weak clears in all three ranges were live timeouts. The required ranges peaked at 49 and 48 live Gnats respectively and recorded zero cap-pressure beats on either cap.

In the additional range, the desktop weak pilot reached 53 live Gnats. The matching mobile weak batch peaked at 50 and recorded one cap-pressure beat on seed 2068. That seed timed out alive on desktop and ended in a loss on mobile. The mobile weak clear rate was 5%, with a 276.8 s median survival.

### Replay and render verification

Stage 7c rebaselines the terminal hashes once for the changed flight paths and combat ranges. Legacy and Survivors each cleared seeds 1, 11, 27, 42, 128, and 2026 on both caps. Every run used all three views and reproduced its terminal hash with recorded inputs. Legacy cleared in 112.50–118.18 s with 39–44 regular kills. Survivors cleared in 526.02–558.47 s with 725–783 regular kills. Fidelity rendering enabled and disabled still give identical simulation hashes.

| Mode | Desktop digest | Mobile digest |
| --- | --- | --- |
| Legacy | `5a032f314bacbff12fe8a257c3788acfdcab0c1184f4b33a86b8f32e42ae493c` | `40281177fc6926bc74baa7b4ac22e52bf192c4e43f852957c16f96fe52249e13` |
| Survivors | `d096f216e3a75786fa1de19e7207247454c67f37a73d7c7cc8ee0e808b103132` | `502301b0575a085145156341922c0cee95ea2819e539002728f628c71c9f8594` |

Each digest uses the six terminal hashes in seed order, separated by line breaks with no trailing break.

Native Chromium on the RTX 4090 used ANGLE Vulkan, the High tier, 180 warm-up intervals and 300 measured intervals per view. The remote stress fixture ran at 182 m/s and crossed a 512 m tile boundary in each sample, with phase-3 Red Kite, 24 regular aircraft, 80 or 50 Gnats, 192 projectiles including 64 hostile shots, and 16 mines. The portrait device was emulated at 390×844 CSS pixels and DPR 3.

| Layout | TOP mean FPS / p95 | CHASE mean FPS / p95 | COCKPIT mean FPS / p95 |
| --- | ---: | ---: | ---: |
| 1920×1080 | 60.0 / 16.7 ms | 60.0 / 16.7 ms | 59.6 / 16.7 ms |
| 390×844 | 60.0 / 16.7 ms | 60.0 / 16.8 ms | 60.0 / 16.7 ms |

High stayed active for all 1,800 standalone intervals. Desktop COCKPIT dropped two frames. A separate run during four CPU batch simulations switched desktop COCKPIT to Medium and measured a 33.3 ms p95. Twelve safe-area layouts checked both languages at 44 px minimum touch targets with no controls, NAV, or loadout overlap. This verification used browser emulation for phones.

## Swarm density escalation

The first tuning pass increased traffic throughout the run. On 100 desktop seeds, average clears fell from 57% to 49% and weak median survival fell from 266.4 to 177.0 seconds. The final curve keeps the opening budgets through 4:00 and starts the escalation at Siege. Red Kite arrives at 8:00 with the largest Gnat packs, split across two altitude bands. The last phase runs through the 10:00 deadline.

| Phase | Regular spawns/min before → after | Regular cap before → after | Gnats/min before → after | Pack size before → after |
| --- | ---: | ---: | ---: | ---: |
| Coast | 14 → 14 | 8 → 8 | 25 → 25 | 6 → 6 |
| Skirmish | 16 → 16 | 16 → 16 | 55 → 55 | 9 → 9 |
| Siege | 18 → 19 | 24 → 26 | 90 → 120 | 12 → 16 |
| Storm | 20 → 23 | 24 → 30 | 130 → 180 | 14 → 18 |
| Ace | 8 → 28 | 14 → 34 | 60 → 250 | 10 → 22 |

The Gnat caps are 80 on desktop and 50 on phones. The renderer still draws Gnats in a single instanced batch and regular airframes in one batch per kind. The patrol, shadow, entry trail, and pursuit marker pools have space for the larger regular cap. Enemy HP, XP, and pickup tuning retain their prior values.

The baseline is `b8c602d`. Each cap used Heat 0 and seeds 1–100 per profile. A clear is an Ace defeat or a live timeout. Successful runs count as surviving 600 seconds, including when the Ace falls earlier.

| Cap | Pilot | Clears before → after | Ace wins before → after | Median survival before → after (s) | Median level-ups before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | Skilled | 95% → 97% | 94% → 96% | 600.0 → 600.0 | 26 → 30 |
| Desktop | Average | 57% → 61% | 50% → 52% | 600.0 → 600.0 | 26 → 30 |
| Desktop | Weak | 6% → 9% | 0% → 0% | 266.4 → 265.0 | 12.5 → 13 |
| Phone | Skilled | 95% → 97% | 94% → 94% | 600.0 → 600.0 | 26 → 30 |
| Phone | Average | 57% → 60% | 50% → 49% | 600.0 → 600.0 | 26 → 30 |
| Phone | Weak | 6% → 9% | 0% → 0% | 266.4 → 265.0 | 12.5 → 13 |

Desktop reached 73 live Gnats with zero cap-pressure beats. The phone cap reached 50 and limited 1,001 spawn beats across 300 runs. The largest regular-plus-Gnat count in each minute is the maximum observed on a single tick across all three profiles. It includes live approaches and turrets. The Ace is tracked separately. The instrumented counts reproduced every CLI terminal hash on both caps.

| Mission minute | Desktop peak before → after | Phone peak before → after |
| --- | ---: | ---: |
| 0–1 | 22 → 22 | 22 → 22 |
| 1–2 | 27 → 27 | 27 → 27 |
| 2–3 | 38 → 38 | 38 → 38 |
| 3–4 | 42 → 42 | 42 → 42 |
| 4–5 | 42 → 49 | 42 → 49 |
| 5–6 | 48 → 56 | 48 → 56 |
| 6–7 | 59 → 79 | 59 → 69 |
| 7–8 | 63 → 76 | 63 → 68 |
| 8–9 | 36 → 97 | 36 → 73 |
| 9–10 | 31 → 99 | 31 → 75 |

### Replay verification

The full-view pilot cleared all 24 mode, cap, and seed combinations using seeds 1, 11, 27, 42, 128, and 2026. Recorded inputs reproduced all 24 terminal hashes. The updated Survivors golden covers the new spawn curve. Legacy terminal hashes match the baseline. Each digest hashes the six terminal hashes in seed order, joined by newlines without a trailing newline.

| Mode | Desktop digest | Phone digest |
| --- | --- | --- |
| Legacy | `5a032f314bacbff12fe8a257c3788acfdcab0c1184f4b33a86b8f32e42ae493c` | `40281177fc6926bc74baa7b4ac22e52bf192c4e43f852957c16f96fe52249e13` |
| Survivors | `78539053dab3c5e7b87f58af2c26a93a67e05bea512a7aeca639983a79fd3b3c` | `4acb1f5c69916cfd2a6aeef674c49c964793455e1f460cf87f49120eac60cd33` |

### Native CHASE performance

Chromium 149 with ANGLE Vulkan on an RTX 4090 rendered the live Survivors time seeks. Each case used at least 132 warm-up frames and 360 consecutive measured intervals at High quality. The 1:00 and 9:00 cases used seed 2 and the 5:00 case used seed 1. Counts are sampled live mission contacts including the active Ace at 9:00. Desktop used 1280×800 at DPR 1 and emulated portrait used 390×844 at DPR 3.

| Layout | Seek | Live contacts before → after | Mean frame time before → after | p95 before → after |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 1:00 | 5–13 → 5–13 | 16.67 → 16.67 ms | 16.7 → 16.7 ms |
| Desktop | 5:00 | 3–18 → 8–25 | 16.67 → 16.67 ms | 16.7 → 16.8 ms |
| Desktop | 9:00 | 12–26 → 53–78 | 16.67 → 16.67 ms | 16.7 → 16.8 ms |
| Portrait | 1:00 | 5–13 → 5–13 | 16.67 → 16.67 ms | 16.7 → 16.7 ms |
| Portrait | 5:00 | 3–18 → 8–25 | 16.67 → 16.67 ms | 16.7 → 16.8 ms |
| Portrait | 9:00 | 12–26 → 49–69 | 16.67 → 16.67 ms | 16.8 → 16.7 ms |

All six candidate windows averaged 60.00 FPS. Each build's desktop 1:00 launch recovered from one WebGL context loss before warm-up. The measured flight windows recorded zero context losses and zero console or page errors. Raw traces and reports are under the local ignored `sim-out/trail-density/` directory.


## Ground AA merge

The twin cannon can now depress onto ground AA from any altitude band when no same-band fighter is in the forward cone, and strafe acquires turrets from every band. Flak still detonates at skim height with the existing hit window. The tell adds a muzzle flash and a lead line; those cues are render-only. The SKIM 1.25× ground-damage bonus is unchanged. Difficulty was left at the post-fix rates: there was no damage or spawn retune after the merge.

The official desktop Heat 0 batch used seeds 1–100 on the merged `renderer-proto` build (`a3b8cf8`, s8-flak plus the density curve from `5dd58c3`). A clear is an Ace defeat or a live 10:00 timeout. Successful runs count as surviving 600 seconds, including when the Ace falls earlier. The density-only figures are from the previous section. Flak-only, before density, cleared 100% / 72% / 20% with a weak median of 518 s.

| Pilot | Clears density-only → merged | Ace wins density-only → merged | Median survival density-only → merged (s) | Median level-ups density-only → merged | Median kills merged | Median end hull merged |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Skilled | 97% → 100% | 96% → 100% | 600.0 → 600.0 | 30 → 29 | 1093.5 | 13 |
| Average | 61% → 74% | 52% → 61% | 600.0 → 600.0 | 30 → 30.5 | 1128.5 | 9 |
| Weak | 9% → 16% | 0% → 0% | 265.0 → 523.6 | 13 → 27 | 900 | 0 |

Average had 13% live timeouts. Weak survival was p10 147.2 / median 523.6 / p90 600.0 s, with 16% live timeouts. Desktop peaked at 72–73 live Gnats with zero cap-pressure beats.

### Replay verification

Seed-1 terminal hashes were regenerated for the combined build and reproduced with fidelity on and off, twice each.

| Mode | Seed-1 hash |
| --- | --- |
| Legacy | `12da2045628f47138ffef72b439e8fca4582fc24663cc4cab1ea1c675aba08ae` |
| Survivors | `a0203b724f1c3866d161333870441d5160d6ed2e5fcb12c47d8f93ff2090097f` |

The Legacy hash matches the flak-only build. Density does not change Legacy. The Survivors hash is new against both the density-only and flak-only goldens.

### Native CHASE performance

Chromium 149 with ANGLE Vulkan on an RTX 4090 rendered a live Survivors time seek at 8:00. The window used seed 2, 180 warm-up frames, and 360 consecutive measured intervals at High quality. Desktop was 1280×800 at DPR 1. The merged production bundle (`index-C-efB6Dm.js`) served from port 5181.

| Layout | Seek | Live contacts | Mean frame time | p95 |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 8:00 | 27 | 16.67 ms | 16.7 ms |

The window averaged 60.00 FPS. High stayed active. There were zero context losses and zero console or page errors during the measured flight. Frame p99 and max were 16.8 ms.

## Stage C altitude model

Stage C widens the flight envelope from 55–165 m to 49–230 m. The fixed bands move from 75/110/145 to 75/125/180, and SKIM drops from 30 m to 14 m above the terrain (10–18 m hold window). The floor is now SKIM height over the sea (35 + 14 m). The player cruise floor follows SKIM height, and a held dive aims 8 m below SKIM so it reaches the layer at speed. Hostile vertical rates, flare launch and fall, bombs and mines scale by 1.5×, so band changes keep their tick timing across the wider gaps. Flak half-height grows from 18 to 28 m so it still bridges two adjacent bands. The Ace now drops to SKIM height instead of stopping at its 22 m clearance.

The 100-seed desktop sims (seeds 1–100, heat 0) compare `renderer-proto` at `8265c4e` with Stage C:

| Profile | Clear (C-lite → C) | Ace kill | Timeout | End HP median | Kills median |
| --- | --- | --- | --- | ---: | ---: |
| Skilled | 100% → 100% | 98% → 97% | 2% → 3% | 12.5 → 13 | 1071.5 → 1083 |
| Average | 59% → 68% | 56% → 46% | 3% → 22% | 5.5 → 6 | 1084 → 1093.5 |
| Weak | 27% → 35% | 0% → 0% | 27% → 35% | 0 → 0 | 896.5 → 977.5 |

Survival rose for the average and weak pilots, because the wider gaps spread out contact. The average pilot kills the Ace less often (56% → 46%): more of its clears are now live timeouts while the Ace skims at 14 m. Tuning the Ace's SKIM time or the bot's low-band chase is the next balance question.

### Replay verification

The seed-1 golden hashes were rebaselined once for the changed flight paths: Legacy `d90af0cd…48ef2`, Survivors `21778f28…0b33`. Two runs reproduced both hashes.
