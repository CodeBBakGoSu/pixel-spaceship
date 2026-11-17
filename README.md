# ASTER // Vesper Run

A small, self-contained arcade flight game built with Vite, TypeScript and Canvas 2D. Clear drone waves in overhead view, dodge canyon pillars and collect energy rings in chase view, then target the Dreadnought from the cockpit. A run lasts roughly 1.5–2 minutes; a win offers a faster next loop. Terrain, sprites and effects are generated in code, with no runtime assets, 3D libraries or network requests.

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` type-checks and builds the app; `npm run preview` serves the build. Both servers use port 5180 on `0.0.0.0` and fail if the port is occupied.

## Controls

- **Enter**, **Space**, click or tap starts; Enter restarts after a loss and starts the next loop after a win. **R** restarts from the result screen.
- **WASD / arrows** or mouse movement steers. Hold **Space**, **J**, **Z**, or the left mouse button to fire. In the cockpit, move the reticle onto the boss core.
- On touchscreens, drag to steer; firing is automatic. A gamepad can use its left stick and A or right trigger.
- Press **P** to pause or resume. Collect rings for points and hull energy; avoid pillars and incoming fire.

For reproducible checks, use `?segment=overhead|chase|cockpit|boss`, `?seed=1`, `?autoplay=1`, `?loop=2`, and optionally `?t=SECONDS` to fast-forward. Without a segment parameter the game opens at the title screen. `window.__game` exposes a read-only snapshot for browser checks. Run the automated state and rendering tests with `npm test` on Node.js 22 or later.
