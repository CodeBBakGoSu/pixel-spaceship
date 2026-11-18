import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameCockpit } from '../src/camera.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { buildRadar } from '../src/instruments.ts';
import { createTranslator, strings } from '../src/i18n.ts';
import { cockpitCacheKey, cockpitMfdDue, cockpitWarnings, headingTape, cockpitTarget } from '../src/cockpit.ts';
import { cockpitLayout, desktopLayout, phoneLayout } from '../src/layout.ts';
import { maneuverAttitude } from '../src/maneuvers.ts';
import { TERRAIN_HALF_WIDTH } from '../src/world.ts';

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

test('the HUD zero line matches projected terrain during level flight and both half-loops', () => {
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const limit = 420, terrainAltitude = 35;
  const ground = () => terrainAltitude;
  for (const [width, height] of [[1280, 800], [390, 844], [320, 568], [844, 390]]) {
    const framing = { width, height, cockpit: width === 1280
      ? cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective)
      : phoneLayout(width, height, safe, 'cockpit').cockpit };
    const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
    for (const maneuver of ['immelmann', 'split-s', 'cobra', 'j-turn']) {
      const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'), ground);
      state.enemies.length = 0;
      for (let tick = 0; tick <= 90; tick++) {
        if (tick) stepStage(state, tick === 1 ? { maneuver } : {}, ground);
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

        const zero = marks.find(mark => mark.angle === 0);
        assert.ok(zero, `${width} px ${maneuver} tick ${tick} has a zero line`);
        const points = [...zero.left, ...zero.right].flatMap(line => [line.from, line.to]);
        for (const point of points) {
          const x = point.x * 2 / width - 1;
          const y = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
          const projectedY = (1 - y) * height / 2;
          assert.ok(Math.abs(projectedY - point.y) < 0.4,
            `${width} px ${maneuver} tick ${tick}: terrain y=${projectedY}, HUD y=${point.y}`);
        }
        const top = framing.cockpit.aiming.y;
        const bottom = top + framing.cockpit.aiming.height;
        assert.ok(points.some(point => point.y >= top && point.y < bottom),
          `${width} px ${maneuver} tick ${tick} keeps the horizon in the aiming field`);
        const above = marks.find(mark => mark.angle === 10);
        const below = marks.find(mark => mark.angle === -10);
        assert.ok(above.left[0].from.y < zero.left[0].from.y && below.left[0].from.y > zero.left[0].from.y);
      }
    }
  }
});

test('the zero line follows the visible mesh edge in high level flight', () => {
  const width = 1280, height = 720, ground = () => 35, limit = 788;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const cockpit = cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective);
  const frame = { width, height, cockpit };
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const player = { x: -96, z: 534 - TERRAIN_HALF_WIDTH, altitude: 165, yaw: Math.PI, bank: 0 };
  const marks = frameCockpit(camera, player, frame, null, ground, limit);
  const y = (1 - new Vector3(player.x, 35, TERRAIN_HALF_WIDTH).project(camera).y) * height / 2;
  const zero = marks.find(mark => mark.angle === 0);
  assert.ok(Math.abs(zero.left[0].to.y - y) < 0.4);
  assert.ok(y < cockpit.aiming.y + cockpit.aiming.height, `mesh edge y=${y} stays in view of the ladder`);
});

test('the zero line follows a terrain corner between the ends of a rung', () => {
  const width = 1920, height = 1080, ground = () => 35;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { width, height, cockpit: cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective) };
  const camera = new PerspectiveCamera(60, width / height, 0.65, 1060);
  const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'), ground);
  state.enemies.length = 0;
  state.player.yaw = 2.29;
  for (let tick = 0; tick < 15; tick++) stepStage(state, tick === 0 ? { maneuver: 'cobra' } : {}, ground);
  // Translate the maneuver to a position that puts the actual terrain corner across the rung.
  state.player.x += TERRAIN_HALF_WIDTH - 896;
  state.player.z += 704 - TERRAIN_HALF_WIDTH;

  const marks = frameCockpit(camera, state.player, frame, maneuverAttitude(state.maneuver), ground, 1060);
  const zero = marks.find(mark => mark.angle === 0);
  const corner = new Vector3(TERRAIN_HALF_WIDTH, 35, TERRAIN_HALF_WIDTH).project(camera);
  const x = (1 + corner.x) * width / 2, y = (1 - corner.y) * height / 2;
  const { from, to } = zero.left.find(line => x >= line.from.x && x <= line.to.x);
  const barY = from.y + (to.y - from.y) * (x - from.x) / (to.x - from.x);
  assert.ok(Math.abs(barY - y) < 0.6, `terrain corner y=${y}, HUD y=${barY}`);
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

test('caution lights respond to hull, ground clearance, descent and boost charge', () => {
  const state = createStage(parseStageOptions(''));
  assert.deepEqual(cockpitWarnings(state, 50, 0), {
    master: false, lowHull: false, terrain: null, boost: null,
  });
  state.hull = 2;
  state.boosting = true;
  state.boost = 0.8;
  assert.deepEqual(cockpitWarnings(state, 36, 0), {
    master: true, lowHull: true, terrain: 'altLow', boost: 'active',
  });
  state.hull = 8;
  state.boost = 0.2;
  assert.deepEqual(cockpitWarnings(state, 30, -12), {
    master: true, lowHull: false, terrain: 'pullUp', boost: 'low',
  });
});

test('cockpit copy covers warnings, instruments and targeting in both languages', () => {
  for (const suffix of [
    'north', 'east', 'south', 'west', 'bearing', 'range', 'lock', 'track', 'gLoad',
    'masterCaution', 'cautionShort', 'lowHull', 'altLow', 'pullUp',
    'airframe', 'weapons', 'altDelta', 'bombs', 'inverted', 'stall',
  ]) {
    const key = `cockpit.${suffix}`;
    assert.ok(strings.en[key]?.trim(), key);
    assert.ok(strings.ko[key]?.trim(), key);
  }
});
