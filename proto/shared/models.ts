import { buildFaces, type Face, type VoxelModel } from '../../src/voxel.ts';

export type Palette = number[][];

export const shipPalette: Palette = [
  [0, 0, 0], [195, 207, 200], [145, 164, 166], [77, 96, 110],
  [232, 126, 81], [64, 155, 167], [34, 44, 57], [255, 165, 79], [225, 231, 214], [108, 207, 209],
  [177, 194, 192], [96, 122, 136], [157, 227, 223], [138, 155, 157], [94, 70, 62], [166, 78, 57],
];

export const SHIP_VOXEL_SUBDIVISIONS = 2;
const SHIP_PIVOT = [17, 21, 6] as const;
const PANEL_EDGE = 10, PANEL_SEAM = 11, GLASS_GLINT = 12;
const NOZZLE_ALLOY = 13, HEAT_LINER = 14, ORANGE_SHADE = 15;

export const dronePalette: Palette = [
  [0, 0, 0], [54, 39, 53], [120, 76, 83], [197, 166, 161],
  [242, 91, 86], [91, 203, 200], [255, 213, 121], [140, 75, 65], [135, 226, 240], [255, 157, 80],
];

function makeModel(w: number, l: number, h: number, pivot: [number, number, number], material: (x: number, y: number, z: number) => number): VoxelModel {
  const data = new Uint8Array(w * l * h);
  for (let z = 0; z < h; z++) for (let y = 0; y < l; y++) for (let x = 0; x < w; x++) {
    data[(z * l + y) * w + x] = material(x - pivot[0], y - pivot[1], z - pivot[2]);
  }
  return { width: w, length: l, height: h, pivot, data };
}

const wingTrailing = (x: number) => 13 - Math.max(0, x - 10) * 0.3;

function shipHullMaterial(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const leading = -5 + Math.max(0, ax - 4) * 0.7;
  let material = 0;
  if (ax <= 16 && y >= leading && y <= wingTrailing(ax) && z >= 2 && z <= 6) {
    material = ax > 13 || (ax > 8 && y > 8) ? 4 : 2;
    if (ax > 7 && y >= 5 && y <= 6) material = 7;
  }
  const halfWidth = y < -17 ? 1 : y < -13 ? 2 : y < -8 ? 3 : y < 11 ? 4 : 3;
  const top = y < -15 ? 6 : y < -10 ? 8 : 10;
  const shoulder = Math.max(0, ax - 2);
  if (y >= -20 && y <= 16 && ax <= halfWidth && z >= 2 + shoulder && z <= top - shoulder) {
    material = z <= 3 ? 3 : ax === halfWidth ? 2 : 1;
    if (x === 0 && y < -10 && z >= 6) material = 8;
    if (ax === 3 && y >= 2 && y <= 9 && z >= 6) material = 4;
    if (ax === 1 && y >= 5 && y <= 12 && z >= 9) material = 2;
  }
  const engine = (ax - 5.5) ** 2 + (z - 5) ** 2;
  if (y >= 4 && y <= 16 && engine <= 9) {
    material = z < 4 ? 3 : 2;
    if (y === 15 && z >= 6) material = 4;
  }
  if (ax >= 5 && ax <= 6 && y >= 7 && y <= 15 && z >= 8 && z <= 16 - Math.max(0, 10 - y)) material = z > 13 ? 4 : 3;
  const canopyTop = y < -7 || y > 0 ? 10 : y < -4 ? 12 : 14;
  if (y >= -10 && y <= 2 && ax <= 2 && z >= 9 && z <= canopyTop - (ax === 2 ? 2 : 0)) {
    const frame = ax === 2 || y === 2 || y === -10 || y === -8 || y === -4 || y === 0;
    material = frame ? 3 : z === canopyTop ? 9 : 5;
  }
  return material;
}

function shipDetailMaterial(x: number, y: number, z: number): number {
  if (y > 18.5) return 0;
  const ax = Math.abs(x);
  const engine = (ax - 5.5) ** 2 + (z - 5) ** 2;
  if (y > 16.5) {
    // The last two rings step outward to the open lip, leaving a dark throat behind it.
    const lip = y > 17.5;
    const opening = lip ? 1.95 : 1.68;
    if (engine > 9 || engine < opening ** 2) return 0;
    if (y > 18) return engine < 2.55 ** 2 ? HEAT_LINER : NOZZLE_ALLOY;
    return engine < 2.42 ** 2 ? HEAT_LINER : 6;
  }

  const material = shipHullMaterial(Math.round(x), Math.round(y), Math.round(z));
  if (!material) return 0;
  if (y > 16 && engine < 1.85 ** 2) return HEAT_LINER;

  if (ax < 2 && y >= -10.25 && y < 2.5 && z >= 9.75) {
    if (y > 1.5 && ax < 1.25 && z < 10.5) return 5;
    if (material === 9 && x < -0.5) return GLASS_GLINT;
    if (material === 5 && z > 10.5 && ax > 1) return 9;
  }
  if (y < -11 && z >= 5.75 && ax < 1.75) {
    if (y > -15.5 && y < -14.5) return PANEL_SEAM;
    if (ax > 0.5) return PANEL_EDGE;
  }

  if (ax < 2.5 && y >= 5 && y <= 12.5 && z >= 9.75) {
    const slot = Math.abs(y - 7) < 0.5 || Math.abs(y - 9) < 0.5 || Math.abs(y - 11) < 0.5;
    if (slot && ax < 1.75) return z > 10 ? 0 : PANEL_SEAM;
    if (ax > 1.75 || y < 5.5 || y > 12) return PANEL_EDGE;
  }
  if (y > 15.5 && ax < 2.5 && z >= 4.25 && z <= 8.75) {
    if (ax > 1.5 || z < 5 || z > 8) return PANEL_SEAM;
    return z >= 6.75 ? PANEL_EDGE : 2;
  }

  if (ax > 7.75 && z >= 2 && z <= 6.25) {
    const trailing = Math.floor(wingTrailing(Math.round(ax)));
    if (y <= trailing + 0.5) {
      if (z > 6 && y > trailing && ax > 10) return 0;
      if (y > trailing - 0.5 && z >= 3.25 && z <= 4.75) return material === 4 ? ORANGE_SHADE : PANEL_SEAM;
      if (z >= 5.75 && y >= 7.75 && y <= 8.25 && ax <= 14.25) return PANEL_SEAM;
      if (z >= 5.75 && ax >= 10.75 && ax <= 11.25 && y > 8.25) return PANEL_EDGE;
    }
  }
  if (ax >= 4.75 && ax <= 6.25 && y >= 14.75 && y <= 15.25 && z >= 8) {
    if (z > 15.75 && (ax > 6 || z > 16)) return 0;
    if (z >= 13.75) return z < 14.75 ? ORANGE_SHADE : 7;
    if (z >= 9.75 && z <= 10.25) return PANEL_SEAM;
  }
  return material;
}

/** Half-size cells preserve the original hull envelope and add room for the surface details. */
export function makeShipModel(): VoxelModel {
  const scale = SHIP_VOXEL_SUBDIVISIONS, center = (scale - 1) / 2;
  const [px, py, pz] = SHIP_PIVOT;
  return makeModel(35 * scale, 43 * scale, 18 * scale,
    [px * scale + center, py * scale + center, pz * scale + center],
    (x, y, z) => shipDetailMaterial(x / scale, y / scale, z / scale + pz));
}

/** Both drones share the swept wing planform and engine attachment points. */
export function makeDroneModel(kind: 'patrol' | 'interceptor' = 'patrol'): VoxelModel {
  return makeModel(17, 19, 9, [8, 9, 3], (x, y, z) => {
    const ax = Math.abs(x);
    if (kind === 'interceptor' && ax === 3 && y >= 6 && y <= 8 && z === 3) return 8;
    if (y >= -8 && y <= 8 && ax <= (y < -4 ? 1 : 2) && z >= -2 && z <= 4 - Math.floor(ax / 2)) {
      if (kind === 'interceptor' && ax === 0 && z === 4 && y >= -5 && y <= 5) return 8;
      if (kind === 'patrol' && y === 8) return 1;
      return y < -4 ? 4 : z > 2 ? 3 : 2;
    }
    if (y >= -2 + ax * 0.5 && y <= 6 && ax <= 8 && z >= -1 && z <= 1) return ax > 5 ? 9 : 1;
    if (y > 4 && ax >= 2 && ax <= 4 && z >= -2 && z <= 2) return y === 8 ? (kind === 'patrol' ? 1 : 6) : 2;
    return 0;
  });
}

export function shipFaces(): Face[] { return buildFaces(makeShipModel()); }
export function droneFaces(kind?: Parameters<typeof makeDroneModel>[0]): Face[] { return buildFaces(makeDroneModel(kind)); }

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
