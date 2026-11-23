import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleTravel } from '../src/data/speed.ts';
import { MANEUVERS } from '../src/maneuvers.ts';
import * as combat from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const calm = () => 0;

function flight(altitude = 125) {
  const state = createStage(parseStageOptions('?fixture=reversal&mode=legacy'));
  state.player.altitude = altitude;
  state.enemies.length = 0;
  state.podsAt = Infinity;
  return state;
}

function contact(state, x, z, band) {
  const enemy = makeEnemy(state, state.player.x + x, state.player.z + z, band);
  state.enemies.push(enemy);
  return enemy;
}

function sweep(state, ticks, ground = calm) {
  for (let i = 0; i < ticks; i++) {
    state.tick++;
    combat.advanceShots(state, ground);
  }
}

test('reversal opens at the half-loop flips and the J-turn control handoff', () => {
  for (const kind of ['immelmann', 'split-s', 'j-turn']) {
    const state = flight();
    const target = contact(state, 0, -85, kind === 'immelmann' ? 2 : kind === 'split-s' ? 0 : 1);
    const handoff = kind === 'j-turn' ? MANEUVERS[kind].ticks : MANEUVERS[kind].flipTick;
    stepStage(state, { maneuver: kind });
    for (let i = 1; i < handoff; i++) {
      assert.equal(state.reversal, null, `${kind} opened before handoff`);
      assert.ok(!state.shots.some(shot => shot.reversal));
      stepStage(state);
    }
    assert.equal(state.reversal.startTick, state.tick, kind);
    assert.equal(state.reversal.until - state.tick, 120);
    assert.deepEqual(state.reversal.pursuers, [target.id]);
  }
});

test('overdrive replaces the regular Twin volley with a five-bolt spread against any forward contact', () => {
  const state = flight();
  contact(state, 0, 40, 1);
  combat.openReversal(state, []);
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 5);
  assert.equal(new Set(state.shots.map(shot => shot.vx)).size, 5);
  assert.ok(state.shots.every(shot => shot.kind === 'twin' && shot.reversal && Math.hypot(shot.vx, shot.vz) > combat.BOLT_SPEED));
  state.tick += 3;
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 5);
  state.tick++;
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 10);
  state.tick = state.reversal.until;
  combat.acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.reversal).length, 10);
});

test('one overdrive bolt pierces three distinct contacts and doubles damage only to former pursuers', () => {
  const state = flight();
  const stranger = contact(state, 0, 35, 1), former = contact(state, 0, 47, 1);
  const stacked = contact(state, 0, 47, 2);
  const third = contact(state, 0, 61, 1), fourth = contact(state, 0, 75, 1);
  for (const target of [stranger, former, third, fourth]) target.hp = 4;
  combat.openReversal(state, [former.id]);
  combat.acquireAndFire(state);
  state.shots = [state.shots.find(shot => shot.vx === 0)];
  sweep(state, 22);
  assert.equal(stranger.hp, 3);
  assert.equal(former.hp, 2);
  assert.equal(stacked.hp, 2);
  assert.equal(third.hp, 3);
  assert.equal(fourth.hp, 4);
});

test('three overdrive kills in 21 ticks trigger a burst and extend the cue past the firing window', () => {
  const state = flight();
  const targets = [35, 48, 61].map(z => contact(state, 0, z, 1));
  for (const target of targets) target.hp = 1;
  combat.openReversal(state, []);
  state.tick = state.reversal.until - 1;
  combat.acquireAndFire(state);
  sweep(state, 16);
  assert.equal(state.reversal.kills, 3);
  assert.equal(state.reversal.streak, 3);
  assert.ok(state.reversal.burstAt > state.reversal.until);
  const { shownUntil } = state.reversal;
  sweep(state, shownUntil - state.tick);
  assert.equal(state.reversal, null);
});

test('an Ace takes the same damage from a locked Twin volley in and out of overdrive', () => {
  const damage = [];
  for (const boosted of [false, true]) {
    const state = createStage(parseStageOptions('?fixture=boss'));
    const ace = state.boss;
    state.player.altitude = ace.alt;
    state.player.yaw = Math.atan2(ace.x - state.player.x, ace.z - state.player.z);
    if (boosted) {
      combat.openReversal(state, [ace.id]);
    }
    for (let i = 0; i < 20; i++) combat.acquireAndFire(state);
    assert.equal(state.shots.length, boosted ? 0 : 2);
    assert.ok(state.shots.every(shot => shot.lockId === null));
    assert.equal(ace.hp, ace.maxHp);
    state.shots.length = 0;
    state.twinAt = state.tick;
    combat.acquireAndFire(state);
    assert.equal(state.shots.filter(shot => shot.lockId === ace.id).length, 2);
    sweep(state, 45);
    damage.push(ace.maxHp - ace.hp);
  }
  assert.equal(damage[0], 2);
  assert.equal(damage[1], damage[0]);
});

test('basic downward strafe fires at two distinct targets on a 0.55 s cadence', () => {
  const state = flight();
  state.twinRank = 3;
  state.twinDamage = 4;
  contact(state, -14, 70, 1);
  const first = contact(state, 10, 82, 0), second = contact(state, -65, 100, 0);
  combat.acquireAndFire(state);

  assert.equal(state.shots.filter(shot => shot.kind === 'twin').length, 4);
  const [strafe, other] = state.shots.filter(shot => shot.kind === 'strafe');
  assert.ok(other && other.vx < 0);
  assert.ok(strafe);
  assert.equal(strafe.damage, 1);
  assert.equal(strafe.targetBand, 0);
  assert.ok(strafe.vy < 0);
  assert.ok(Math.abs(Math.hypot(strafe.vx, strafe.vy, strafe.vz) - scaleTravel(230)) < 1e-6);

  state.tick += 32;
  combat.acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'strafe').length, 2);
  state.tick++;
  combat.acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'strafe').length, 4);
  sweep(state, 40);
  assert.equal(first.hp, 0);
  assert.equal(second.hp, 0);
});

test('strafe clamps acquisition to a single lower band and a 38-degree forward lane', () => {
  for (const [altitude, x, z, band, fires] of [
    [180, 0, 28, 1, true], [125, 0, 135, 0, true], [180, 0, 70, 0, false],
    [75, 0, 70, 1, false], [180, 0, 27, 1, false], [180, 0, 136, 1, false],
    [180, 50, 70, 1, true], [180, 63, 70, 1, false], [130, 0, 70, 1, false],
  ]) {
    const state = flight(altitude);
    contact(state, scaleTravel(x), scaleTravel(z), band);
    combat.acquireAndFire(state);
    assert.equal(state.shots.some(shot => shot.kind === 'strafe'), fires, `${altitude} → ${band} at ${x},${z}`);
  }
});

test('strafe intercepts an approaching craft faster than the bolt and skips a receding craft', () => {
  const state = flight(180);
  const target = contact(state, 0, scaleTravel(110), 1);
  target.vz = scaleTravel(300);
  combat.acquireAndFire(state);
  assert.equal(state.shots.some(shot => shot.kind === 'strafe'), false);
  target.vz = scaleTravel(-300);
  combat.acquireAndFire(state);
  const bolt = state.shots.find(shot => shot.kind === 'strafe');
  assert.ok(bolt && bolt.vy < 0 && bolt.life > 0);
  assert.ok(Math.abs(Math.hypot(bolt.vx, bolt.vy, bolt.vz) - scaleTravel(230)) < 1e-6);
});

test('descending strafe catches a contact entering its height window mid-tick', () => {
  const state = flight(180), target = contact(state, 0, 70, 1);
  combat.acquireAndFire(state);
  const [strafe] = state.shots;
  assert.equal(strafe?.kind, 'strafe');
  Object.assign(strafe, { x: target.x, z: target.z - 8, alt: 118.5, vx: 0, vz: 210, vy: -90 });

  sweep(state, 1);
  assert.equal(target.hp, 1);
  assert.equal(state.shots.length, 0);
});

test('terrain intersecting the descending path stops the strafe before an aircraft', () => {
  const state = flight(180), target = contact(state, 0, 70, 1);
  combat.acquireAndFire(state);
  const [strafe] = state.shots;
  assert.equal(strafe?.kind, 'strafe');
  Object.assign(strafe, { x: target.x, z: target.z - 8, alt: 118.5, vx: 0, vz: 210, vy: -90 });

  sweep(state, 1, (_x, z) => z >= target.z - 6.4 ? 118 : 0);
  assert.equal(target.hp, 2);
  assert.equal(state.shots.length, 0);
});

test('a missed strafe remains limited to aircraft in its selected lower band', () => {
  const state = flight(180);
  state.boss = createStage(parseStageOptions('?fixture=boss')).boss;
  const ace = state.boss;
  const target = contact(state, 0, 73, 1);
  target.alt = 118;
  Object.assign(ace, { x: target.x, z: target.z, alt: 112.9 });
  combat.acquireAndFire(state);
  const [strafe] = state.shots;
  assert.equal(strafe?.kind, 'strafe');
  assert.equal(state.lock, null);

  state.enemies.length = 0;
  const outsideBand = contact(state, 0, 73, 1), twoDown = contact(state, 0, 114, 0);
  outsideBand.alt = 112.9;
  sweep(state, 60);
  assert.equal(outsideBand.hp, 2);
  assert.equal(twoDown.hp, 2);
  assert.equal(ace.hp, ace.maxHp);
  assert.ok(Math.abs(strafe.alt - 113) < 1e-6);
  assert.equal(state.shots.length, 0);
});

test('a strafe swept through the selected band can clip the Ace', () => {
  const state = flight(180);
  state.boss = createStage(parseStageOptions('?fixture=boss')).boss;
  const ace = state.boss;
  const target = contact(state, 0, 73, 1);
  target.alt = 118;
  Object.assign(ace, { x: target.x, z: target.z, alt: target.alt });
  combat.acquireAndFire(state);
  assert.equal(state.shots[0]?.kind, 'strafe');
  state.enemies.length = 0;
  sweep(state, 45);
  assert.equal(ace.hp, ace.maxHp - 1);
  assert.equal(state.lock, null);
});

test('a strafe kill drops salvage in the lower band until the player dives to collect it', () => {
  const state = flight(), target = contact(state, 0, 75, 0);
  target.hp = 1;
  for (let i = 0; i < 30; i++) stepStage(state);
  assert.equal(state.enemies.length, 0);
  assert.equal(state.xp, 0);
  assert.equal(state.pickups[0]?.alt, 75);

  Object.assign(state.player, { x: state.pickups[0].x, z: state.pickups[0].z });
  stepStage(state);
  assert.equal(state.xp, 0);
  state.player.altitude = 75;
  stepStage(state);
  assert.equal(state.xp, 1);
});
