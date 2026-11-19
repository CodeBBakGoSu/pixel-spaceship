import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { EngineExhaust } from '../src/engine-exhaust.ts';
import { MANEUVERS, maneuverAttitude } from '../src/maneuvers.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

function exhaustFixture() {
  const state = createStage(parseStageOptions('?t=0&view=chase'));
  const ship = new Object3D();
  const camera = new PerspectiveCamera();
  camera.position.set(0, 15, 46);
  camera.lookAt(ship.position);
  const exhaust = new EngineExhaust(ship);
  const plumes = ship.getObjectByName('Engine plumes');
  const diamonds = ship.getObjectByName('Shock diamonds');
  const matrix = new Matrix4();
  const length = () => {
    plumes.getMatrixAt(0, matrix);
    return new Vector3().setFromMatrixScale(matrix).z;
  };
  return { state, ship, camera, exhaust, plumes, diamonds, length };
}

test('exhaust grows from idle through cruise to boost with a separate diamond pass', () => {
  const { state, exhaust, camera, diamonds, length } = exhaustFixture();
  exhaust.update(state, camera);
  const idle = length();
  stepStage(state);
  exhaust.update(state, camera);
  const cruise = length();
  assert.equal(diamonds.visible, false);
  stepStage(state, { boost: true });
  exhaust.update(state, camera);
  assert.ok(idle < cruise / 2);
  assert.ok(length() > cruise * 1.8);
  assert.equal(diamonds.visible, true);
});

test('Cobra and immediate J-turn produce a flame flare without changing stage state', () => {
  const { state, exhaust, camera, length } = exhaustFixture();
  exhaust.update(state, camera);
  const idle = length();
  stepStage(state, { maneuver: 'cobra' });
  for (let i = 0; i < 8; i++) stepStage(state);
  exhaust.update(state, camera);
  assert.ok(length() > idle * 1.5);
  const flipped = createStage(parseStageOptions('?t=0'));
  stepStage(flipped, { maneuver: 'j-turn' });
  const snapshot = structuredClone(flipped);
  exhaust.update(flipped, camera);
  assert.ok(length() > idle * 1.5);
  assert.deepEqual(flipped, snapshot);
});

test('the Cobra recovery pulse is fading out when normal flight resumes', () => {
  const { state, exhaust, camera, length } = exhaustFixture();
  stepStage(state);
  stepStage(state, { maneuver: 'cobra' });
  for (let i = 0; i < 58; i++) stepStage(state);
  exhaust.update(state, camera);
  const before = length();
  stepStage(state);
  exhaust.update(state, camera);
  assert.equal(state.maneuver, null);
  assert.ok(Math.abs(before - length()) < 2, 'plume length should stay continuous at handoff');
});

test('the same tick reproduces both plumes and keeps their axes attached through inversion', () => {
  const { state, ship, exhaust, camera, plumes } = exhaustFixture();
  stepStage(state, { maneuver: 'immelmann' });
  for (let i = 1; i <= MANEUVERS.immelmann.flipTick + 5; i++) stepStage(state);
  const attitude = maneuverAttitude(state.maneuver);
  assert.ok(attitude.inverted);
  ship.rotation.set(attitude.pitch, -state.player.yaw, attitude.roll, 'YXZ');
  exhaust.update(state, camera);
  const first = Array.from(plumes.instanceMatrix.array);
  const geometry = Array.from(plumes.geometry.getAttribute('position').array);
  exhaust.update(state, camera);
  assert.deepEqual(Array.from(plumes.instanceMatrix.array), first);
  assert.deepEqual(Array.from(plumes.geometry.getAttribute('position').array), geometry);

  ship.updateMatrixWorld(true);
  const expected = new Vector3(0, 0, 1).applyQuaternion(ship.quaternion);
  const matrix = new Matrix4();
  for (let i = 0; i < 2; i++) {
    plumes.getMatrixAt(i, matrix);
    const nozzle = new Vector3().applyMatrix4(matrix).applyMatrix4(ship.matrixWorld);
    const tip = new Vector3(0, 0, 1).applyMatrix4(matrix).applyMatrix4(ship.matrixWorld);
    assert.ok(tip.sub(nozzle).normalize().distanceTo(expected) < 1e-6);
  }
});
