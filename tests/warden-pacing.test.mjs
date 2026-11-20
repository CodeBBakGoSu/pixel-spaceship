import test from 'node:test';
import assert from 'node:assert/strict';
import { planFlyIn } from '../src/fly-in.ts';
import { createStage, parseStageOptions, RUN_BOSS_TICK, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { activeWeakPoint, hurtWeakPoint, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { firePacedWarden, makePacedWarden, pacedExposureTick, positionPacedWeakPoints } from '../src/warden.ts';

const sea = () => 35;
const tick = seconds => seconds * TICKS_PER_SECOND;
const sortie = (heat = 0) => createStage({ ...parseStageOptions('?mode=survivors&t=0&seed=27'), heat }, sea);

test('a new sortie opens its first Warden shield at 8:03 and stages the core at 9:48', () => {
  const state = sortie();
  state.tick = RUN_BOSS_TICK;
  const boss = makePacedWarden(state, 0, 0);
  assert.deepEqual(boss.weakPoints.map(point => point.band), [2, 0, 2, 1]);
  assert.equal(boss.exposeTick, RUN_BOSS_TICK + tick(3));
  const dead = boss.weakPoints.length - 1;
  assert.equal(pacedExposureTick(boss, 0, dead, RUN_BOSS_TICK + tick(90)), RUN_BOSS_TICK + tick(108));
  assert.ok(boss.weakPoints.slice(0, -1).every(point => point.hp > 10));
  assert.ok(boss.weakPoints[dead].hp > 8);
});

test('late part kills still give a readable exposure countdown', () => {
  const state = sortie();
  state.tick = RUN_BOSS_TICK;
  const boss = makePacedWarden(state, 0, 0);
  const late = RUN_BOSS_TICK + tick(110);
  assert.equal(pacedExposureTick(boss, 0, 3, late), late + tick(2));
});

test('Heat 4 adds a middle relay with a finite orbit before the scheduled core', () => {
  const state = sortie(4);
  state.tick = RUN_BOSS_TICK;
  const boss = makePacedWarden(state, 0, 0);
  assert.deepEqual(boss.weakPoints.map(point => [point.kind, point.band]),
    [['pod', 2], ['pod', 0], ['pod', 2], ['pod', 1], ['core', 1]]);
  assert.equal(pacedExposureTick(boss, 4, 3, state.tick + tick(75)), state.tick + tick(79));
  assert.equal(pacedExposureTick(boss, 4, 4, state.tick + tick(96)), state.tick + tick(108));
  positionPacedWeakPoints(boss, 4, state.tick + tick(100));
  assert.ok(boss.weakPoints.every(point => [point.x, point.z, point.vx, point.vz].every(Number.isFinite)));
});

test('the Warden stays quiet on entry and fires different active salvos through shield intervals', () => {
  const state = sortie();
  state.tick = RUN_BOSS_TICK;
  const boss = makePacedWarden(state, 0, 0);
  boss.entry = planFlyIn(state, state.arena, { x: 0, z: 0, alt: boss.alt }, { ticks: tick(2), bend: 0.2, exitSpeed: 0 });
  state.tick = boss.shotAt;
  firePacedWarden(state, boss);
  assert.equal(state.shots.length, 0);
  delete boss.entry;
  const patterns = boss.weakPoints.map((point, index) => {
    state.shots = [];
    state.tick = boss.shotAt;
    boss.index = index;
    boss.exposeTick = state.tick + tick(5);
    firePacedWarden(state, boss);
    assert.ok(boss.shotAt > state.tick);
    assert.ok(state.shots.length >= 2);
    assert.ok(state.shots.every(shot => shot.kind === 'hostile' && shot.alt === point.alt));
    return state.shots.map(shot => Math.atan2(shot.vx, shot.vz));
  });
  assert.ok(new Set(patterns.map(JSON.stringify)).size >= 3);
});

test('ordinary play spawns the paced boss at 8:00, keeps entry immune and stops at 10:00', () => {
  const state = sortie();
  state.tick = RUN_BOSS_TICK - 1;
  stepStage(state, {}, sea);
  assert.equal(state.tick, RUN_BOSS_TICK);
  const boss = state.boss;
  assert.ok(boss?.paced);
  assert.equal(boss.entry?.arriveAt, RUN_BOSS_TICK + tick(2));
  const point = boss.weakPoints[boss.index];
  const full = point.hp;
  hurtWeakPoint(state, boss, 999);
  assert.equal(point.hp, full);
  state.tick = boss.entry.arriveAt - 1;
  stepStage(state, {}, sea);
  assert.equal(activeWeakPoint(state)?.exposed, false);
  state.tick = boss.exposeTick - 1;
  stepStage(state, {}, sea);
  assert.equal(activeWeakPoint(state)?.exposed, true);
  hurtWeakPoint(state, boss, 999);
  stepStage(state, {}, sea);
  assert.equal(boss.index, 1);
  assert.equal(boss.exposeTick, RUN_BOSS_TICK + tick(30));
  state.tick = RUN_END_TICK - 1;
  stepStage(state, {}, sea);
  assert.equal(state.phase, 'timeout');
  stepStage(state, {}, sea);
  assert.equal(state.tick, RUN_END_TICK);
});
