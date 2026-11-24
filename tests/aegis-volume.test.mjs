import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_EVOLUTIONS } from '../src/data/close-evolutions.ts';
import { aegisVolumeOutline } from '../src/aegis-volume.ts';
import {
  AEGIS_INNER_RADIUS, AEGIS_OUTER_RADIUS, AEGIS_RING_TUBE_RADIUS, AEGIS_VOLUME_CUE_OFFSETS, AEGIS_VOLUME_OUTLINE,
  createAegisRingGeometry,
} from '../src/aegis-volume-render.ts';

test('Aegis volume outlines the judged inner, outer, upper, and lower bounds', () => {
  const { radius, halfWidth } = CLOSE_EVOLUTIONS.aegis;
  const { rings, supports } = aegisVolumeOutline(radius, halfWidth);
  const radialBounds = new Set(rings.map(ring => ring.radius.toFixed(3)));
  const verticalBounds = new Set(rings.map(ring => ring.alt));
  const ringCorners = rings.map(({ radius: ringRadius, alt }) => `${ringRadius.toFixed(3)}:${alt}`).sort();

  assert.deepEqual(ringCorners, [
    `${(radius - halfWidth).toFixed(3)}:${-halfWidth}`,
    `${(radius - halfWidth).toFixed(3)}:${halfWidth}`,
    `${(radius + halfWidth).toFixed(3)}:${-halfWidth}`,
    `${(radius + halfWidth).toFixed(3)}:${halfWidth}`,
  ].sort());
  assert.deepEqual([...radialBounds].sort(), [(radius - halfWidth).toFixed(3), (radius + halfWidth).toFixed(3)].sort());
  assert.deepEqual([...verticalBounds].sort((a, b) => a - b), [-halfWidth, halfWidth]);
  assert.equal(rings.length, 4);
  assert.equal(supports.length, 32);
  let verticalSupports = 0, radialSupports = 0;
  for (const { from, to } of supports) {
    assert.ok(Math.abs(Math.hypot(from.x, from.z) - (radius - halfWidth)) < 0.001
      || Math.abs(Math.hypot(from.x, from.z) - (radius + halfWidth)) < 0.001);
    assert.ok(Math.abs(Math.hypot(to.x, to.z) - (radius - halfWidth)) < 0.001
      || Math.abs(Math.hypot(to.x, to.z) - (radius + halfWidth)) < 0.001);
    assert.ok(from.alt === -halfWidth || from.alt === halfWidth);
    assert.ok(to.alt === -halfWidth || to.alt === halfWidth);
    if (from.alt !== to.alt) {
      verticalSupports++;
      assert.equal(from.x, to.x);
      assert.equal(from.z, to.z);
      assert.deepEqual([from.alt, to.alt], [-halfWidth, halfWidth]);
    } else {
      radialSupports++;
      assert.deepEqual([Math.hypot(from.x, from.z).toFixed(3), Math.hypot(to.x, to.z).toFixed(3)],
        [(radius - halfWidth).toFixed(3), (radius + halfWidth).toFixed(3)]);
    }
  }
  assert.equal(verticalSupports, 16);
  assert.equal(radialSupports, 16);
});

test('rendered Aegis torus geometry keeps a fixed world-unit outline thickness', () => {
  const radii = [...new Set(AEGIS_VOLUME_OUTLINE.rings.map(ring => ring.radius))].sort((a, b) => a - b);
  assert.deepEqual(radii, [AEGIS_INNER_RADIUS, AEGIS_OUTER_RADIUS]);

  for (const radius of radii) {
    const geometry = createAegisRingGeometry(radius);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    assert.ok(bounds);
    assert.equal(geometry.parameters.radius, radius);
    assert.equal(geometry.parameters.tube, AEGIS_RING_TUBE_RADIUS);
    const epsilon = 1e-5;
    assert.ok(Math.abs(bounds.min.x + radius + AEGIS_RING_TUBE_RADIUS) < epsilon);
    assert.ok(Math.abs(bounds.max.x - radius - AEGIS_RING_TUBE_RADIUS) < epsilon);
    assert.ok(Math.abs(bounds.min.z + radius + AEGIS_RING_TUBE_RADIUS) < epsilon);
    assert.ok(Math.abs(bounds.max.z - radius - AEGIS_RING_TUBE_RADIUS) < epsilon);
    assert.ok(Math.abs(bounds.min.y + AEGIS_RING_TUBE_RADIUS) < epsilon);
    assert.ok(Math.abs(bounds.max.y - AEGIS_RING_TUBE_RADIUS) < epsilon);
    geometry.dispose();
  }
});

test('mobile Aegis visibility samples use the rendered inner, outer, upper, and lower bounds', () => {
  const { radius, halfWidth } = CLOSE_EVOLUTIONS.aegis;
  assert.equal(AEGIS_VOLUME_CUE_OFFSETS.length, 4 * 16);
  assert.deepEqual([...new Set(AEGIS_VOLUME_CUE_OFFSETS.map(point => Math.hypot(point.x, point.z).toFixed(3)))].sort(),
    [(radius - halfWidth).toFixed(3), (radius + halfWidth).toFixed(3)].sort());
  assert.deepEqual([...new Set(AEGIS_VOLUME_CUE_OFFSETS.map(point => point.alt))].sort((a, b) => a - b),
    [-halfWidth, halfWidth]);
});
