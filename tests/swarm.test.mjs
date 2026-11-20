import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, RUN_BOSS_SECONDS, RUN_END_SECONDS, phaseAt } from '../src/data/phases.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { makeEnemy, advanceEnemies } from '../src/stage-enemies.ts';
import { advancePhaseSpawns, trimEscorts } from '../src/spawn-director.ts';

const ground = () => 35;
const ticks = seconds => seconds * 60;
const waveState = (seed = 27, swarmCap = 80) =>
  createStage(parseStageOptions(`?mode=survivors&t=0&seed=${seed}&touch=${swarmCap === 50 ? 1 : 0}`), ground);
const gnats = state => state.enemies.filter(enemy => enemy.kind === 'gnat');
const spawnAt = (state, seconds, terrain = ground) => {
  state.tick = ticks(seconds);
  advancePhaseSpawns(state, terrain);
};

test('phase data fixes the four spawn budgets, boss arrival and hard timeout', () => {
  assert.equal(RUN_BOSS_SECONDS, 480);
  assert.equal(RUN_END_SECONDS, 600);
  assert.deepEqual(PHASES.map(phase => [phase.regularPerMinute, phase.gnatsPerMinute]), [
    [14, 25], [16, 55], [18, 90], [20, 130], [8, 60],
  ]);
  for (const [index, second] of [0, 120, 240, 360, 480].entries()) {
    assert.equal(phaseAt(second), PHASES[index]);
    if (index) assert.equal(phaseAt(second - 1 / 60), PHASES[index - 1]);
  }
});

test('uncapped packs distribute each phase budget across the scheduled ticks', () => {
  const state = waveState();
  for (const phase of PHASES) {
    let spawned = 0;
    for (state.tick = ticks(phase.starts); state.tick < ticks(phase.ends); state.tick++) {
      advancePhaseSpawns(state, ground);
      spawned += gnats(state).length;
      state.enemies.length = 0;
    }
    assert.equal(spawned, phase.gnatsPerMinute * 2, phase.id);
  }
});

test('the first Gnat formation approaches at 45 seconds', () => {
  const state = waveState();
  spawnAt(state, 45 - 1 / 60);
  assert.equal(gnats(state).length, 0);
  spawnAt(state, 45);
  assert.ok(gnats(state).length >= 4);
  assert.ok(gnats(state).every(enemy => enemy.hp === 1 && enemy.entry));
  assert.equal(new Set(gnats(state).map(enemy => enemy.band)).size, 1);
  assert.equal(new Set(gnats(state).map(enemy => JSON.stringify(enemy.entry.target))).size, gnats(state).length);
});

test('swarm caps are independent of the regular enemy cap', () => {
  for (const cap of [50, 80]) {
    const state = waveState(27, cap);
    for (let i = 0; i < cap - 1; i++) state.enemies.push(makeEnemy(state, 0, -200, 1, 'gnat'));
    state.tick = ticks(45);
    const samples = [];
    advancePhaseSpawns(state, ground, (...sample) => samples.push(sample));
    assert.deepEqual(samples, [[cap, cap, true]]);
    assert.equal(gnats(state).length, cap);
    spawnAt(state, 0.5);
    assert.equal(state.enemies.filter(enemy => enemy.kind === 'patrol').length, 2);
  }
});

test('regular placements, the cap and draft randomness cannot desynchronize future spawn beats', () => {
  const first = waveState();
  const second = waveState(27, 50);
  second.run.draftRng.rng = 12345;
  second.rng = 99;
  second.streams.combat.rng = 17;
  for (let i = 0; i < 50; i++) second.enemies.push(makeEnemy(second, 0, -200, 1, 'gnat'));
  for (const seconds of [0.5, 1.5, 7.5, 45, 120, 240, 360, 480]) {
    spawnAt(first, seconds);
    spawnAt(second, seconds, () => 130);
    assert.equal(first.streams.spawn.rng, second.streams.spawn.rng, `spawn RNG at ${seconds}s`);
  }
  assert.equal(first.rng, 27);
  assert.equal(second.rng, 99);
});

test('phases reserve their final fifteen seconds for the lull', () => {
  for (const seconds of [105, 225, 345, 465]) {
    const state = waveState();
    const before = state.streams.spawn.rng;
    for (let tick = ticks(seconds); tick < ticks(seconds + 15); tick++) {
      state.tick = tick;
      advancePhaseSpawns(state, ground);
    }
    assert.deepEqual(state.enemies, []);
    assert.equal(state.streams.spawn.rng, before);
  }
});

test('the Ace escort limit trims regulars without removing Gnats', () => {
  const state = waveState();
  for (let i = 0; i < 24; i++) state.enemies.push(makeEnemy(state, i, 100, 1, 'patrol'));
  for (let i = 0; i < 80; i++) state.enemies.push(makeEnemy(state, i, 140, 1, 'gnat'));
  state.tick = ticks(RUN_BOSS_SECONDS);
  trimEscorts(state);
  assert.equal(gnats(state).length, 80);
  assert.equal(state.enemies.length, 94);
});

test('engaged Gnats drift with the pack and retire without attacks or a kill drop', () => {
  const state = waveState();
  spawnAt(state, 45);
  const [gnat] = gnats(state);
  const { target, arriveAt } = gnat.entry;
  state.tick = arriveAt;
  advanceEnemies(state, ground);
  assert.ok(!gnat.entry);
  assert.equal(gnat.alt, target.alt);
  state.tick++;
  advanceEnemies(state, ground);
  assert.notDeepEqual([gnat.x, gnat.z], [target.x, target.z]);
  assert.equal(gnat.alt, target.alt);
  state.tick += ticks(30);
  advanceEnemies(state, ground);
  assert.equal(gnat.hp, 0);
  assert.equal(gnat.shotDown, false);
  assert.deepEqual(state.shots, []);
  assert.deepEqual(state.pickups, []);
});
