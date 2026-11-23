# Stage 7f fidelity

> 개발 이력: Stage 7f 작업 당시의 그래픽 품질 설정이다. [위키 홈](../wiki/README.md)

Baseline `5a890c1`, lane `s7f-fidelity`. Graphics quality lives in the title and pause menus and persists in `aster.render-quality`.

| Setting | Desktop world buffer at 1920×1080 | Portrait world buffer at 390×844 | Airframes |
| --- | ---: | ---: | --- |
| High (default) | 1920×1080 | 390×844 | Fine |
| Medium | 960×540 | 336×727 | Fine |
| Low | 640×360 | 195×422 | Stage 7a meshes |

High renders one world pixel per CSS pixel. Desktop Medium and Low use exact 2× and 3× CSS pixels, clipping up to two spare pixels at the viewport edge. Phone Medium retains the old buffer at typical phone sizes and clamps it between the other settings. At 1280×800 the 1.5× comparison used 854×534. The fractional presentation widened some nearest-neighbour steps and softened one-pixel lines on the hull and rear bezel. The 1× capture kept those edges consistent, so High uses 1×.

During flight, 120 sampled frame intervals determine p95 after 24 settling frames. A window above 16.8 ms lowers the active quality one step. Long active stalls count. Pause, visibility changes, and viewport changes clear the sampling window. Reloading or changing the menu setting starts a new window at the preferred tier. Menu shortcuts yield to a focused select or input.

## Art and budgets

The player hull uses 0.155 m voxels. Patrol, Interceptor, Skimmer, Spotter, Hound, Flanker, Harrier, Diver, Bomber, Turret, and Warden all use half-size voxels. The old hull envelopes, hardpoints, and exhaust sockets stay aligned. Fine meshes add wing chamfers, panel lines, service hatches, and canopy reflections. The Gnat remains one instanced draw with a 24-triangle fine mesh and a 16-triangle Low mesh.

| Model or load | Detailed triangles | Test cap |
| --- | ---: | ---: |
| Player | 2,918 | 3,400 |
| Warden | 3,396 | 3,600 |
| Regular airframe | 310–590 each | 1,200 each |
| Player + largest legal 24-enemy wave + 80 Gnats | 16,362 | 17,500 |
| Player + Warden + legal 14-enemy wave + 80 Gnats | 15,314 | 16,500 |
| Player + Warden + 24 enemies + 80 Gnats | 19,758 | 21,000 |
| Low player + Warden + 24 enemies + 50 Gnats | 9,280 | 10,000 |

The caps accommodate the finer exposed surfaces while bounding the largest per-kind mix. Greedy baking merges contiguous faces and the same instance batches switch between cached geometries. Weapon attachment and rear camera layer budgets are unchanged.

Salvage uses a nearest-sampled 12×12 atlas. An XP orb has a mint core and two halo steps. The existing gold XP tier (`xp >= 2`) has a rim and a glint animated from the sortie tick. Opaque faces write depth before translucent halos blend through the same depth buffer. TOP gives a coin a small depth offset so its rim remains visible over an overlapping orb on the flattened plane. Faces and halos share the instance buffer, and magnet trails retain their separate batch. The full 150-pickup case costs at most 2,400 triangles including 150 trails, down from 3,600 with the two box batches.

## Determinism and simulations

Both `npm run sim -- --profile all --seeds 100` and the same command with `--mobile` produced byte-identical JSON and CSV at `5a890c1` and S7f. Each report includes all 300 terminal state hashes. The two swarm caps gave the same outcomes and summary statistics.

| Pilot | Clears before → after | Warden defeats before → after | Median survival before → after | Median run | Median kills |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skilled | 96% → 96% | 95% → 95% | 600.0 → 600.0 s | 592.6 s | 744.5 |
| Average | 65% → 65% | 64% → 64% | 600.0 → 600.0 s | 590.4 s | 696 |
| Weak | 5% → 5% | 2% → 2% | 276.4 → 276.4 s | 276.4 s | 191.5 |

The full-view seeds `1, 11, 27, 42, 128, 2026` cleared in both modes on both caps. All 24 terminal hashes matched Stage 7a. Legacy runs lasted 122.47–131.83 s with 44–46 kills. Survivors runs lasted 589.55–596.48 s with 655–775 kills. The seed-1 regression tests also compare both modes to their Stage 7a hashes with pickup rendering and adaptive quality on and off.

`npm test` passed 396 tests. `npm run build -- --configLoader runner` passed using the worktree's existing dependencies.

## Frame timing

Headless Chromium with ANGLE Vulkan on an RTX 4090 ran the production builds with `?fixture=bullets&stress=1&view=overhead|chase|cockpit`. Recorded 300 `requestAnimationFrame` intervals per view after 45 warm-up frames. The fixture replenished the Warden, 24 regular enemies, 80 desktop or 50 portrait Gnats, 192 projectiles including 64 hostile, 150 salvage pickups, and 16 mines. Desktop was 1920×1080 at DPR 1. Portrait was 390×844 in Chromium touch emulation at DPR 3. The S7f build stayed at High for every measured interval.

| View | Desktop p95 ms before → after | Portrait p95 ms before → after | Desktop mean FPS before → after | Portrait mean FPS before → after |
| --- | ---: | ---: | ---: | ---: |
| TOP | 16.8 → 16.8 | 16.8 → 16.7 | 60.0 → 60.0 | 60.0 → 60.0 |
| CHASE | 16.7 → 16.7 | 16.7 → 16.8 | 60.0 → 60.0 | 60.0 → 60.0 |
| COCKPIT | 16.7 → 16.8 | 16.7 → 16.8 | 60.0 → 57.1 | 60.0 → 59.2 |

The COCKPIT repeat reached 60.0 FPS, p95 16.7 ms and max 16.8 ms in both sizes. A separate browser run delayed every eighth flight frame by at least 250 ms. It reached Low after 35 long frames, passing through Medium and keeping High as the preferred setting.

## Browser fixtures

Use `?fixture=fidelity&view=chase&quality=high&lang=en` for the fixed lineup. `view=overhead` shows the hulls from above, and `view=cockpit` shows the close-up and the rear mirror. `touch=1` selects the phone layout, `lang=ko` selects Korean, and `kind=bomber` (or any existing enemy kind) selects the featured aircraft. On desktop, `compare=1.5` uses the fractional buffer for comparison. `overlap=near-first` and `overlap=far-first` reverse the same salvage pair to check depth order.

The screenshot folder is `/home/total/grok_bot/full-run/stage7/s7f/`. The `before-*` captures use the Stage 7a renderer with the same frozen fixture pose. Screenshots cover 1280×800 desktop and 390×844 portrait, TOP, CHASE, and COCKPIT with rear mirror, in EN and KO. The paired `detail-*` crops use nearest-neighbour enlargement where needed. `detail-roster.png` shows each enemy and the Warden in Chromium. The isolated preview used port 5193.

The two pickup insertion orders rendered identical PNGs in all three views on both layouts. The browser also checked keyboard routing with both menu form controls focused, Korean quality selection after reload, and the controls against NAV and loadout at 390×844 and 844×390 with simulated safe areas. The regenerated Galmuri subset covers all 463 translated codepoints in the Korean strings.

## Merge notes

- Lane B can use `refineVoxelModel(model, detail?)` and `AIRFRAME_VOXEL_SUBDIVISIONS` from `src/voxel.ts`. Bake at `originalSize / AIRFRAME_VOXEL_SUBDIVISIONS`. The optional callback receives `(x, y, z, material, sample)` in the old model's local grid units and returns a material ID. `sample(x, y, z)` looks up the old grid. The helper adjusts the pivot so world-space hardpoints stay aligned. Keep index `0` for air, preserve the livery indices, and append related 8-bit sRGB panel and canopy colors so the baker can merge spans.
- Register S7e's already-fine new aircraft explicitly in the scene model construction and keep its Ace boss path. The legacy model table describes the Stage 7a airframes.
- Put S7b's post-buffer sizing beside the world target resize in `FlightScene.resizeWorldBuffer` so a quality change resizes dependent targets during flight. The integrated effects still need a max-load timing check.
- Keep the Stage 7a replay goldens for renderer changes. Document and update the golden hashes when a gameplay lane intentionally changes the replay.
- Shared edits cover model and quality wiring in `src/scene.ts`, menu/fixture wiring in `src/main.ts`, `index.html`, `src/style.css`, two translation blocks in `src/i18n.ts`, and the regenerated Galmuri subset. `src/layout.ts` changes are confined to buffer sizing.
