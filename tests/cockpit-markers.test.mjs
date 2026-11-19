import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameCockpit } from '../src/camera.ts';
import { CockpitMarkers } from '../src/cockpit-markers.ts';
import { projectCameraContact } from '../src/contact-projection.ts';
import { cockpitLayout, desktopLayout, phoneLayout } from '../src/layout.ts';
import { MANEUVERS, maneuverViewYaw } from '../src/maneuvers.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const safe = { top: 0, right: 0, bottom: 0, left: 0 };
const ground = () => 35;

function fixture(width = 1280, height = 800) {
  const phone = width < 600 ? phoneLayout(width, height, safe, 'cockpit') : null;
  const layout = phone?.cockpit ?? cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective);
  const frame = { width, height, cockpit: layout };
  const state = createStage(parseStageOptions('?view=cockpit&fixture=stack'), ground);
  state.enemies.length = 0;
  Object.assign(state.player, { x: 0, z: 0, altitude: 110, yaw: 0, bank: 0 });
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060), vector = new Vector3();
  const markers = new CockpitMarkers(), projections = [];
  const source = {
    projectContact(contact, out) {
      projections.push(contact.id);
      projectCameraContact(camera, frame, contact, out, vector);
    },
  };
  const enemy = (x, z, alt) => {
    const item = makeEnemy(state, x, z, 1);
    item.alt = alt;
    state.enemies.push(item);
    return item;
  };
  const face = (attitude = null) => frameCockpit(camera, state.player, frame, attitude, ground, 1060);
  const read = (mirror = null) => markers.update(state, layout, source, mirror);
  face();
  return { camera, enemy, face, layout, projections, read, state };
}

test('canopy contacts use the flight camera position and box the closest forward aircraft', () => {
  const { camera, enemy, projections, read } = fixture();
  const near = enemy(0, 84, 113), high = enemy(29, 136, 122), low = enemy(-30, 142, 92);
  const markers = read();
  assert.deepEqual(markers.map(({ id }) => id), [near.id, high.id, low.id]);
  assert.deepEqual(projections, [near.id, high.id, low.id]);
  assert.deepEqual(markers.map(({ boxed, delta }) => [boxed, delta]), [[true, 3], [false, 12], [false, -18]]);
  for (const [index, target] of [near, high, low].entries()) {
    const projected = new Vector3(target.x, target.alt, -target.z).project(camera);
    assert.equal(markers[index].placement, 'forward');
    assert.ok(Math.abs(markers[index].x - (1 + projected.x) * 640) < 1e-9);
    assert.ok(Math.abs(markers[index].y - (1 - projected.y) * 400) < 1e-9);
  }
});

test('edge arrows retain the projected direction and rear traffic gets a single closest cue', () => {
  const { enemy, layout, projections, read } = fixture();
  const left = enemy(-120, 30, 110), right = enemy(160, 35, 110);
  const farLeft = enemy(-240, 30, 110), rear = enemy(0, -40, 117), fartherRear = enemy(1, -70, 120);
  const destroyed = enemy(5, 16, 110), distant = enemy(0, 900, 115);
  destroyed.hp = 0;
  const markers = read();
  const arrows = markers.filter(({ placement }) => placement === 'edge');
  assert.deepEqual(arrows.map(({ id }) => id), [left.id, right.id]);
  assert.ok(arrows[0].x - layout.aiming.x < 20 && Math.cos(arrows[0].angle) < -0.95);
  assert.ok(layout.aiming.x + layout.aiming.width - arrows[1].x < 20 && Math.cos(arrows[1].angle) > 0.95);
  const aft = markers.filter(({ placement }) => placement === 'rear');
  assert.deepEqual(aft.map(({ id, range, delta }) => [id, range, delta]), [[rear.id, 40, 7]]);
  assert.deepEqual(projections, [left.id, right.id, farLeft.id, rear.id, fartherRear.id]);
  assert.ok(!markers.some(({ id }) => id === distant.id || id === destroyed.id));
});

test('the live Warden lock keeps its box and dwell when a closer aircraft is present', () => {
  const { enemy, read, state } = fixture();
  const bossStage = createStage(parseStageOptions('?view=cockpit&fixture=boss'), ground);
  state.boss = bossStage.boss;
  const weak = state.boss.weakPoints[state.boss.index];
  Object.assign(weak, { x: 32, z: 130, alt: 117 });
  const near = enemy(0, 80, 110);
  state.lock = { id: weak.id, progress: 0.75, ready: false };
  const markers = read();
  assert.deepEqual(markers.map(({ id, boxed }) => [id, boxed]), [[weak.id, true], [near.id, false]]);
  assert.equal(markers[0].lockProgress, 0.75);
  assert.equal(markers[0].locked, false);
  state.lock.progress = 1;
  state.lock.ready = true;
  assert.equal(read()[0].locked, true);
});

test('former pursuers survive inversion and retain altitude data when diverted around the rear mirror', () => {
  const { enemy, face, read, state } = fixture();
  state.player.yaw = Math.PI;
  const contact = enemy(14, -130, 123), hiddenByMirror = enemy(78, -116, 92);
  state.maneuverTrail = { kind: 'immelmann', startTick: state.tick - 30, yaw: 0, side: 1,
    exitAltitude: 110, limited: false, points: [{ x: 0, z: 0, alt: 110 }], pursuers: [contact.id, hiddenByMirror.id] };
  face({ pitch: Math.PI, roll: 0, cockpitPitch: 0, cameraPitch: 0, cameraBank: Math.PI, inverted: true, stalled: false });
  const [visible, obscured] = read({ x: 1080, y: 210, width: 120, height: 100 });
  assert.equal(visible.id, contact.id);
  assert.equal(visible.placement, 'forward');
  assert.equal(visible.former, true);
  assert.ok(visible.y > 375, 'higher contact is drawn below center in the inverted camera');
  assert.equal(obscured.id, hiddenByMirror.id);
  assert.equal(obscured.placement, 'edge');
  assert.equal(obscured.former, true);
  assert.equal(obscured.delta, -18);
  assert.ok(obscured.x < 1070 || obscured.y > 320);
});

test('the J-turn exits with a former pursuer in the desktop and portrait canopy', () => {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const { camera, layout, state, read } = fixture(width, height);
    Object.assign(state, createStage(parseStageOptions('?view=cockpit&fixture=pursuit'), ground));
    const frame = { width, height, cockpit: layout };
    for (let tick = 0; tick < 9; tick++) stepStage(state, {}, ground);
    stepStage(state, { maneuver: 'j-turn', maneuverTurn: 1 }, ground);
    for (let tick = 1; tick < MANEUVERS['j-turn'].ticks; tick++) stepStage(state, {}, ground);
    assert.equal(state.maneuver, null);
    for (let tick = 0; tick < 18; tick++) {
      frameCockpit(camera, state.player, frame, null, ground, 870, maneuverViewYaw(state));
      assert.ok(read().some(marker => marker.former && marker.placement === 'forward'), `${width}px at ${tick} ticks after exit`);
      stepStage(state, {}, ground);
    }
  }
});

test('desktop and portrait cap busy skies ahead of the instrument tapes and dashboard', () => {
  for (const [width, height, capacity] of [[1280, 800, 8], [390, 844, 5]]) {
    const { camera, enemy, layout, read } = fixture(width, height);
    const { x, y, width: w, height: h } = layout.aiming;
    for (let n = 0; n < 24; n++) {
      const screenX = x + 25 + (w - 50) * (n % 6) / 5;
      const screenY = y + 27 + (h - 54) * Math.floor(n / 6) / 3;
      const world = new Vector3(2 * screenX / width - 1, 1 - 2 * screenY / height, 0.99).unproject(camera);
      enemy(world.x, -world.z, world.y);
    }
    enemy(-80, 35, 110);
    enemy(70, 35, 110);
    enemy(0, -40, 110);
    const markers = read();
    assert.equal(markers.length, capacity);
    assert.equal(markers.filter(({ placement }) => placement === 'rear').length, 1);
    assert.ok(markers.some(({ placement }) => placement === 'edge'));
    assert.ok(markers.every(marker => marker.x > x + 7 && marker.x < x + w - 7 && marker.y > y + 7 && marker.y < y + h - 7));
  }
});
