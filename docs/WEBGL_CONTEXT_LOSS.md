# WebGL context loss

The release-blocking exception is a race in Three.js r170. When loss begins during the first use of a shader program, the native context can already return a null info log while Three still considers the context live. Three calls `.trim()` before its shader error callback and the thrown exception aborts the game's animation callback before it requests the next frame.

An isolated Chromium 149 run on RTX 4090 reproduced the original stack from `5f92897`. The harness requested `WEBGL_lose_context` inside the first real `getProgramInfoLog` call at 249.5 ms. The call returned null with `isContextLost()` true, Three threw from its program diagnostics, and the corresponding canvas event arrived at 257.3 ms. The audio decoder had made zero calls. This isolates the fatal application path. The initiating trigger for the earlier spontaneous driver loss remains unconfirmed.

## Revision and harness comparison

Each revision used the same native headless Vulkan renderer flags and one browser at a time. Four trials per revision started at the title and entered CHASE. Three launched cold and one reloaded the same tab. Each reached flight tick 107 or 108. Each snapshot exposed the same renderer-info getter.

| Revision | Stage | Native losses / trials | Audio decodes per trial |
| --- | --- | ---: | ---: |
| `e16a200` | Stage 7b | 0 / 4 | 0 |
| `ee2b8b1` | Fidelity merge | 0 / 4 | 0 |
| `084ad18` | Before Stage 7c | 0 / 4 | 0 |
| `8deb5f6` | Stage 7c | 0 / 4 | 0 |
| `5f92897` | Generated audio | 0 / 4 | 10 |

Six additional trials on unmodified `5f92897` from port 5181 gave zero spontaneous losses. All six decoded ten samples after the trusted title interaction. Native Chromium used `--use-gl=angle --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface` and reported RTX 4090 through `WEBGL_debug_renderer_info`. Default headless Chromium and `--use-gl=angle --use-angle=egl` selected SwiftShader on this host. Each software comparison completed four short trials. Read-only NVIDIA telemetry showed both RTX 4090s on driver `560.35.03` at 2 MiB and 0% GPU use at kickoff. During the native trials the Chromium GPU process appeared on GPU 0. The accessible kernel log contained no event for the earlier incident.

The isolated headed comparison also selected RTX Vulkan. It completed one cold and one reload trial each before and after audio, with zero losses or errors. That display used a private local X socket and no TCP listener. A separate test shared one headless browser GPU process across three independent contexts with one flight page each. All three reached tick 136, decoded ten clips, and reported zero losses or errors. Observed GPU 0 allocation reached 168 MiB. These short comparisons do not establish a spontaneous loss trigger.

## Resource ownership

All five revisions use Three.js 0.170.0. The audio commit leaves the scene, terrain streamer, and post chain unchanged. A pre-audio roster capture also encountered a cold native context loss. That earlier capture was exploratory. The controlled trials and the reproduced null-log exception leave audio decode unsupported as a cause.

The terrain streamer reuses 169 chunk slots and three shared LOD index buffers. Stage 7c increased the fixed vertex arrays from 17×17 to 33×33 per slot. It retains the same slot count and up to six chunk builds per draw. The renderer owns one world target, one rear-view target, and two lazily allocated bloom targets. Three's `RenderTarget.setSize()` disposes the previous attachments when dimensions change. Airframe meshes swap between fixed coarse and detailed assets.

The instrumented `5f92897` baseline ran seed 57 through 36,000 ticks in all three views. It recorded 62 samples at ten-second intervals, 59.93 mean RAF FPS, no context loss, and ten successful audio decodes. Geometry uploads settled at 221–224 after the initial pool and model warm-up. Textures stayed at 7–9, programs at 21–23, and live framebuffers at 3–4. At the terminal sample, 230 framebuffers had been created and 226 deleted. Adaptive quality switched from High to Medium around mission time 6:50, and the total memory in use on GPU 0 fell from 114 to 102 MiB. The transition released the old framebuffer attachments. Live resource counts stayed bounded over the full run.

The baseline and candidate soak snapshots expose the renderer's actual `info` object. A localhost Playwright route fulfills each snapshot without a separate preview server. The snapshots feed controls from the existing deterministic average pilot so combat continues to the full 10:00 deadline. The default full-view pilot found no 36,000-tick run across 220 sampled seeds. The observation hook and pilot selection are confined to these harness snapshots. The forced-loss checks use the unmodified production bundle served on 5181.

## Recovery

Production disables Three r170's unsafe shader info-log diagnostic. Each animation frame checks the native context before feeding elapsed time into the fixed-step loop. The guarded draw skips GL work while lost and absorbs a draw exception only if the native context reports loss.

The application prevents the default loss behavior, clears carried frame time, and suspends audio. It uses the existing interruption countdown for a flight that was running. The graphics pause preserves boost and the rest of the stage state. A flight that was already manually paused stays paused. Title, draft, and chest state stays intact.

On restoration the app constructs a fresh renderer and GPU resource graph on the restored canvas, with the current viewport and quality setting. It retires the old Three renderer and its event handlers while lost. This also avoids retaining the old geometry and texture callbacks across repeated Three r170 restorations. The graphics status stays visible during the terrain and post-chain warm-up. A complete frame clears the status, then the existing three-second auto-resume allows flight and audio to continue.

For a reproducible loss on the production preview, use `?autoplay=1&view=chase&glDebug=1&glloss=2`. The hook requests `WEBGL_lose_context` at mission second 2 and requests restoration 750 ms after the loss event. Vite dev mode also enables the hook. Use `view=cockpit` for the forward and rear cockpit renders and append `touch=1&lang=ko` for portrait emulation.

## Verification

`npm test` passed all 476 tests, including the graphics pause ownership cases and a boosted replay with a suspended frame sequence. The 24 full-view terminal records match `5f92897` byte for byte. Replaying those same inputs with a graphics interruption at tick 1,800 also reproduced all 24 hashes. The standard 100-seed batch per profile produces byte-identical JSON and CSV. The gameplay modules and sim CLI are unchanged.

The production build and curl asset check passed. Testing used the exact bundle on port 5181 for all four forced-loss cases. The overlay appeared in the requested language, the canvas loss event was canceled, audio suspended, and real GL draw calls resumed. The tick was 120 at both loss and restoration in all four cases. There were no page or console errors.

| Native forced-loss case | Overlay | Loss and restore tick | Follow-up tick |
| --- | --- | ---: | ---: |
| Desktop CHASE | English | 120 | 157 |
| Desktop COCKPIT | Korean | 120 | 151 |
| 390×844 emulated CHASE | Korean | 120 | 157 |
| 390×844 emulated COCKPIT | English | 120 | 158 |

A second loss on the same canvas held tick 157 and advanced to tick 188 after audio and drawing resumed. A manually paused game stayed at tick 15 through restoration and another 350 ms. Pressing P then advanced the flight to tick 46. Chromium reported a `ReadPixels` performance warning of unconfirmed origin during the first forced run.

## Native ten-minute soaks

Each completed run used a fresh Chromium 149 browser and one page on RTX 4090. Both builds ran the existing average pilot in the instrumented snapshots. All five completed runs reached tick 36,000 at 10:00 of mission time, cycled through TOP, CHASE, and COCKPIT, and decoded ten audio clips. Each recorded 62 samples at ten-second intervals. The mean RAF FPS excludes the startup sample. The resource ranges start at wall time 120 seconds.

| Build | Seed | Mission time | Mean RAF FPS | Geometries | Textures | Programs | Live framebuffers | Context losses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `5f92897` baseline | 57 | 10:00 | 59.93 | 214–224 | 8–9 | 23 | 3–4 | 0 |
| Candidate, run 1 | 10 | 10:00 | 60.00 | 217–223 | 8–9 | 23 | 3–4 | 0 |
| Candidate, run 2 | 57 | 10:00 | 60.00 | 214–224 | 8–9 | 23 | 3–4 | 0 |
| Candidate, run 3 | 10 | 10:00 | 60.00 | 217–223 | 8–9 | 23 | 3–4 | 0 |
| Candidate, run 4 | 57 | 10:00 | 60.00 | 214–224 | 8–9 | 23 | 3–4 | 0 |

The four complete candidate runs stayed at High quality. Their ten-second FPS windows were 59.90–60.00, the highest window p95 frame time was 16.8 ms, and GPU 0 memory in use was 114 MiB at each periodic sample. Renderer resources stayed within the measured ranges and no page or console errors occurred.

An additional candidate flight on seed 20 ended in combat at tick 35,463 (9:51.05) with 60.00 mean RAF FPS and zero context losses or errors. The final candidate attempt was stopped at the owner's request. Its last sample at tick 13,176 (3:39.60) recorded 60.00 mean RAF FPS and zero context losses. The full-duration total is four candidate runs and one baseline run.

The local ignored directory `sim-out/glloss-browser/` contains the raw ten-second traces, `soak-summary.jsonl`, and the short-run and forced-loss records.
