import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, parseGameOptions } from '../src/game.ts';
import { createTranslator, strings } from '../src/i18n.ts';
import { cockpitWarnings, headingTape, measureCockpitMotion, pitchLadder, selectCockpitTarget } from '../src/cockpit.ts';

const screen = { width: 1280, height: 720 };
const aiming = { x: 180, y: 235, width: 920, height: 270 };
const target = (kind, x, z, alt, hp = 1) => ({ kind, x, z, alt, hp });
const projection = state => ({ camera: state.camera, buffer: { width: 320, height: 180 }, screen });

test('pitch ladder shifts with climb and rotates its marks with bank', () => {
  const center = { x: 100, y: 120 };
  const level = pitchLadder(center, 0, 0, 40, 2).find(mark => mark.angle === 0);
  assert.deepEqual(level.left.from, { x: 60, y: 120 });
  assert.deepEqual(level.right.to, { x: 140, y: 120 });
  const climb = pitchLadder(center, 10, 0, 40, 2).find(mark => mark.angle === 0);
  assert.equal(climb.left.from.y, 140);
  const bank = pitchLadder(center, 0, Math.PI / 2, 40, 2).find(mark => mark.angle === 0);
  assert.equal(Math.round(bank.left.from.x), 100);
  assert.equal(Math.round(bank.left.from.y), 160);
  assert.equal(Math.round(bank.right.to.y), 80);
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

test('cockpit motion measures actual travel and handles yaw wrap and pause', () => {
  const before = createGame(parseGameOptions('?segment=orbit'));
  before.player.yaw = Math.PI - 0.01;
  const tick = 0.02;
  const after = {
    ...before, elapsed: tick,
    player: { ...before.player, z: before.player.z + 0.68, altitude: before.player.altitude + 0.4, bank: 0.3, yaw: -Math.PI + 0.01 },
  };
  const motion = measureCockpitMotion(before, after, { speed: 0, climb: 0, turn: 0, bank: 0 }, tick);
  assert.ok(Math.abs(motion.speed - 34) < 1e-6);
  assert.ok(Math.abs(motion.climb - 20) < 1e-6);
  assert.ok(Math.abs(motion.turn - 1) < 1e-6);
  assert.equal(motion.bank, 0.3);
  assert.deepEqual(measureCockpitMotion(after, { ...after, paused: true }, motion, tick), motion);
});

test('designator takes the nearest live, visible combat target and locks within the sight cone', () => {
  const state = createGame(parseGameOptions('?segment=canyon&view=cockpit'));
  const { x, z, altitude } = state.player;
  state.aimY = -0.26;
  state.entities = [
    target('drone', x, z - 20, altitude),
    target('lock', x, z + 40, altitude - 10, 0),
    target('capsule', x, z + 48, altitude - 10),
    target('door', x, z + 55, altitude - 10),
    target('drone', x + 180, z + 70, altitude - 10),
    target('supply', x + 1, z + 135, altitude - 10),
    target('lock', x + 2, z + 100, altitude - 10),
  ];
  const result = selectCockpitTarget(state, projection(state), aiming);
  assert.equal(result.kind, 'lock');
  assert.equal(result.range, 101);
  assert.equal(result.locked, true);
  state.aimX = -1;
  assert.equal(selectCockpitTarget(state, projection(state), aiming).locked, false);
  state.entities = state.entities.slice(0, 5);
  assert.equal(selectCockpitTarget(state, projection(state), aiming), null);
});

test('Warden lock tracks a live pod until the core is exposed', () => {
  const state = createGame(parseGameOptions('?segment=boss'));
  state.entities = [];
  state.boss.alt -= 12;
  state.aimY = -0.18;
  const aimArea = { ...aiming, y: 200 };
  assert.equal(selectCockpitTarget(state, projection(state), aimArea).kind, 'pod');
  state.boss.pods = [0, 0, 0, 0];
  assert.equal(selectCockpitTarget(state, projection(state), aimArea).kind, 'core');
  state.boss.coreHp = 0;
  assert.equal(selectCockpitTarget(state, projection(state), aimArea), null);
});

test('caution lights respond to hull, ground clearance, descent and boost charge', () => {
  const state = createGame(parseGameOptions('?segment=canyon'));
  assert.deepEqual(cockpitWarnings(state, 50, 0), {
    master: false, lowHull: false, terrain: null, boost: null,
  });
  state.hull = 2;
  state.boosting = true;
  state.bst = 0.8;
  assert.deepEqual(cockpitWarnings(state, 36, 0), {
    master: true, lowHull: true, terrain: 'altLow', boost: 'active',
  });
  state.hull = 8;
  state.bst = 0.2;
  assert.deepEqual(cockpitWarnings(state, 30, -12), {
    master: true, lowHull: false, terrain: 'pullUp', boost: 'low',
  });
  state.biome = 'space';
  assert.equal(cockpitWarnings(state, 22, -12).terrain, null);
});

test('cockpit copy covers warnings, instruments and targeting in both languages', () => {
  for (const suffix of [
    'north', 'east', 'south', 'west', 'bearing', 'range', 'lock', 'track', 'gLoad',
    'masterCaution', 'cautionShort', 'lowHull', 'altLow', 'pullUp',
    'airframe', 'weapons', 'ammo', 'missiles', 'bombs',
  ]) {
    const key = `cockpit.${suffix}`;
    assert.ok(strings.en[key]?.trim(), key);
    assert.ok(strings.ko[key]?.trim(), key);
  }
});
