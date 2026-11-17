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
