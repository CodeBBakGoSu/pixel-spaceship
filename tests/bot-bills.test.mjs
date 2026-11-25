import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { createBot } from '../src/bot.ts';
import { billXpScale, finishBillTick, startBillTick } from '../src/bills.ts';
import { BILLS } from '../src/data/items.ts';
import { TICKS_PER_SECOND } from '../src/stage-combat.ts';

const ground = () => 35;

test('a bot that ignores a Bill does not remove it from Survivors state or suppress its expiry penalty', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=1'), ground);
  state.tick = BILLS[0].second * TICKS_PER_SECOND;
  startBillTick(state);
  const active = structuredClone(state.bills.active);
  assert.ok(active);

  createBot('weak', 1)(state, ground);
  assert.deepEqual(state.bills.active, active);

  state.tick = active.deadline;
  assert.deepEqual(finishBillTick(state), { definition: BILLS[0], paid: false });
  assert.equal(state.bills.interest, true);
  assert.equal(billXpScale(state), 0.75);
});
