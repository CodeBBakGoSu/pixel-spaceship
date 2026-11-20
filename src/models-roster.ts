import { buildFaces } from './voxel.ts';

function airframe(
  width: number, length: number, height: number, pivot: [number, number, number],
  size: number, palette: number[][], material: (x: number, y: number, z: number) => number,
) {
  const data = new Uint8Array(width * length * height);
  for (let z = 0; z < height; z++) for (let y = 0; y < length; y++) for (let x = 0; x < width; x++) {
    data[(z * length + y) * width + x] = material(x - pivot[0], y - pivot[1], z - pivot[2]);
  }
  return { faces: buildFaces({ width, length, height, pivot, data }), palette, size };
}

const acePalette = [
  [0, 0, 0], [51, 30, 49], [147, 53, 66], [227, 76, 83], [255, 192, 128],
  [248, 224, 194], [98, 181, 201], [49, 78, 113], [255, 150, 67], [122, 113, 144],
];

/** Swept crimson wings, a pale stripe and split tailpipes identify the Ace at any attitude. */
export function aceAirframe() {
  return airframe(67, 65, 21, [33, 33, 6], 0.5, acePalette, (x, y, z) => {
    const across = Math.abs(x);
    const wingFront = -8 + Math.max(0, across - 4) * 0.66;
    const wingBack = 22 - Math.max(0, across - 25) * 0.47;
    const tailpipe = (across - 7) ** 2 + (z + 0.5) ** 2;
    if (y >= 25 && y <= 29 && tailpipe <= 20) {
      if (tailpipe < 9) return y === 26 ? 8 : 0;
      return y === 29 ? 9 : 1;
    }
    if (across >= 9 && across <= 11 && y >= 15 && y <= 25 && z >= 3 && z <= y - 11) {
      return z >= 9 ? 3 : 2;
    }
    if (y >= -1 && y <= 26 && tailpipe <= 18) return z < 0 ? 1 : 2;
    const noseWidth = y < -26 ? 1 : y < -19 ? 2 : y < -11 ? 3 : 4;
    const top = y < -20 ? 1 : y < 16 ? 4 : 2;
    if (y >= -32 && y <= 24 && across <= noseWidth && z >= -3 && z <= top) {
      if (y >= -14 && y <= -3 && z >= 3) return y < -11 || across === 4 ? 7 : 6;
      return z < -1 ? 1 : y < -22 || across === 4 ? 3 : 2;
    }
    if (across <= 32 && y >= wingFront && y <= wingBack && z >= -2 && z <= 0) {
      if (y > wingBack - 2 || across > 29) return 1;
      if (across > 7 && y - wingFront >= 3 && y - wingFront < 5) return 5;
      return z === -2 ? 2 : across > 11 ? 3 : 2;
    }
    return 0;
  });
}

const aegisPalette = [
  [0, 0, 0], [43, 58, 81], [86, 126, 160], [142, 213, 222], [190, 249, 241],
  [73, 119, 174], [237, 141, 91], [62, 78, 108],
];

/** Broad blue shield emitters face forward and orange cooling ports mark the open tail. */
export function aegisAirframe() {
  return airframe(39, 33, 12, [19, 16, 5], 0.55, aegisPalette, (x, y, z) => {
    const across = Math.abs(x), front = -14 + Math.floor(Math.abs(across - 13) / 4) * 2;
    if (across >= 10 && across <= 16 && y >= front && y <= -7 && z >= -2 && z <= 3) {
      return y < front + 2 ? 4 : z > 1 ? 3 : 1;
    }
    if (across >= 11 && across <= 14 && y >= 6 && y <= 12 && z >= -1 && z <= 4) {
      return y === 12 ? 6 : z > 2 ? 5 : 1;
    }
    if (across <= 4 && y >= -11 && y <= 14 && z >= -3 && z <= 4) {
      if (y >= -9 && y <= -2 && z >= 3) return across >= 3 ? 7 : 3;
      if (y >= 10 && z > 1) return 6;
      return z < 0 ? 1 : 2;
    }
    const back = 11 - Math.floor(Math.max(0, across - 12) / 4) * 3;
    if (across <= 18 && y >= front + 4 && y <= back && z >= -2 && z <= 0) {
      return y > back - 2 ? 1 : 2;
    }
    return 0;
  });
}
