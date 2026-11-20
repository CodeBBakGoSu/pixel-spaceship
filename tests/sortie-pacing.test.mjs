import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { createProfile, dailySeed } from '../src/meta.ts';
import { STARTER_BUFFS, STARTER_WEAPONS } from '../src/data/meta.ts';

const start = options => createStage({ ...parseStageOptions('?mode=survivors&t=0&seed=42'), ...options });

test('four lulls each repair two hull once and never exceed capacity', () => {
  const state = start();
  assert.equal(state.hull, 10);
  for (const seconds of [105, 225, 345, 465]) {
    state.tick = seconds * 60 - 1;
    state.hull = 8;
    for (let i = 0; i < 3; i++) stepStage(state);
    assert.equal(state.hull, 10);
    assert.equal(state.phaseNotice.kind, 'lull');
    assert.equal(state.phaseNotice.repaired, 2);
  }
});

test('completed in-run quests add their gear at the next draft and persist on retreat', () => {
  const state = start();
  assert.ok(!state.run.weapons.includes('drones'));
  state.metrics.orbs = 100;
  state.xp = 16;
  stepStage(state);
  assert.equal(state.phase, 'draft');
  assert.ok(state.run.weapons.includes('drones'));
  stepStage(state, { pick: state.draft[0] });
  state.run.credits = 100;
  stepStage(state, { retreat: true });
  assert.equal(state.phase, 'retreated');
  assert.equal(state.summary.credits, 50);
  assert.deepEqual(state.summary.unlocked, ['drones']);
  stepStage(state, { start: true });
  assert.ok(state.run.weapons.includes('drones'));
  assert.equal(state.metrics.orbs, 0);
  assert.equal(state.profile.metrics.orbs, 100);
});

test('a daily launch uses fixed starter pools, four slots and base hull at a deterministic seed', () => {
  const profile = createProfile();
  profile.upgrades.hull = 3;
  profile.metrics.orbs = 200;
  const state = start({ profile, daily: true, heat: 5, seed: dailySeed('2026-11-20') });
  assert.equal(state.hull, 10);
  assert.equal(state.heat, 0);
  assert.deepEqual([state.run.weaponSlots, state.run.buffSlots], [4, 4]);
  assert.deepEqual(state.run.weapons, STARTER_WEAPONS);
  assert.deepEqual(state.run.buffs, STARTER_BUFFS);
  state.tick = 600 * 60 - 1;
  stepStage(state);
  assert.equal(state.phase, 'timeout');
  assert.equal(state.summary.seconds, 600);
  assert.equal(state.summary.credits, 0);
  assert.deepEqual(state.profile, profile);
});
