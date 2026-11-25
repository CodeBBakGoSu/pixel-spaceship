import assert from 'node:assert/strict';
import test from 'node:test';
import { crosswingTrail, CROSSWING_TRAIL_LENGTH, CROSSWING_TRAIL_SEGMENTS, resampleTrail, trimTrail } from '../src/attack-trail.ts';

const fighter = (phase, current) => ({
  x: current.x, z: current.z, alt: 120,
  crosswing: { phase, start: { x: 0, z: 0 }, crossingPoint: { x: 100, z: 0 } },
});

test('Crosswing approach smoke ends at the fighter without drawing the future crossing point', () => {
  const trail = crosswingTrail(fighter('crossing', { x: 40, z: 0 }));
  assert.equal(trail.length, CROSSWING_TRAIL_SEGMENTS + 1);
  assert.deepEqual(trail.at(-1), { x: 40, z: 0, alt: 120 });
  assert.equal(Math.max(...trail.map(point => point.x)), 40);
});

test('Crosswing exit smoke keeps the shared crossing inside the visible trailing path', () => {
  const trail = crosswingTrail(fighter('exit', { x: 240, z: 0 }));
  assert.deepEqual(trail.at(-1), { x: 240, z: 0, alt: 120 });
  assert.equal(Math.min(...trail.map(point => point.x)), 240 - CROSSWING_TRAIL_LENGTH);
  assert.ok(trail.some(point => Math.abs(point.x - 100) < CROSSWING_TRAIL_LENGTH / CROSSWING_TRAIL_SEGMENTS));
});

test('trail trimming and resampling preserve a turn while spacing render segments evenly', () => {
  const path = [
    { x: 0, z: 0, alt: 120 },
    { x: 100, z: 0, alt: 120 },
    { x: 100, z: 100, alt: 120 },
  ];
  const trimmed = trimTrail(path, 150);
  assert.equal(Math.hypot(trimmed[0].x - 100, trimmed[0].z), 50);
  const sampled = resampleTrail(trimmed, 10);
  assert.ok(sampled.some(point => point.z > 0), 'resampling preserves the turned exit leg');
  assert.deepEqual(sampled.at(-1), { x: 100, z: 100, alt: 120 });

  const straight = resampleTrail([{ x: 0, z: 0, alt: 120 }, { x: 100, z: 0, alt: 120 }], 10);
  const spacing = straight.slice(1).map((point, index) => Math.hypot(
    point.x - straight[index].x, point.z - straight[index].z, point.alt - straight[index].alt));
  for (const distance of spacing) assert.ok(Math.abs(distance - 10) < 1e-9, String(distance));
});
