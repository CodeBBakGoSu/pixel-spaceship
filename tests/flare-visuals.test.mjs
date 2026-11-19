import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { FlareVisuals } from '../src/flare-visuals.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';

function centers(mesh) {
  const matrix = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix).toArray();
  });
}

test('TOP flattens the flare trail and a rear camera pass restores its sinking path', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.tick = 59;
  state.flares = [{ x: 14, z: -30, alt: 72, born: 10, vx: 0, vz: -44, vy: -28 }];
  const visuals = new FlareVisuals();
  const fire = visuals.group.getObjectByName('Flare embers');
  const smoke = visuals.group.getObjectByName('Flare smoke');
  const snapshot = structuredClone(state);

  visuals.update(state);
  assert.deepEqual(centers(fire)[0], [14, 72, 30]);
  const trail = centers(smoke);
  assert.ok(trail.length > 2);
  assert.ok(trail.every(([, y, z]) => y > 72 && z < 30));

  visuals.update(state, 159);
  assert.deepEqual(centers(fire)[0], [14, 159, 30]);
  const flatTrail = centers(smoke);
  assert.equal(new Set(flatTrail.map(([, y]) => y)).size, 1);
  assert.deepEqual(flatTrail.map(([x, , z]) => [x, z]), trail.map(([x, , z]) => [x, z]));

  visuals.update(state);
  assert.deepEqual(centers(smoke), trail);
  assert.deepEqual(state, snapshot);

  state.tick++;
  state.flares[0].z -= 44 / 60;
  visuals.update(state);
  assert.equal(centers(smoke)[0][2], trail[0][2], 'an emitted puff stays behind as the flare moves');
});

test('every burning contact can emit fire and smoke with several volleys active', () => {
  const state = createStage(parseStageOptions('?fixture=boss'));
  state.tick = 70;
  state.flares = Array.from({ length: 15 }, (_, i) => ({
    x: i, z: -30, alt: 72, born: 20, vx: 0, vz: -44, vy: -28,
  }));
  state.enemies = Array.from({ length: 24 }, (_, i) => makeEnemy(state, 100 + 18 * i, 0, 1));
  const burning = [...state.enemies, ...state.boss.weakPoints];
  for (const contact of burning) contact.burnUntil = 90;

  const visuals = new FlareVisuals();
  const fire = visuals.group.getObjectByName('Flare embers');
  const smoke = visuals.group.getObjectByName('Flare smoke');
  visuals.update(state);
  for (const mesh of [fire, smoke]) {
    assert.ok(mesh.count <= mesh.instanceMatrix.count);
    const positions = centers(mesh);
    for (const contact of burning) {
      assert.ok(positions.some(([x, , z]) => Math.hypot(x - contact.x, z + contact.z) < 9),
        `${mesh.name} missing for contact ${contact.id}`);
    }
  }

  state.flares = [];
  state.tick = 89;
  visuals.update(state);
  assert.ok(fire.count > 0);
  assert.ok(smoke.count > 0);

  state.tick = 90;
  visuals.update(state);
  assert.equal(fire.count, 0);
  assert.equal(smoke.count, 0);
});

test('a flare close to the chase lens leaves room to see the ship and returns in the rear pass', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.flares = [{ x: 14, z: -30, alt: 72, born: 0, vx: 0, vz: -44, vy: -7 }];
  const visuals = new FlareVisuals();
  const fire = visuals.group.getObjectByName('Flare embers');
  const chase = new PerspectiveCamera();
  chase.position.set(14, 72, 32);
  chase.lookAt(14, 72, 0);
  chase.updateMatrixWorld();

  visuals.update(state, undefined, chase);
  assert.equal(fire.count, 0);
  visuals.update(state);
  assert.deepEqual(centers(fire)[0], [14, 72, 30]);
});
