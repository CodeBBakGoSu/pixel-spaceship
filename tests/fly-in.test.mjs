import test from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { sampleFlyIn } from '../src/fly-in.ts';
import { BOSS_TICK, createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { activeWeakPoint, advanceFlares, advanceRearBombs, advanceShots, BANDS, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { LANDMARKS } from '../src/reach.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const planarDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const launch = seed => {
  const state = createStage(parseStageOptions(`?t=0&seed=${seed}`), ground);
  state.twinAt = state.podsAt = state.strafeAt = Infinity;
  return state;
};
const tick = state => stepStage(state, {}, ground);

function openingPatrol() {
  const state = launch(1);
  while (state.tick < 94) tick(state);
  state.enemies.length = 1;
  const [patrol] = state.enemies;
  assert.ok(patrol?.entry);
  return { state, patrol };
}

function incomingWarden() {
  const state = launch(42);
  state.tick = BOSS_TICK - 1;
  state.nextWave = -1;
  tick(state);
  assert.ok(state.boss?.entry);
  return { state, boss: state.boss };
}

function boltAt({ x, z, alt }, overrides = {}) {
  return { kind: 'twin', x, z: z - 7, alt, vx: 0, vz: 320,
    life: 0.5, damage: 1, volley: 1, nearMiss: false, lockId: null, ...overrides };
}

test('the opening patrols start beyond the rim, bank and slow into their scheduled wave', () => {
  const state = launch(1);
  while (!state.enemies.length && state.tick < 120) tick(state);
  const first = state.enemies[0], approach = first?.entry;
  assert.ok(approach, 'the wave was already at its combat positions');
  const duration = (approach.arriveAt - state.tick) / TICKS_PER_SECOND;
  assert.ok(duration >= 1 && duration <= 2);
  for (const enemy of state.enemies) {
    assert.ok(planarDistance(enemy, state.arena) >= state.arena.radius + 50);
    assert.ok(planarDistance(enemy, state.player) >= 600);
  }

  const initialSpeed = Math.hypot(first.vx, first.vz);
  let bank = 0;
  for (let i = state.tick; i < approach.arriveAt; i++) {
    const yaw = first.yaw, position = { x: first.x, z: first.z };
    tick(state);
    const rotation = Math.atan2(Math.sin(first.yaw - yaw), Math.cos(first.yaw - yaw));
    assert.ok(Math.abs(rotation) <= 3.2 / TICKS_PER_SECOND + 1e-9);
    assert.ok(planarDistance(first, position) < 65, 'an entering patrol teleported');
    assert.ok(first.alt >= ground(first.x, first.z) + 22 - 1e-9);
    bank = Math.max(bank, Math.abs(first.bank));
  }
  assert.ok(bank > 0.02, 'the patrol never banked along its curved route');
  assert.equal(state.tick, 2 * TICKS_PER_SECOND);
  assert.equal(first.entry, undefined);
  assert.equal(planarDistance(first, approach.target), 0);
  assert.equal(first.alt, approach.target.alt);
  const finalSpeed = Math.hypot(first.vx, first.vz);
  assert.ok(initialSpeed > finalSpeed * 4 && finalSpeed <= ENEMY_KINDS.patrol.pursuit);
  assert.ok(first.shotAt >= state.tick + ENEMY_KINDS.patrol.firstShot);
  assert.equal(state.shots.length, 0);
});

test('wave paths replay exactly by seed and retain the opening front and aft bearings', () => {
  const sample = seed => {
    const state = launch(seed), entries = [];
    for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
      tick(state);
      for (const enemy of state.enemies) {
        if (!enemy.entry || (state.tick !== enemy.entry.startedAt && state.tick % 11)) continue;
        entries.push({ id: enemy.id, wave: enemy.entry.arriveAt,
          aft: enemy.entry.origin.z < state.player.z, x: enemy.x, z: enemy.z, alt: enemy.alt, yaw: enemy.yaw });
      }
    }
    return entries;
  };
  for (const seed of [1, 11, 42]) {
    const paths = sample(seed);
    assert.deepEqual(paths, sample(seed));
    assert.ok(paths.some(pose => pose.wave === 120 && !pose.aft));
    assert.ok(paths.some(pose => pose.wave === 180 && pose.aft));
  }
  assert.notDeepEqual(sample(1), sample(42));
});

for (const [name, overrides] of [
  ['Twin', {}],
  ['pod', { kind: 'pods', damage: 2 }],
  ['overdrive', { damage: 2, vz: 485, reversal: { remaining: 3, hits: [] } }],
  ['strafe', { kind: 'strafe', damage: 2, targetBand: 1, vz: 210, vy: -90 }],
]) {
  test(`an inbound patrol passes through ${name} bolts and deals no contact damage`, () => {
    const { state, patrol } = openingPatrol();
    const next = sampleFlyIn(patrol.entry, state.tick + 1, ground);
    Object.assign(state.player, { x: next.x, z: next.z, altitude: next.alt });
    const hull = state.hull, hp = patrol.hp;
    patrol.shotAt = state.tick;
    const shot = boltAt(next, structuredClone(overrides));
    state.shots.push(shot);
    tick(state);
    assert.ok(planarDistance(state.player, patrol) < 7);
    assert.equal(state.hull, hull);
    assert.equal(patrol.hp, hp);
    assert.equal(patrol.hitUntil, 0);
    assert.equal(patrol.shotDown, false);
    assert.equal(state.score, 0);
    assert.equal(state.xp, 0);
    assert.deepEqual(state.pickups, []);
    assert.deepEqual(state.effects, []);
    assert.deepEqual(state.shots, [shot]);
    assert.ok(planarDistance(shot, patrol) < 6);
    assert.equal(shot.nearMiss, false);
    assert.deepEqual(shot.reversal, overrides.reversal);
  });
}

test('a patrol takes damage on arrival and drops collectible salvage when shot down', () => {
  const { state, patrol } = openingPatrol();
  const { arriveAt, target } = patrol.entry;
  while (state.tick < arriveAt - 1) tick(state);
  state.shots.push(boltAt(target));
  tick(state);
  assert.equal(patrol.entry, undefined);
  assert.equal(patrol.hp, 1);
  assert.equal(state.shots.length, 0);

  state.shots.push(boltAt(patrol));
  tick(state);
  assert.equal(state.enemies.includes(patrol), false);
  assert.equal(state.score, 100);
  assert.equal(state.xp, 0);
  assert.equal(state.pickups.length, 1);
  const [{ x, z, alt }] = state.pickups;
  Object.assign(state.player, { x, z, altitude: alt });
  tick(state);
  assert.equal(state.pickups.length, 0);
  assert.equal(state.xp, 1);
  assert.equal(state.salvage, 1);
});

for (const kind of ['patrol', 'Warden']) {
  test(`rear bombs, flares and ongoing burns pass over an inbound ${kind}`, () => {
    let state, target;
    if (kind === 'patrol') {
      const { state: flight, patrol } = openingPatrol();
      state = flight;
      target = patrol;
    } else {
      const { state: flight, boss } = incomingWarden();
      state = flight;
      boss.exposeTick = state.tick;
      target = boss.weakPoints[boss.index];
    }
    const { x, z, alt, hp } = target;
    const bomb = { x, z, alt, vx: 0, vz: 0, born: state.tick };
    state.rearBombs.push(bomb);
    advanceRearBombs(state, ground);
    assert.deepEqual(state.rearBombs, [bomb]);

    // An engaged patrol can still trigger the bomb next to the inbound target.
    const engaged = makeEnemy(state, x + 12, z, 1);
    engaged.alt = alt;
    state.enemies.push(engaged);
    advanceRearBombs(state, ground);
    assert.equal(engaged.hp, 0);
    assert.equal(target.hp, hp);
    assert.deepEqual(state.rearBombs, []);

    const flare = { x, z, alt, vx: 0, vz: 0, vy: -7, born: state.tick };
    state.flares.push(flare);
    advanceFlares(state, ground);
    assert.deepEqual(state.flares, [flare]);
    assert.equal(target.hp, hp);
    assert.equal(target.burnUntil, undefined);
    assert.equal(state.flareHit, null);

    target.burnUntil = state.tick + 10;
    target.burnNextAt = state.tick;
    advanceFlares(state, ground);
    assert.equal(target.hp, hp);
  });
}

test('locked shots pass through the inbound Warden even if its expose timer expires early', () => {
  const { state, boss } = incomingWarden();
  const { arriveAt } = boss.entry;
  const point = boss.weakPoints[boss.index];
  const assertShotPasses = () => {
    const shot = boltAt(point, { lockId: point.id });
    state.shots.push(shot);
    advanceShots(state, ground);
    assert.equal(point.hp, point.maxHp);
    assert.equal(point.hits, 0);
    assert.ok(state.shots.includes(shot));
    state.shots.length = 0;
  };
  assertShotPasses();
  boss.exposeTick = state.tick;
  boss.shotAt = state.tick;
  assertShotPasses();
  assert.equal(activeWeakPoint(state).exposed, false);
  while (state.tick < arriveAt - 1) {
    tick(state);
    assert.deepEqual(state.shots, []);
  }
  tick(state);
  assert.equal(boss.entry, undefined);
  assert.equal(activeWeakPoint(state).exposed, true);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 3);
});

test('Warden crosses the rim during the existing shield signal and stops at the atoll', () => {
  const { state, boss } = incomingWarden();
  const approach = boss.entry;
  assert.ok(approach && planarDistance(boss, state.arena) >= state.arena.radius + 50);
  assert.equal(boss.exposeTick, BOSS_TICK + 3 * TICKS_PER_SECOND);
  assert.ok(approach.arriveAt < boss.exposeTick);
  while (state.tick < approach.arriveAt) tick(state);
  assert.equal(boss.entry, undefined);
  assert.deepEqual([boss.x, boss.z, boss.alt], [LANDMARKS.atoll.x, LANDMARKS.atoll.z, BANDS[1]]);
  assert.equal(state.shots.length, 0);
  assert.equal(activeWeakPoint(state).exposed, false);
  while (state.tick < boss.exposeTick) tick(state);
  assert.equal(activeWeakPoint(state).exposed, true);
  const point = boss.weakPoints[boss.index];
  state.shots.push(boltAt(point, { lockId: point.id }));
  advanceShots(state, ground);
  assert.equal(point.hp, point.maxHp - 1);
  assert.equal(point.hits, 1);
});
