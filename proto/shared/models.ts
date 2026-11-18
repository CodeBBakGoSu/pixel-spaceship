import { buildFaces, type Face, type VoxelModel } from '../../src/voxel.ts';

export type Palette = number[][];

export const shipPalette: Palette = [
  [0, 0, 0], [195, 207, 200], [145, 164, 166], [77, 96, 110],
  [232, 126, 81], [64, 155, 167], [34, 44, 57], [255, 165, 79], [225, 231, 214],
];

export const dronePalette: Palette = [
  [0, 0, 0], [54, 39, 53], [120, 76, 83], [197, 166, 161],
  [242, 91, 86], [91, 203, 200], [255, 213, 121], [140, 75, 65],
];

function makeModel(w: number, l: number, h: number, pivot: [number, number, number], material: (x: number, y: number, z: number) => number): VoxelModel {
  const data = new Uint8Array(w * l * h);
  for (let z = 0; z < h; z++) for (let y = 0; y < l; y++) for (let x = 0; x < w; x++) {
    data[(z * l + y) * w + x] = material(x - pivot[0], y - pivot[1], z - pivot[2]);
  }
  return { width: w, length: l, height: h, pivot, data };
}

/** Player craft voxels, copied from src/ship.ts (throwaway proto; do not edit the game). */
export function makeShipModel(): VoxelModel {
  const W = 35, L = 43, H = 18, CENTER_X = 17, CENTER_Y = 21, CENTER_Z = 6;
  const voxels = new Uint8Array(W * L * H);
  const at = (x: number, y: number, z: number) => (z * L + y) * W + x;
  for (let z = 0; z < H; z++) for (let iy = 0; iy < L; iy++) for (let ix = 0; ix < W; ix++) {
    const x = ix - CENTER_X, y = iy - CENTER_Y, ax = Math.abs(x);
    let m = 0;
    const leading = -5 + Math.max(0, ax - 4) * 0.7;
    const trailing = 13 - Math.max(0, ax - 10) * 0.3;
    if (ax <= 16 && y >= leading && y <= trailing && z >= 2 && z <= 6) {
      m = ax > 13 || (ax > 8 && y > 8) ? 4 : 2;
      if (ax > 7 && y === 5) m = 3;
    }
    const halfWidth = y < -17 ? 1 : y < -13 ? 2 : y < -8 ? 3 : y < 11 ? 4 : 3;
    const top = y < -15 ? 6 : y < -10 ? 8 : 10;
    if (y >= -20 && y <= 16 && ax <= halfWidth && z >= 2 + Math.max(0, ax - 2) && z <= top - Math.max(0, ax - 2)) {
      m = z <= 3 ? 3 : ax === halfWidth ? 2 : 1;
      if (x === 0 && y < -10 && z >= 6) m = 8;
      if (ax === 3 && y >= 2 && y <= 9 && z >= 6) m = 4;
      if (ax === 1 && y >= 5 && y <= 12 && z >= 9) m = 2;
    }
    const engine = ((ax - 5.5) / 3) ** 2 + ((z - 5) / 3) ** 2;
    if (y >= 4 && y <= 18 && engine <= 1) {
      m = y >= 17 ? (engine < 0.26 ? 7 : 6) : z < 4 ? 3 : 2;
      if (y === 15 && z >= 6) m = 4;
    }
    if (ax >= 5 && ax <= 6 && y >= 7 && y <= 15 && z >= 8 && z <= 16 - Math.max(0, 10 - y)) m = z > 13 ? 4 : 3;
    const canopyTop = y < -7 || y > 0 ? 10 : y < -4 ? 12 : 14;
    if (y >= -10 && y <= 2 && ax <= 2 && z >= 9 && z <= canopyTop - (ax === 2 ? 2 : 0)) {
      m = ax === 2 || y === 2 || y === -10 ? 3 : 5;
      if (x === -1 && y >= -5 && y <= -3 && z >= 12) m = 8;
    }
    if (m) voxels[at(ix, iy, z)] = m;
  }
  return { width: W, length: L, height: H, pivot: [CENTER_X, CENTER_Y, CENTER_Z], data: voxels };
}

/** Enemy drone voxels, copied from src/models.ts. */
export function makeDroneModel(): VoxelModel {
  return makeModel(17, 19, 9, [8, 9, 3], (x, y, z) => {
    const ax = Math.abs(x);
    if (y >= -8 && y <= 8 && ax <= (y < -4 ? 1 : 2) && z >= -2 && z <= 4 - Math.floor(ax / 2)) return y < -4 ? 4 : z > 2 ? 3 : 2;
    if (y >= -2 + ax * 0.5 && y <= 6 && ax <= 8 && z >= -1 && z <= 1) return ax > 5 ? 4 : 1;
    if (y > 4 && ax >= 2 && ax <= 4 && z >= -2 && z <= 2) return y === 8 ? 6 : 2;
    return 0;
  });
}

export function shipFaces(): Face[] { return buildFaces(makeShipModel()); }
export function droneFaces(): Face[] { return buildFaces(makeDroneModel()); }

/** Solid voxels as {x,y,z,material} in model space (pivot already subtracted in iterate). */
export function filledVoxels(model: VoxelModel): { x: number; y: number; z: number; material: number }[] {
  const { width: w, length: l, height: h, data, pivot } = model;
  const out: { x: number; y: number; z: number; material: number }[] = [];
  for (let z = 0; z < h; z++) for (let y = 0; y < l; y++) for (let x = 0; x < w; x++) {
    const material = data[(z * l + y) * w + x];
    if (material) out.push({ x: x - pivot[0], y: y - pivot[1], z: z - pivot[2], material });
  }
  return out;
}
