import type { Point } from './stage-types.ts';

export const ARENA = { x: 0, z: 0, radius: 560 };
export const RIM_WARNING = 60;
export const RIM_PUSH = 40;
export const BEACON_SIGNAL_SECONDS = 92;

export const LANDMARKS = {
  ridge: { x: -240, z: 96, alt: 110 },
  strait: { x: -128, z: -320, alt: 75 },
  stacks: { x: 288, z: 240, alt: 145 },
  atoll: { x: 160, z: -128, alt: 110 },
} as const;

export type LandmarkId = keyof typeof LANDMARKS;

export function isLandmarkId(value: string | null): value is LandmarkId {
  return value !== null && Object.prototype.hasOwnProperty.call(LANDMARKS, value);
}

export const BASALT_STACKS = [
  { x: 224, z: 224, top: 104 }, { x: 288, z: 240, top: 112 },
  { x: 352, z: 208, top: 96 }, { x: 256, z: 304, top: 108 }, { x: 336, z: 288, top: 101 },
] as const;

export function keepInsideArena(point: Point, arena: typeof ARENA, inset = 0): void {
  const dx = point.x - arena.x, dz = point.z - arena.z;
  const distance = Math.hypot(dx, dz), limit = arena.radius - inset;
  if (distance <= limit) return;
  point.x = arena.x + dx * limit / distance;
  point.z = arena.z + dz * limit / distance;
}
