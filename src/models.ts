import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { dronePalette, makeDroneModel, makeShipModel, shipPalette, SHIP_VOXEL_SUBDIVISIONS } from '../proto/shared/models.ts';
import { AIRFRAME_VOXEL_SUBDIVISIONS, buildFaces, refineVoxelModel, type VoxelModel } from './voxel.ts';
import type { NewEnemyKind, RegularEnemyKind } from './enemy-kinds.ts';

export const SHIP_HULL_UNIT = 0.62;
export const SHIP_BASE_VOXEL_SIZE = SHIP_HULL_UNIT / SHIP_VOXEL_SUBDIVISIONS;

function airframe(model: VoxelModel, palette: number[][], size: number) {
  return { faces: buildFaces(model), palette, size };
}

const CANOPY_TINT = shipPalette.length;
const CANOPY_REFLECTION = CANOPY_TINT + 1;
const SERVICE_PANEL = CANOPY_TINT + 2;
const detailedShipPalette = [...shipPalette, [47, 116, 139], [198, 243, 225], [167, 187, 184]];

export function playerAirframe(detailed: boolean) {
  const model = makeShipModel();
  if (!detailed) return airframe(model, shipPalette, SHIP_BASE_VOXEL_SIZE);

  const hull = refineVoxelModel(model, (x, y, z, material, sample) => {
    if (!material || y > 32) return material;

    const across = Math.abs(x);
    const upper = !sample(x, y, z + 0.5);
    if (across < 4 && y >= -21 && y <= 5 && z > 5 && (material === 5 || material === 9 || material === 12)) {
      if (upper && x < -1.5 && x > -3.5 && y > -14 && y < 0) return CANOPY_REFLECTION;
      if (z < 8 || across > 2.5) return CANOPY_TINT;
      return material;
    }

    // Chamfer the wing shoulders and nose in half-cell steps. The aft nozzle profile is held fixed.
    const outside = across > 1.5 && !sample(x + Math.sign(x) * 0.5, y, z);
    if (outside && (upper || !sample(x, y, z - 0.5))) return 0;
    if (upper && across > 7.5 && y < 13 && !sample(x, y - 0.5, z)) return 0;

    if (upper && across > 9 && y > -6 && y < 24 && z < 2) {
      const flapJoint = Math.abs(y - (across > 21 ? 9.5 : 6.5)) < 0.5;
      const inspectionEdge = Math.abs(across - 16.5) < 0.5 && y > 10 && y < 19;
      if (flapJoint || inspectionEdge) return material === 4 || material === 7 ? 15 : 11;
      if (across > 12 && across < 16 && y > 12 && y < 18) return SERVICE_PANEL;
    }
    if (upper && across > 8.5 && across < 13.5 && y > 12 && y < 28 && z > 3) {
      if (Math.abs(y - 18.5) < 0.5 || Math.abs(y - 22.5) < 0.5 || Math.abs(y - 26.5) < 0.5) {
        return across < 11.5 ? 0 : 11;
      }
      if (Math.abs(across - 13) < 0.5) return SERVICE_PANEL;
    }
    if (upper && across < 4 && y < -24 && y > -36) {
      if (Math.abs(y + 28) < 0.5) return 11;
      if (across < 1 && y < -29) return SERVICE_PANEL;
    }
    return material;
  });
  return airframe(hull, detailedShipPalette, SHIP_BASE_VOXEL_SIZE / AIRFRAME_VOXEL_SUBDIVISIONS);
}

export const wardenPalette = [[0, 0, 0], [54, 64, 77], [102, 121, 133], [149, 162, 166], [81, 104, 118]];
const WARDEN_VOXEL_SIZE = 0.65;
const WARDEN_SEAM = wardenPalette.length;
const WARDEN_RIM = WARDEN_SEAM + 1;
const WARDEN_BRACE = WARDEN_SEAM + 2;
const detailedWardenPalette = [...wardenPalette, [72, 83, 94], [173, 186, 187], [112, 137, 151]];

function makeWardenModel(): VoxelModel {
  const width = 57, length = 7, height = 57;
  const pivot: [number, number, number] = [28, 3, 28];
  const data = new Uint8Array(width * length * height);
  for (let z = 0; z < height; z++) for (let y = 0; y < length; y++) for (let x = 0; x < width; x++) {
    const dx = x - pivot[0], dz = z - pivot[2];
    const r = Math.hypot(dx, dz);
    const brace = Math.min(Math.abs(dx), Math.abs(dz)) <= 2 && r >= 18 && r <= 27;
    if (brace) data[(z * length + y) * width + x] = 4;
    else if (y > 0 && y < length - 1 && r >= 20 && r <= 27) data[(z * length + y) * width + x] = r > 25 ? 1 : r < 22 ? 2 : 3;
  }
  return { width, length, height, pivot, data };
}

export function wardenFaces() {
  return buildFaces(makeWardenModel());
}

export function wardenAirframe(detailed: boolean) {
  const model = makeWardenModel();
  if (!detailed) return airframe(model, wardenPalette, WARDEN_VOXEL_SIZE);

  const ring = refineVoxelModel(model, (x, y, z, material, sample) => {
    if (!material) return 0;
    const radius = Math.hypot(x, z);
    const axial = Math.min(Math.abs(x), Math.abs(z));
    const end = Math.abs(y);
    const forward = end > 1.75 && !sample(x, y + Math.sign(y) * 0.5, z);
    if (material === 4) {
      if (forward && axial < 0.75 && radius > 19 && radius < 26) {
        return Math.abs(radius - 24) < 0.5 ? WARDEN_SEAM : WARDEN_BRACE;
      }
      return material;
    }

    // The outer lip steps down to the ring. The inner wall keeps long coplanar spans for the greedy bake.
    if (forward && radius > 27.15) return 0;
    if (forward && radius > 22 && radius < 25.5) {
      if (Math.abs(Math.abs(x) - Math.abs(z)) < 0.65) return WARDEN_SEAM;
      if (axial < 3.25) return WARDEN_BRACE;
      if (radius > 24.75) return WARDEN_RIM;
    }
    return material;
  });
  return airframe(ring, detailedWardenPalette, WARDEN_VOXEL_SIZE / AIRFRAME_VOXEL_SUBDIVISIONS);
}

type Detail = readonly [x: number, y: number, z: number, width: number, length: number, material: number];
type Airframe = { rows: string[]; palette: number[][]; size: number; details: Detail[] };

// Planforms run from nose to tail. Letters mark the raised canopy and engine blocks.
const enemyAirframes: Record<NewEnemyKind, Airframe> = {
  skimmer: {
    size: 1.26, palette: [[0, 0, 0], [41, 33, 33], [216, 149, 47], [255, 213, 93], [77, 215, 204], [74, 209, 223]],
    // Amber underside skids and a blue chin intake.
    details: [[1, 5, 0, 2, 3, 3], [8, 5, 0, 2, 3, 3], [4, 1, 1, 3, 1, 5]],
    rows: ['.....C.....', '....bCb....', '...bbCbb...', '..bbbbbbb..', '.bbbAbAbbb.', 'bbbbbbbbbbb', 'bbb.....bbb', '.bA.....Ab.'],
  },
  spotter: {
    size: 1.38, palette: [[0, 0, 0], [35, 29, 55], [137, 109, 205], [255, 219, 117], [204, 186, 255]],
    // A gold sensor dish projects into the open purple frame.
    details: [[6, 3, 4, 3, 1, 3], [7, 4, 4, 1, 1, 3]],
    rows: ['.bbbbbbbbbbbbb.', 'bbbbbCCCbbbbbbb', 'bbbbbbCbbbbbbbb', 'bbb.........bbb', 'bbb.........bbb', 'bbb.........bbb',
      'bAbbbbbbbbbbbAb', '.bbbbbbbbbbbbb.'],
  },
  hound: {
    size: 1.24, palette: [[0, 0, 0], [53, 28, 31], [200, 81, 51], [255, 163, 95], [252, 230, 189]],
    // Staggered side intakes and three bright exhaust ports.
    details: [[2, 5, 3, 1, 2, 1], [8, 5, 3, 1, 2, 1], [1, 6, 3, 1, 2, 1], [9, 6, 3, 1, 2, 1], [0, 8, 2, 1, 1, 4], [5, 9, 2, 1, 1, 4], [10, 8, 2, 1, 1, 4]],
    rows: ['.....C.....', '.....C.....', '....bCb....', '....bCb....', '...bbCbb...', '..bbbbbbb..',
      '.bbbbbbbbb.', 'bbb.bbb.bbb', 'Ab..bbb..bA', '....bAb....'],
  },
  flanker: {
    size: 1.38, palette: [[0, 0, 0], [22, 48, 53], [46, 161, 155], [141, 237, 222], [210, 244, 201]],
    // Teal nacelles with raised outboard fins.
    details: [[0, 4, 4, 1, 3, 3], [12, 4, 4, 1, 3, 3]],
    rows: ['bbb.......bbb', 'bAb.......bAb', 'bbb...C...bbb', 'bbb..bCb..bbb', 'bbbbbbCbbbbbb',
      'bbbbbCCCbbbbb', 'bbb..bbb..bbb', 'bbb.......bbb', 'bAb.......bAb'],
  },
  harrier: {
    size: 1.36, palette: [[0, 0, 0], [48, 43, 59], [211, 218, 214], [136, 134, 222], [255, 238, 169]],
    // Pale engine covers and a violet chevron across the spine.
    details: [[1, 0, 4, 1, 2, 4], [11, 0, 4, 1, 2, 4], [4, 5, 3, 1, 1, 3], [8, 5, 3, 1, 1, 3], [5, 6, 3, 1, 1, 3], [7, 6, 3, 1, 1, 3], [6, 7, 3, 1, 1, 3]],
    rows: ['Ab...AbA...bA', 'bbb..bCb..bbb', '.bbb.bCb.bbb.', '.bbb.bCb.bbb.', '..bbbbbbbbb..',
      '..bbbbbbbbb..', '...bbAbAbb...', '....bbbbb....', '.....bbb.....'],
  },
  diver: {
    size: 1.34, palette: [[0, 0, 0], [33, 43, 55], [105, 128, 155], [249, 181, 78], [255, 224, 132]],
    // Gold shoulders and a matching underside warning panel.
    details: [[2, 4, 4, 3, 2, 3], [8, 4, 4, 3, 2, 3], [5, 3, 1, 3, 4, 4]],
    rows: ['......C......', '.....bCb.....', '....bbCbb....', '..bbbbCbbbb..', 'bbbbbbCbbbbbb',
      'AbbbbbbbbbbA', '..bbbbbbbbb..', '....bbAbb....', '.....bbb.....'],
  },
  bomber: {
    size: 1.62, palette: [[0, 0, 0], [41, 43, 37], [119, 145, 106], [235, 133, 184], [255, 195, 221]],
    // Dark engine covers and a pink mine hatch underneath.
    details: [[1, 6, 4, 3, 2, 1], [15, 6, 4, 3, 2, 1], [8, 5, 1, 3, 3, 3]],
    rows: ['.......CCCCC.......', '....bbbCCCCCbbb....', '..bbbbbCCCCCbbbbb..', 'bbbbbbbCCCCCbbbbbbb',
      'bbbAbbbbbbbbbbbAbbb', 'bbbbbbbbbbbbbbbbbbb', 'bbbbb.bbbbbbb.bbbbb', 'bAbbb.bbbbbbb.bbbAb',
      '..bbb..bbbbb..bbb..'],
  },
  turret: {
    size: 1.5, palette: [[0, 0, 0], [43, 47, 49], [154, 152, 139], [249, 101, 83], [255, 184, 132]],
    // Low armor skirt and red gun breeches.
    details: [[0, 4, 0, 11, 3, 1], [3, 4, 4, 1, 2, 3], [7, 4, 4, 1, 2, 3]],
    rows: ['...C...C...', '...C...C...', '..bCbbbCb..', '.bbCbAbCbb.', 'bbbbbbbbbbb',
      'bbbbAbAbbbb', 'bbbbbbbbbbb', '.bbbbbbbbb.'],
  },
};

function makeRosterModel(kind: NewEnemyKind): VoxelModel {
  const { rows, details } = enemyAirframes[kind];
  const width = rows[0].length, length = rows.length, height = 6;
  const data = new Uint8Array(width * length * height);
  for (let y = 0; y < length; y++) for (let x = 0; x < width; x++) {
    const cell = rows[y][x];
    if (cell === '.') continue;
    const edge = !x || x === width - 1 || !y || y === length - 1
      || rows[y][x - 1] === '.' || rows[y][x + 1] === '.' || rows[y - 1][x] === '.' || rows[y + 1][x] === '.';
    const tall = cell === 'C' ? 5 : cell === 'A' ? 4 : 3;
    for (let z = 1; z <= tall; z++) {
      data[(z * length + y) * width + x] = cell === 'C' && z >= 4 ? 4 : cell === 'A' && z >= 3 ? 3 : edge ? 1 : 2;
    }
  }
  for (const [x, y, z, across, along, material] of details) {
    for (let dy = 0; dy < along; dy++) for (let dx = 0; dx < across; dx++) {
      data[(z * length + y + dy) * width + x + dx] = material;
    }
  }
  return { width, length, height, pivot: [(width - 1) / 2, (length - 1) / 2, 2], data };
}

const DRONE_VOXEL_SIZE = 0.84;
const INTERCEPTOR_VOXEL_SIZE = DRONE_VOXEL_SIZE * 1.18;

function shade(color: number[], brightness: number): number[] {
  return color.map(value => Math.min(255, Math.round(value * brightness)));
}

export function enemyAirframe(kind: RegularEnemyKind, detailed = false) {
  const drone = kind === 'patrol' || kind === 'interceptor';
  const model = drone ? makeDroneModel(kind) : makeRosterModel(kind);
  const palette = drone ? dronePalette : enemyAirframes[kind].palette;
  const size = kind === 'patrol' ? DRONE_VOXEL_SIZE : kind === 'interceptor' ? INTERCEPTOR_VOXEL_SIZE : enemyAirframes[kind].size;
  if (!detailed) return airframe(model, palette, size);

  const canopy = kind === 'patrol' ? 3 : kind === 'interceptor' ? 8 : 4;
  const seam = palette.length, panel = seam + 1, glassTint = seam + 2, glint = seam + 3;
  const detailedPalette = [...palette, shade(palette[2], 0.64), shade(palette[2], 1.12), shade(palette[canopy], 0.73),
    palette[canopy].map(value => Math.round(value + (255 - value) * 0.34))];

  const hull = refineVoxelModel(model, (x, y, z, material, sample) => {
    if (!material) return 0;
    const across = Math.abs(x) * 2 / model.width;
    const along = (y + model.pivot[1] + 0.5) / model.length;
    const upper = !sample(x, y, z + 0.5);
    const shoulder = !sample(x + Math.sign(x) * 0.5, y, z);

    if (material === canopy) {
      if (upper && x < -0.5 && along < 0.68) return glint;
      if (shoulder || (upper && along >= 0.68)) return glassTint;
      return material;
    }

    if (across > 0.17 && shoulder && (upper || !sample(x, y, z - 0.5))) return 0;
    if (upper && across > 0.22 && along < 0.64 && material === 2 && !sample(x, y - 0.5, z)) return 0;

    if (upper && (material === 1 || material === 2)) {
      if (across > 0.24 && across < 0.9 && along > 0.25 && along < 0.9) {
        const flap = across > 0.63 ? 1.5 : 0.5;
        if (Math.abs(y - flap) < 0.26) return seam;
        if (across > 0.30 && across < 0.58 && along > 0.55 && along < 0.79) return panel;
      }
      if (across < 0.19 && along > 0.66 && along < 0.86 && Math.abs(y - 1.5) < 0.26) return seam;
    }
    return material;
  });
  return airframe(hull, detailedPalette, size / AIRFRAME_VOXEL_SUBDIVISIONS);
}

/** Two Gnat hulls with the same footprint, both intended for one tinted instance batch. */
export function gnatGeometry(detailed: boolean): BufferGeometry {
  const outline = [
    [0, 0, -4.4], [-1.08, 0, -1.9], [-4.3, 0, 1.7], [-1.18, 0, 1.2],
    [0, 0, 3.5], [1.18, 0, 1.2], [4.3, 0, 1.7], [1.08, 0, -1.9],
  ];
  const top = outline.length, bottom = top + 1;
  const positions = [...outline.flat(), 0, 1.25, 0, 0, -0.95, 0];
  const swatches = [0xf3e8de, 0x9c9aae, 0x706b7d, 0xaa9fa7, 0xe3d2c6,
    0xaa9fa7, 0x706b7d, 0x9c9aae, 0xffffff, 0x636a82];
  const indices: number[] = [];
  for (let index = 0; index < top; index++) {
    const next = (index + 1) % top;
    if (!detailed) indices.push(top, index, next);
    indices.push(bottom, next, index);
  }
  if (detailed) {
    // Split the ridge into canopy and engine faces, and raise a shaded panel on each wing.
    const noseRidge = bottom + 1, tailRidge = bottom + 2, leftPanel = bottom + 3, rightPanel = bottom + 4;
    positions.push(0, 0.66, -2.68, 0, 1.04, 1.02, -1.85, 0.66, 0.95, 1.85, 0.66, 0.95);
    swatches.push(0xd1eff7, 0xbba7a5, 0xc9bdac, 0xc9bdac);
    indices.push(
      top, noseRidge, 1, noseRidge, 0, 1, top, 7, noseRidge, noseRidge, 7, 0,
      top, 1, 2, top, 6, 7,
      top, 2, leftPanel, 2, 3, leftPanel, 3, top, leftPanel,
      top, 5, rightPanel, 5, 6, rightPanel, 6, top, rightPanel,
      top, 3, tailRidge, tailRidge, 3, 4, top, tailRidge, 5, tailRidge, 4, 5,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(swatches.flatMap(swatch => new Color(swatch).toArray()), 3));
  geometry.setIndex(indices);
  return geometry;
}
