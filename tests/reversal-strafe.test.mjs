import test from 'node:test';
import assert from 'node:assert/strict';
import { MANEUVERS } from '../src/maneuvers.ts';
import * as combat from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const calm = () => 0;

function flight(altitude = 110) {
  const state = createStage(parseStageOptions('?fixture=flare'));
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
    assert.equal(state.reversal.until - state.tick, 90);
    assert.deepEqual(state.reversal.pursuers, [target.id]);
  }
});

test('rapid Twin fire uses the original pursuers, forward cone, range, and matching altitude', () => {
  const state = flight();
  state.twinAt = Infinity;
  const stranger = contact(state, 0, 40, 1);
  const former = contact(state, 12, 80, 1);
  const wrongBand = contact(state, 0, 45, 2);
  const outOfCone = contact(state, 35, 28, 1);
  const tooFar = contact(state, 0, 176, 1);
  const snapshot = [former.id, wrongBand.id, outOfCone.id, tooFar.id];
  combat.openReversal(state, snapshot);
  snapshot.push(stranger.id);

  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 1);
  assert.equal(state.shots[0].reversal?.targetId, former.id);
  assert.equal(state.shots[0].kind, 'twin');
  assert.equal(Math.round(Math.hypot(state.shots[0].vx, state.shots[0].vz)), 320);
  state.tick += 6;
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 1);
  state.tick++;
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 2);
  state.tick = state.reversal.until;
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 2);
});

test('the follow-up separates onto a second former pursuer and counts each real Twin kill once', () => {
  const state = flight();
  const first = contact(state, -8, 50, 1), second = contact(state, 15, 69, 1);
  const stacked = contact(state, 15, 69, 2);
  first.hp = second.hp = 1;
  combat.openReversal(state, [first.id, second.id, stacked.id]);
  combat.acquireAndFire(state);
  assert.equal(state.shots.filter(shot => !shot.reversal).length, 2);
  assert.equal(state.shots.find(shot => shot.reversal)?.reversal.targetId, second.id);
  assert.equal(state.reversal.kills, 0);

  sweep(state, 23);
  assert.equal(first.hp, 0);
  assert.equal(second.hp, 0);
  assert.equal(stacked.hp, 2);
  assert.equal(state.reversal.kills, 2);
  assert.ok(state.reversal.shownUntil > state.tick);
});

test('a stray aircraft can block the extra Twin bolt without taking bonus damage', () => {
  const state = flight();
  state.twinAt = Infinity;
  const blocker = contact(state, 0, 30, 1), former = contact(state, 0, 65, 1);
  combat.openReversal(state, [former.id]);
  combat.acquireAndFire(state);
  assert.equal(state.shots.length, 1);

  sweep(state, 24);
  assert.equal(blocker.hp, 2);
  assert.equal(former.hp, 2);
  assert.equal(state.shots.length, 0);
  assert.equal(state.reversal.kills, 0);
});

test('both Twin volleys and rapid follow-ups can confirm a late reversal kill', () => {
  for (const boosted of [false, true]) {
    const state = flight();
    const former = contact(state, 0, 80, 1);
    former.hp = 1;
    combat.openReversal(state, [former.id]);
    if (boosted) state.twinAt = Infinity;
    else state.reversal.nextShotAt = Infinity;
    state.tick = state.reversal.until - 1;
    combat.acquireAndFire(state);
    sweep(state, 17);
    assert.equal(former.hp, 0);
    assert.equal(state.reversal?.kills, 1, boosted ? 'rapid follow-up' : 'regular volley');
    const shownUntil = state.reversal.shownUntil;
    sweep(state, shownUntil - state.tick - 1);
    assert.equal(state.reversal.kills, 1);
    sweep(state, 1);
    assert.equal(state.reversal, null);
  }
});

test('basic downward strafe adds one slower bolt on an independent 0.7 s cadence', () => {
  const state = flight();
  state.twinRank = 3;
  state.twinDamage = 4;
  contact(state, -14, 70, 1);
  contact(state, 10, 82, 0);
  combat.acquireAndFire(state);

  assert.equal(state.shots.filter(shot => shot.kind === 'twin').length, 4);
  const [strafe] = state.shots.filter(shot => shot.kind === 'strafe');
  assert.ok(strafe);
  assert.equal(strafe.damage, 1);
  assert.equal(strafe.targetBand, 0);
  assert.ok(strafe.vy < 0);
  assert.ok(Math.abs(Math.hypot(strafe.vx, strafe.vy, strafe.vz) - 230) < 1e-6);

  state.tick += 41;
  combat.acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'strafe').length, 1);
  state.tick++;
  combat.acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'strafe').length, 2);
});

test('strafe clamps acquisition to a single lower band and a narrow forward lane', () => {
  for (const [altitude, x, z, band, fires] of [
    [145, 0, 45, 1, true], [110, 0, 100, 0, true], [145, 0, 70, 0, false],
    [75, 0, 70, 1, false], [145, 0, 44, 1, false], [145, 0, 101, 1, false],
    [145, 30, 70, 1, false], [130, 0, 70, 1, false],
  ]) {
    const state = flight(altitude);
    contact(state, x, z, band);
    combat.acquireAndFire(state);
    assert.equal(state.shots.some(shot => shot.kind === 'strafe'), fires, `${altitude} → ${band} at ${x},${z}`);
  }
});

test('descending strafe catches a contact entering its height window mid-tick', () => {
  const state = flight(145), target = contact(state, 0, 70, 1);
  combat.acquireAndFire(state);
  const [strafe] = state.shots;
  assert.equal(strafe?.kind, 'strafe');
  Object.assign(strafe, { x: target.x, z: target.z - 8, alt: 118.5, vx: 0, vz: 210, vy: -90 });

  sweep(state, 1);
  assert.equal(target.hp, 1);
  assert.equal(state.shots.length, 0);
});

test('terrain intersecting the descending path stops the strafe before an aircraft', () => {
  const state = flight(145), target = contact(state, 0, 70, 1);
  combat.acquireAndFire(state);
  const [strafe] = state.shots;
  assert.equal(strafe?.kind, 'strafe');
  Object.assign(strafe, { x: target.x, z: target.z - 8, alt: 118.5, vx: 0, vz: 210, vy: -90 });

  sweep(state, 1, (_x, z) => z >= target.z - 6.4 ? 118 : 0);
  assert.equal(target.hp, 2);
  assert.equal(state.shots.length, 0);
});

test('a missed strafe remains limited to aircraft in its selected lower band', () => {
  const state = flight(145);
  state.boss = createStage(parseStageOptions('?fixture=boss')).boss;
  state.boss.exposeTick = state.tick;
  const point = state.boss.weakPoints[0];
  const target = contact(state, 0, 73, 1);
  target.alt = 103;
  Object.assign(point, { x: target.x, z: target.z, alt: target.alt });
  combat.acquireAndFire(state);
  const [strafe] = state.shots;
  assert.equal(strafe?.kind, 'strafe');
  assert.equal(state.lock, null);

  state.enemies.length = 0;
  const outsideBand = contact(state, 0, 73, 1), twoDown = contact(state, 0, 114, 0);
  outsideBand.alt = 101.9;
  sweep(state, 60);
  assert.equal(outsideBand.hp, 2);
  assert.equal(twoDown.hp, 2);
  assert.equal(point.hp, point.maxHp);
  assert.ok(Math.abs(strafe.alt - 102) < 1e-6);
  assert.equal(state.shots.length, 0);
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
