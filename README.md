# ASTER WING

A three-minute sortie over Kestrel Reach. Match altitude to shoot and collect salvage, upgrade Twin Cannon and Wing Pods, and destroy the Warden before time runs out. The game uses TypeScript, Vite, and Three.js instanced voxels drawn through a nearest-filtered low-resolution buffer.

## Run

```sh
npm install
npm run dev
```

The development and preview servers default to port 5180. To use a different port, run `npm run dev -- --port 5182`. Run `npm run build` to type-check and build the game and `npm test` with Node.js 22 or later.

## Controls

- **Enter** opens the preflight guide from the title. Press **Enter** again, choose **Start Sortie**, or skip the guide to fly. **P** pauses and resumes. **Enter** or **R** retries the same seed from the result card.
- The ship flies forward automatically. Use **A/D** or **←/→** to turn and **W/S** or **↑/↓** to climb and dive. Move the mouse to steer. Twin Cannon and Wing Pods auto-fire at targets within 8 m of your altitude.
- Hold **Shift** to boost. Use **Space** to climb and reverse (Immelmann). Hold **Down** to dive and reverse (Split-S), **Left/Right** to flip in place (J-turn), or **C** to stall and let close pursuers overshoot (Cobra) when pressing **Space**. The J-turn spends 40% of your boost and starts a 7-second cooldown.
- Press **X** or **K** to drop a bomb behind you. It glides before falling through the lower bands and bursts near an in-band enemy or on contact with the ground. The blast clears nearby hostile shots at all heights. One of the three charges refills every 7.5 seconds while stocks are low.
- **V** cycles TOP, CHASE and COCKPIT. TOP shows coarse altitude on the nose-up radar with △ above, ■ level and ▽ below. CHASE shows the three bands and a correction cue. COCKPIT shows signed altitude error for the tracked target plus lock progress for a moving Warden weak point.
- On touchscreens, tap **LOOP** with the stick neutral or up for Immelmann, down for Split-S, or sideways for J-turn. Swipe **LOOP** left for Cobra. The other controls are **BOOST**, **BOMB**, **VIEW** and pause.
- Match the salvage height to collect XP. Draft one of three upgrades at 6 XP and again after 10 more. Press **1–3** or select a card. The sortie pauses during the draft.

## Language

Choose **EN** or **한국어** from the title or pause menu. The game saves the choice as `aster.lang`. Korean browser locales default to Korean. Use `?lang=ko` or `?lang=en` to override the initial language.

The local WOFF2 subset uses Galmuri11 from `galmuri@2.40.3` under the [SIL Open Font License 1.1](public/fonts/OFL-Galmuri.txt). To regenerate it, use FontTools with WOFF2 support and the package’s `dist/Galmuri11.ttf`.

```sh
node --experimental-strip-types --input-type=module -e 'import { strings } from "./src/i18n.ts"; process.stdout.write(Object.values(strings.ko).join(""));' > glyphs.txt
pyftsubset Galmuri11.ttf --text-file=glyphs.txt --flavor=woff2 \
  --unicodes=U+0020-007E,U+00B0,U+00B7,U+2014,U+2019,U+2160-2162,U+2190-2193,U+2212,U+25A0,U+25AE-25AF,U+25B3,U+25BC-25BD,U+25C2,U+25C6-25C7 \
  --name-IDs=0,1,2,3,4,5,6,13,14 --output-file=src/fonts/galmuri11-subset.woff2
```

## Verification hooks

- `?fixture=stack` starts at 0:30 with three vertically stacked patrols.
- `?fixture=draft` opens the first draft at 0:45.
- `?fixture=boss` starts at 1:48 with the high weak point ahead.
- `?fixture=pursuit` starts in CHASE at 0:30 with four pursuers behind at three heights.
- Use `?seed=1`, `?view=overhead|chase|cockpit`, `?touch=1`, and `?autoplay=1` for replay checks. `?t=SECONDS` seeks to an absolute sortie time and returns control to the player unless autoplay is active.

`window.__game` exposes a read-only snapshot with tick, altitude, draft choices, weak-point hits, and lock progress.
