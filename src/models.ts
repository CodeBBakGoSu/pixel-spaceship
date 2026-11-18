import { buildFaces } from './voxel.ts';
import type { NewEnemyKind } from './enemy-kinds.ts';

export const wardenPalette = [[0, 0, 0], [54, 64, 77], [102, 121, 133], [205, 213, 206]];

export function wardenFaces() {
  const width = 57, length = 7, height = 57;
  const pivot: [number, number, number] = [28, 3, 28];
  const data = new Uint8Array(width * length * height);
  for (let z = 0; z < height; z++) for (let y = 0; y < length; y++) for (let x = 0; x < width; x++) {
    const r = Math.hypot(x - pivot[0], z - pivot[2]);
    if (r >= 20 && r <= 27) data[(z * length + y) * width + x] = r > 25 ? 1 : r < 22 ? 2 : 3;
  }
  return buildFaces({ width, length, height, pivot, data });
}

type Airframe = { rows: string[]; palette: number[][]; size: number };

// Planforms run from nose to tail. Letters mark the raised canopy and engine blocks.
const enemyAirframes: Record<NewEnemyKind, Airframe> = {
  skimmer: {
    size: 1.26, palette: [[0, 0, 0], [41, 33, 33], [216, 149, 47], [255, 213, 93], [77, 215, 204]],
    rows: ['.....C.....', '....bCb....', '...bbCbb...', '..bbbbbbb..', '.bbbAbAbbb.', 'bbbbbbbbbbb', 'bbb.....bbb', '.bA.....Ab.'],
  },
  spotter: {
    size: 1.38, palette: [[0, 0, 0], [35, 29, 55], [137, 109, 205], [255, 219, 117], [204, 186, 255]],
    rows: ['.bbbbbbbbbbbbb.', 'bbbbbCCCbbbbbbb', 'bbbbbbCbbbbbbbb', 'bbb.........bbb', 'bbb.........bbb', 'bbb.........bbb',
      'bAbbbbbbbbbbbAb', '.bbbbbbbbbbbbb.'],
  },
  hound: {
    size: 1.24, palette: [[0, 0, 0], [53, 28, 31], [200, 81, 51], [255, 163, 95], [252, 230, 189]],
    rows: ['.....C.....', '.....C.....', '....bCb....', '....bCb....', '...bbCbb...', '..bbbbbbb..',
      '.bbbbbbbbb.', 'bbb.bbb.bbb', 'Ab..bbb..bA', '....bAb....'],
  },
  flanker: {
    size: 1.38, palette: [[0, 0, 0], [22, 48, 53], [46, 161, 155], [141, 237, 222], [210, 244, 201]],
    rows: ['bbb.......bbb', 'bAb.......bAb', 'bbb...C...bbb', 'bbb..bCb..bbb', 'bbbbbbCbbbbbb',
      'bbbbbCCCbbbbb', 'bbb..bbb..bbb', 'bbb.......bbb', 'bAb.......bAb'],
  },
  harrier: {
    size: 1.36, palette: [[0, 0, 0], [48, 43, 59], [211, 218, 214], [136, 134, 222], [255, 238, 169]],
    rows: ['Ab...AbA...bA', 'bbb..bCb..bbb', '.bbb.bCb.bbb.', '.bbb.bCb.bbb.', '..bbbbbbbbb..',
      '..bbbbbbbbb..', '...bbAbAbb...', '....bbbbb....', '.....bbb.....'],
  },
  diver: {
    size: 1.34, palette: [[0, 0, 0], [33, 43, 55], [105, 128, 155], [249, 181, 78], [255, 224, 132]],
    rows: ['......C......', '.....bCb.....', '....bbCbb....', '..bbbbCbbbb..', 'bbbbbbCbbbbbb',
      'AbbbbbbbbbbA', '..bbbbbbbbb..', '....bbAbb....', '.....bbb.....'],
  },
  bomber: {
    size: 1.62, palette: [[0, 0, 0], [41, 43, 37], [119, 145, 106], [235, 133, 184], [255, 195, 221]],
    rows: ['.......CCCCC.......', '....bbbCCCCCbbb....', '..bbbbbCCCCCbbbbb..', 'bbbbbbbCCCCCbbbbbbb',
      'bbbAbbbbbbbbbbbAbbb', 'bbbbbbbbbbbbbbbbbbb', 'bbbbb.bbbbbbb.bbbbb', 'bAbbb.bbbbbbb.bbbAb',
      '..bbb..bbbbb..bbb..'],
  },
  turret: {
    size: 1.5, palette: [[0, 0, 0], [43, 47, 49], [154, 152, 139], [249, 101, 83], [255, 184, 132]],
    rows: ['...C...C...', '...C...C...', '..bCbbbCb..', '.bbCbAbCbb.', 'bbbbbbbbbbb',
      'bbbbAbAbbbb', 'bbbbbbbbbbb', '.bbbbbbbbb.'],
  },
};

export function enemyAirframe(kind: NewEnemyKind) {
  const { rows, palette, size } = enemyAirframes[kind];
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
  return { faces: buildFaces({ width, length, height, pivot: [(width - 1) / 2, (length - 1) / 2, 2], data }), palette, size };
}
