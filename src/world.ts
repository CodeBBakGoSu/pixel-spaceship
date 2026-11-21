import { GROUND_COLORS } from './data/palette.ts';
import { REACH_LANDMARKS as LANDMARKS, REACH_STACKS as BASALT_STACKS, WORLD_TERRAIN } from './data/world.ts';
import { TERRAIN_STREAM } from './data/terrain-stream.ts';
import type { Ground } from './stage-types.ts';

export const TERRAIN_SIZE = WORLD_TERRAIN.period;
export const TERRAIN_MESH_STEP = WORLD_TERRAIN.step;
export const TERRAIN_MIN_ALTITUDE = WORLD_TERRAIN.seaLevel;
export const TERRAIN_MAX_ALTITUDE = WORLD_TERRAIN.maxHeight;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (v: number) => v * v * (3 - 2 * v);
const shoulder = (r: number, start: number) => 1 - smooth(Math.max(0, Math.min(1, (r - start) / (1 - start))));

export function worldHash(seed: number, x: number, z: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1446999437) + 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function noise(seed: number, x: number, z: number, scale: number, period: number = TERRAIN_SIZE): number {
  const mask = period / scale - 1;
  const gx = x / scale, gz = z / scale;
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const ax = x0 & mask, bx = (x0 + 1) & mask;
  const az = z0 & mask, bz = (z0 + 1) & mask;
  const tx = smooth(gx - x0), tz = smooth(gz - z0);
  return mix(mix(worldHash(seed, ax, az), worldHash(seed, bx, az), tx),
    mix(worldHash(seed, ax, bz), worldHash(seed, bx, bz), tx), tz) / 4294967295;
}

function reachHeight(x: number, z: number, raw = false): number {
  const jx = x + 128, jz = z + 128;
  const coast = noise(0, jx, jz, 256, 512) * 0.55 + noise(0, jx, jz, 128, 512) * 0.45;
  const detail = noise(0, jx, jz, 64, 512);
  let height = TERRAIN_MIN_ALTITUDE + (raw ? coast - 0.32 : Math.max(0, coast - 0.32)) * 38 + detail * 2;
  const { ridge, strait, atoll, stacks } = LANDMARKS;
  const ridgeRange = Math.hypot((x - ridge.x) / 118, (z - ridge.z) / 94);
  const straitRange = Math.hypot((x - strait.x) / 179, (z - strait.z) / 88);
  const atollRange = Math.hypot(x - atoll.x, z - atoll.z);
  if (ridgeRange < 1) return mix(height, 80 + detail * 3, shoulder(ridgeRange, 0.48));
  if (straitRange < 1) return mix(height, TERRAIN_MIN_ALTITUDE, shoulder(straitRange, 0.58));
  if (atollRange < 115) {
    const rim = Math.max(0, 1 - Math.abs(atollRange - 77) / 17);
    return mix(height, 36 + 5 * rim, shoulder(atollRange / 115, 0.82));
  }
  if (Math.abs(x - stacks.x) < 135 && Math.abs(z - stacks.z) < 117) {
    for (const stack of BASALT_STACKS) {
      const range = Math.hypot((x - stack.x) / 37, (z - stack.z) / 31);
      if (range < 1) height = Math.max(height, mix(height, stack.top, shoulder(range, 0.34)));
    }
  }
  return height;
}

function terrainVertex(seed: number, x: number, z: number, raw = false): number {
  const half = TERRAIN_SIZE / 2, mask = TERRAIN_SIZE - 1;
  const wx = ((x + half) & mask) - half, wz = ((z + half) & mask) - half;
  const radius = Math.max(Math.abs(wx), Math.abs(wz));
  if (radius <= WORLD_TERRAIN.reachCore) return reachHeight(wx, wz, raw);
  const coast = noise(seed, wx, wz, 512) * 0.64 + noise(seed, wx, wz, 256) * 0.36;
  const detail = noise(seed, wx, wz, 64);
  const height = TERRAIN_MIN_ALTITUDE + (raw ? coast - 0.41 : Math.max(0, coast - 0.41)) * 35 + detail * 2;
  if (radius >= WORLD_TERRAIN.reachBlend) return height;
  const blend = shoulder(radius / WORLD_TERRAIN.reachBlend, WORLD_TERRAIN.reachCore / WORLD_TERRAIN.reachBlend);
  return mix(height, reachHeight(wx, wz, raw), blend);
}

// Both the mesh and gameplay use the 16 m grid's two triangles at full detail.
export function terrainSurface(sample: Ground, x: number, z: number): number {
  const step = TERRAIN_MESH_STEP;
  const left = Math.floor(x / step) * step, top = Math.ceil(z / step) * step;
  const u = (x - left) / step, v = (top - z) / step;
  if (u === 0 && v === 0) return sample(left, top);
  const b = sample(left, top - step), d = sample(left + step, top);
  if (u + v <= 1) return sample(left, top) * (1 - u - v) + u * d + v * b;
  return sample(left + step, top - step) * (u + v - 1) + (1 - u) * b + (1 - v) * d;
}

export const isWater = (altitude: number): boolean => altitude <= WORLD_TERRAIN.shallows;

export function groundAt(seed: number, x: number, z: number): number {
  return terrainSurface((vx, vz) => terrainVertex(seed, vx, vz), x, z);
}

/** Higher up sees further: the haze starts later and the horizon recedes (render-only). */
export function altitudeHaze(altitude: number): number {
  return Math.min(1, Math.max(0, (altitude - 75) / 90));
}

export function terrainFogFar(aspect: number, fov: number, pitch = 0, bank = 0, mobile = false, altitude = 0): number {
  const forward = 1 / Math.cos(pitch);
  const slope = Math.abs(Math.tan(pitch)), halfHeight = Math.tan(fov * Math.PI / 360);
  const across = halfHeight * (aspect * Math.abs(Math.cos(bank)) + 1.8 * Math.abs(Math.sin(bank)));
  const tier = mobile ? TERRAIN_STREAM.phone : TERRAIN_STREAM.desktop;
  const coverage = tier.radius * TERRAIN_STREAM.chunkSize;
  const room = Math.max(TERRAIN_STREAM.chunkSize, coverage - TERRAIN_STREAM.fogMargin - MAX_CAMERA_CLEARANCE * slope);
  return Math.min(tier.fogFar * (1 + 0.3 * altitudeHaze(altitude)), room / Math.hypot(forward, across));
}

const MAX_CAMERA_CLEARANCE = 170;
const CACHE_SIZE = 1 << 14;

export class World {
  private activeSeed: number;
  private readonly keys = new Int32Array(CACHE_SIZE).fill(-1);
  private readonly heights = new Float64Array(CACHE_SIZE);

  constructor(seed = 1) { this.activeSeed = seed >>> 0; }
  get seed(): number { return this.activeSeed; }
  set seed(value: number) {
    const next = value >>> 0;
    if (next === this.activeSeed) return;
    this.activeSeed = next;
    this.keys.fill(-1);
  }

  // Memoize vertices by their coordinates within the terrain period. Nothing depends on cache order.
  private readonly sample: Ground = (x, z) => {
    const width = TERRAIN_SIZE / TERRAIN_MESH_STEP;
    const vx = (x / TERRAIN_MESH_STEP) & (width - 1), vz = (z / TERRAIN_MESH_STEP) & (width - 1);
    const key = vz * width + vx;
    const index = (Math.imul(vx, 73856093) ^ Math.imul(vz, 19349663)) & (CACHE_SIZE - 1);
    if (this.keys[index] === key) return this.heights[index];
    this.keys[index] = key;
    return this.heights[index] = terrainVertex(this.activeSeed, x, z);
  };

  height(x: number, z: number): number {
    return terrainSurface(this.sample, x, z);
  }

  private readonly rawFloor: Ground = (x, z) => terrainVertex(this.activeSeed, x, z, true);

  /** Render-only depth field. Ease the unclamped floor into the shore of raised landmarks. */
  seabed(x: number, z: number): number {
    const surface = this.height(x, z);
    if (surface >= WORLD_TERRAIN.shallows) return surface;
    const floor = terrainSurface(this.rawFloor, x, z);
    return mix(surface, floor, Math.min(1, WORLD_TERRAIN.shallows - surface));
  }

  color(x: number, z: number): number {
    const height = this.height(x, z), c = GROUND_COLORS;
    if (isWater(height)) return height < 36.3 ? c.deep : c.shallow;
    if (height < 41.5) return c.sand;
    if (height < 45) return c.meadow;
    if (height < 73) return c.grass[worldHash(this.seed, Math.floor(x / 32), Math.floor(z / 32)) & 1];
    return height < 88 ? c.hill : c.rock;
  }
}
