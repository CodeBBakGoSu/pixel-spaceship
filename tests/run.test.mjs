import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { autopilotInput } from '../src/autoplay.ts';
import { fireHostile } from '../src/stage-combat.ts';
import { createStage, parseStageOptions, requiredXp, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const start = (params = '') => createStage(parseStageOptions(`?mode=survivors&t=0&${params}`), ground);
const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('the phase sortie starts with one weapon, 3+3 slots and a fixed mobile cap', () => {
  const state = start('touch=1&seed=7');
  assert.equal(state.swarmCap, 50);
  assert.deepEqual(state.run.weaponLevels, { twin: 1 });
  assert.deepEqual([state.run.weaponSlots, state.run.buffSlots], [3, 3]);
  assert.equal(requiredXp(1, true), 16);
  assert.equal(requiredXp(27, true), 79);
  state.phase = 'lost';
  stepStage(state, { start: true }, ground);
  assert.equal(state.swarmCap, 50);
  assert.deepEqual(state.run.weaponLevels, { twin: 1 });
  assert.equal(state.tick, 0);
});

test('drafts consume recorded input, leave spawns untouched and preserve excess XP', () => {
  const state = start('seed=18');
  state.xp = 32;
  stepStage(state, {}, ground);
  assert.equal(state.phase, 'draft');
  assert.equal(state.draft.length, 3);
  const { tick, streams } = state;
  const prior = JSON.stringify(streams);
  stepStage(state, { reroll: true, climb: 1, boost: true }, ground);
  assert.equal(state.run.rerolls, 0);
  stepStage(state, { pick: state.draft[0], turn: 1 }, ground);
  assert.equal(state.tick, tick);
  assert.equal(state.level, 2);
  assert.equal(state.xp, 16);
  assert.equal(JSON.stringify(state.streams), prior);
  assert.equal(state.phase, 'playing');
  assert.equal(state.picks.length, 1);
});

test('the survivor salvage cap merges nearby orbs without losing XP', () => {
  const state = start();
  state.pickups = Array.from({ length: 160 }, (_, index) => ({
    id: index + 1000, x: 100 + index, z: 40, alt: 145, xp: 1, born: 0,
  }));
  stepStage(state, {}, ground);
  assert.equal(state.pickups.length, 150);
  assert.equal(state.pickups.reduce((sum, pickup) => sum + pickup.xp, 0), 160);
  assert.ok(state.pickups.every(pickup => pickup.alt === 145));
});

test('hostile shots have their own cap during the phase sortie', () => {
  const state = start();
  for (let i = 0; i < 90; i++) fireHostile(state, { x: 100, z: 150, alt: 110 }, 60);
  assert.equal(state.shots.length, 64);
});

test('survivor state hashes repeat with the same seed and input stream', () => {
  function replay(seed) {
    const state = start(`seed=${seed}`);
    const input = [];
    for (let i = 0; i < 4200 && (state.phase === 'draft' || state.phase === 'playing'); i++) {
      input.push(autopilotInput(state, 'full', ground));
      stepStage(state, input.at(-1), ground);
    }
    return { state, input };
  }
  const first = replay(42);
  const second = start('seed=42');
  for (const input of first.input) stepStage(second, input, ground);
  assert.ok(first.state.tick > 2700);
  assert.equal(hash(first.state), hash(second));
  assert.notEqual(hash(first.state), hash(replay(11).state));
});

for (const seed of [1, 11, 27, 42, 128, 2026]) {
  test(`Survivors replay seed ${seed} chases and defeats the Ace within the sortie`, () => {
    const state = start(`seed=${seed}`);
    for (let inputs = 0; inputs < 37_000 && ['playing', 'draft', 'chest'].includes(state.phase); inputs++) {
      stepStage(state, autopilotInput(state, 'full', ground), ground);
    }
    assert.equal(state.phase, 'clear');
    assert.equal(state.boss.phase, 3);
    assert.equal(state.boss.crashed, true);
  });
}
