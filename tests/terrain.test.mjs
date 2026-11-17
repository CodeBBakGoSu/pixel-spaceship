import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.ts';

test('terrain wraps seamlessly and neighboring samples stay smooth', () => {
  const world = new World();
  let steepest = 0;
  for (let z = 0; z < 512; z += 2) for (let x = 0; x < 512; x += 2) {
    const height = world.height(x, z);
    steepest = Math.max(steepest, Math.abs(height - world.height(x + 1, z)), Math.abs(height - world.height(x, z + 1)));
  }
  assert.equal(world.height(-1, 20), world.height(511, 20));
  assert.ok(steepest < 2.5, `adjacent terrain jumped ${steepest.toFixed(2)} units`);
});
