import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PICKUP_LIMIT } from '../src/data/run-balance.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { advanceShots, fireHostile, hostileCanHit } from '../src/stage-combat.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const sea = () => 0;
const sortie = () => createStage(parseStageOptions('?autoplay=1&seed=13'), sea);
const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

function advance(state, ticks, input = {}) {
  for (let i = 0; i < ticks; i++) stepStage(state, input, sea);
}

function facingBolt(state, altitude = state.player.altitude, kind = 'patrol') {
  const { x, z } = state.player;
  fireHostile(state, { x, z: z - 7, alt: altitude, kind }, 240);
  return state.shots.at(-1);
}

test('neutral roll remembers the last turn and holds heading, altitude and the centerline', () => {
  const state = sortie();
  stepStage(state, { turn: -1 }, sea);
  advance(state, 120);
  const { x, z, altitude, yaw } = state.player;
  stepStage(state, { roll: true, rollTurn: 0, turn: 1 }, sea);
  assert.equal(state.roll?.kind, 'aileron');
  assert.equal(state.roll.side, -1);
  assert.equal(state.roll.elapsed, 0);
  advance(state, 29, { turn: 1, climb: 1 });
  assert.equal(state.roll.elapsed, 29);
  assert.ok(Math.abs(state.player.yaw - yaw) < 1e-10);
  assert.equal(state.player.altitude, altitude);
  assert.ok(Math.abs((state.player.x - x) * Math.cos(yaw) - (state.player.z - z) * Math.sin(yaw)) < 1e-8);
  stepStage(state, {}, sea);
  assert.ok(!state.roll);
});

test('barrel rolls shift 40 m to the chosen side and return to their entry altitude in 42 ticks', () => {
  for (const side of [-1, 1]) {
    const state = sortie();
    const { x, altitude, yaw } = state.player;
    stepStage(state, { roll: true, turn: side, boost: true }, sea);
    assert.equal(state.roll?.kind, 'barrel');
    assert.equal(state.roll.side, side);
    assert.ok(state.boosting);
    advance(state, 9);
    assert.ok(state.player.altitude > altitude);
    advance(state, 32);
    assert.equal(state.roll.elapsed, 41);
    assert.ok(Math.abs(state.player.x - x - side * 40) < 1e-8);
    assert.ok(Math.abs(state.player.altitude - altitude) < 1e-8);
    assert.equal(state.player.yaw, yaw);
    stepStage(state, {}, sea);
    assert.ok(!state.roll);
  }
});

test('a requested roll takes precedence over reversal and cannot restart before its activation cooldown', () => {
  const state = sortie();
  const rolls = [];
  const events = { roll: (...args) => rolls.push(args) };
  stepStage(state, { roll: true, maneuver: 'immelmann' }, sea, undefined, events);
  assert.ok(!state.maneuver);
  assert.deepEqual(rolls, [[1, false]]);
  assert.equal(state.rollReadyAt, 79);
  stepStage(state, { maneuver: 'immelmann' }, sea);
  assert.ok(!state.maneuver);
  advance(state, 75);
  assert.equal(state.tick, 77);
  stepStage(state, { roll: true, maneuver: 'immelmann' }, sea, undefined, events);
  assert.ok(!state.roll);
  assert.ok(!state.maneuver);
  assert.equal(rolls.length, 1);
  stepStage(state, { roll: true, rollTurn: -1 }, sea, undefined, events);
  assert.equal(state.roll?.elapsed, 0);
  assert.deepEqual(rolls, [[1, false], [-1, true]]);
});

test('an active reversal blocks roll initiation and the prior reversal keeps its timing', () => {
  const state = sortie();
  stepStage(state, { maneuver: 'immelmann' }, sea);
  const maneuver = state.maneuver;
  stepStage(state, { roll: true }, sea);
  assert.ok(!state.roll);
  assert.equal(state.maneuver, maneuver);
  assert.equal(maneuver.elapsed, 2);
});

test('parry and bolt immunity use separate inclusive-start, exclusive-end roll windows', () => {
  const cases = [
    [0, 0, 'parry'], [0, 20, 'parry'], [0, 21, 'parry'], [0, 23, 'parry'], [0, 24, 'hit'],
    [1, 23, 'parry'], [1, 24, 'pass'], [1, 26, 'pass'], [1, 27, 'hit'],
  ];
  for (const [turn, age, expected] of cases) {
    const state = sortie();
    if (age > 0) {
      stepStage(state, { roll: true, rollTurn: turn }, sea);
      advance(state, age - 1);
    }
    const bolt = facingBolt(state, state.player.altitude, 'core');
    const parries = [];
    const input = age === 0 ? { roll: true, rollTurn: turn } : {};
    stepStage(state, input, sea, undefined, { parry: (...args) => parries.push(args) });
    const label = `side=${turn}, age=${age}`;
    assert.equal(state.roll?.elapsed, age, label);
    assert.equal(state.hull < state.maxHull, expected === 'hit', label);
    assert.equal(state.shots.includes(bolt), expected === 'pass', label);
    assert.equal(parries.length, Number(expected === 'parry'), label);
    assert.equal(state.xp, Number(expected === 'parry'), label);
    if (expected === 'parry') {
      assert.equal(parries[0][0], bolt);
      assert.equal(parries[0][3], bolt.alt);
    }
  }
});

test('off-band and terrain-blocked bolts never pay parry XP', () => {
  const state = sortie();
  stepStage(state, { roll: true }, sea);
  const offBand = facingBolt(state, state.player.altitude + 35);
  const blocked = facingBolt(state);
  advanceShots(state, (x, z) => z < state.player.z - 6 ? state.player.altitude : 0, {
    parry: () => assert.fail('parry requires an unobstructed in-band contact'),
  });
  assert.ok(state.shots.includes(offBand));
  assert.ok(!state.shots.includes(blocked));
  assert.equal(state.pickups.length, 0);
  assert.equal(state.hull, state.maxHull);
  assert.equal(hostileCanHit(state.player.altitude, state), false);
});

test('Aegis interception resolves before a parry on the same flight segment', () => {
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=13'), sea);
  state.run.evolutions.pods = 'aegis';
  stepStage(state, { roll: true }, sea);
  const { x, z, altitude: alt } = state.player;
  fireHostile(state, { x, z: z - scaleTravel(27), alt }, scaleTravel(1800));
  advanceShots(state, sea, { parry: () => assert.fail('Aegis already absorbed this bolt') });
  assert.equal(state.shots.length, 0);
  assert.equal(state.pickups.length, 0);
});

test('a parry spark is credited through salvage with the pickup pool already full', () => {
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=13'), sea);
  for (let i = 0; i < PICKUP_LIMIT; i++) {
    state.pickups.push({ id: ++state.nextId, x: 250, z: 250, alt: 145, xp: 1, born: 0 });
  }
  facingBolt(state);
  stepStage(state, { roll: true }, sea);
  assert.equal(state.xp, 1);
  assert.equal(state.salvage, 1);
  assert.equal(state.run.credits, 1);
  assert.equal(state.metrics.orbs, 1);
});

test('roll does not grant enemy-body grace or block mine damage', () => {
  const state = sortie();
  const { x, z, altitude: alt } = state.player;
  state.enemyMines.push({ x, z, alt, born: 0 });
  stepStage(state, { roll: true }, sea);
  assert.ok(state.roll);
  assert.equal(state.hull, state.maxHull - 2);
  assert.equal(state.bodyGraceUntil, 0);
});

test('restarting a sortie clears any roll in progress and restores readiness', () => {
  const state = sortie();
  stepStage(state, { roll: true, rollTurn: -1 }, sea);
  state.phase = 'lost';
  stepStage(state, { start: true }, sea);
  assert.ok(!state.roll);
  assert.ok((state.rollReadyAt ?? 0) <= state.tick);
  stepStage(state, { roll: true }, sea);
  assert.equal(state.roll?.side, 1);
});

test('a seeded roll replay hashes identically with and without combat observers', () => {
  const replay = observe => {
    const state = sortie();
    let parries = 0, rolls = 0;
    const events = observe ? { roll: () => rolls++, parry: () => parries++ } : undefined;
    for (let i = 0; i < 220; i++) {
      const roll = i === 0 || i === 82 || i === 170;
      if (roll) facingBolt(state);
      stepStage(state, { roll, rollTurn: i === 82 ? -1 : 0 }, sea, undefined, events);
    }
    if (observe) assert.deepEqual([rolls, parries], [3, 3]);
    return hash(state);
  };
  assert.equal(replay(false), replay(true));
  assert.equal(replay(true), replay(true));
});

test('disabled roll presses leave the no-roll replay unchanged', () => {
  const replay = input => {
    const state = sortie();
    for (let i = 0; i < 600; i++) {
      stepStage(state, { ...(i % 64 < 20 ? { turn: -0.5, boost: true } : {}), ...input }, sea);
    }
    assert.ok(!Object.hasOwn(state, 'roll'));
    assert.ok(!Object.hasOwn(state, 'rollReadyAt'));
    return hash(state);
  };
  assert.equal(replay({}), replay({ roll: false, rollTurn: 1 }));
});
