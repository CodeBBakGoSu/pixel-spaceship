import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { buildRadar } from '../src/instruments.ts';
import { createTranslator, strings } from '../src/i18n.ts';
import { cockpitCacheKey, cockpitMfdDue, cockpitWarnings, headingTape, cockpitTarget, pitchLadder } from '../src/cockpit.ts';
import { phoneLayout } from '../src/layout.ts';

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
    'airframe', 'weapons', 'altDelta', 'bombs',
  ]) {
    const key = `cockpit.${suffix}`;
    assert.ok(strings.en[key]?.trim(), key);
    assert.ok(strings.ko[key]?.trim(), key);
  }
});
