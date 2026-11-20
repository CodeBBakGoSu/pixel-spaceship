# ASTER WING balance notes

## Stage 1

New browser sorties use the phase director. The previous sortie is available with `?mode=legacy`, and the existing fixtures and replay entry point keep their previous defaults.

- The phase budgets from the design describe scheduled spawn opportunities. Terrain, formation size, live caps, and the pilot's route affect how many contacts arrive and get destroyed. Gnats have 1 HP and give 1 XP. They pass through the player and do not fire. The optional Sting variant is outside this pass.
- Regular kills give three times their legacy XP. Level costs use `14 + round(2.4 × current level)`. The first deck contains Twin Cannon, Wing Pods, and fallback cards. An overcharged or high-risk card grants two levels when the item has room. The high-risk pick costs one hull and is unavailable at one hull. A skip keeps the earned XP toward the next level.
- The long sortie has the 8:00 Warden arrival and 10:00 timeout so headless replays exercise every phase. Hull starts at 8 in this pass. Phase repair, chest and Bill rewards, and the unlock-quest pool enter in later stages.
- The six full-view replays cleared in 498.53–502.80 s with 522–553 kills and 21–22 level-ups. The 26–28 level-up target includes later reward sources and remains a tuning target.

The instanced Gnat airframe costs 16 triangles. At the caps it adds 1,280 desktop or 800 mobile triangles to the existing airframe budget. Player and hostile projectile pools allow 128 and 64 live projectiles respectively. Excess salvage orbs merge at 150 and keep their XP.
