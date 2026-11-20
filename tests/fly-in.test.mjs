import test from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { sampleFlyIn } from '../src/fly-in.ts';
import { BOSS_TICK, createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { BANDS, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { LANDMARKS } from '../src/reach.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const planarDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const launch = seed => {
  const state = createStage(parseStageOptions(`?t=0&seed=${seed}`), ground);
  state.twinAt = state.podsAt = Infinity;
  return state;
};
const tick = state => stepStage(state, {}, ground);

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

test('an inbound ship takes weapon hits without damaging the player on contact', () => {
  const state = launch(1);
  while (state.tick < 85) tick(state);
  state.enemies.length = 1;
  const [patrol] = state.enemies;
  assert.ok(patrol?.entry);
  const next = sampleFlyIn(patrol.entry, state.tick + 1, ground);
  Object.assign(state.player, { x: next.x, z: next.z, altitude: next.alt });
  const hull = state.hull, hp = patrol.hp;
  state.shots.push({ kind: 'twin', x: next.x, z: next.z - 2, alt: next.alt, vx: 0, vz: 320,
    life: 0.5, damage: 1, volley: 1, nearMiss: false, lockId: null });
  tick(state);
  assert.ok(planarDistance(state.player, patrol) < 7);
  assert.equal(state.hull, hull);
  assert.equal(patrol.hp, hp - 1);
});

test('Warden crosses the rim during the existing shield signal and stops at the atoll', () => {
  const state = launch(42);
  state.tick = BOSS_TICK - 1;
  state.nextWave = -1;
  tick(state);
  const boss = state.boss, approach = boss.entry;
  assert.ok(approach && planarDistance(boss, state.arena) >= state.arena.radius + 50);
  assert.equal(boss.exposeTick, BOSS_TICK + 3 * TICKS_PER_SECOND);
  assert.ok(approach.arriveAt < boss.exposeTick);
  while (state.tick < approach.arriveAt) tick(state);
  assert.equal(boss.entry, undefined);
  assert.deepEqual([boss.x, boss.z, boss.alt], [LANDMARKS.atoll.x, LANDMARKS.atoll.z, BANDS[1]]);
  assert.equal(state.shots.length, 0);
});
