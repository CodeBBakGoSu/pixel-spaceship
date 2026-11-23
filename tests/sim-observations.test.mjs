import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullBuildObservation, createProgressionObservations, summarizeProgressionObservations } from '../tools/sim-observations.mjs';

const record = (tracker, values) => tracker.record({
  previousTick: 0, previousLevel: 1, previousXp: 0, previousSalvage: 0, previousPhase: 'playing',
  nextTick: 1, nextLevel: 1, nextXp: 0, nextSalvage: 0, nextPhase: 'playing', terminal: false,
  ...values,
});

test('paused draft picks count as level-ups before the 60-second snapshot freezes', () => {
  const tracker = createProgressionObservations(60);
  record(tracker, { previousTick: 3599, nextTick: 3600, nextXp: 1, nextSalvage: 1, nextPhase: 'draft' });
  assert.equal(tracker.finish().firstXpGainSeconds, 60);
  assert.equal(tracker.finish().firstDraftSeconds, 60);
  assert.equal(tracker.finish().firstLevelUpSeconds, null);
  assert.equal(tracker.finish().levelUpsAt60Seconds, null);

  record(tracker, { previousTick: 3600, previousLevel: 1, previousPhase: 'draft', nextTick: 3600, nextLevel: 2 });
  assert.equal(tracker.finish().firstLevelUpSeconds, 60);
  assert.equal(tracker.finish().levelUpTimes[2], 60);
  assert.equal(tracker.finish().levelUpsAt60Seconds, null);

  record(tracker, { previousTick: 3600, previousLevel: 2, nextTick: 3601, nextLevel: 2 });
  assert.equal(tracker.finish().levelUpsAt60Seconds, 1);
});

test('level 2–4 timings are recorded and summarized only for observed runs', () => {
  const first = createProgressionObservations(60);
  record(first, { previousTick: 0, nextTick: 1, nextLevel: 2 });
  record(first, { previousTick: 1, previousLevel: 2, previousPhase: 'draft', nextTick: 1, nextLevel: 3,
    nextPhase: 'playing' });
  record(first, { previousTick: 120, previousLevel: 3, nextTick: 121, nextLevel: 4 });
  const second = createProgressionObservations(60);
  record(second, { previousTick: 6, nextTick: 7, nextLevel: 2 });

  const summary = summarizeProgressionObservations([first.finish(), second.finish()]);
  assert.deepEqual(first.finish().levelUpTimes, { 2: 1 / 60, 3: 1 / 60, 4: 121 / 60 });
  assert.deepEqual(summary.levelUpTimes[2], { median: 4 / 60, observedRuns: 2 });
  assert.deepEqual(summary.levelUpTimes[3], { median: 1 / 60, observedRuns: 1 });
  assert.deepEqual(summary.levelUpTimes[4], { median: 121 / 60, observedRuns: 1 });
  assert.deepEqual(summarizeProgressionObservations([{ fullBuildSeconds: 450 }, { fullBuildSeconds: null }]).fullBuildSeconds,
    { median: 450, observedRuns: 1 });
});

test('600-second level-up count includes same-tick modal picks and excludes early endings', () => {
  const boundary = createProgressionObservations(60);
  record(boundary, { previousTick: 35999, previousLevel: 4, nextTick: 36000, nextLevel: 4, nextPhase: 'draft' });
  assert.equal(boundary.finish().levelUpsAt600Seconds, null);
  record(boundary, { previousTick: 36000, previousLevel: 4, previousPhase: 'draft', nextTick: 36000,
    nextLevel: 5, terminal: true });
  assert.equal(boundary.finish().levelUpsAt600Seconds, 4);

  const early = createProgressionObservations(60);
  record(early, { previousTick: 30000, previousLevel: 8, nextTick: 30001, nextLevel: 8, terminal: true });
  assert.equal(early.finish().levelUpsAt600Seconds, null);
  assert.deepEqual(summarizeProgressionObservations([boundary.finish(), early.finish()]).levelUpsAt600Seconds,
    { median: 4, observedRuns: 1 });
});

test('strict full-build timing requires exactly capped weapons and buffs', () => {
  const options = { weaponSlots: 4, buffSlots: 4, maxWeaponLevel: 7, maxBuffLevel: 3, ticksPerSecond: 60 };
  const build = createFullBuildObservation(options);
  build.record({ tick: 27000, weaponLevels: { twin: 7, pods: 7, seeker: 7, rail: 7 }, buffLevels: { a: 3, b: 3, c: 3 } });
  build.record({ tick: 27000, weaponLevels: { twin: 7, pods: 7, seeker: 7, rail: 6 }, buffLevels: { a: 3, b: 3, c: 3, d: 3 } });
  assert.equal(build.finish(), null);
  build.record({ tick: 27000, weaponLevels: { twin: 7, pods: 7, seeker: 7, rail: 7 }, buffLevels: { a: 3, b: 3, c: 3, d: 3 } });
  assert.equal(build.finish(), 450);

  const never = createFullBuildObservation(options);
  never.record({ tick: 36000, weaponLevels: { twin: 7 }, buffLevels: {} });
  assert.equal(never.finish(), null);
  assert.throws(() => createFullBuildObservation({ ...options, ticksPerSecond: 0 }), /full build limits/);
  assert.throws(() => never.record({ tick: -1, weaponLevels: {}, buffLevels: {} }), /full build tick/);
});

test('salvage credit records first XP time and summaries count only observed metrics', () => {
  const first = createProgressionObservations(60);
  record(first, { previousTick: 5, nextTick: 6, nextSalvage: 1 });
  record(first, { previousTick: 3599, nextTick: 3600, terminal: true });
  const second = createProgressionObservations(60);
  record(second, { previousTick: 11, nextTick: 12, nextSalvage: 2 });
  record(second, { previousTick: 3600, nextTick: 3601 });
  const early = createProgressionObservations(60);
  record(early, { previousTick: 3598, nextTick: 3599, terminal: true });

  const firstMetrics = first.finish();
  const summary = summarizeProgressionObservations([firstMetrics, second.finish(), early.finish()]);
  assert.equal(firstMetrics.firstXpGainSeconds, 0.1);
  assert.ok(Math.abs(summary.firstXpGainSeconds.median - 0.15) < 1e-12);
  assert.equal(summary.firstXpGainSeconds.observedRuns, 2);
  assert.deepEqual(summary.firstDraftSeconds, { median: null, observedRuns: 0 });
  assert.deepEqual(summary.firstLevelUpSeconds, { median: null, observedRuns: 0 });
  assert.deepEqual(summary.levelUpsAt60Seconds, { median: 0, observedRuns: 2 });
  assert.deepEqual(summary.levelUpsAt600Seconds, { median: null, observedRuns: 0 });
  assert.equal(early.finish().levelUpsAt60Seconds, null);
  assert.deepEqual(summary.levelUpTimes[4], { median: null, observedRuns: 0 });
});

test('unobserved metrics stay null and invalid observation inputs are rejected', () => {
  assert.deepEqual(summarizeProgressionObservations([]).firstXpGainSeconds, { median: null, observedRuns: 0 });
  assert.deepEqual(summarizeProgressionObservations([]).levelUpTimes[2], { median: null, observedRuns: 0 });
  assert.deepEqual(summarizeProgressionObservations([]).fullBuildSeconds, { median: null, observedRuns: 0 });
  assert.throws(() => createProgressionObservations(0), /ticksPerSecond must be positive/);

  const tracker = createProgressionObservations(60);
  assert.throws(() => record(tracker, { previousTick: 2, nextTick: 1 }), /invalid simulation tick advance/);
});
