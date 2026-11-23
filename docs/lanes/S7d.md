# Stage 7d streamed Reach and SKIM

> 개발 이력: Stage 7d 작업 당시의 지형·저공 비행 기록이다. [위키 홈](../wiki/README.md)

Base commit `5a890c1` on the `s7d-world` lane. The sortie can fly continuously through signed world coordinates. The 1,792 m reference radius covers 10.24× the previous 560 m arena area. Terrain repeats every 16,384 m. The authored Reach landmarks occupy the starting region and blend into seed-specific terrain.

## Gameplay and rendering

- The 60 Hz simulation samples a continuous, constant-time height function of seed and position. A bounded vertex cache avoids repeated hashing. Terrain, site placement, and streaming leave the gameplay RNG streams independent.
- Regular formations, Gnats, and chest carriers enter around the player's projected position. Ground emplacements and skimmers prefer suitable land or water. Long-distance stragglers can re-enter near the player. The two scripted Legacy bomber beats reserve three contact slots ahead of each fly-in, using the cap on the entry tick. The reserved entry ticks are 4,110 and 5,310. The two formations keep their escort count, approach timing, and global cap.
- The seeded regions place beacon landmarks, supply drops, and XP wells. Supplies grant 60% boost and one bomb up to capacity. Wells grant four base XP through normal salvage credit even with a full orb pool. Claims persist across regions and checkpoints. At the Warden signal, distant pilots get a reachable rally near their position. Pilots near Reach still use Beacon Atoll.
- Terrain streams in 256 m chunks across 16/32/64 m mesh resolutions. Shared 16 m borders join the resolutions. Each draw generates at most six chunks. The desktop and phone windows cover up to 169 and 81 chunks respectively. The terrain group reuses mesh buffers and instanced foliage, rocks, water, and site markers. Fog fits the active window.
- Hold dive near the surface or perform a LOW Split-S to enter SKIM. Climb to leave it. SKIM follows the local floor at 30 m with a 25–35 m envelope during rolls. LOW, MID, and HIGH stay at 75, 110, and 145 m. SKIM increases magnet reach by 30% and turret damage by 25%. Turrets telegraph flak into SKIM and skimmers fly at terrain-relative altitude. The player exposes `skim: 'water' | 'land'` for spray and dust effects. The chase eye samples its own terrain and adjusts its aim as it rises over obstacles.
- Hostile shots keep physical altitude windows. LOW's lower-band Twin strafe reaches SKIM, and SKIM Twin can strafe turret bodies. Seeker, arc, Firebird, rail, Prism Lance, and Skybreaker use the added band where their coverage allows. Rail planes use the height at the emitter and remain terrain-occluded. Downward flight cues are suppressed while attached to SKIM. V1 checkpoint resume migrates skimmer and turret placement and pending flak altitude.
- The north-up map follows the player at a 768 m range. The 210 m tactical radar marks destinations out of range or aft. The localized objective shows bearing, range, and target altitude. Both altitude instruments show SKIM from the flight state.

## Verification

- `npm test` passed **398/398** and `npm run build` passed. Regressions cover streamed seams and budget, distant spawns, SKIM transitions and weapons, chase eye clearance in both viewports, wells at the pickup cap and revisits, v1 resume, suppressed DIVE cues, and both bomber formations under a saturated patrol cap. The Galmuri11 subset covers all 394 Korean syllables in the translation table.
- The replay gate uses seeds `1, 11, 27, 42, 128, 2026`. Both modes cleared all six seeds on each swarm cap and used all three views. Legacy cleared in 123.90–135.55 s with 43–46 kills. Survivors cleared in 589.27–592.98 s with 731–774 kills. Reapplying the recorded inputs reproduced every terminal SHA-256. The combat observer test also matched hashes with callbacks enabled and disabled.
- The streamed world, local spawns, and SKIM intentionally change state and replay digests. The table records the Stage 7d baseline. Each digest is SHA-256 over the six terminal `JSON.stringify(state)` SHA-256 values joined by newlines in the seed order above.

| Replay mode | Desktop digest | Phone digest |
| --- | --- | --- |
| Legacy | `42429c777097ef712bbfbc80f6fa472a00f27acf5d758d939fea28de8c752166` | `6aa2ffa546363c3b195965bee229db77dd1f60368cd53dc9b94bb5462eb4f62c` |
| Survivors | `90c38f382cb330c34bead1a5ae9d535f3717c7e9165d0975667da12b8c5f4721` | `c0d4bfd9fcfcef437b4d0311cb872e30c4e546a8c520fd1fa314e0aae47b9709` |

## Browser fixtures

The 20 PNGs are under `/home/total/grok_bot/full-run/stage7/d/`. Captures use 1280×800 desktop and 390×844 portrait at DPR 3, saved at CSS viewport dimensions. TOP, CHASE, and COCKPIT were captured in English and Korean on land, with English water and both chase-clearance views included. The cockpit captures include the rear mirror. Chromium measured at least 44×44 px for the touch controls and detected zero intersections among the checked controls, NAV and loadout. The layout suite also exercises synthetic safe-area insets.

- Land and local NAV `?fixture=world&seed=19&x=3612&z=2387&alt=skim&view=top&lang=en`
- Water `?fixture=world&seed=19&x=2787&z=1673&alt=skim&view=chase&lang=en`
- Sea-stack camera `?fixture=world&x=288&z=286&alt=skim&view=chase` on desktop. Use `z=302&touch=1` on portrait.
- Set `view` to `top`, `chase`, or `cockpit`, `lang` to `en` or `ko`, and `touch=1` for phone controls. Add `live=1` to fly from a fixture pose. The browser verified a remote chunk crossing followed by keyboard climb out of SKIM and dive back in.

## Performance

Headless Chromium with ANGLE Vulkan on the RTX 4090 measured 300 consecutive `requestAnimationFrame` intervals per view after warming up the production build. The `?fixture=bullets&stress=1` fixture held the Warden, 24 regular contacts, 80 desktop or 50 portrait Gnats, 192 shots, and 16 mines. All samples held 60.0 FPS. The portrait run used Chromium device emulation at DPR 3.

| View | 1920×1080 p95 | 390×844 p95 |
| --- | ---: | ---: |
| TOP | 16.8 ms | 16.7 ms |
| CHASE | 16.7 ms | 16.8 ms |
| COCKPIT with rear mirror | 16.7 ms | 16.7 ms |

## Simulation impact

Ran `npm run sim -- --profile all --seeds 100` and the same command with `--mobile` at `5a890c1` before implementation and on the finished lane. Each batch uses seeds 1–100 at Heat 0. Desktop and mobile outcomes matched per seed in both revisions. Peak live Gnats were 41 for all profiles in both revisions. Clear includes a boss kill or survival to the 600 s timeout. Survival time uses the 600 s horizon for boss winners.

| Profile | Clear before → after | Boss kill before → after | Survival p10 / median / p90 before → after (s) | Median sortie before → after (s) | Median end HP before → after | Median kills before → after | Median level-ups before → after |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Skilled | 96% → 88% | 95% → 87% | 600.0 / 600.0 / 600.0 → 582.1 / 600.0 / 600.0 | 592.6 → 592.6 | 10.5 → 11 | 744.5 → 768 | 26 → 26 |
| Average | 65% → 38% | 64% → 38% | 542.5 / 600.0 / 600.0 → 190.6 / 585.0 / 600.0 | 590.4 → 585.0 | 5.5 → 0 | 696 → 697 | 25 → 25 |
| Weak | 5% → 5% | 2% → 0% | 87.2 / 276.4 / 567.2 → 88.7 / 199.0 / 519.5 | 276.4 → 199.0 | 0 → 0 | 191.5 → 133.5 | 12 → 9 |

Skilled and average clears, and weak median survival, are below the Stage 7 balance targets. Weak pilots' five clears were timeouts. The lane adds `skimUse` by profile and keeps the global speed, damage, and pacing tuning for S7c.

## Merge notes

The scene changes remove the static terrain, canopies, and rim geometry and add a stream mount and update, fog bounds, and chase clearance. Keep those hooks when merging the S7b camera and atmosphere changes. The altitudes and `player.skim` are available to S7b effects and the S7e roster. S7c owns global speed and balance tuning.

Shared files changed include `src/scene.ts`, `src/stage.ts`, `src/autoplay.ts`, `src/bot.ts`, and `src/i18n.ts`. Stage 7d also needed `index.html`, `src/main.ts`, `src/stage-types.ts`, `src/stage-enemies.ts`, `src/stage-combat.ts` beyond band constants, `src/ranged-weapons.ts`, `src/bills.ts`, `src/chests.ts`, `src/swarm.ts`, `src/maneuvers.ts`, `src/cockpit.ts`, `src/cockpit-display.ts`, the numeric HUD and font, `src/data/bot-profiles.ts`, `src/data/hud.ts`, `src/data/navigation.ts`, `src/data/terrain-stream.ts`, `tools/sim.mjs`, and the relevant tests. The scripted reservation is the only spawn-director change beyond placement.

Physical phone and Safari performance remain unmeasured. The cockpit horizon samples the 16 m gameplay surface, so the far silhouette can differ slightly where the renderer uses coarser terrain.
