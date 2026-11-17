import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFlight, createFlight, initialView, startRoll } from '../src/flight.ts';

const flatGround = () => 20;
const neutral = { turn: 0, climb: 0, boost: false };

test('query string chooses a valid initial view and defaults to chase', () => {
  for (const view of ['overhead', 'chase', 'cockpit']) assert.equal(initialView(`?view=${view}`), view);
  assert.equal(initialView('?view=unknown'), 'chase');
  assert.equal(initialView(''), 'chase');
});

test('steering changes heading and climb changes altitude', () => {
  const ship = createFlight();
  const altitude = ship.altitude;
  advanceFlight(ship, { turn: 1, climb: 1, boost: false }, 0.05, flatGround);
  assert.ok(ship.yaw > 0);
  assert.ok(ship.altitude > altitude);
  assert.ok(ship.x > 0);
});

test('boost increases forward travel', () => {
  const slow = createFlight();
  const fast = createFlight();
  for (let i = 0; i < 60; i++) {
    advanceFlight(slow, neutral, 1 / 60, flatGround);
    advanceFlight(fast, { ...neutral, boost: true }, 1 / 60, flatGround);
  }
  assert.ok(fast.z > slow.z + 5);
});

test('frame time is bounded and the ship stays above terrain', () => {
  const stalled = createFlight();
  const bounded = createFlight();
  advanceFlight(stalled, neutral, 10, flatGround);
  advanceFlight(bounded, neutral, 0.05, flatGround);
  assert.equal(stalled.z, bounded.z);
  stalled.altitude = 0;
  advanceFlight(stalled, neutral, 0.05, flatGround);
  assert.ok(stalled.altitude >= 42);
});

test('roll starts once and finishes after its animation', () => {
  const ship = createFlight();
  startRoll(ship);
  assert.ok(ship.roll > 0);
  for (let i = 0; i < 30; i++) advanceFlight(ship, neutral, 0.05, flatGround);
  assert.equal(ship.roll, 0);
});

test('screenshot options preserve a stable bank and held boost only when requested', async () => {
  const { initialOptions } = await import('../src/flight.ts');
  assert.deepEqual(initialOptions('?view=overhead&roll=1&boost=1'), { view: 'overhead', bank: true, boost: true });
  assert.deepEqual(initialOptions('?roll=0&boost=yes'), { view: 'chase', bank: false, boost: false });
});

test('a roll eases in and out instead of snapping to full speed', async () => {
  const { rollAngle } = await import('../src/flight.ts');
  assert.equal(rollAngle(0), 0);
  assert.ok(rollAngle(0.95) < 0.05);
  assert.ok(Math.abs(rollAngle(0.5) - Math.PI) < 0.001);
  assert.ok(Math.PI * 2 - rollAngle(0.05) < 0.05);
});

test('the initial flight begins high enough to show the ground below', () => {
  assert.ok(createFlight().altitude >= 100);
});

test('steering banks the ship smoothly and releasing the turn levels it', async () => {
  const { advanceBank } = await import('../src/flight.ts');
  const first = advanceBank(0, 1, 1 / 60);
  assert.ok(first > 0 && first < 0.65);
  let bank = first;
  for (let i = 0; i < 60; i++) bank = advanceBank(bank, 1, 1 / 60);
  assert.ok(bank > 0.6 && bank <= 0.65);
  assert.ok(advanceBank(bank, 0, 1 / 60) < bank);
});
