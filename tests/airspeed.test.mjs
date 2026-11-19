import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameCockpit } from '../src/camera.ts';
import { FlightAtmosphere } from '../src/flight-atmosphere.ts';
import { cockpitLayout, desktopLayout } from '../src/layout.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

test('boost has a short ignition surge, reaches sustained speed, and needs a fresh press to surge again', () => {
  const state = createStage(parseStageOptions('?t=0'));
  stepStage(state);
  assert.equal(state.speed, 52);
  stepStage(state, { boost: true });
  assert.equal(state.speed, 101);
  assert.ok(Math.abs(state.player.vz - 101) < 1e-9);
  for (let i = 1; i < 15; i++) stepStage(state, { boost: true });
  assert.equal(state.speed, 91);
  assert.equal(state.boostTicks, 15);
  stepStage(state);
  assert.equal(state.speed, 52);
  assert.equal(state.boostTicks, 0);
  stepStage(state, { boost: true });
  assert.equal(state.speed, 101);
});

test('the cockpit boost lens widens the view while projecting the same scenery and ladder', () => {
  const width = 1280, height = 800, safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const cockpit = cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective);
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const player = { x: 0, z: -85, altitude: 110, yaw: 0, bank: 0 };
  const ground = () => 35, far = 500;
  frameCockpit(camera, player, { width, height, cockpit }, null, ground, far);
  const normalZ = camera.position.z;
  const marks = frameCockpit(camera, player, { width, height, cockpit }, null, ground, far, player.yaw,
    { widening: 4, pullback: 1.4, shake: 0.18 });
  assert.equal(camera.fov, 64);
  assert.ok(camera.position.z > normalZ && camera.position.x > 0);
  const terrain = new Vector3(0, 35, camera.position.z - far).project(camera);
  const horizonY = (1 - terrain.y) * height / 2;
  const mark = marks.find(line => line.angle === 0);
  assert.ok(Math.abs(mark.left[0].from.y - horizonY) < 0.5);
});

test('boost adds more wind streaks in a forward view while TOP and reduced motion suppress them', () => {
  const state = createStage(parseStageOptions('?t=0'));
  const air = new FlightAtmosphere(state.arena);
  const camera = new PerspectiveCamera(60, 1.6);
  camera.updateMatrixWorld();
  const cruise = air.update(camera, 52, 1, false);
  assert.ok(cruise > 0);
  assert.ok(air.update(camera, 91, 1, false) > cruise);
  assert.equal(air.update(camera, 91, 1, true), 0);
  assert.equal(air.group.visible, true);
  assert.equal(air.update(null, 91, 1, false), 0);
  assert.equal(air.group.visible, false);
});
