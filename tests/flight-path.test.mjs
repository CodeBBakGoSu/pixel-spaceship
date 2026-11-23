import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

// Keep SKIM below the 55 m floor unless a test supplies its own terrain.
const lowGround = () => 0;
const start = (ground = lowGround) => createStage(parseStageOptions('?t=0&seed=23'), ground);
const radians = degrees => degrees * Math.PI / 180;

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('full stick builds the climb and dive angles over 0.35 s and levels on release', () => {
  for (const [climb, target] of [[1, radians(32)], [-1, radians(-38)]]) {
    const state = start();
    assert.equal(state.player.pitch, 0);
    for (let tick = 1; tick <= 42; tick++) {
      const previous = state.player.pitch;
      stepStage(state, { climb }, lowGround);
      const change = climb * (state.player.pitch - previous);
      assert.ok(change > 0 && change <= 1.8 / 60 + 1e-12);
      if (tick === 1) close(change, 1.8 / 60);
      if (tick === 21) assert.ok(state.player.pitch / target > 0.85 && state.player.pitch / target < 0.92);
    }
    assert.ok(state.player.pitch / target > 0.99 && state.player.pitch / target <= 1);
    stepStage(state, {}, lowGround);
    assert.ok(state.player.pitch / target > 0.9);
    assert.ok(climb * state.climbRate > 0);
    for (let tick = 0; tick < 60; tick++) stepStage(state, {}, lowGround);
    assert.ok(Math.abs(state.player.pitch) < 0.001);
  }
});

test('small pitch commands follow the exponential response before the rate limit binds', () => {
  const state = start();
  for (let tick = 1; tick <= 12; tick++) {
    stepStage(state, { climb: 0.2 }, lowGround);
    close(state.player.pitch, radians(6.4) * (1 - Math.exp(-8 * tick / 60)));
  }
});

test('climb and dive change cruise speed in proportion to the sine of the held angle', () => {
  for (const [climb, maxAngle, energy] of [[1, 32, -0.10], [-1, -38, 0.12]]) {
    for (const fraction of [0.5, 1]) {
      const state = start();
      const angle = radians(maxAngle) * fraction;
      state.player.pitch = angle;
      const { altitude, z } = state.player;
      stepStage(state, { climb: climb * fraction }, lowGround);
      const speed = 104 * (1 + energy * Math.sin(angle) / Math.sin(radians(maxAngle)));
      close(state.speed, speed);
      close((state.player.z - z) * 60, speed);
      close(state.climbRate, Math.min(70, Math.max(-70, speed * Math.sin(angle))));
      close(state.player.altitude, altitude + state.climbRate / 60);
    }
  }
});

test('boosted vertical speed caps at 70 m/s in both directions even with Vector Thrusters', () => {
  for (const [climb, angle] of [[1, 32], [-1, -38]]) {
    for (const level of [0, 3]) {
      const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), lowGround);
      state.run.buffLevels['vector-thrusters'] = level;
      state.player.pitch = radians(angle);
      stepStage(state, { climb, boost: true }, lowGround);
      close(state.climbRate, climb * 70);
    }
  }
});

test('Vector Thrusters multiply uncapped vertical speed', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), lowGround);
  state.run.buffLevels['vector-thrusters'] = 3;
  state.player.pitch = radians(16);
  stepStage(state, { climb: 0.5 }, lowGround);
  close(state.climbRate, state.speed * Math.sin(radians(16)) * 1.25);
});

test('the ceiling, minimum altitude and terrain floor progressively reduce inward speed and pitch', () => {
  for (const [ground, limit, climb, angle] of [
    [lowGround, 230, 1, 32],
    // A light dive stays below the SKIM command threshold over the sea floor and raised terrain.
    [lowGround, 49, -0.1, -3.8],
    [() => 78, 92, -0.1, -3.8],
  ]) {
    const direction = Math.sign(climb);
    const samples = [13, 7, 2].map(distance => {
      const state = start(ground);
      state.player.altitude = limit - direction * distance;
      state.player.pitch = radians(angle);
      stepStage(state, { climb }, ground);
      assert.ok(direction * (limit - state.player.altitude) > 0);
      assert.equal(state.player.skim, undefined);
      return { rate: direction * state.climbRate, pitch: direction * state.player.pitch };
    });
    const [outside, middle, near] = samples;
    close(outside.pitch, direction * radians(angle));
    assert.ok(outside.rate > middle.rate && middle.rate > near.rate && near.rate > 0);
    assert.ok(near.pitch >= 0 && near.pitch < outside.pitch);

    const away = start(ground);
    const awayPitch = radians(direction > 0 ? -38 : 32);
    away.player.altitude = limit - direction * 2;
    away.player.pitch = awayPitch;
    stepStage(away, { climb: -direction }, ground);
    close(away.player.pitch, awayPitch);
    close(away.climbRate, Math.max(-70, Math.min(70, away.speed * Math.sin(awayPitch))));
  }
});

test('the terrain hard stop preserves clearance when the ground rises within one tick', () => {
  const state = start();
  const startZ = state.player.z;
  const ridge = (_x, z) => z > startZ + 1 ? 115 : 0;
  state.player.pitch = radians(-15);
  stepStage(state, {}, ridge);
  close(state.player.altitude, 129);
});

test('bank sink is added to the measured altitude change independently of flight-path pitch', () => {
  const state = start();
  Object.assign(state.player, { bank: 1.5, bankDrive: 1, pitch: radians(16) });
  const altitude = state.player.altitude;
  stepStage(state, { turn: 1, climb: 0.5 }, lowGround);
  close(state.player.pitch, radians(16));
  assert.ok(state.player.bankDrop > 0);
  close(state.player.altitude + state.player.bankDrop, altitude + state.speed * Math.sin(radians(16)) / 60);
  close(state.climbRate, (state.player.altitude - altitude) * 60);
});

test('rolls and uncontrolled maneuvers clear pitch and use their own altitude and speed', () => {
  for (const input of [{ roll: true }, { maneuver: 'immelmann' }, { maneuver: 'split-s' }, { maneuver: 'j-turn' }]) {
    const pitched = start(), level = start();
    pitched.player.pitch = radians(32);
    for (let tick = 0; tick < 10; tick++) {
      const command = { ...(tick === 0 ? input : {}), climb: 1 };
      stepStage(pitched, command, lowGround);
      stepStage(level, command, lowGround);
      assert.ok(pitched.roll || pitched.maneuver);
      assert.equal(pitched.player.pitch, 0);
      assert.equal(pitched.speed, level.speed);
      assert.equal(pitched.player.altitude, level.player.altitude);
    }
  }
});

test('the controlled inverted segment accepts pitch input while retaining maneuver airspeed', () => {
  const state = start();
  stepStage(state, { maneuver: 'immelmann' }, lowGround);
  for (let tick = 1; tick < 78; tick++) stepStage(state, {}, lowGround);
  const altitude = state.player.altitude;
  for (let tick = 0; tick < 12; tick++) stepStage(state, { climb: -0.5 }, lowGround);
  assert.equal(state.maneuver.kind, 'immelmann');
  assert.ok(state.player.pitch < 0 && state.player.altitude < altitude);
  assert.equal(state.speed, 104);
});

test('a held dive still enters SKIM and drops its pitch before the next climb', () => {
  const ground = () => 35;
  const state = start(ground);
  state.player.altitude = 70;
  state.player.pitch = radians(-38);
  for (let tick = 0; tick < 60 && !state.player.skim; tick++) stepStage(state, { climb: -1 }, ground);
  assert.ok(state.player.skim);
  assert.equal(state.player.pitch, 0);
  stepStage(state, { climb: -1 }, ground);
  assert.equal(state.speed, 104);
  assert.equal(state.player.altitude, 49);
  for (let tick = 0; tick < 20; tick++) stepStage(state, { climb: 1 }, ground);
  assert.equal(state.player.skim, undefined);
  assert.ok(state.player.pitch > 0 && state.player.altitude > 49);
});

test('flares inherit the measured climb or dive rate while rear bombs hold their launch altitude', () => {
  for (const [climb, angle] of [[1, 32], [-1, -38], [0.1, 0], [0, 0]]) {
    const state = createStage(parseStageOptions('?t=0&mode=survivors'), lowGround);
    Object.assign(state.run.weaponLevels, { phoenix: 1, 'bomb-bay': 1 });
    state.player.pitch = radians(angle);
    const altitude = state.player.altitude;
    stepStage(state, { climb }, lowGround);
    const launchAltitude = state.player.altitude;
    const verticalSpeed = (launchAltitude - altitude) * 60;
    const flareRate = Math.min(-9, Math.max(-18, verticalSpeed * 0.2 - 10.5));
    assert.ok(state.flares.length > 0);
    for (const flare of state.flares) close(flare.vy, flareRate);
    stepStage(state, { climb }, lowGround);
    assert.equal(state.rearBombs[0].alt, launchAltitude);
  }
});
