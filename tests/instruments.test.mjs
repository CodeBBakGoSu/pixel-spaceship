import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { altitudeDeltaText, buildRadar, relativeMark } from '../src/instruments.ts';
import { createTranslator } from '../src/i18n.ts';
import { fireHostile } from '../src/stage-combat.ts';

test('TOP radar exposes only coarse marks for overlapping bands', () => {
  const state = createStage(parseStageOptions('?fixture=stack'));
  const radar = buildRadar(state);
  assert.deepEqual(radar.contacts.map(contact => contact.mark), ['▽', '■', '△']);
  assert.ok(radar.contacts.every(contact => contact.x === 0 && contact.y === radar.contacts[0].y));
  assert.equal(radar.priority, null);
  assert.equal(radar.salvage, null);
  assert.equal(radar.rear, false);
});

test('forward radar gives one precise hostile track, one salvage mark and a neutral rear contact', () => {
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
  assert.equal(radar.rearCount, 1);
  assert.equal(radar.rearDanger, null);
  assert.equal(radar.rearBandMatch, true);
  assert.deepEqual(radar.contacts.filter(contact => contact.mark).map(contact => contact.mark), ['^', '=']);
});

test('only a live same-band aft bolt that can catch the player outranks a closing aircraft', () => {
  const state = createStage(parseStageOptions('?fixture=pursuit&view=cockpit'));
  const p = state.player, aircraft = state.enemies[1];
  state.speed = 52;
  state.enemies = [aircraft];
  Object.assign(aircraft, { x: p.x, z: p.z - 18, vz: 75 });
  fireHostile(state, { x: p.x, z: p.z - 24, alt: p.altitude }, 95);
  const [shot] = state.shots;
  const radar = buildRadar(state);
  assert.equal(radar.rearCount, 1);
  assert.equal(radar.rearDanger?.kind, 'shot');
  assert.ok(radar.rearDanger.seconds < 0.5);
  shot.alt += 35;
  assert.equal(buildRadar(state).rearDanger?.kind, 'contact');
  shot.alt = p.altitude;
  shot.vz = 50;
  assert.equal(buildRadar(state).rearDanger?.kind, 'contact');
  shot.vz = 95;
  shot.vx = 22;
  assert.equal(buildRadar(state).rearDanger?.kind, 'contact');
  shot.vx = 0;
  shot.life = 0.2;
  assert.equal(buildRadar(state).rearDanger?.kind, 'contact');
});

test('a neutral close tail becomes danger only while on a near-term collision path outside body grace', () => {
  const state = createStage(parseStageOptions('?fixture=stack&view=chase'));
  const p = state.player, enemy = state.enemies[1];
  state.speed = 52;
  Object.assign(enemy, { x: p.x, z: p.z - 12, vz: 27 });
  assert.deepEqual(buildRadar(state).rearMarks, ['■']);
  assert.equal(buildRadar(state).rearDanger, null);
  enemy.vz = 57;
  assert.equal(buildRadar(state).rearDanger, null);
  enemy.vz = 80;
  enemy.x = p.x + 12;
  assert.equal(buildRadar(state).rearDanger, null);
  enemy.x = p.x;
  assert.equal(buildRadar(state).rearDanger?.enemyId, enemy.id);
  state.bodyGraceUntil = state.tick + 48;
  assert.equal(buildRadar(state).rearDanger, null);
});

test('rear danger follows the actual aircraft heading and keeps TOP altitude marks coarse', () => {
  const state = createStage(parseStageOptions('?fixture=stack&view=chase'));
  const p = state.player;
  state.speed = 52;
  state.bodyGraceUntil = state.tick + 48;
  fireHostile(state, { x: p.x, z: p.z - 24, alt: p.altitude }, 95);
  assert.equal(buildRadar(state, Math.PI).rearDanger?.kind, 'shot');
  p.vx = 22;
  p.vz = 52;
  assert.equal(buildRadar(state, Math.PI).rearDanger, null);
  p.vx = 0;
  state.climbRate = 40;
  assert.equal(buildRadar(state, Math.PI).rearDanger, null);
  state.climbRate = 0;
  state.view = 'overhead';
  const radar = buildRadar(state, Math.PI);
  assert.equal(radar.rearDanger?.kind, 'shot');
  assert.deepEqual(radar.rearMarks, []);
  assert.deepEqual(radar.contacts.map(contact => contact.mark), ['▽', '■', '△']);
});

test('the pursuit warning marks reachable higher, level and lower rear contacts', () => {
  const state = createStage(parseStageOptions('?fixture=pursuit'));
  assert.deepEqual(buildRadar(state).rearMarks, ['△', '■', '▽']);
  state.view = 'overhead';
  assert.deepEqual(buildRadar(state).rearMarks, []);
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

test('far radar groups share a rim tick and the warning arc points to the nearest boundary', () => {
  const state = createStage(parseStageOptions('?fixture=stack'));
  const p = state.player;
  p.x = state.arena.x + 515;
  p.z = state.arena.z;
  state.enemies[0].x = p.x - 242;
  state.enemies[0].z = p.z;
  state.enemies[1].x = p.x - 243;
  state.enemies[1].z = p.z + 6;
  state.enemies[2].x = p.x - 65;
  state.enemies[2].z = p.z;
  state.pickups.push({ id: 200, x: p.x - 250, z: p.z, alt: 110, xp: 1, born: state.tick });
  state.tick = 92 * 60;
  const readout = buildRadar(state);
  assert.equal(readout.contacts.length, 1);
  assert.equal(readout.rim.filter(tick => tick.kind === 'enemy').length, 1);
  assert.equal(readout.rim.filter(tick => tick.kind === 'salvage').length, 1);
  assert.equal(readout.rim.filter(tick => tick.kind === 'warden').length, 1);
  assert.ok(Math.abs(readout.boundaryBearing - Math.PI / 2) < 0.001);
});
