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
