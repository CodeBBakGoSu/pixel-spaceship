import type { Vector3 } from 'three';
import type { Ground } from './stage-types.ts';
import { TERRAIN_MAX_ALTITUDE, TERRAIN_MESH_STEP, TERRAIN_MIN_ALTITUDE } from './world.ts';

const STEP = TERRAIN_MESH_STEP;
const TOP = TERRAIN_MAX_ALTITUDE, BOTTOM = TERRAIN_MIN_ALTITUDE;

export function terrainElevation(eye: Vector3, horizontal: Vector3, vertical: Vector3, normal: Vector3,
  gaze: Vector3, ground: Ground, near: number, far: number): number {
  const horizontalDepth = gaze.dot(horizontal), verticalDepth = gaze.dot(vertical);
  // Walk grid rows along the slice, visiting only the strip between its top and bottom terrain limits.
  const alongZ = Math.abs(normal.x) >= Math.abs(normal.z);
  const eyeAlong = alongZ ? eye.z : eye.x, eyeAcross = alongZ ? eye.x : eye.z;
  const normalAlong = alongZ ? normal.z : normal.x, normalAcross = alongZ ? normal.x : normal.z;
  const hAlong = alongZ ? horizontal.z : horizontal.x, vAlong = alongZ ? vertical.z : vertical.x;
  const rowAt = (depth: number, altitude: number): number => {
    const rise = (altitude - eye.y) / vertical.y;
    const run = (depth - rise * verticalDepth) / horizontalDepth;
    return eyeAlong + run * hAlong + rise * vAlong;
  };
  const nearBottom = rowAt(near, BOTTOM), nearTop = rowAt(near, TOP);
  const farBottom = rowAt(far, BOTTOM), farTop = rowAt(far, TOP);
  const firstRow = Math.floor(Math.min(nearBottom, nearTop, farBottom, farTop) / STEP) * STEP;
  const lastRow = Math.max(nearBottom, nearTop, farBottom, farTop);
  const acrossAt = (row: number, altitude: number) =>
    eyeAcross - (normalAlong * (row - eyeAlong) + normal.y * (altitude - eye.y)) / normalAcross;

  // The highest projected point along a clipped triangle slice is always at an endpoint.
  let highest = -Infinity, bestRun = 1, bestRise = 0;
  const consider = (rise: number, run: number, depth: number) => {
    if (depth < near || depth > far || rise / depth <= highest) return;
    highest = rise / depth;
    bestRun = run;
    bestRise = rise;
  };
  const xs = [0, 0, 0, 0], zs = [0, 0, 0, 0], ys = [0, 0, 0, 0], side = [0, 0, 0, 0];
  const rises = [0, 0, 0], runs = [0, 0, 0], depths = [0, 0, 0];
  const cutTriangle = (a: number, b: number, c: number) => {
    let count = 0;
    for (let edge = 0; edge < 3; edge++) {
      const from = edge === 0 ? a : edge === 1 ? b : c;
      const to = edge === 0 ? b : edge === 1 ? c : a;
      if (side[from] !== 0 && side[from] * side[to] >= 0) continue;
      const f = side[from] === 0 ? 0 : side[from] / (side[from] - side[to]);
      const rise = (ys[from] + f * (ys[to] - ys[from])) / vertical.y;
      const x = xs[from] + f * (xs[to] - xs[from]);
      const z = zs[from] + f * (zs[to] - zs[from]);
      const run = x * horizontal.x + z * horizontal.z;
      const depth = run * horizontalDepth + rise * verticalDepth;
      consider(rise, run, depth);
      rises[count] = rise;
      runs[count] = run;
      depths[count++] = depth;
    }
    // Include intersections with the near and fog planes as well as triangle edges.
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const low = Math.min(depths[i], depths[j]), high = Math.max(depths[i], depths[j]);
      if (low < near && high > near) {
        const f = (near - depths[i]) / (depths[j] - depths[i]);
        consider(rises[i] + f * (rises[j] - rises[i]), runs[i] + f * (runs[j] - runs[i]), near);
      }
      if (low < far && high > far) {
        const f = (far - depths[i]) / (depths[j] - depths[i]);
        consider(rises[i] + f * (rises[j] - rises[i]), runs[i] + f * (runs[j] - runs[i]), far);
      }
    }
  };

  for (let row = firstRow; row <= lastRow; row += STEP) {
    const startBottom = acrossAt(row, BOTTOM), startTop = acrossAt(row, TOP);
    const endBottom = acrossAt(row + STEP, BOTTOM), endTop = acrossAt(row + STEP, TOP);
    const first = Math.floor(Math.min(startBottom, startTop, endBottom, endTop) / STEP) * STEP;
    const end = Math.max(startBottom, startTop, endBottom, endTop);
    for (let across = first; across <= end; across += STEP) {
      const x = alongZ ? across : row, z = alongZ ? row : across;
      for (let i = 0; i < 4; i++) {
        const vx = x + (i % 2) * STEP, vz = z + (i >= 2 ? STEP : 0);
        xs[i] = vx - eye.x;
        ys[i] = ground(vx, -vz) - eye.y;
        zs[i] = vz - eye.z;
        side[i] = normal.x * xs[i] + normal.y * ys[i] + normal.z * zs[i];
      }
      // Use the same anti-diagonal split as PlaneGeometry and terrainSurface.
      cutTriangle(0, 1, 2);
      cutTriangle(1, 2, 3);
    }
  }
  return highest === -Infinity ? -Infinity : Math.atan2(bestRise, bestRun);
}
