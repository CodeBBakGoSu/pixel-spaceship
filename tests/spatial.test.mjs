import test from 'node:test';
import assert from 'node:assert/strict';
import {
  add3d, direction3d, distance3d, distanceSquared3d, normalize3d, playerSpatialPoint, pointSegmentDistanceSquared3d,
  scale3d, segmentSphereIntersection3d, spheresOverlap3d, subtract3d,
} from '../src/spatial.ts';

const origin = { x: 0, z: 0, alt: 0 };

test('continuous-space vectors include altitude in distance, direction, and point transforms', () => {
  const target = { x: 3, z: 4, alt: 12 };
  assert.equal(distanceSquared3d(origin, target), 169);
  assert.equal(distance3d(origin, target), 13);
  assert.deepEqual(direction3d(origin, target), { x: 3 / 13, z: 4 / 13, alt: 12 / 13 });
  assert.deepEqual(add3d(origin, scale3d(subtract3d(target, origin), 0.5)), { x: 1.5, z: 2, alt: 6 });
  assert.deepEqual(normalize3d(origin), origin);
  assert.deepEqual(playerSpatialPoint({ x: 1, z: 2, altitude: 3 }), { x: 1, z: 2, alt: 3 });
});

test('point-to-segment distance clamps to endpoints in full 3D', () => {
  assert.equal(pointSegmentDistanceSquared3d({ x: 5, z: 2, alt: 4 }, origin, { x: 10, z: 0, alt: 0 }), 20);
  assert.equal(pointSegmentDistanceSquared3d({ x: 0, z: 3, alt: 4 }, origin, origin), 25);
  assert.equal(pointSegmentDistanceSquared3d({ x: 15, z: 0, alt: 0 }, origin, { x: 10, z: 0, alt: 0 }), 25);
});

test('swept segment resolves the first sphere contact and misses disjoint 3D volumes', () => {
  assert.equal(segmentSphereIntersection3d(origin, { x: 10, z: 0, alt: 0 }, { x: 5, z: 0, alt: 0 }, 1), 0.4);
  assert.equal(segmentSphereIntersection3d(origin, { x: 10, z: 0, alt: 0 }, { x: 5, z: 2, alt: 0 }, 1), null);
  assert.equal(segmentSphereIntersection3d({ x: 5, z: 0, alt: 0 }, { x: 5, z: 0, alt: 0 }, { x: 5, z: 0, alt: 0 }, 1), 0);
  assert.equal(segmentSphereIntersection3d(origin, origin, { x: 1, z: 0, alt: 0 }, 0.5), null);
});

test('sphere overlap uses continuous altitude and rejects negative radii', () => {
  assert.equal(spheresOverlap3d(origin, 2, { x: 0, z: 0, alt: 4 }, 2), true);
  assert.equal(spheresOverlap3d(origin, 1.9, { x: 0, z: 0, alt: 4 }, 2), false);
  assert.equal(spheresOverlap3d(origin, -1, origin, 1), false);
});
