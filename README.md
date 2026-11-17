# ASTER // Pixel Flight

A small, self-contained flight demo built with Vite, TypeScript and Canvas 2D. The alien terrain, sky, planets, ship and exhaust are generated in code; there are no image assets, 3D libraries or network requests at runtime. The terrain uses a wrapping procedural heightmap and a column-based voxel-space renderer. The ship is made from eleven rotated pixel slices.

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` type-checks and builds the app, and `npm run preview` serves the build. Both servers use port 5180 on `0.0.0.0` and fail if that port is occupied.

## Fly

- Move the mouse to steer; **click** to roll and **hold** to boost.
- Use **WASD** or the **arrow keys** to turn and climb/dive; hold **Shift** to boost.
- Press **Space** or use the camera buttons to cycle between overhead, chase and cockpit views.
- On touchscreens, drag to steer, tap to roll, and hold to boost. Tap the camera buttons to change view.
- A gamepad can use its left stick, A (roll), right trigger (boost), and Y (view).

Start in a particular view with `?view=overhead`, `?view=chase`, or `?view=cockpit`. Unknown values fall back to chase. The automated flight checks can be run with `npm test` on Node.js 22 or later.
