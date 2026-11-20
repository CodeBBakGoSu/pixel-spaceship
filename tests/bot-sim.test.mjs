import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.ts';
import { BOT_PROFILE_IDS } from '../src/data/bot-profiles.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { parseSimArgs, runBatch, serializeSummaryCsv } from '../tools/sim.mjs';

test('a bot returns controls without mutating stage state or consuming a game RNG stream', () => {
  const stage = createStage(parseStageOptions('?autoplay=1&mode=survivors&seed=42'));
  stage.player.yaw = Math.PI / 2;
  const before = JSON.stringify(stage), pilot = createBot('weak', stage.seed);
  const first = pilot(stage);
  assert.equal(JSON.stringify(stage), before);
  assert.ok(Math.abs(first.turn) <= 1);
  const startingYaw = stage.player.yaw;
  stepStage(stage, first);
  assert.equal(stage.tick, 1);
  assert.notEqual(stage.player.yaw, startingYaw);
  assert.equal(pilot(stage).turn, first.turn, 'pilot holds a decision across its reaction delay');
});

test('three seeds per profile make the same replay hashes and profile reports on repeat', () => {
  const args = parseSimArgs(['--profile', 'all', '--seeds', '3', '--from', '1', '--heat', '0']);
  const first = runBatch(args), second = runBatch(args);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(serializeSummaryCsv(first), serializeSummaryCsv(second));
  assert.deepEqual(first.profiles.map(row => row.profile), BOT_PROFILE_IDS);
  assert.equal(first.runs.length, 9);
  assert.equal(first.swarmCap, 80);
  const [skilled, average, weak] = first.profiles;
  assert.ok(skilled.survival.median >= average.survival.median, JSON.stringify(first.profiles));
  assert.ok(average.survival.median >= weak.survival.median, JSON.stringify(first.profiles));
  for (const run of first.runs) {
    assert.match(run.stateHash, /^[a-f0-9]{64}$/);
    assert.ok(['clear', 'lost', 'timeout'].includes(run.outcome));
    assert.ok(run.ticks > 0 && run.survivalSeconds >= run.seconds);
    assert.equal(run.clear, run.outcome !== 'lost');
  }
  for (const row of first.profiles) {
    assert.ok(Math.abs(row.clearRate - row.bossClearRate - row.timeoutRate) < 1e-12);
    assert.equal(Object.values(row.endHull).reduce((sum, count) => sum + count, 0), 3);
    assert.ok(row.billsPaidPct >= 0 && row.billsPaidPct <= 100);
    assert.ok(Object.hasOwn(row.weapons, 'twin'));
  }
});

test('sim arguments preserve heat and cap inputs and reject misspelled flags and unsafe ranges', () => {
  assert.deepEqual(parseSimArgs(['--profile', 'weak', '--seeds', '1', '--from', '42', '--heat', '5', '--mobile']),
    { profile: 'weak', seeds: 1, from: 42, heat: 5, mobile: true });
  for (const args of [['--profile', 'god'], ['--seeds', '0'], ['--heat', '6'], ['--from', '1.3'],
    ['--unknown'], ['--from', '4294967295', '--seeds', '2'], ['--seeds'], ['--mobile', '--mobile']]) {
    assert.throws(() => parseSimArgs(args));
  }
});
