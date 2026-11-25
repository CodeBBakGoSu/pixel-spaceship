import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advancePhasePacing } from '../src/sortie-pacing.ts';
import { createProfile, dailySeed } from '../src/meta.ts';
import { STARTER_BUFFS, STARTER_WEAPONS } from '../src/data/meta.ts';
import { noteSortieKill } from '../src/sortie-pacing.ts';

const start = options => createStage({ ...parseStageOptions('?mode=survivors&t=0&seed=42'), ...options });

test('repair-only boundaries preserve the existing repair amount without a rest announcement', () => {
  const state = start();
  assert.equal(state.hull, 10);
  for (const seconds of [105, 225, 345, 465]) {
    state.tick = seconds * 60 - 1;
    state.hull = 8;
    for (let i = 0; i < 3; i++) stepStage(state);
    assert.equal(state.hull, 10);
    assert.notEqual(state.phaseNotice?.kind, 'lull');
  }
});

test('repair-only boundaries are idempotent when the same tick is processed again', () => {
  const state = start();
  for (const seconds of [105, 225, 345, 465]) {
    state.tick = seconds * 60;
    state.hull = 8;
    state.phaseNotice = null;
    advancePhasePacing(state);
    assert.equal(state.hull, 10);
    assert.equal(state.phaseNotice, null);
    state.hull = 8;
    advancePhasePacing(state);
    assert.equal(state.hull, 8);
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

test('height unlocks use a rolling five-second kill spread and cumulative 15m vertical kills', () => {
  const state = start();
  const player = state.player.altitude;
  for (const [tick, alt] of [[1, player - 15], [2, player], [3, player + 15]]) {
    state.tick = tick;
    noteSortieKill(state, { alt });
  }
  assert.equal(state.metrics.verticalKills, 2);
  assert.equal(state.metrics.heightSpreadWithinFive, 3);
  assert.deepEqual(state.killAltitudeTicks, [
    { tick: 1, alt: player - 15 }, { tick: 2, alt: player }, { tick: 3, alt: player + 15 },
  ]);

  state.tick = 5 * 60 + 4;
  noteSortieKill(state, { alt: player + 60 });
  assert.equal(state.killAltitudeTicks.length, 1);
  assert.equal(state.metrics.heightSpreadWithinFive, 3);
});
