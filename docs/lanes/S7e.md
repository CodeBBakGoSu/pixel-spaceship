# Stage 7e · Enemy roster and Red Kite

Red Kite enters from the atoll signal at 8:00 in Survivors. The legacy sortie also uses the fighter and keeps its original timetable. The Ace shares the player's fixed-step bank drive, yaw, bank drop, and barrel-roll trajectory. Its health phases start at 100%, 66%, and 33%. In Survivors, phase two calls capped wingmen and Gnats once. Phase three adds afterburner, faster band changes, shorter roll recovery, and a wider salvo. The 10:00 timeout still applies.

Gun runs commit to a tracer line for 33 ticks. Missile attacks signal a lock for 52 ticks, then launch guided same-band rounds. The existing roll parries these rounds on contact. The Ace signals an evasive roll for 17 ticks before displacing laterally. The start of the roll deflects hits, and the fighter is vulnerable during recovery. Tailing holds the matched layer and gives a rear-mirror cue and tone. The fighter spirals down on defeat, awarding 2,500 score and a 250-credit cache before payout modifiers. Existing hangar quest progress carries forward. An 8:00 checkpoint saved in Stage 7a resumes with the new fighter.

| Contact | Band and tell | Counter |
| --- | --- | --- |
| Patrol | Holds its entry band and marks its gun charge | Change altitude or approach after the burst |
| Interceptor, Hound | Follow the player's band after a one-second warning inside pursuit range. A tailing approach appears in the mirror | Change layer, reverse behind the pursuer, or roll-parry |
| Skimmer | Stays low over water and warns before a strafe fan | Dive behind it or use bombs |
| Spotter | Holds its mid or high entry band and marks a fixed projected aim line for 0.8 s | Leave the line or layer before the shot |
| Flanker | Holds its entry band and warns before firing across the wing | Turn into the pass or change band |
| Harrier | Trails the player and warns before a band hop in response to a reversal | Break the tail or vary the reversal exit layer |
| Diver | Warns at high altitude, dives through the bands, and fires during the descent | Move off its line or engage during the crossing |
| Bomber | Holds its entry band and warns before dropping mines or using its rear gun | Attack from a side or above |
| Flak turret | Marks one blast position and altitude for 84 ticks with an expanding ring | Clear the ring or switch altitude |
| Aegis | Holds MID and displays a 120° nose shield | Attack the side or rear or use blast damage |
| Carrier | Launches warned Gnat waves from HIGH and drops its scheduled chest on defeat | Focus the carrier and clear the pack with area weapons |
| Gnat | Tracks its formation layer and signals the pack on approach | Use area weapons, flares, or break to another layer |

Aegis replaces one patrol weight in each of the four regular spawn tables. Existing global spawn budgets, cap values, and player flight balance carry forward. A reversal extends a charged patrol's tell through the 25-tick firing grace. The regression test stages a shot due at tick 100, reverses at tick 97, and checks that it fires at 122.

## Review fixtures

Use the lane preview on port 5192. The fixture snapshots open frozen, and `&live=1` advances the flight. Append `&lang=en` or `&lang=ko` and use `view=overhead`, `view=chase`, or `view=cockpit`.

- `?fixture=ace&phase=1&view=chase` opens on a gun run. Phase 2 shows the lock and phase 3 shows the afterburner and roll warning.
- `?fixture=ace&phase=3&cue=tail&view=cockpit` opens the rear mirror. The other cue values are `gun`, `missile`, `roll`, `rolling`, and `down`.
- `?fixture=roster&view=overhead` stages the roster. Use `&cue=spotter`, `flak`, `aegis`, `hound`, `interceptor`, `diver`, `skimmer`, `bomber`, `carrier`, `flanker`, `patrol`, `harrier`, or `gnat` for individual tells.
- `?fixture=bullets&stress=1&view=chase` fills the performance fixture with the Ace, 24 regular contacts, 80 desktop or 50 mobile Gnats, 64 hostile shots, and 128 friendly shots.

Screenshots and the `browser-checks.json` manifest are in `/home/total/grok_bot/full-run/stage7/s7e/`.

## Replay and sim evidence

`npm test` passed 400 tests. `npm run build` passed. Deterministic replays compared SHA-256 hashes across repeated inputs and with combat observers enabled and disabled. The charged-patrol regression failed against the original deadline logic and passed after the fix.

The full-view pilot cleared all six legacy and six Survivors seeds on both caps. Seeds were 1, 11, 27, 42, 128, and 2026. Legacy clears took 110.53–125.13 s with 40–44 regular kills. Survivors clears took 529.05–545.27 s with 696–797 regular kills. The radar-only legacy pilot can also clear the single moving contact, so its rebaselined gate compares it with full-view performance. View selection still leaves combat state unchanged under identical inputs.

Rebaseline digests are SHA-256 of the six terminal state hashes joined by newline in the listed seed order, with no trailing newline.

| Cap | Mode | Rebaseline digest |
| --- | --- | --- |
| Desktop | Legacy | `50fc1de5a8e5916ae7d3ed32d417a4ce9951a6da1eb65214f46b313172754fd4` |
| Desktop | Survivors | `7df38e7dace6f96b3de51be0abbe20192ea996f81426a0265b57525f71a2bdfe` |
| Mobile | Legacy | `829a927fcaedf874edb2034a5d413cb2f1faeda35a3daf07dad9f0b7c08d24fe` |
| Mobile | Survivors | `d85ca3832bbb6d908e46ccd4c177a40c07f518f2f8e3af88ce43fd69f86ad1d4` |

The lane ran `npm run sim -- --profile all --seeds 100` and the same command with `--mobile`, seeds 1–100 per profile at Heat 0. Clear includes an Ace or Warden victory and a live timeout. Survival medians right-censor clears at 600 s. The baseline is `5a890c1`.

Desktop and mobile returned the same counts. Each cap had 100 seeds per row.

| Profile | Clear incl. timeout before → after | Boss wins before → after | Median survival before → after | Median run length before → after | Median regular kills before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skilled | 96% → 99% | 95% → 99% | 600.0 → 600.0 s | 592.6 → 545.2 s | 744.5 → 780 |
| Average | 65% → 57% | 64% → 42% | 600.0 → 600.0 s | 590.4 → 570.0 s | 696 → 767 |
| Weak | 5% → 14% | 2% → 0% | 276.4 → 266.4 s | 276.4 → 266.4 s | 191.5 → 235.5 |

Survivors pilots who won the encounter took a median 65.45 s from Ace arrival on skilled and 92.87 s on average. All 14 weak clears were live timeouts, above the roughly 10% overall clear target. Peak live Gnats rose from 41 to 49 and remained within both caps. S7c owns the later global balance pass.

## Browser checks

Chromium 149 rendered the production build with native ANGLE Vulkan on an RTX 4090. Each run warmed up for 120 active ticks and sampled 240 successive `requestAnimationFrame` intervals. The fixture maintained the Ace, 24 regulars, the full swarm cap, and 64 hostile plus 128 friendly shots. Desktop used 1920×1080 at DPR 1 with a 960×540 render buffer. Portrait used an emulated 390×844 at DPR 3 with a 336×727 render buffer. All six native runs averaged 60.0 FPS.

| Viewport | TOP p95 ms | CHASE p95 ms | COCKPIT p95 ms |
| --- | ---: | ---: | ---: |
| RTX 4090 desktop | 16.7 | 16.8 | 16.7 |
| RTX 4090 portrait | 16.7 | 16.7 | 16.8 |
| SwiftShader desktop, baseline → S7e | 83.3 → 66.6 | 83.3 → 66.7 | 100.1 → 83.4 |
| SwiftShader portrait, baseline → S7e | 83.2 → 33.4 | 50.0 → 49.9 | 66.6 → 66.7 |

The screenshot set contains 94 PNGs at 1280×800 and 390×844, covering all three views, both languages, the pursuit mirror, and individual roster tells. Chromium verified 36 EN/KO portrait and landscape layouts with simulated safe insets. The smallest control target was 44 CSS px and controls, NAV, loadout, and the Ace bar fit without overlap. The Galmuri11 subset covers all 389 Hangul glyphs used by the localized strings.

## Merge notes

- S7d owns altitude data and world placement. Supply the same terrain-relative band resolver to `deployAce` and `advanceAce`. Use the streamed encounter rendezvous in `deployAce` and keep checkpoint restoration on that entry point. Escort formation and placement should follow the merged band and spawn APIs. This lane verifies a fourth dynamic band with an injected resolver.
- Reconcile the Ace/roster batch and rear-mirror hooks in `scene.ts` and `main.ts` with the S7b effects. The Ace and Aegis geometry is self-contained at doubled voxel density in `models-roster.ts`. Reconcile mesh registration alongside S7f's existing models. The retired Warden mesh exports are still in the shared `models.ts` for that merge.
- The S7c rescale and global balance pass follow the lane merges. Ace airspeeds and projectile speeds use the existing player speed constants. Other Ace-specific distance and cadence values are in `data/ace.ts`.

### Integration files outside lane ownership

- Combat dependencies use the single Ace target in `src/stage-types.ts`, `src/ranged-weapons.ts`, and `src/support-weapons.ts`. Cue events and hostile shapes use `src/hostile-events.ts` and `src/data/hostile-fire.ts`. Ace-specific pilot knobs live in `src/data/bot-profiles.ts` and Carrier bands in `src/data/chest-tuning.ts`.
- Save and reward wiring updates `src/checkpoint.ts`, `src/meta.ts`, and `src/data/meta.ts`. The historic saved quest key remains `weakPointHits`.
- Player-facing wiring updates `src/main.ts`, `index.html`, `src/style.css`, `src/roster-{hud,audio,visuals,fixture}.ts`, `src/combat-audio.ts`, `src/flare-visuals.ts`, `src/hostile-fixture.ts`, `src/instruments.ts`, `src/cockpit-{display,markers}.ts`, `src/numeric-hud.ts`, `src/run-summary-display.ts`, and the Galmuri11 subset.
- Shared lane files `src/stage.ts`, `src/scene.ts`, `src/i18n.ts`, and `src/hostile-visuals.ts` carry the integration changes. The tests and fixture references in `README.md` describe the live Ace.
