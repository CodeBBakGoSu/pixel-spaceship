import test from 'node:test';
import assert from 'node:assert/strict';
import { autopilotInput } from '../src/autoplay.ts';
import { createBot } from '../src/bot.ts';
import { BOT_PROFILES, BOT_PROFILE_IDS } from '../src/data/bot-profiles.ts';
import { random, rngStream } from '../src/stage-random.ts';
import { PHASES, SWARM_CAPS } from '../src/data/phases.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { fireHostile } from '../src/stage-combat.ts';
import { parseSimArgs, runBatch, serializeSummaryCsv } from '../tools/sim.mjs';

function altitudeDecisionSeed(profile, seeksAltitude) {
  for (let seed = 1; seed <= 1000; seed++) {
    if ((random(rngStream(seed, `bot:${profile}`)) < BOT_PROFILES[profile].altitudeUse) === seeksAltitude) return seed;
  }
  throw new Error(`No altitude decision seed for ${profile}`);
}

function acePursuitStage(seed, targetAltitude) {
  const stage = createStage(parseStageOptions(`?mode=survivors&fixture=ace&seed=${seed}`));
  Object.assign(stage.player, { altitude: 125, pitch: 0, yaw: 0 });
  Object.assign(stage.boss, { x: stage.player.x, z: stage.player.z + 300, alt: targetAltitude,
    band: targetAltitude > 125 ? 2 : 0, entry: undefined, tell: null, tail: false });
  stage.enemies = [];
  stage.invulnerability = 0;
  return stage;
}

test('failed altitude decisions preserve Ace pursuit climb and dive across profile reaction delays', () => {
  for (const profile of BOT_PROFILE_IDS) {
    for (const targetAltitude of [75, 180]) {
      const seed = altitudeDecisionSeed(profile, false);
      const stage = acePursuitStage(seed, targetAltitude);
      const base = autopilotInput(stage, 'full', undefined, BOT_PROFILES[profile], false);
      assert.equal(base.climb, Math.sign(targetAltitude - stage.player.altitude));
      const pilot = createBot(profile, seed);
      const input = pilot(stage);
      assert.equal(input.climb, base.climb);
      stage.tick++;
      assert.equal(pilot(stage).climb, input.climb, 'reaction delay holds the pursuit command');
    }
  }
  assert.ok(BOT_PROFILES.skilled.reactionDelayTicks < BOT_PROFILES.average.reactionDelayTicks);
  assert.ok(BOT_PROFILES.average.reactionDelayTicks < BOT_PROFILES.weak.reactionDelayTicks);
});

test('successful altitude decisions preserve full Ace pursuit control', () => {
  for (const profile of BOT_PROFILE_IDS) {
    const seed = altitudeDecisionSeed(profile, true);
    const stage = acePursuitStage(seed, 180);
    assert.equal(createBot(profile, seed)(stage).climb, 1);
  }
});

test('failed altitude decisions preserve Ace-fight dodge climb for every profile', () => {
  for (const profile of BOT_PROFILE_IDS) {
    const seed = altitudeDecisionSeed(profile, false);
    const stage = acePursuitStage(seed, 75);
    stage.effects.push({ kind: 'flak', x: stage.player.x, z: stage.player.z, alt: 125, life: 1 });
    assert.equal(autopilotInput(stage, 'full', undefined, BOT_PROFILES[profile], false).climb, 1);
    assert.equal(createBot(profile, seed)(stage).climb, 1);
  }
});

test('inactive stages still return no bot controls', () => {
  const stage = acePursuitStage(1, 180);
  stage.phase = 'lost';
  assert.deepEqual(createBot('average', 1)(stage), {});
  stage.phase = 'playing';
  stage.paused = true;
  assert.deepEqual(createBot('average', 1)(stage), {});
});

test('failed altitude decisions preserve absent and neutral climb commands', () => {
  const seed = altitudeDecisionSeed('average', false);
  const maneuvering = acePursuitStage(seed, 180);
  maneuvering.maneuver = { kind: 'j-turn', elapsed: 0 };
  assert.equal(createBot('average', seed)(maneuvering).climb, undefined);
  const aligned = acePursuitStage(seed, 125);
  assert.equal(createBot('average', seed)(aligned).climb, 0);
});

test('failed altitude decisions do not attenuate climb outside a boss fight', () => {
  for (const profile of BOT_PROFILE_IDS) {
    const seed = altitudeDecisionSeed(profile, false);
    const stage = acePursuitStage(seed, 180);
    stage.boss = null;
    stage.player.altitude = 75;
    const base = autopilotInput(stage, 'full', undefined, BOT_PROFILES[profile], false);
    assert.notEqual(base.climb, 0);
    assert.equal(createBot(profile, seed)(stage).climb, base.climb);
  }
});

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
  assert.equal(first.swarmCap, SWARM_CAPS.desktop);
  assert.match(serializeSummaryCsv(first).split('\n')[0], /\bpeakLiveGnats\b/);
  assert.match(serializeSummaryCsv(first).split('\n')[0], /\bphaseMetrics\b/);
  assert.match(serializeSummaryCsv(first).split('\n')[0], /\bfirstXpGainSeconds\b/);
  assert.match(serializeSummaryCsv(first).split('\n')[0], /\bfirstDraftSeconds\b/);
  assert.match(serializeSummaryCsv(first).split('\n')[0], /\bfirstLevelUpSeconds\b/);
  assert.match(serializeSummaryCsv(first).split('\n')[0], /\blevelUpsAt60Seconds\b/);
  const [skilled, average, weak] = first.profiles;
  assert.ok(skilled.survival.median >= average.survival.median, JSON.stringify(first.profiles));
  assert.ok(average.survival.median >= weak.survival.median, JSON.stringify(first.profiles));
  for (const run of first.runs) {
    assert.match(run.stateHash, /^[a-f0-9]{64}$/);
    assert.ok(['clear', 'lost', 'timeout'].includes(run.outcome));
    assert.ok(run.ticks > 0 && run.survivalSeconds >= run.seconds);
    assert.equal(run.clear, run.outcome !== 'lost');
    assert.ok(run.peakLiveGnats > 0 && run.peakLiveGnats <= first.swarmCap);
    assert.deepEqual(Object.keys(run.phaseMetrics), PHASES.map(phase => phase.id));
    assert.equal(Object.values(run.phaseMetrics).reduce((sum, phase) => sum + (phase.kills ?? 0), 0), run.kills);
    assert.ok(run.firstXpGainSeconds === null || Number.isFinite(run.firstXpGainSeconds));
    assert.ok(run.firstDraftSeconds === null || Number.isFinite(run.firstDraftSeconds));
    assert.ok(run.firstLevelUpSeconds === null || Number.isFinite(run.firstLevelUpSeconds));
    assert.ok(run.levelUpsAt60Seconds === null || Number.isFinite(run.levelUpsAt60Seconds));
  }
  for (const row of first.profiles) {
    assert.ok(Math.abs(row.clearRate - row.bossClearRate - row.timeoutRate) < 1e-12);
    assert.equal(Object.values(row.endHull).reduce((sum, count) => sum + count, 0), 3);
    assert.ok(row.billsPaidPct >= 0 && row.billsPaidPct <= 100);
    assert.ok(Object.hasOwn(row.weapons, 'twin'));
    assert.equal(row.peakLiveGnats, Math.max(...first.runs.filter(run => run.profile === row.profile).map(run => run.peakLiveGnats)));
    assert.ok(Object.hasOwn(row.phaseMetrics, 'ace'));
    assert.ok(row.phaseMetrics.coast.reachedRuns <= row.samples);
    assert.ok(row.firstXpGainSeconds.observedRuns <= row.samples);
    assert.ok(row.firstDraftSeconds.observedRuns <= row.samples);
    assert.ok(row.firstLevelUpSeconds.observedRuns <= row.samples);
    assert.ok(row.levelUpsAt60Seconds.observedRuns <= row.samples);
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

test('skilled pilots parry same-band approaches more often than average and weak pilots', () => {
  const attempts = profile => {
    let rolls = 0, parries = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const stage = createStage(parseStageOptions(`?mode=survivors&autoplay=1&seed=${seed}`));
      stage.tick = 1;
      const { x, z, altitude } = stage.player;
      fireHostile(stage, { x, z: z + 14, alt: altitude }, 90);
      const input = createBot(profile, seed)(stage);
      if (input.roll) rolls++;
      if (input.roll && input.rollTurn === 0) parries++;
      stage.shots[0].alt += 35;
      assert.ok(!createBot(profile, seed)(stage).roll, 'an off-band pass does not warrant a roll');
    }
    return { rolls, parries };
  };
  const skilled = attempts('skilled'), average = attempts('average'), weak = attempts('weak');
  assert.ok(skilled.rolls > average.rolls && average.rolls >= weak.rolls);
  assert.ok(skilled.parries > average.parries && skilled.parries > weak.parries);
});
