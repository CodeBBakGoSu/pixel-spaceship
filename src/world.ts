export const TERRAIN_SIZE = 512;
const MASK = TERRAIN_SIZE - 1;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (x: number, y: number) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

// The Reach heightmap and color map wrap at 512 metres.
function noise(x: number, y: number, scale: number): number {
  const cells = TERRAIN_SIZE / scale;
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const sx = gx - x0, sy = gy - y0;
  const tx = sx * sx * (3 - 2 * sx), ty = sy * sy * (3 - 2 * sy);
  const sample = (a: number, b: number) => hash((a + cells) % cells, (b + cells) % cells);
  return mix(mix(sample(x0, y0), sample(x0 + 1, y0), tx), mix(sample(x0, y0 + 1), sample(x0 + 1, y0 + 1), tx), ty);
}

export class World {
  private readonly heights = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
  readonly texture = new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE * 4);

  constructor() {
    for (let z = 0; z < TERRAIN_SIZE; z++) for (let x = 0; x < TERRAIN_SIZE; x++) {
      const index = z * TERRAIN_SIZE + x;
      const jx = (x + 128) % TERRAIN_SIZE, jz = (z + 128) % TERRAIN_SIZE;
      const coast = noise(jx, jz, 256) * 0.55 + noise(jx, jz, 128) * 0.45;
      this.heights[index] = 35 + Math.max(0, coast - 0.32) * 38 + noise(jx, jz, 64) * 2;

      let rgb: [number, number, number];
      if (coast < 0.32) rgb = coast < 0.25 ? [28, 85, 109] : [45, 128, 140];
      else if (coast < 0.35) rgb = [215, 191, 139];
      else if (coast < 0.39) rgb = [117, 162, 79];
      else rgb = noise(jx, (z + 64) % TERRAIN_SIZE, 128) > 0.54 ? [58, 127, 57] : [75, 145, 63];
      const dx = x % 4 - 1.5, dz = z % 4 - 1.5;
      const tree = coast >= 0.37 && hash(Math.floor(x / 4), Math.floor(z / 4)) > 0.82 && dx * dx + dz * dz < 4 ? -25 : 0;
      const shimmer = coast < 0.32 && hash(x * 3, z * 3) > 0.97 ? 23 : 0;
      const band = (Math.floor(coast * 28) % 3 - 1) * 4;
      for (let channel = 0; channel < 3; channel++) this.texture[index * 4 + channel] = rgb[channel] + band + tree + shimmer;
      this.texture[index * 4 + 3] = 255;
    }
  }

  height(x: number, z: number): number {
    return this.heights[(Math.floor(z) & MASK) * TERRAIN_SIZE + (Math.floor(x) & MASK)];
  }
}
