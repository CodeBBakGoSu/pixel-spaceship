# ASTER // Courier Run

A small pixel-art courier shooter made with Vite, TypeScript and Canvas 2D. Fight through Kestrel Reach's waves, roam the Atoll to destroy four pylons and find the exit, open three canyon blast doors, and reach orbit to defeat the Warden's four pods and exposed core. The stage-clear card ranks the run; the next loop is faster. Terrain, voxel ships and effects are generated in code, with no runtime dependencies or external art.

Play the current build at [codebbakgosu.github.io/pixel-spaceship](https://codebbakgosu.github.io/pixel-spaceship/).

## Run

```sh
npm install
npm run dev
```

`npm run build` type-checks and builds; `npm run preview` serves the build. Both Vite servers use port 5180 on `0.0.0.0` with strict port selection. `npm test` runs the deterministic game and renderer tests on Node.js 22 or later.

## Controls

- **Enter** opens the preflight guide on the first launch from the title. Press **Enter** again or tap **Start Phase 1** or **Skip Guide** to fly. Reopen the guide with **How to Play** on the title, **Help** on the pause menu, or **?** from either menu.
- **P** pauses and resumes. **Enter** also restarts after a loss or starts the next loop after a win. **R** restarts from the result screen.
- The ship flies forward automatically. Use **A/D** or **left/right** to turn and **W/S** or **up/down** to climb and dive; the mouse also steers. Hold **Space**, **J**, **Z**, or the left mouse button to fire. In cockpit view, aim with the mouse or movement keys.
- **V** cycles TOP, CHASE and COCKPIT at any point. In TOP view, match a target's altitude before firing: red `[ ]` means aligned, cyan `^` means climb, and orange `v` means dive.
- Hold **Shift** for boost; the meter refills when released. **X** or **K** spends a bomb to clear enemy fire and damage nearby targets. Shoot red supply drones and collect their `P` capsules to upgrade the weapon; taking damage lowers it.
- On touchscreens, use the left stick and the **FIRE**, **BOOST**, **BOMB**, and **VIEW** buttons; the top-right pause button opens the pause menu. Dragging the stick also fires automatically, and the stick and FIRE can be held together. The layout adapts to portrait, landscape, and phone safe areas.

**BMB** shows the number of bombs remaining. **HULL** is armor, **BST** is the boost meter, **TWIN n** is the gun level, **◆** is salvage, and **ALT** is the altitude ruler.

Use the north-up navigation radar to find objectives: yellow dots mark pylons and locks, green marks the exit, cyan marks supplies, and pink marks the Warden. The Atoll bay, canyon walls, and orbit have soft boundaries; turn back when the edge warning appears.

In cockpit view the radar rotates with the ship. The right tape shows your altitude and marks the tracked target's altitude. A flashing lock box means the target is within range and close to the gunsight. The weapon display shows unlimited gun ammo, remaining bombs, and zero missiles.

The clear rank is based on hits taken: S for zero, A for one or two, B for three to five, and C for more. The optional shop and later-game mechanics from the reference are outside this MVP.

## Language

Choose **EN** or **한국어** on the title screen or pause menu. The HUD, mission messages, canvas labels and guide update immediately. The game saves the choice as `aster.lang` in local storage. Korean browser locales default to Korean, and other locales default to English. Open `?lang=ko` or `?lang=en` to override the initial choice for testing. Selecting a language in the menu clears the URL override and saves the selection for reloads.

The local WOFF2 subset uses Galmuri11 from `galmuri@2.40.3`. It includes the Korean UI glyphs, printable ASCII and the HUD symbols. [SIL Open Font License 1.1](public/fonts/OFL-Galmuri.txt)

When adding Korean glyphs, regenerate the subset from the package's `dist/Galmuri11.ttf` with FontTools and WOFF2 support.

```sh
node --experimental-strip-types --input-type=module -e 'import { strings } from "./src/i18n.ts"; process.stdout.write(Object.values(strings.ko).join(""));' > glyphs.txt
pyftsubset Galmuri11.ttf --text-file=glyphs.txt --flavor=woff2 \
  --unicodes=U+0020-007E,U+00B0,U+00B7,U+00D7,U+2014,U+2026,U+2161,U+221E,U+25AE-25AF,U+25C2,U+25C6 \
  --name-IDs=0,1,2,3,4,5,6,13,14 --output-file=src/fonts/galmuri11-subset.woff2
```

## Verification hooks

For reproducible checks use `?segment=reach|atoll|canyon|orbit`, `?view=overhead|chase|cockpit`, `?seed=1`, `?autoplay=1`, `?touch=1`, `?loop=2`, and optionally `?t=SECONDS` to fast-forward. Orbit begins with an approach wave; `?segment=boss` starts directly at the Warden. Without a segment the game opens at the title screen. `window.__game` exposes a read-only snapshot, including the current and peak weapon levels, for browser checks.
