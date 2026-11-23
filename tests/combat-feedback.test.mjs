import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DamageFeedback, batchBursts, observeDamage, reportDamage } from '../src/combat-feedback.ts';
import { COMBAT_FEEDBACK as C } from '../src/data/combat-feedback.ts';

const target = { x: 1, z: 2, alt: 100 };
test('damage pool caps new records per frame, merges, expires and reuses slots', () => {
  const pool = new DamageFeedback(), first = pool.slots[0];
  assert.equal(pool.slots.filter(s => s.born > -Infinity).length, 0);
  for (let i = 0; i < C.perFrame; i++) assert.equal(pool.hit(i, 1, false, target, 0), true);
  assert.equal(pool.hit(999, 1, false, target, 0), false);
  assert.equal(pool.hit(0, 10, true, target, 0.05), true);
  assert.equal(first.damage, 11); assert.equal(first.big, true);
  assert.equal(pool.hit(0, NaN, false, target, 0), false);
  assert.equal(pool.hit(0, -1, false, target, 0), false);
  pool.beginFrame(); pool.hit(999, 2, false, target, 2);
  assert.equal(pool.slots[0], first); assert.equal(first.id, 999);
});
test('pool stays bounded when every slot is live', () => {
  const pool = new DamageFeedback();
  for (let i = 0; i < C.poolSize; i++) { pool.beginFrame(); pool.hit(i, 1, false, target, 0); }
  pool.beginFrame(); assert.equal(pool.hit(999, 1, false, target, 0), false);
  pool.clear(); assert.equal(pool.hit(999, 1, false, target, 0), true);
});
test('rolling kill counter expires at five seconds and resets on a new run', () => {
  const pool = new DamageFeedback();
  assert.equal(pool.count(0, 0), 0);
  assert.equal(pool.count(12, 1), 12);
  assert.equal(pool.count(14, 2), 14);
  assert.equal(pool.count(14, 5.99), 14);
  assert.equal(pool.count(14, 6), 2);
  assert.equal(pool.count(14, 7), 0);
  assert.equal(pool.count(0, 0), 0);
  assert.equal(pool.count(3, 0.5), 3);
});
test('batching combines only gnats, leaves small and empty groups alone', () => {
  const out = { ...target, life: 0, count: 0 };
  assert.equal(batchBursts([], () => true, out), false);
  assert.equal(batchBursts([{ ...target, life: .4 }], () => true, out), false);
  const effects = Array.from({ length: C.batchThreshold }, () => ({ ...target, life: .4 }));
  effects.push({ x: 999, z: 999, alt: 999, life: 1 });
  assert.equal(batchBursts(effects, e => e.x !== 999, out), true);
  assert.equal(out.count, C.batchThreshold); assert.equal(out.x, 1); assert.equal(out.life, .4);
});
test('damage observers are external to serialized state', () => {
  const state = {}, before = JSON.stringify(state); let observed;
  reportDamage(state, 1, 2, false, target);
  observeDamage(state, (...args) => { observed = args; });
  reportDamage(state, 1, 2, true, target);
  assert.deepEqual(observed, [1, 2, true, target]); assert.equal(JSON.stringify(state), before);
});
