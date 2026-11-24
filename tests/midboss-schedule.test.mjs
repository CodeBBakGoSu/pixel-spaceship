import assert from 'node:assert/strict';
import test from 'node:test';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { consumeMidbossCue, finishMidbossEncounter, midbossSpawnsBlocked } from '../src/midboss-schedule.ts';

const stage = () => createStage(parseStageOptions('?mode=survivors&t=0'), () => 35);

test('midboss cues use combat ticks and rest starts from the returned end tick', () => {
  const state = stage();
  state.tick = 205 * TICKS_PER_SECOND;
  const first = consumeMidbossCue(state);
  assert.deepEqual(first, {
    id: 'armored-transport', kind: 'midboss', startTick: 205 * TICKS_PER_SECOND,
    maxDurationTicks: 30 * TICKS_PER_SECOND, threatSource: 'midboss:armored-transport',
  });
  assert.equal(midbossSpawnsBlocked(state), true);
  state.tick += 17 * TICKS_PER_SECOND;
  assert.deepEqual(finishMidbossEncounter(state, { id: first.id, endedAt: state.tick, outcome: 'defeated' }), {
    id: first.id, endedAt: state.tick, outcome: 'defeated',
  });
  assert.equal(state.midbossSchedule.restUntil, state.tick + 15 * TICKS_PER_SECOND);
  assert.equal(midbossSpawnsBlocked(state), true);
  state.tick = state.midbossSchedule.restUntil;
  assert.equal(midbossSpawnsBlocked(state), false);

  state.tick = 400 * TICKS_PER_SECOND;
  const second = consumeMidbossCue(state);
  assert.equal(second?.id, 'escort-commander');
  assert.equal(second?.threatSource, 'midboss:escort-commander');
});

test('an end result outside the cue or actual state tick is rejected', () => {
  const state = stage();
  state.tick = 205 * TICKS_PER_SECOND;
  const cue = consumeMidbossCue(state);
  assert.equal(finishMidbossEncounter(state, { id: cue.id, endedAt: state.tick + 1, outcome: 'escaped' }), null);
  state.tick = cue.startTick + cue.maxDurationTicks + 1;
  assert.equal(finishMidbossEncounter(state, { id: cue.id, endedAt: state.tick, outcome: 'escaped' }), null);
});
