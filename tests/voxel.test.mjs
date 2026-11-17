import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFaces } from '../src/voxel.ts';

test('voxel surfaces omit shared interior faces', () => {
  const model = { width: 2, length: 1, height: 1, pivot: [0, 0, 0], data: new Uint8Array([1, 1]) };
  assert.equal(buildFaces(model).length, 10);
  model.data[1] = 0;
  assert.equal(buildFaces(model).length, 6);
});
