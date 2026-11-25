export type SpatialPoint = Readonly<{ x: number; z: number; alt: number }>;
export type SpatialVector = Readonly<{ x: number; z: number; alt: number }>;

export function playerSpatialPoint(player: Readonly<{ x: number; z: number; altitude: number }>): SpatialPoint {
  return { x: player.x, z: player.z, alt: player.altitude };
}

export function add3d(point: SpatialPoint, vector: SpatialVector): SpatialPoint {
  return { x: point.x + vector.x, z: point.z + vector.z, alt: point.alt + vector.alt };
}

export function subtract3d(to: SpatialPoint, from: SpatialPoint): SpatialVector {
  return { x: to.x - from.x, z: to.z - from.z, alt: to.alt - from.alt };
}

export function scale3d(vector: SpatialVector, scale: number): SpatialVector {
  return { x: vector.x * scale, z: vector.z * scale, alt: vector.alt * scale };
}

export function dot3d(a: SpatialVector, b: SpatialVector): number {
  return a.x * b.x + a.z * b.z + a.alt * b.alt;
}

export function lengthSquared3d(vector: SpatialVector): number {
  return dot3d(vector, vector);
}

export function distanceSquared3d(a: SpatialPoint, b: SpatialPoint): number {
  return lengthSquared3d(subtract3d(a, b));
}

export function distance3d(a: SpatialPoint, b: SpatialPoint): number {
  return Math.sqrt(distanceSquared3d(a, b));
}

export function normalize3d(vector: SpatialVector): SpatialVector {
  const length = Math.sqrt(lengthSquared3d(vector));
  return length > 0 ? scale3d(vector, 1 / length) : { x: 0, z: 0, alt: 0 };
}

export function direction3d(from: SpatialPoint, to: SpatialPoint): SpatialVector {
  return normalize3d(subtract3d(to, from));
}

export function pointSegmentDistanceSquared3d(point: SpatialPoint, start: SpatialPoint, end: SpatialPoint): number {
  const segment = subtract3d(end, start), offset = subtract3d(point, start);
  const lengthSquared = lengthSquared3d(segment);
  const fraction = lengthSquared > 0 ? Math.max(0, Math.min(1, dot3d(offset, segment) / lengthSquared)) : 0;
  return distanceSquared3d(point, add3d(start, scale3d(segment, fraction)));
}

export function segmentSphereIntersection3d(
  start: SpatialPoint, end: SpatialPoint, center: SpatialPoint, radius: number,
): number | null {
  if (radius < 0) return null;
  const offset = subtract3d(start, center), direction = subtract3d(end, start);
  const lengthSquared = lengthSquared3d(direction), radiusSquared = radius * radius;
  const startDistanceSquared = lengthSquared3d(offset);
  if (startDistanceSquared <= radiusSquared) return 0;
  if (lengthSquared === 0) return null;

  const projection = dot3d(offset, direction);
  const discriminant = projection * projection - lengthSquared * (startDistanceSquared - radiusSquared);
  if (discriminant < 0) return null;
  const fraction = (-projection - Math.sqrt(discriminant)) / lengthSquared;
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}

export function spheresOverlap3d(a: SpatialPoint, radiusA: number, b: SpatialPoint, radiusB: number): boolean {
  if (radiusA < 0 || radiusB < 0) return false;
  const radius = radiusA + radiusB;
  return distanceSquared3d(a, b) <= radius * radius;
}
