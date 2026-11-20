import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameCockpit } from '../src/camera.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { buildRadar } from '../src/instruments.ts';
import { createTranslator, strings } from '../src/i18n.ts';
import { cockpitCacheKey, cockpitMfdDue, cockpitWarnings, headingTape, cockpitTarget } from '../src/cockpit.ts';
import { cockpitLayout, desktopLayout, phoneLayout } from '../src/layout.ts';
import { MANEUVERS, maneuverAttitude } from '../src/maneuvers.ts';
import { terrainFogFar, World } from '../src/world.ts';

const aiming = { x: 180, y: 235, width: 920, height: 270 };
test('cockpit artwork stays cached for equivalent layouts and invalidates for language, resize and safe areas', () => {
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const layout = phoneLayout(390, 844, safe, 'cockpit').cockpit;
  const original = cockpitCacheKey(layout, 390, 844, 'en');
  assert.equal(cockpitCacheKey(structuredClone(layout), 390, 844, 'en'), original);
  assert.notEqual(cockpitCacheKey(layout, 390, 844, 'ko'), original);
  assert.notEqual(cockpitCacheKey(layout, 390, 845, 'en'), original);
  const inset = phoneLayout(390, 844, { ...safe, top: 24 }, 'cockpit').cockpit;
  assert.notEqual(cockpitCacheKey(inset, 390, 844, 'en'), original);
});

test('MFDs refresh at 20 Hz, including the first frame and a restarted run', () => {
  assert.equal(cockpitMfdDue(null, 0), true);
  assert.equal(cockpitMfdDue(10, 10), false);
  assert.equal(cockpitMfdDue(10, 10 + 2 / 60), false);
  assert.equal(cockpitMfdDue(10, 10 + 3 / 60), true);
  assert.equal(cockpitMfdDue(10, 0), true);
});

test('the HUD zero line matches projected terrain through upright, vertical and inverted views', () => {
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const limit = 420, terrainAltitude = 35;
  const ground = () => terrainAltitude;
  for (const [width, height] of [[1280, 800], [390, 844], [320, 568], [844, 390]]) {
    const framing = { width, height, cockpit: width === 1280
      ? cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective)
      : phoneLayout(width, height, safe, 'cockpit').cockpit };
    const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
    for (const maneuver of ['immelmann', 'split-s', 'j-turn']) {
      const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'), ground);
      state.enemies.length = 0;
      for (let tick = 0; tick <= MANEUVERS[maneuver].ticks; tick++) {
        if (tick) stepStage(state, tick === 1 ? { maneuver } : {}, ground);
        if (tick > 20 && tick % 3 && tick !== MANEUVERS[maneuver].flipTick) continue;
        const marks = frameCockpit(camera, state.player, framing, state.maneuver && maneuverAttitude(state.maneuver), ground, limit);

        // Intersect flat terrain with the camera-space visibility plane and project a line in that intersection.
        const gaze = camera.getWorldDirection(new Vector3());
        assert.ok(gaze.y >= -Math.sin(28 * Math.PI / 180) - 1e-9 && gaze.y <= Math.sin(34 * Math.PI / 180) + 1e-9);
        const horizontal = new Vector3(gaze.x, 0, gaze.z).normalize();
        const distance = (limit - gaze.y * (terrainAltitude - camera.position.y)) / gaze.dot(horizontal);
        const terrainPoint = camera.position.clone().addScaledVector(horizontal, distance).setY(terrainAltitude);
        const side = new Vector3(-horizontal.z, 0, horizontal.x);
        const a = terrainPoint.clone().addScaledVector(side, -200).project(camera);
        const b = terrainPoint.clone().addScaledVector(side, 200).project(camera);
        const ax = (1 + a.x) * width / 2, ay = (1 - a.y) * height / 2;
        const dx = (b.x - a.x) * width / 2, dy = (a.y - b.y) * height / 2;

        const zero = marks.find(mark => mark.angle === 0);
        assert.ok(zero, `${width} px ${maneuver} tick ${tick} has a zero line`);
        const points = [...zero.left, ...zero.right].flatMap(line => [line.from, line.to]);
        for (const point of points) {
          const error = Math.abs(dx * (point.y - ay) - dy * (point.x - ax)) / Math.hypot(dx, dy);
          assert.ok(error < 0.4, `${width} px ${maneuver} tick ${tick}: horizon error ${error} px`);
        }
        const top = framing.cockpit.aiming.y;
        const bottom = top + framing.cockpit.aiming.height;
        assert.ok(points.some(point => point.y >= top && point.y < bottom),
          `${width} px ${maneuver} tick ${tick} keeps the horizon in the aiming field`);
        const above = marks.find(mark => mark.angle === 10);
        const below = marks.find(mark => mark.angle === -10);
        const signedSide = point => dx * (point.y - ay) - dy * (point.x - ax);
        assert.ok(signedSide(above.left[0].from) * signedSide(below.left[0].from) < 0);
      }
    }
  }
});

test('the inverted cockpit exchanges sky and ground and rotates its horizon through vertical', () => {
  const width = 390, height = 844, ground = () => 35;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { width, height, cockpit: phoneLayout(width, height, safe, 'cockpit').cockpit };
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'), ground);
  state.enemies.length = 0;
  stepStage(state, { maneuver: 'split-s' }, ground);
  for (let tick = 2; tick <= 10; tick++) stepStage(state, {}, ground);
  const marks = frameCockpit(camera, state.player, frame, maneuverAttitude(state.maneuver), ground, 640);
  const zero = marks.find(mark => mark.angle === 0);
  const from = zero.left[0].from, to = zero.right.at(-1).to;
  assert.ok(Math.abs(to.x - from.x) < 0.4);
  assert.ok(Math.abs(to.y - from.y) > 50);

  for (let tick = 11; tick <= 155; tick++) stepStage(state, {}, ground);
  frameCockpit(camera, state.player, frame, maneuverAttitude(state.maneuver), ground, 640);
  const gaze = camera.getWorldDirection(new Vector3());
  const horizon = camera.position.clone().addScaledVector(gaze, 200);
  const sky = horizon.clone().setY(horizon.y + 25).project(camera);
  const terrain = horizon.clone().setY(horizon.y - 25).project(camera);
  assert.ok(sky.y < terrain.y);
  assert.ok(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y < -0.999);
});

test('terrain fog remains positive and continuous through a full cockpit roll at both tiers', () => {
  assert.ok(terrainFogFar(1, 60, 0, 0, true) < terrainFogFar(1, 60));
  for (const [aspect, fov, mobile, far] of [[1.6, 92, false, 1020], [390 / 844, 78, true, 740]]) {
    for (const pitch of [0, -0.48, 0.58]) {
      const upright = terrainFogFar(aspect, fov, pitch, 0, mobile);
      const inverted = terrainFogFar(aspect, fov, pitch, Math.PI, mobile);
      assert.ok(Math.abs(inverted - upright) < 1e-9);
      for (let angle = -180; angle <= 180; angle++) {
        const fog = terrainFogFar(aspect, fov, pitch, angle * Math.PI / 180, mobile);
        const next = terrainFogFar(aspect, fov, pitch, (angle + 1) * Math.PI / 180, mobile);
        assert.ok(fog > 245 && fog <= far);
        assert.ok(Math.abs(fog - next) < 20);
      }
    }
  }
});

test('the zero line follows the visible terrain far beyond the starting islands', () => {
  const width = 1280, height = 720, ground = () => 35, limit = 788;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const cockpit = cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective);
  const frame = { width, height, cockpit };
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const player = { x: -18173, z: 27343, altitude: 165, yaw: Math.PI, bank: 0 };
  const marks = frameCockpit(camera, player, frame, null, ground, limit);
  const y = (1 - new Vector3(player.x, 35, camera.position.z + limit).project(camera).y) * height / 2;
  const zero = marks.find(mark => mark.angle === 0);
  assert.ok(zero);
  assert.ok(Math.abs(zero.left[0].to.y - y) < 0.4);
  assert.ok(y < cockpit.aiming.y + cockpit.aiming.height, `skyline y=${y} stays in view of the ladder`);
});

test('the zero line has the same rolled projection over flat ground in remote chunks', () => {
  const width = 1920, height = 1080, ground = () => 35;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { width, height, cockpit: cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective) };
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'), ground);
  state.enemies.length = 0;
  state.player.yaw = 2.29;
  for (let tick = 0; tick < Math.round(MANEUVERS.immelmann.flipTick * 0.74); tick++) {
    stepStage(state, tick === 0 ? { maneuver: 'immelmann' } : {}, ground);
  }
  const attitude = maneuverAttitude(state.maneuver);
  function zeroPoints() {
    const marks = frameCockpit(camera, state.player, frame, attitude, ground, 1060);
    const zero = marks.find(mark => mark.angle === 0);
    assert.ok(zero);
    return [...zero.left, ...zero.right].flatMap(line => [line.from, line.to]);
  }

  const origin = zeroPoints();
  state.player.x += 8316;
  state.player.z -= 13817;
  const remote = zeroPoints();
  for (let i = 0; i < origin.length; i++) {
    assert.ok(Math.hypot(origin[i].x - remote[i].x, origin[i].y - remote[i].y) < 0.01);
  }
});

test('heading tape wraps through north and localizes cardinal labels and degrees', () => {
  const en = createTranslator('en'), ko = createTranslator('ko');
  const nearNorth = headingTape(-Math.PI / 180, 15, en);
  assert.equal(nearNorth.bearing, '359°');
  assert.equal(nearNorth.ticks.find(tick => tick.label === 'N').offset, 1);
  const korean = headingTape(Math.PI / 2, 30, ko);
  assert.equal(korean.bearing, '090°');
  assert.deepEqual(korean.ticks.find(tick => tick.offset === 0), { offset: 0, label: '동' });
  assert.equal(headingTape(359.7 * Math.PI / 180, 15, en).bearing, '000°');
});

test('the reticle reflects simulation dwell for the instrument track and stays in bounds', () => {
  const state = createStage(parseStageOptions('?fixture=boss&view=cockpit'));
  const radar = buildRadar(state);
  const track = radar.priority;
  const center = { x: 640, y: 340 };
  assert.equal(cockpitTarget(track, center, aiming, state.lock).locked, false);
  assert.equal(cockpitTarget(track, { x: aiming.x + 3, y: center.y }, aiming, state.lock), null);
  state.player.altitude = track.alt;
  for (let i = 0; i < 12; i++) stepStage(state);
  const inProgress = cockpitTarget(track, center, aiming, state.lock);
  assert.ok(inProgress.progress > 0 && inProgress.progress < 1);
  assert.equal(inProgress.locked, false);
  for (let i = 0; i < 9; i++) stepStage(state);
  const acquired = cockpitTarget(track, center, aiming, state.lock);
  assert.equal(acquired.progress, 1);
  assert.equal(acquired.locked, true);
});

test('cockpit caution lights respond to ground clearance, descent and boost charge', () => {
  const state = createStage(parseStageOptions(''));
  assert.deepEqual(cockpitWarnings(state, 50, 0), { terrain: null, boost: null });
  state.boosting = true;
  state.boost = 0.8;
  assert.deepEqual(cockpitWarnings(state, 36, 0), { terrain: 'altLow', boost: 'active' });
  state.boost = 0.2;
  assert.deepEqual(cockpitWarnings(state, 30, -12), { terrain: 'pullUp', boost: 'low' });
});

test('cockpit copy covers warnings, instruments and targeting in both languages', () => {
  for (const suffix of [
    'north', 'east', 'south', 'west', 'bearing', 'range', 'lock', 'track', 'gLoad',
    'masterCaution', 'cautionShort', 'lowHull', 'altLow', 'pullUp',
    'airframe', 'weapons', 'altDelta', 'bombs', 'flares', 'inverted',
  ]) {
    const key = `cockpit.${suffix}`;
    assert.ok(strings.en[key]?.trim(), key);
    assert.ok(strings.ko[key]?.trim(), key);
  }
});

test('the zero rung follows a steep Reach stack between grid samples', () => {
  const width = 1280, height = 800, far = 770;
  const world = new World();
  const ground = (x, z) => world.height(x, z);
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { width, height, cockpit: cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective) };
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const player = { x: 356, z: 322.641, altitude: 110, yaw: 210 * Math.PI / 180, bank: 0 };
  const marks = frameCockpit(camera, player, frame, null, ground, far);
  const { to } = marks.find(mark => mark.angle === 0).right.at(-1);
  const gaze = camera.getWorldDirection(new Vector3());
  const heading = new Vector3(to.x * 2 / width - 1, 0, 0).unproject(camera).sub(camera.position).setY(0).normalize();
  const sample = new Vector3();
  let skyline = height;
  for (let range = 1; range <= far / gaze.dot(heading); range += 0.025) {
    sample.copy(camera.position).addScaledVector(heading, range);
    sample.y = ground(sample.x, -sample.z);
    skyline = Math.min(skyline, (1 - sample.project(camera).y) * height / 2);
  }
  assert.ok(Math.abs(to.y - skyline) < 0.75, `terrain skyline y=${skyline}, HUD y=${to.y}`);
});

test('the cockpit ladder sweeps with pitch through an upright climb and an inverted dive', () => {
  const width = 1280, height = 800;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const cockpit = cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective);
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const heights = [];
  const climbTick = Math.round(MANEUVERS.immelmann.flipTick * 0.625);
  const rollIn = MANEUVERS['split-s'].flipTick - MANEUVERS.immelmann.flipTick;
  for (const [kind, tick] of [['immelmann', climbTick], ['split-s', climbTick + rollIn]]) {
    const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'));
    state.enemies.length = 0;
    for (let elapsed = 0; elapsed < tick; elapsed++) stepStage(state, elapsed === 0 ? { maneuver: kind } : {});
    const attitude = maneuverAttitude(state.maneuver);
    const marks = frameCockpit(camera, state.player, { width, height, cockpit }, attitude, () => 35, 770);
    const zero = marks.find(mark => mark.angle === 0);
    const y = (zero.left.at(-1).to.y + zero.right[0].from.y) / 2;
    const relative = (y - cockpit.aiming.y) / cockpit.aiming.height;
    heights.push(attitude.inverted ? 1 - relative : relative);
  }
  assert.ok(heights[0] > 0.65 && heights[1] < 0.35, heights.join(' vs '));
});
