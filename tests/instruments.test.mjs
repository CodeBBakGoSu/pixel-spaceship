import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { altitudeDeltaText, beaconTrack, buildRadar, relativeMark, worldSiteObjective } from '../src/instruments.ts';
import { createTranslator } from '../src/i18n.ts';
import { fireHostile } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';

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

test('TOP and forward radar track the same single Ace airframe and its actual altitude', () => {
  const state = createStage(parseStageOptions('?fixture=ace&view=top'));
  const { boss: ace, player: p } = state;
  state.enemies.length = 0;
  Object.assign(p, { x: 0, z: 0, yaw: 0 });
  Object.assign(ace, { x: 10, z: 90, alt: p.altitude + 10 });
  const radar = buildRadar(state);
  assert.equal(radar.contacts.length, 1);
  assert.equal(radar.contacts[0].kind, 'ace');
  assert.equal(radar.contacts[0].mark, '△');
  state.view = 'cockpit';
  const forward = buildRadar(state);
  assert.equal(forward.priority.id, ace.id);
  assert.equal(forward.priority.alt, ace.alt);
  assert.equal(forward.contacts[0].mark, '^');
});

test('a tailing Ace outranks a regular tail warning in every view until it crosses the nose', () => {
  const state = createStage(parseStageOptions('?fixture=ace'));
  const { boss: ace, player: p } = state;
  Object.assign(p, { x: 0, z: 0, yaw: 0 });
  Object.assign(ace, { x: -10, z: -70, alt: p.altitude, tail: true, entry: undefined });
  const hound = makeEnemy(state, 0, -40, 1, 'hound');
  hound.tell = { kind: 'tail', until: state.tick + 30 };
  state.enemies = [hound];
  for (const view of ['overhead', 'chase', 'cockpit']) {
    state.view = view;
    assert.equal(buildRadar(state).rearPursuit?.id, ace.id, view);
  }
  ace.z *= -1;
  assert.equal(buildRadar(state).rearPursuit?.id, hound.id);
  hound.tell.until = state.tick;
  assert.equal(buildRadar(state).rearPursuit, null);
});

test('far radar groups share a rim tick outside the original arena', () => {
  const state = createStage(parseStageOptions('?fixture=stack'));
  const p = state.player;
  p.x = 4515;
  p.z = 0;
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
  assert.equal(readout.rim.filter(tick => tick.kind === 'ace').length, 1);
});

test('an Ace signal marks the rally point once the signal starts', () => {
  const state = createStage(parseStageOptions('?fixture=stack&view=chase'));
  state.rally = { x: 0, z: -80, alt: 110 };
  assert.equal(beaconTrack(state), null);
  state.tick = 92 * 60;
  state.player.x = state.player.z = state.player.yaw = 0;
  assert.deepEqual(beaconTrack(state), state.rally);
  assert.ok(buildRadar(state).rim.some(tick => tick.kind === 'ace' && tick.angle === Math.PI));
});

test('navigation tracks nearby destinations and marks distant or aft destinations at their bearings', () => {
  const state = createStage(parseStageOptions('?fixture=stack&view=cockpit'));
  const p = state.player;
  p.x = 7100;
  p.z = -4600;
  p.yaw = 0;
  state.worldSites = [
    { id: 'beacon', kind: 'beacon', x: p.x + 64, z: p.z + 96, alt: 110 },
    { id: 'drop', kind: 'supply', x: p.x - 45, z: p.z - 44, alt: 75 },
    { id: 'well', kind: 'xp', x: p.x + 900, z: p.z + 30, alt: 32 },
    { id: 'claimed', kind: 'supply', x: p.x, z: p.z + 20, alt: 75, claimed: true },
  ];
  const cockpit = buildRadar(state);
  const beacon = cockpit.contacts.find(contact => contact.kind === 'beacon');
  assert.ok(beacon && beacon.x > 0 && beacon.y < 0);
  assert.ok(cockpit.rim.some(tick => tick.kind === 'supply' && tick.angle === 5 * Math.PI / 4));
  assert.ok(cockpit.rim.some(tick => tick.kind === 'xp' && tick.angle === Math.PI / 2));
  assert.ok(cockpit.contacts.every(contact => contact.kind !== 'supply'));
  assert.equal(cockpit.salvage, null);

  state.view = 'overhead';
  const top = buildRadar(state);
  assert.equal(top.contacts.filter(contact => contact.kind === 'supply').length, 1);
  assert.ok(top.contacts.find(contact => contact.kind === 'supply').y > 0);
});

test('the navigation objective gives the nearest unclaimed destination and its claim altitude', () => {
  const state = createStage(parseStageOptions('?fixture=stack'));
  const p = state.player;
  state.worldSites = [
    { id: 'claimed', kind: 'xp', x: p.x, z: p.z + 60, alt: 75, claimed: true },
    { id: 'beacon', kind: 'beacon', x: p.x, z: p.z + 900, alt: 110 },
    { id: 'supply', kind: 'supply', x: p.x - 160, z: p.z, alt: 110 },
  ];
  assert.equal(worldSiteObjective(state, createTranslator('en')), 'SUPPLY DROP · 270° · 160 m · ALT 110');
  assert.equal(worldSiteObjective(state, createTranslator('ko')), '보급품 · 270° · 160 m · 고도 110');
  state.worldSites[2].claimed = true;
  assert.equal(worldSiteObjective(state, createTranslator('en')), null);
});
