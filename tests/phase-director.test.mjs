import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASES } from '../src/data/phases.ts';
import { advancePhaseDirector } from '../src/phase-director.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemies, makeEnemy } from '../src/stage-enemies.ts';

const tick = seconds => seconds * 60;
const ground = () => 35;

test('four new enemy types have deterministic isolated introductions and the late formation schedule', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  state.tick = tick(70);
  assert.equal(advancePhaseDirector(state, ground), true);
  assert.equal(state.enemies.filter(enemy => enemy.kind === 'twin-chaser').length, 1);
  assert.equal(state.enemies.some(enemy => enemy.kind === 'crosswing'), false);

  for (const [seconds, kind] of [[140, 'crosswing'], [260, 'manta'], [300, 'mender']]) {
    const before = state.nextId;
    state.tick = tick(seconds);
    assert.equal(advancePhaseDirector(state, ground), true);
    const intro = state.enemies.filter(enemy => enemy.id > before);
    assert.equal(intro.every(enemy => enemy.kind === kind || (kind === 'mender' && enemy.kind === 'aegis')), true);
    assert.equal(intro.some(enemy => enemy.kind === kind), true);
    if (seconds === 140) assert.equal(state.enemies.some(enemy => enemy.kind === 'twin-chaser'), false);
  }

  state.phaseDirector.intro = 4;
  state.tick = tick(360);
  advancePhaseDirector(state, ground);
  const crosswing = state.enemies.filter(enemy => enemy.kind === 'crosswing' && enemy.leaveAt === tick(400) - 1);
  const twin = state.enemies.find(enemy => enemy.kind === 'twin-chaser' && enemy.leaveAt === tick(400) - 1);
  assert.equal(crosswing.length, 2);
  assert.ok(twin);
  assert.equal(twin.maneuverAt - crosswing[0].maneuverAt, 78);

  state.tick = tick(420);
  advancePhaseDirector(state, ground);
  const aegis = state.enemies.find(enemy => enemy.kind === 'aegis' && enemy.leaveAt === tick(465));
  assert.ok(aegis);
  aegis.hp = 0;
  state.tick++;
  advancePhaseDirector(state, ground);
  assert.equal(state.enemies.some(enemy => enemy.kind === 'manta' && enemy.leaveAt === tick(480) - 1), true);

  const nextIdAtAce = state.nextId;
  state.tick = tick(480);
  advancePhaseDirector(state, ground);
  assert.equal(state.nextId, nextIdAtAce);
  state.tick = tick(540);
  advancePhaseDirector(state, ground);
  assert.equal(state.enemies.some(enemy => enemy.hp > 0), false);
});

test('restarting a sortie clears the old director and allows the new introduction schedule', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  state.phase = 'clear';
  state.phaseDirector = { intro: 4, six: true, seven: true, manta: true, isolationUntil: tick(500), introIds: [],
    sixTellUntil: tick(480), sixCrosswingStarted: true, sixTwinStarted: true };
  stepStage(state, { start: true, launch: { profile: state.profile, heat: 0, seed: 22, daily: false } }, ground);
  assert.equal(state.tick, 0);
  assert.equal(state.phaseDirector, undefined);

  state.tick = tick(70) - 1;
  stepStage(state, {}, ground);
  assert.equal(state.phaseDirector.intro, 1);
  assert.equal(state.enemies.some(enemy => enemy.kind === 'twin-chaser' && enemy.directorIntro), true);
});

test('escorts advance along their clear-out heading at the eight-minute boundary', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  state.tick = tick(480);
  const escort = makeEnemy(state, 0, 0, 1, 'aegis');
  state.enemies.push(escort);
  advancePhaseDirector(state, ground);
  assert.equal(escort.leaveAt, tick(540));
  assert.ok(Number.isFinite(escort.escortClearYaw));
  const before = { x: escort.x, z: escort.z };
  advanceEnemies(state, ground);
  assert.ok(Math.hypot(escort.x - before.x, escort.z - before.z) > 0);
});

test('intro isolation cancels existing tells and pending volleys', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), () => 0);
  state.tick = tick(70);
  const aegis = makeEnemy(state, 0, 50, 1, 'aegis');
  aegis.elite = true;
  aegis.tell = { kind: 'aegis', started: state.tick - 30, until: state.tick + 30 };
  aegis.eliteVolley = { started: state.tick - 30, secondAt: state.tick };
  aegis.shotAt = state.tick;
  state.enemies.push(aegis);
  state.threatBudget.spends.push({ tick: state.tick + 30, source: `escort:${aegis.id}`, points: 2,
    activeFromTick: state.tick - 30, activeUntilTick: state.tick + 180, bearing: 0 });

  advancePhaseDirector(state, () => 0);
  const intro = state.enemies.find(enemy => enemy.kind === 'twin-chaser');
  assert.ok(state.phaseDirector.introIds.includes(intro.id));
  advanceEnemies(state, () => 0);

  assert.equal(aegis.tell, undefined);
  assert.equal(aegis.eliteVolley, undefined);
  assert.ok(aegis.shotAt >= state.phaseDirector.isolationUntil);
  assert.equal(state.threatBudget.spends.some(spend => spend.source === `escort:${aegis.id}`), false);
});

test('an intro remains available after budget denial and retires only after its first tell', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), () => 0);
  const started = tick(70);
  state.tick = started;
  advancePhaseDirector(state, () => 0);
  const twin = state.enemies.find(enemy => enemy.kind === 'twin-chaser');
  twin.entry = undefined;
  twin.x = 0;
  twin.z = 80;
  state.tick = started + 100;
  twin.maneuverAt = state.tick;
  state.threatBudget.spends.push(
    { tick: state.tick + 42, source: 'ace:one', points: 2, bearing: 1 },
    { tick: state.tick + 42, source: 'ace:two', points: 2, bearing: 2 },
  );
  advanceEnemies(state, () => 0);
  assert.equal(twin.tell, undefined);
  assert.equal(twin.leaveAt, undefined);

  state.tick = started + 18 * 60;
  advancePhaseDirector(state, () => 0);
  assert.ok(state.enemies.includes(twin));
  assert.equal(twin.leaveAt, undefined);
  state.threatBudget.spends = [];
  twin.maneuverAt = state.tick;
  advanceEnemies(state, () => 0);
  assert.equal(twin.tell?.kind, 'charge');
  assert.equal(twin.introAttackDone, true);
  assert.ok(twin.leaveAt > state.tick);
});

test('late elite share rises through minute seven without changing Gnat hull values', () => {
  const shares = PHASES.slice(0, 8).map(phase => phase.eliteShare);
  assert.deepEqual(shares, [...shares].sort((a, b) => a - b));
  assert.ok(PHASES[0].eliteShare > 0);
  assert.ok(PHASES[7].eliteShare > PHASES[1].eliteShare);
});
