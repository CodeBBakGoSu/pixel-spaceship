import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBank } from '../src/flight.ts';

test('steering banks the ship smoothly and releasing the turn levels it', () => {
  const first = advanceBank(0, 1, 1 / 60);
  assert.ok(first > 0 && first < 0.65);
  let bank = first;
  for (let i = 0; i < 60; i++) bank = advanceBank(bank, 1, 1 / 60);
  assert.ok(bank > 0.6 && bank <= 0.65);
  assert.ok(advanceBank(bank, 0, 1 / 60) < bank);
});
