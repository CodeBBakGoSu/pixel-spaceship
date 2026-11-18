import { buildFaces } from './voxel.ts';

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
