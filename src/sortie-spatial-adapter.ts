import type { Position } from './stage-types.ts';

export type SpatialPoint = Position;
export type SpatialVector = Pick<Position, 'x' | 'z' | 'alt'>;

export function add3d(point: SpatialPoint, vector: SpatialVector): SpatialPoint {
  return { x: point.x + vector.x, z: point.z + vector.z, alt: point.alt + vector.alt };
}

function subtract3d(first: SpatialPoint, second: SpatialPoint): SpatialVector {
  return { x: first.x - second.x, z: first.z - second.z, alt: first.alt - second.alt };
}

export function scale3d(vector: SpatialVector, scale: number): SpatialVector {
  return { x: vector.x * scale, z: vector.z * scale, alt: vector.alt * scale };
}

function dot3d(first: SpatialVector, second: SpatialVector): number {
  return first.x * second.x + first.z * second.z + first.alt * second.alt;
}

function lengthSquared3d(vector: SpatialVector): number {
  return dot3d(vector, vector);
}

function distanceSquared3d(first: SpatialPoint, second: SpatialPoint): number {
  return lengthSquared3d(subtract3d(first, second));
}

export function distance3d(first: SpatialPoint, second: SpatialPoint): number {
  return Math.sqrt(distanceSquared3d(first, second));
}

export function normalize3d(vector: SpatialVector): SpatialVector {
  const length = Math.sqrt(lengthSquared3d(vector));
  return length > 0 ? scale3d(vector, 1 / length) : { x: 0, z: 0, alt: 0 };
}

export function segmentSphereIntersection3d(start: SpatialPoint, end: SpatialPoint, center: SpatialPoint,
  radius: number): number | null {
  const segment = subtract3d(end, start);
  const fromCenter = subtract3d(start, center);
  const a = lengthSquared3d(segment);
  const c = lengthSquared3d(fromCenter) - radius ** 2;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const b = 2 * dot3d(fromCenter, segment);
  const discriminant = b ** 2 - 4 * a * c;
  if (discriminant < 0) return null;
  const firstContact = (-b - Math.sqrt(discriminant)) / (2 * a);
  return firstContact >= 0 && firstContact <= 1 ? firstContact : null;
}
