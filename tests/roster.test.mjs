import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASES } from '../src/data/phases.ts';
import { aegisBlocks } from '../src/data/roster.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemyHazards, advanceShots } from '../src/stage-combat.ts';
import { advanceEnemies, makeEnemy } from '../src/stage-enemies.ts';

const ground = () => 35;
const makeRun = () => createStage(parseStageOptions('?mode=survivors&autoplay=1'), ground);

test('all four sortie pools include an Aegis contact at the middle band', () => {
  for (const phase of PHASES.slice(0, 4)) {
    const aegis = phase.enemies.find(contact => contact.kind === 'aegis');
    assert.equal(aegis?.band, 1, phase.id);
    assert.ok(aegis.weight > 0);
  }
  assert.equal(PHASES.at(-1).id, 'ace');
});

test('an Aegis blocks attacks in its 120-degree front arc across the yaw wrap', () => {
  const defender = { x: 19, z: -12, yaw: Math.PI - 0.1, kind: 'aegis' };
  const sourceAt = angle => [defender.x + 15 * Math.sin(angle), defender.z + 15 * Math.cos(angle)];
  assert.equal(aegisBlocks(defender, ...sourceAt(-Math.PI + 0.1)), true);
  assert.equal(aegisBlocks(defender, ...sourceAt(defender.yaw + Math.PI / 3 - 0.0001)), true);
  assert.equal(aegisBlocks(defender, ...sourceAt(defender.yaw + Math.PI / 3 + 0.0001)), false);
  assert.equal(aegisBlocks(defender, ...sourceAt(defender.yaw - Math.PI / 2)), false);
  assert.equal(aegisBlocks(defender, ...sourceAt(defender.yaw + Math.PI)), false);
  assert.equal(aegisBlocks({ ...defender, kind: 'patrol' }, ...sourceAt(defender.yaw)), false);
});

test('a swept Twin bolt is stopped by the Aegis shield and damages the exposed side', () => {
  const state = makeRun();
  const aegis = makeEnemy(state, 0, 0, 1, 'aegis');
  aegis.yaw = 0;
  state.enemies = [aegis];
  const hp = aegis.hp;
  const bolt = { kind: 'twin', alt: aegis.alt, life: 1, damage: 2, volley: 1, nearMiss: false, lockId: null };

  state.shots.push({ ...bolt, x: 0, z: 9, vx: 0, vz: -320 });
  advanceShots(state, ground);
  assert.equal(state.shots.length, 0);
  assert.equal(aegis.hp, hp);

  state.shots.push({ ...bolt, x: -9, z: 0, vx: 320, vz: 0 });
  advanceShots(state, ground);
  assert.equal(state.shots.length, 0);
  assert.ok(aegis.hp < hp);
});

test('a flak warning fixes its blast position and altitude despite a band switch', () => {
  const state = makeRun(), p = state.player;
  Object.assign(p, { x: 0, z: 0, yaw: 0, altitude: 110 });
  const turret = makeEnemy(state, 0, 75, 1, 'turret');
  turret.alt = 40;
  turret.shotAt = state.tick;
  state.enemies = [turret];
  const cues = [];
  advanceEnemies(state, ground, { tell: kind => cues.push(kind) });
  const warning = turret.tell;
  assert.deepEqual(cues, ['flak']);
  assert.equal(warning.started, state.tick);
  assert.equal(warning.until - warning.started, 84);

  Object.assign(p, { x: warning.x, z: warning.z, altitude: 145 });
  state.tick = warning.until - 1;
  advanceEnemies(state, ground);
  assert.equal(state.effects.length, 0);
  state.tick++;
  advanceEnemies(state, ground);
  const [burst] = state.effects;
  assert.deepEqual([burst.x, burst.z, burst.alt], [warning.x, warning.z, 110]);
  const hull = state.hull;
  advanceEnemyHazards(state, ground);
  assert.equal(state.hull, hull);
  p.altitude = 110;
  advanceEnemyHazards(state, ground);
  assert.ok(state.hull < hull);
});

test('a Hound starts following the pilot’s band after a one-second delay', () => {
  const state = makeRun(), p = state.player;
  Object.assign(p, { x: 0, z: 0, yaw: 0, altitude: 145 });
  const hound = makeEnemy(state, 0, -38, 1, 'hound');
  hound.maneuverAt = state.tick;
  hound.shotAt = Infinity;
  state.enemies = [hound];
  advanceEnemies(state, ground);
  assert.equal(hound.maneuver?.band, 2);
  const started = state.tick;
  assert.equal(hound.maneuver?.diveAt, started + 60);
  for (state.tick = started + 1; state.tick < started + 60; state.tick++) advanceEnemies(state, ground);
  assert.equal(hound.alt, 110);
  advanceEnemies(state, ground);
  assert.ok(hound.alt > 110);
});

test('a charged patrol waits for the full reversal grace period before firing', () => {
  const state = makeRun();
  Object.assign(state.player, { x: 0, z: 0, yaw: 0, altitude: 110 });
  state.tick = 96;
  state.twinAt = Infinity;
  const patrol = makeEnemy(state, 0, -106, 1);
  patrol.shotAt = 100;
  patrol.tell = { kind: 'gun', started: 78, until: 100 };
  state.enemies = [patrol];
  const emitted = [];
  const events = { muzzle() { emitted.push(state.tick); } };
  stepStage(state, { maneuver: 'j-turn', maneuverTurn: 1 }, ground, undefined, events);
  assert.equal(state.tick, 97);
  assert.equal(patrol.shotAt, 122);
  assert.equal(patrol.tell.until, 122);
  while (state.tick < 121) stepStage(state, {}, ground, undefined, events);
  assert.deepEqual(emitted, []);
  stepStage(state, {}, ground, undefined, events);
  assert.deepEqual(emitted, [122]);
});

test('an elite Carrier launches its warned wave only into available Gnat slots', () => {
  const state = makeRun(), p = state.player;
  Object.assign(p, { x: 0, z: 0, yaw: 0, altitude: 110 });
  const carrier = makeEnemy(state, 0, 80, 2, 'bomber');
  carrier.carrier = 'coast-supply';
  carrier.shotAt = state.tick;
  state.enemies = [carrier];
  state.swarmCap = 2;
  const cues = [], counts = [];
  advanceEnemies(state, ground, { tell: kind => cues.push(kind) });
  assert.deepEqual(cues, ['carrier']);
  assert.equal(carrier.tell?.kind, 'carrier');
  assert.equal(state.enemies.length, 1);
  state.tick = carrier.tell.until;
  advanceEnemies(state, ground, undefined, (...args) => counts.push(args));
  const gnats = state.enemies.filter(enemy => enemy.kind === 'gnat');
  assert.equal(gnats.length, 2);
  assert.ok(gnats.every(enemy => enemy.band === carrier.band && enemy.hp === 1));
  assert.deepEqual(counts, [[2, 2, true]]);
});
