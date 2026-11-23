import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, phaseAt } from '../src/data/phases.ts';
import { TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { createPhaseTelemetry, summarizePhaseTelemetry } from '../tools/phase-telemetry.mjs';

const telemetry = () => createPhaseTelemetry(PHASES, phaseAt, TICKS_PER_SECOND);
const sample = (tracker, previousTick, previousKills, live, kills = previousKills) => tracker.record({
  previousTick, previousKills, nextTick: previousTick + 1, nextKills: kills,
  enemies: live.map(([kind, hp]) => ({ kind, hp })),
});

test('a boundary tick and its kills belong to the phase at the pre-step tick', () => {
  const tracker = telemetry();
  tracker.record({ previousTick: 120 * 60 - 1, previousKills: 4, nextTick: 120 * 60, nextKills: 6,
    enemies: [{ kind: 'patrol', hp: 2 }, { kind: 'gnat', hp: 1, gnatVariant: 'sting' },
      { kind: 'gnat', hp: 3, gnatVariant: 'armored' }, { kind: 'gnat', hp: 0 }, { kind: 'ace', hp: 20 }] });
  tracker.record({ previousTick: 120 * 60, previousKills: 6, nextTick: 120 * 60 + 1, nextKills: 6,
    enemies: [{ kind: 'patrol', hp: 1 }] });

  const phases = tracker.finish();
  assert.equal(phases.coast.liveMedian, 3);
  assert.equal(phases.coast.liveMax, 3);
  assert.equal(phases.coast.kills, 2);
  assert.equal(phases.coast.completed, true);
  assert.equal(phases.skirmish.liveMedian, 1);
  assert.equal(phases.skirmish.kills, 0);
});

test('an unchanged tick from a draft or chest contributes no sample or kills', () => {
  const tracker = telemetry();
  tracker.record({ previousTick: 90, previousKills: 2, nextTick: 90, nextKills: 3,
    enemies: [{ kind: 'patrol', hp: 1 }] });
  const empty = tracker.finish().coast;
  assert.equal(empty.observedSeconds, null);
  assert.equal(empty.liveMedian, null);
  assert.equal(empty.kills, null);

  sample(tracker, 90, 3, []);
  const observed = tracker.finish().coast;
  assert.equal(observed.observedSeconds, 1 / 60);
  assert.equal(observed.liveMedian, 0);
  assert.equal(observed.kills, 0);
});

test('active occupancy excludes the initial Gnat start and final lull', () => {
  const tracker = telemetry();
  sample(tracker, 20 * 60 - 1, 0, [['patrol', 1]]);
  sample(tracker, 20 * 60, 0, [['patrol', 1], ['gnat', 1]]);
  sample(tracker, 105 * 60 - 1, 0, [['patrol', 1], ['gnat', 1], ['gnat', 1]]);
  sample(tracker, 105 * 60, 0, [['patrol', 1], ['gnat', 1], ['gnat', 1], ['gnat', 1]]);

  const coast = tracker.finish().coast;
  assert.equal(coast.observedSeconds, 4 / 60);
  assert.equal(coast.activeObservedSeconds, 2 / 60);
  assert.equal(coast.liveMedian, 2.5);
  assert.equal(coast.liveMax, 4);
  assert.equal(coast.activeLiveMedian, 2.5);
});

test('run summaries take the median of per-run medians and leave unreached phases null', () => {
  const first = telemetry();
  sample(first, 20 * 60, 0, [['patrol', 1], ['gnat', 1]], 1);
  const second = telemetry();
  sample(second, 20 * 60, 0, Array.from({ length: 10 }, () => ['gnat', 1]));
  sample(second, 20 * 60 + 1, 0, Array.from({ length: 10 }, () => ['gnat', 1]));
  sample(second, 20 * 60 + 2, 0, Array.from({ length: 10 }, () => ['gnat', 1]));

  const summary = summarizePhaseTelemetry([{ phaseMetrics: first.finish() }, { phaseMetrics: second.finish() }], PHASES);
  assert.equal(summary.coast.medianFullLiveContacts, 6);
  assert.equal(summary.coast.maxFullLiveContacts, 10);
  assert.equal(summary.coast.medianActiveLiveContacts, 6);
  assert.equal(summary.coast.medianObservedSeconds, 2 / 60);
  assert.equal(summary.coast.medianKills, 0.5);
  assert.equal(summary.coast.medianKillsPerMinute, 1800);
  assert.equal(summary.coast.reachedRuns, 2);
  assert.equal(summary.coast.completedRuns, 0);
  assert.equal(summary.skirmish.medianFullLiveContacts, null);
  assert.equal(summary.skirmish.maxFullLiveContacts, null);
  assert.equal(summary.skirmish.medianKillsPerMinute, null);
  assert.equal(summary.skirmish.reachedRuns, 0);
});

test('phase telemetry rejects a backwards simulation tick', () => {
  const tracker = telemetry();
  assert.throws(() => tracker.record({ previousTick: 2, previousKills: 0, nextTick: 1, nextKills: 0, enemies: [] }),
    /simulation tick moved backwards/);
});
