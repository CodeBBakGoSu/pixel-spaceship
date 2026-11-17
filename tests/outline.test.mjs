import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineShip } from '../src/outline.ts';

test('outline adds a single pixel around a silhouette without spreading', () => {
  const width = 9, height = 9;
  const pixels = new Uint32Array(width * height);
  const center = 4 * width + 4;
  pixels[center] = 0xffffffff;
  outlineShip(pixels, width, height, 0, 0, width, height);
  const ink = (0xff1f1510 >>> 0);
  assert.equal(pixels[center], 0xffffffff);
  for (const i of [center - 1, center + 1, center - width, center + width]) assert.equal(pixels[i], ink);
  assert.equal([...pixels].filter(Boolean).length, 5);
});
