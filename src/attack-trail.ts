import type { Enemy, Position } from './stage-types.ts';

export const CROSSWING_TRAIL_LENGTH = 180;
export const CROSSWING_TRAIL_SEGMENTS = 15;

const length = (from: Position, to: Position): number => Math.hypot(to.x - from.x, to.z - from.z, to.alt - from.alt);

function positionAt(from: Position, to: Position, distance: number): Position {
  const span = length(from, to);
  if (!span) return { ...to };
  const t = distance / span;
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
    alt: from.alt + (to.alt - from.alt) * t,
  };
}

/** Keep only the trailing `limit` world units of a polyline, ending at its newest point. */
export function trimTrail(points: readonly Position[], limit: number): Position[] {
  if (points.length < 2) return points.map(point => ({ ...point }));
  const result: Position[] = [{ ...points[points.length - 1] }];
  let remaining = limit;
  for (let i = points.length - 2; i >= 0 && remaining > 0; i--) {
    const from = points[i], to = points[i + 1], span = length(from, to);
    if (!span) continue;
    if (span <= remaining) {
      result.unshift({ ...from });
      remaining -= span;
    } else {
      result.unshift(positionAt(from, to, span - remaining));
      remaining = 0;
    }
  }
  return result;
}

/** Resample a trail polyline into equal-length render segments. */
export function resampleTrail(points: readonly Position[], segments: number): Position[] {
  if (points.length < 2 || segments < 1) return points.map(point => ({ ...point }));
  const total = points.slice(1).reduce((sum, point, index) => sum + length(points[index], point), 0);
  if (!total) return [points[0], points[points.length - 1]].map(point => ({ ...point }));
  const sampled: Position[] = [{ ...points[0] }];
  let segmentIndex = 0, segmentStart = 0;
  for (let step = 1; step < segments; step++) {
    const target = total * step / segments;
    while (segmentIndex < points.length - 2
      && segmentStart + length(points[segmentIndex], points[segmentIndex + 1]) < target) {
      segmentStart += length(points[segmentIndex], points[segmentIndex + 1]);
      segmentIndex++;
    }
    sampled.push(positionAt(points[segmentIndex], points[segmentIndex + 1], target - segmentStart));
  }
  sampled.push({ ...points[points.length - 1] });
  return sampled;
}

/**
 * The visible smoke path left by one Crosswing attack run. It is derived from the planned
 * start/crossing geometry rather than render history, so time seeks show the same crossing shape.
 */
export function crosswingTrail(enemy: Enemy, segments = CROSSWING_TRAIL_SEGMENTS): Position[] | null {
  const pair = enemy.crosswing;
  if (!pair?.start || !pair.crossingPoint) return null;
  const current = { x: enemy.x, z: enemy.z, alt: enemy.alt };
  const start = { x: pair.start.x, z: pair.start.z, alt: enemy.alt };
  const crossing = { x: pair.crossingPoint.x, z: pair.crossingPoint.z, alt: enemy.alt };
  if (pair.phase === 'crossing') return resampleTrail(trimTrail([start, current], CROSSWING_TRAIL_LENGTH), segments);
  if (pair.phase === 'exit' || pair.phase === 'finished' || pair.phase === 'recovery') {
    return resampleTrail(trimTrail([start, crossing, current], CROSSWING_TRAIL_LENGTH), segments);
  }
  return null;
}
