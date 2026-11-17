# ASTER // Courier Run

A small pixel-art courier shooter made with Vite, TypeScript and Canvas 2D. Fly the jungle coast of Kestrel Reach, destroy the Atoll's four pylons and enter the exit ring, shoot the locks on two canyon blast doors, and defeat the orbital Warden's four pods and exposed core. The stage-clear card ranks the run; the next loop is faster. The terrain, voxel ships and effects are generated in code, with no runtime dependencies or external art.

## Run

```sh
npm install
npm run dev
```

`npm run build` type-checks and builds; `npm run preview` serves the build. Both Vite servers use port 5180 on `0.0.0.0` with strict port selection. `npm test` runs the deterministic game and renderer tests on Node.js 22 or later.

## Controls

- **Enter** starts, restarts after a loss, or starts the next loop after a win. **P** pauses; **R** restarts from the result screen.
- **WASD / arrows** or mouse steer and climb/dive. Hold **Space**, **J**, **Z**, or the left mouse button to fire. In cockpit view, aim with the mouse or movement keys.
- **V** cycles TOP, CHASE and COCKPIT at any point. In TOP view, match a target's altitude before firing: red `[ ]` means aligned, cyan `^` means climb, and orange `v` means dive.
- Hold **Shift** for boost; the meter refills when released. **X** or **K** spends a bomb to clear enemy fire and damage nearby targets. Shoot red supply drones and collect `P` capsules to upgrade the weapon; taking damage lowers it.
- On touchscreens, use the left stick and the **FIRE**, **BOOST**, **BOMB**, and **VIEW** buttons. Dragging the stick also fires automatically.

The clear rank is based on hits taken: S for zero, A for one or two, B for three to five, and C for more. The optional shop and later-game mechanics from the reference are outside this MVP.

For reproducible checks use `?segment=reach|atoll|canyon|orbit`, `?view=overhead|chase|cockpit`, `?seed=1`, `?autoplay=1`, `?touch=1`, `?loop=2`, and optionally `?t=SECONDS` to fast-forward. `?segment=boss` remains an alias for orbit. Without a segment the game opens at the title screen. `window.__game` exposes a read-only snapshot for browser checks.
