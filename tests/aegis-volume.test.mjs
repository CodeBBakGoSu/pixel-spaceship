import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_EVOLUTIONS } from '../src/data/close-evolutions.ts';
import { aegisVolumeOutline } from '../src/aegis-volume.ts';

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
