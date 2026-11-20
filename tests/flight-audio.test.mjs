import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOST_IGNITION_SPEED, CRUISE_SPEED } from '../src/flight.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { hasCloseFlyby, mapFlightAudio } from '../src/flight-audio.ts';

test('engine tracks speed, wind grows quadratically and the afterburner follows eased boost', () => {
  const stopped = mapFlightAudio(0, 0, 0, 0, 80);
  const half = mapFlightAudio(BOOST_IGNITION_SPEED / 2, 0.5, 0, 0, 80);
  const full = mapFlightAudio(BOOST_IGNITION_SPEED, 1, 0, 0, 80);
  assert.ok(stopped.engineHz < half.engineHz && half.engineHz < full.engineHz);
  assert.ok(stopped.engineGain < half.engineGain && half.engineGain < full.engineGain);
  assert.equal(stopped.windGain, 0);
  assert.ok(full.windGain > 0);
  assert.equal(half.windGain * 4, full.windGain);
  assert.equal(stopped.afterburnerGain, 0);
  assert.equal(half.afterburnerGain * 2, full.afterburnerGain);
  assert.ok(full.afterburnerHz > half.afterburnerHz);
});

test('deep bank adds air rush and a dive or nearby terrain increases the hiss', () => {
  const steady = mapFlightAudio(52, 0, 0, 0, 80);
  const bank = mapFlightAudio(52, 0, -1.45, 0, 80);
  const dive = mapFlightAudio(52, 0, 0, -48, 80);
  const low = mapFlightAudio(52, 0, 0, 0, 25);
  assert.equal(steady.rushGain, 0);
  assert.ok(bank.rushGain > steady.rushGain);
  assert.equal(bank.rushGain, mapFlightAudio(52, 0, 1.45, 0, 80).rushGain);
  assert.ok(dive.rushGain > steady.rushGain && dive.rushHz > bank.rushHz);
  assert.ok(low.rushGain > steady.rushGain && low.rushHz > bank.rushHz);
  assert.equal(mapFlightAudio(52, 0, 0, 40, 45).rushGain, 0);
});

test('flight audio maps transient and out-of-range inputs to finite values using a reusable output', () => {
  const output = mapFlightAudio(52, 0, 0, 0, 80);
  assert.equal(mapFlightAudio(NaN, Infinity, -Infinity, NaN, NaN, output), output);
  assert.ok(Object.values(output).every(value => Number.isFinite(value) && value >= 0));
  const fast = mapFlightAudio(1000, 1, 0, 0, 80);
  const maximum = mapFlightAudio(BOOST_IGNITION_SPEED, 1, 0, 0, 80);
  assert.deepEqual(fast, maximum);
});

test('flyby follows relative motion crossing closest approach within the latest rendered tick', () => {
  const player = { x: 0, z: 0, altitude: 110, yaw: 0, vx: 0, vz: CRUISE_SPEED };
  const enemy = { x: scaleTravel(17), z: scaleTravel(-1), alt: 110, vx: 0, vz: scaleTravel(-48), hp: 2, kind: 'patrol' };
  const close = candidate => ({ player, speed: CRUISE_SPEED, enemies: [candidate] });
  assert.equal(hasCloseFlyby(close(enemy), 1), true);
  assert.equal(hasCloseFlyby(close(enemy), 0), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, z: scaleTravel(1) }), 1), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, z: scaleTravel(-3) }), 1), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, z: scaleTravel(-3) }), 2), true);
  assert.equal(hasCloseFlyby(close({ ...enemy, x: scaleTravel(44) }), 1), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, alt: 145 }), 1), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, vz: CRUISE_SPEED }), 1), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, kind: 'turret' }), 1), false);
  assert.equal(hasCloseFlyby(close({ ...enemy, hp: 0 }), 1), false);
});
