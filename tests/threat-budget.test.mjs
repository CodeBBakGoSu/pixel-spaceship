import assert from 'node:assert/strict';
import test from 'node:test';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { threatBudgetAt, trySpendThreat } from '../src/threat-budget.ts';
import { HOSTILE_BOLT_LIFE } from '../src/data/hostile-fire.ts';

const stage = mode => createStage(parseStageOptions(`?mode=${mode}&t=0`), () => 35);

test('threat budget grows through minute seven and caps afterward', () => {
  assert.equal(threatBudgetAt(0), 4);
  assert.equal(threatBudgetAt(60 * 60), 4 * 1.15);
  assert.equal(threatBudgetAt(7 * 60 * 60), 4 * 1.15 ** 7);
  assert.equal(threatBudgetAt(8 * 60 * 60), threatBudgetAt(7 * 60 * 60));
});

test('denied volleys do not become debt and accepted directions leave an escape sector', () => {
  const state = stage('survivors');
  assert.equal(trySpendThreat(state, { tick: 60, source: 'regular:1', points: 2, bearing: 0 }), true);
  assert.equal(trySpendThreat(state, { tick: 90, source: 'escort:2', points: 2, bearing: 0 }), true);
  assert.equal(trySpendThreat(state, { tick: 120, source: 'ace', points: 1, bearing: 0 }), false);
  assert.equal(state.threatBudget.spends.length, 2);

  state.threatBudget.spends = [];
  const late = 8 * 60 * 60;
  assert.equal(trySpendThreat(state, { tick: late, source: 'regular:3', points: 1, bearing: 0 }), true);
  assert.equal(trySpendThreat(state, { tick: late + 30, source: 'escort:4', points: 1, bearing: Math.PI / 2 }), true);
  assert.equal(trySpendThreat(state, { tick: late + 60, source: 'midboss:test', points: 1, bearing: Math.PI }), false);
  assert.equal(state.threatBudget.spends.length, 2);
  assert.equal(trySpendThreat(stage('legacy'), { tick: 0, source: 'legacy', points: 2, bearing: 0 }), true);
});

test('future threat reservations use full overlapping danger intervals in either request order', () => {
  const state = stage('survivors');
  assert.equal(trySpendThreat(state, {
    tick: 120, activeFromTick: 60, activeUntilTick: 360, source: 'charge:1', points: 1, bearing: 0,
  }), true);
  assert.equal(trySpendThreat(state, {
    tick: 240, activeFromTick: 180, activeUntilTick: 420, source: 'charge:2', points: 1, bearing: Math.PI / 2,
  }), true);
  assert.equal(trySpendThreat(state, {
    tick: 300, activeFromTick: 250, activeUntilTick: 400, source: 'charge:3', points: 1, bearing: Math.PI,
  }), false);
  assert.equal(state.threatBudget.spends.length, 2);
});

test('default direction reservation lasts through a standard projectile lifetime', () => {
  const state = stage('survivors');
  assert.equal(trySpendThreat(state, { tick: 60, source: 'regular:1', points: 1, bearing: 0 }), true);
  assert.equal(state.threatBudget.spends[0].activeUntilTick, 60 + HOSTILE_BOLT_LIFE * 60);
});
