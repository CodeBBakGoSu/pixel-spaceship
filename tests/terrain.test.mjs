import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_SIZE, World } from '../src/world.ts';

test('terrain wraps seamlessly and neighboring samples stay smooth', () => {
  const world = new World();
  let steepest = 0;
  for (let z = 0; z < 512; z += 2) for (let x = 0; x < 512; x += 2) {
    const height = world.height(x, z);
    steepest = Math.max(steepest, Math.abs(height - world.height(x + 1, z)), Math.abs(height - world.height(x, z + 1)));
  }
  assert.equal(world.height(-1, 20), world.height(TERRAIN_SIZE - 1, 20));
  assert.ok(steepest < 4.5, `adjacent terrain jumped ${steepest.toFixed(2)} units`);
});

test('Reach terrain separates the low strait, ridge, stacks and open Warden orbit', () => {
  const world = new World();
  assert.ok(world.height(-240, 96) + 22 > 100, 'Kestrel Ridge requires a climb');
  assert.ok(world.height(-128, -320) + 22 < 68, 'the strait has a clear LOW approach');
  assert.ok(world.height(288, 240) > 110, 'a sea stack blocks cruise-height sightlines');
  for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
    assert.ok(world.height(160 + Math.sin(angle) * 41, -128 + Math.cos(angle) * 41) <= 42);
  }
});
