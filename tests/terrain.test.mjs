import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceShots } from '../src/stage-combat.ts';
import { createStage } from '../src/stage.ts';
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

test('a Basalt Sea Stack stops a cruise bolt while a HIGH bolt clears it', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  for (const [alt, expectedHull] of [[110, 8], [145, 6]]) {
    const state = createStage();
    Object.assign(state.player, { x: 288, z: 280, altitude: alt });
    state.shots.push({ x: 288, z: 200, alt, vx: 0, vz: 230, life: 1, damage: 2,
      kind: 'hostile', volley: 0, nearMiss: false, lockId: null });
    for (let tick = 0; tick < 30 && state.shots.length; tick++) advanceShots(state, ground);
    assert.equal(state.hull, expectedHull);
  }
});
