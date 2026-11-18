import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { altitudeDeltaText, buildRadar, relativeMark } from '../src/instruments.ts';
import { createTranslator } from '../src/i18n.ts';

test('TOP radar exposes only coarse marks for overlapping bands', () => {
  const state = createStage(parseStageOptions('?fixture=stack'));
  const radar = buildRadar(state);
  assert.deepEqual(radar.contacts.map(contact => contact.mark), ['▽', '■', '△']);
  assert.ok(radar.contacts.every(contact => contact.x === 0 && contact.y === radar.contacts[0].y));
  assert.equal(radar.priority, null);
  assert.equal(radar.salvage, null);
  assert.equal(radar.rear, false);
});

test('forward radar gives one precise hostile track, one salvage mark and one rear warning', () => {
  const state = createStage(parseStageOptions('?fixture=stack&view=chase'));
  const [low, level, high] = state.enemies;
  const player = state.player;
  low.z = player.z + 85;
  level.z = player.z - 42;
  high.z = player.z + 75;
  state.pickups = [
    { id: 5, x: player.x, z: player.z + 40, alt: player.altitude + 6, xp: 1, born: state.tick },
    { id: 6, x: player.x, z: player.z + 52, alt: player.altitude + 19, xp: 1, born: state.tick },
  ];
  const radar = buildRadar(state);
  assert.equal(radar.priority.id, high.id);
  assert.equal(radar.salvage.id, 5);
  assert.equal(radar.rear, true);
  assert.deepEqual(radar.contacts.filter(contact => contact.mark).map(contact => contact.mark), ['^', '=']);
});

test('instruments use the inclusive altitude window and format a signed compact cockpit delta', () => {
  assert.equal(relativeMark(-8, false), '=');
  assert.equal(relativeMark(8.01, false), '^');
  assert.equal(relativeMark(-8.01, true), '▽');
  const t = createTranslator('en');
  assert.equal(altitudeDeltaText(4.5, t), '+05 m');
  assert.equal(altitudeDeltaText(-4.5, t), '−05 m');
});

test('TOP uses a single Warden return, while forward instruments track the exposed weak point', () => {
  const state = createStage(parseStageOptions('?fixture=boss'));
  const radar = buildRadar(state);
  assert.equal(radar.contacts.length, 1);
  assert.equal(radar.contacts[0].mark, '■');
  const weak = state.boss.weakPoints[0];
  weak.z += 14;
  weak.alt += 5;
  assert.deepEqual(buildRadar(state), radar);
  state.view = 'cockpit';
  const forward = buildRadar(state);
  assert.equal(forward.priority.id, weak.id);
  assert.equal(forward.priority.alt, weak.alt);
  assert.equal(forward.contacts[0].mark, '^');
});
