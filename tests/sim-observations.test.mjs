import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressionObservations, summarizeProgressionObservations } from '../tools/sim-observations.mjs';

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
  assert.equal(tracker.finish().levelUpsAt60Seconds, null);

  record(tracker, { previousTick: 3600, previousLevel: 2, nextTick: 3601, nextLevel: 2 });
  assert.equal(tracker.finish().levelUpsAt60Seconds, 1);
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
  assert.equal(early.finish().levelUpsAt60Seconds, null);
});

test('unobserved metrics stay null and invalid observation inputs are rejected', () => {
  assert.deepEqual(summarizeProgressionObservations([]).firstXpGainSeconds, { median: null, observedRuns: 0 });
  assert.throws(() => createProgressionObservations(0), /ticksPerSecond must be positive/);

  const tracker = createProgressionObservations(60);
  assert.throws(() => record(tracker, { previousTick: 2, nextTick: 1 }), /invalid simulation tick advance/);
});
