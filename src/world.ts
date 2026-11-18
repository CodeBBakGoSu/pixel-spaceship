import { ARENA, BASALT_STACKS, LANDMARKS } from './reach.ts';
import type { Ground } from './stage-types.ts';

export const TERRAIN_SIZE = 1024;
export const TERRAIN_HALF_WIDTH = 1920;
export const TERRAIN_MESH_STEP = 16;
const MASK = TERRAIN_SIZE - 1;
const BASE_SIZE = 512;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (v: number) => v * v * (3 - 2 * v);
const shoulder = (r: number, start: number) => 1 - smooth(Math.max(0, Math.min(1, (r - start) / (1 - start))));
const hash = (x: number, y: number) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

function noise(x: number, y: number, scale: number): number {
  const cells = BASE_SIZE / scale;
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const sx = gx - x0, sy = gy - y0;
  const tx = sx * sx * (3 - 2 * sx), ty = sy * sy * (3 - 2 * sy);
  const sample = (a: number, b: number) => hash((a + cells) % cells, (b + cells) % cells);
  return mix(mix(sample(x0, y0), sample(x0 + 1, y0), tx), mix(sample(x0, y0 + 1), sample(x0 + 1, y0 + 1), tx), ty);
}

// The mesh has reversed world Z. Use its two triangles for clearance and HUD projection.
export function terrainSurface(sample: Ground, x: number, z: number): number {
  const step = TERRAIN_MESH_STEP;
  const left = Math.floor(x / step) * step, top = Math.ceil(z / step) * step;
  const u = (x - left) / step, v = (top - z) / step;
  if (u === 0 && v === 0) return sample(left, top);
  const b = sample(left, top - step), d = sample(left + step, top);
  if (u + v <= 1) return sample(left, top) * (1 - u - v) + u * d + v * b;
  return sample(left + step, top - step) * (u + v - 1) + (1 - u) * b + (1 - v) * d;
}

export function terrainFogFar(aspect: number, fov: number, pitch = 0, bank = 0): number {
  const forward = 1 / Math.cos(pitch);
  const slope = Math.abs(Math.tan(pitch)), roll = Math.abs(Math.tan(bank));
  const across = aspect * Math.tan(fov * Math.PI / 360) / Math.cos(bank) + roll * slope;
  // Allow 100 m for camera setback and 170 m for the eye-to-ground height difference.
  const room = TERRAIN_HALF_WIDTH - ARENA.radius - 100 - 170 * Math.hypot(slope, roll * forward);
  return Math.min(875, room / Math.hypot(forward, across));
}

export class World {
  private readonly heights = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
  readonly texture = new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE * 4);
  private readonly sample = (x: number, z: number) => this.heights[(z & MASK) * TERRAIN_SIZE + (x & MASK)];

  constructor() {
    for (let z = 0; z < TERRAIN_SIZE; z++) for (let x = 0; x < TERRAIN_SIZE; x++) {
      const index = z * TERRAIN_SIZE + x;
      const jx = (x + 128) % BASE_SIZE, jz = (z + 128) % BASE_SIZE;
      const coast = noise(jx, jz, 256) * 0.55 + noise(jx, jz, 128) * 0.45;
      let height = 35 + Math.max(0, coast - 0.32) * 38 + noise(jx, jz, 64) * 2;

      let rgb: [number, number, number];
      if (coast < 0.32) rgb = coast < 0.25 ? [28, 85, 109] : [45, 128, 140];
      else if (coast < 0.35) rgb = [215, 191, 139];
      else if (coast < 0.39) rgb = [117, 162, 79];
      else rgb = noise(jx, (z + 64) % BASE_SIZE, 128) > 0.54 ? [58, 127, 57] : [75, 145, 63];
      const wx = x < TERRAIN_SIZE / 2 ? x : x - TERRAIN_SIZE;
      const wz = z < TERRAIN_SIZE / 2 ? z : z - TERRAIN_SIZE;
      const { ridge, strait, atoll, stacks } = LANDMARKS;
      const ridgeRange = Math.hypot((wx - ridge.x) / 118, (wz - ridge.z) / 94);
      const straitRange = Math.hypot((wx - strait.x) / 179, (wz - strait.z) / 88);
      const atollRange = Math.hypot(wx - atoll.x, wz - atoll.z);
      if (ridgeRange < 1) {
        height = mix(height, 80 + noise(jx, jz, 64) * 3, shoulder(ridgeRange, 0.48));
        if (height > 53) rgb = height > 74 ? [118, 158, 83] : [132, 122, 78];
      } else if (straitRange < 1) {
        height = mix(height, 35, shoulder(straitRange, 0.58));
        rgb = straitRange < 0.61 ? [31, 115, 139] : straitRange < 0.87 ? [64, 148, 147] : [180, 173, 120];
      } else if (atollRange < 115) {
        const rim = Math.max(0, 1 - Math.abs(atollRange - 77) / 17);
        height = mix(height, 36 + 5 * rim, shoulder(atollRange / 115, 0.82));
        rgb = atollRange < 65 ? [34, 120, 149] : atollRange < 89 ? [200, 188, 128] : [61, 142, 142];
      } else if (Math.abs(wx - stacks.x) < 135 && Math.abs(wz - stacks.z) < 117) {
        for (const stack of BASALT_STACKS) {
          const range = Math.hypot((wx - stack.x) / 37, (wz - stack.z) / 31);
          if (range >= 1) continue;
          height = Math.max(height, mix(height, stack.top, shoulder(range, 0.34)));
          rgb = height > 81 ? [103, 108, 109] : [83, 99, 97];
        }
      }
      this.heights[index] = height;
      const dx = x % 4 - 1.5, dz = z % 4 - 1.5;
      const tree = coast >= 0.37 && hash(Math.floor(x / 4), Math.floor(z / 4)) > 0.82 && dx * dx + dz * dz < 4 ? -25 : 0;
      const shimmer = coast < 0.32 && hash(x * 3, z * 3) > 0.97 ? 23 : 0;
      const band = (Math.floor(coast * 28) % 3 - 1) * 4;
      for (let channel = 0; channel < 3; channel++) this.texture[index * 4 + channel] = rgb[channel] + band + tree + shimmer;
      this.texture[index * 4 + 3] = 255;
    }
  }

  height(x: number, z: number): number {
    return terrainSurface(this.sample, x, z);
  }
}
