import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBank, rollAngle } from '../src/flight.ts';

test('a roll eases in and out instead of snapping to full speed', () => {
  assert.equal(rollAngle(0), 0);
  assert.ok(rollAngle(0.95) < 0.05);
  assert.ok(Math.abs(rollAngle(0.5) - Math.PI) < 0.001);
  assert.ok(Math.PI * 2 - rollAngle(0.05) < 0.05);
});

test('steering banks the ship smoothly and releasing the turn levels it', () => {
  const first = advanceBank(0, 1, 1 / 60);
  assert.ok(first > 0 && first < 0.65);
  let bank = first;
  for (let i = 0; i < 60; i++) bank = advanceBank(bank, 1, 1 / 60);
  assert.ok(bank > 0.6 && bank <= 0.65);
  assert.ok(advanceBank(bank, 0, 1 / 60) < bank);
});
