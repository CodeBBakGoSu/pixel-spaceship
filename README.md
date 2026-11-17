# ASTER // Courier Run

A small pixel-art courier shooter made with Vite, TypeScript and Canvas 2D. Fight through Kestrel Reach's waves, roam the Atoll to destroy four pylons and find the exit, open three canyon blast doors, and reach orbit to defeat the Warden's four pods and exposed core. The stage-clear card ranks the run; the next loop is faster. Terrain, voxel ships and effects are generated in code, with no runtime dependencies or external art.

## Run

```sh
npm install
npm run dev
```

`npm run build` type-checks and builds; `npm run preview` serves the build. Both Vite servers use port 5180 on `0.0.0.0` with strict port selection. `npm test` runs the deterministic game and renderer tests on Node.js 22 or later.

## Controls

- **Enter** starts, restarts after a loss, or starts the next loop after a win. **P** pauses; **R** restarts from the result screen.
- The ship flies forward automatically. Use **A/D** or **left/right** to turn and **W/S** or **up/down** to climb and dive; the mouse also steers. Hold **Space**, **J**, **Z**, or the left mouse button to fire. In cockpit view, aim with the mouse or movement keys.
- **V** cycles TOP, CHASE and COCKPIT at any point. In TOP view, match a target's altitude before firing: red `[ ]` means aligned, cyan `^` means climb, and orange `v` means dive.
- Hold **Shift** for boost; the meter refills when released. **X** or **K** spends a bomb to clear enemy fire and damage nearby targets. Shoot red supply drones and collect their `P` capsules to upgrade the weapon; taking damage lowers it.
- On touchscreens, use the left stick and the **FIRE**, **BOOST**, **BOMB**, and **VIEW** buttons; the top-right pause button opens the pause menu. Dragging the stick also fires automatically, and the stick and FIRE can be held together. The layout adapts to portrait, landscape, and phone safe areas.

Use the north-up navigation radar to find objectives: yellow dots mark pylons and locks, green marks the exit, cyan marks supplies, and pink marks the Warden. The Atoll bay, canyon walls, and orbit have soft boundaries; turn back when the edge warning appears.

The clear rank is based on hits taken: S for zero, A for one or two, B for three to five, and C for more. The optional shop and later-game mechanics from the reference are outside this MVP.

For reproducible checks use `?segment=reach|atoll|canyon|orbit`, `?view=overhead|chase|cockpit`, `?seed=1`, `?autoplay=1`, `?touch=1`, `?loop=2`, and optionally `?t=SECONDS` to fast-forward. Orbit begins with an approach wave; `?segment=boss` starts directly at the Warden. Without a segment the game opens at the title screen. `window.__game` exposes a read-only snapshot, including the current and peak weapon levels, for browser checks.
