import test from 'node:test';
import assert from 'node:assert/strict';
import * as flight from '../src/flight.ts';
import { inBand } from '../src/stage-combat.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const STEP = 1 / 60;

function steer(state, turn, boosting = false) {
  const drive = flight.advanceBankDrive(state.drive, turn, STEP);
  const bank = flight.advanceBank(state.bank, turn, STEP, drive);
  const drop = flight.advanceBankDrop(state.drop, bank, STEP);
  const yaw = state.yaw + flight.bankYawRate(bank, turn, boosting) * STEP;
  return { drive, bank, drop, yaw };
}

const level = { drive: 0, bank: 0, drop: 0, yaw: 0 };

test('sustained and stronger stick input builds more bank within the roll rate and soft cap', () => {
  let right = level;
  let left = level;
  let half = level;
  for (let tick = 1; tick <= 240; tick++) {
    const next = steer(right, 1);
    assert.ok(next.drive >= right.drive && next.drive <= 1);
    assert.ok(next.bank >= right.bank && next.bank - right.bank <= 2.2 * STEP);
    assert.ok(next.bank <= 1.55);
    left = steer(left, -1);
    assert.equal(left.drive, -next.drive);
    assert.equal(left.bank, -next.bank);
    assert.equal(left.yaw, -next.yaw);
    half = steer(half, 0.5);
    assert.ok(half.bank <= next.bank);
    if (tick === 12) assert.ok(half.bank < next.bank && next.bank < 0.65);
    if (tick === 72) assert.ok(next.bank > 1.35);
    right = next;
  }
  assert.ok(right.bank >= 1.45);
  assert.ok(half.bank < 0.65);
  assert.deepEqual(steer(right, 2), steer(right, 1));
});

test('neutral stick eases the roll out and opposite stick reverses it without a snap', () => {
  let hardTurn = level;
  for (let tick = 0; tick < 120; tick++) hardTurn = steer(hardTurn, 1);

  let released = hardTurn;
  let reversed = hardTurn;
  const initialRelease = released.bank - steer(released, 0).bank;
  for (let tick = 0; tick < 120; tick++) {
    const nextRelease = steer(released, 0);
    const nextReverse = steer(reversed, -1);
    assert.ok(nextRelease.bank >= 0 && released.bank > nextRelease.bank);
    assert.ok(released.bank - nextRelease.bank <= 1.8 * STEP);
    assert.equal(nextRelease.yaw, hardTurn.yaw);
    assert.ok(nextReverse.bank < reversed.bank && reversed.bank - nextReverse.bank <= 2.2 * STEP);
    assert.ok(nextReverse.yaw < reversed.yaw);
    reversed = nextReverse;
    released = nextRelease;
  }
  assert.ok(released.bank < 0.002);
  assert.ok(released.bank - steer(released, 0).bank < initialRelease / 10);
  assert.ok(reversed.bank < -1.45);
  assert.equal(flight.advanceBank(hardTurn.bank, -1, 0, -1), hardTurn.bank);
});

test('aligned bank progressively tightens turns while shallow inputs retain fine yaw control', () => {
  const banks = [0, 0.25, 0.65, Math.PI / 3, 80 * Math.PI / 180, 1.5];
  const rates = banks.map(bank => flight.bankYawRate(bank, 1, false));
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] > rates[i - 1]);
  assert.ok(rates[4] >= flight.TURN_RATE * 1.2 && rates[4] <= flight.TURN_RATE * 1.35);
  assert.equal(flight.bankYawRate(1.5, 0, false), 0);
  assert.equal(flight.bankYawRate(-1.5, 1, false), rates[0]);
  const boostGain = flight.bankYawRate(1.5, 1, true) / rates.at(-1);
  assert.ok(Math.abs(boostGain - flight.BOOST_TURN_RATE / flight.TURN_RATE) < 1e-12);

  const fineTurn = 0.1;
  const fine = steer(level, fineTurn);
  assert.ok(fine.bank > 0 && fine.bank < 0.02);
  const fineGain = fine.yaw / (fineTurn * flight.TURN_RATE * STEP);
  assert.ok(fineGain > 0.9 && fineGain < 1.1);
});

test('full-stick 180s stay within ten percent of the baseline at cruise and boost', () => {
  for (const boosting of [false, true]) {
    const rate = boosting ? flight.BOOST_TURN_RATE : flight.TURN_RATE;
    const baselineTicks = Math.ceil(Math.PI / (rate * STEP));
    for (const turn of [-1, 1]) {
      let flightState = level;
      let ticks = 0;
      while (Math.abs(flightState.yaw) < Math.PI && ticks <= baselineTicks * 1.1) {
        flightState = steer(flightState, turn, boosting);
        ticks++;
      }
      assert.ok(Math.abs(flightState.yaw) >= Math.PI);
      assert.ok(Math.abs(ticks / baselineTicks - 1) <= 0.1,
        `${ticks} ticks vs. the ${baselineTicks}-tick baseline`);
    }
  }
});

test('bank over 60 degrees lowers altitude gradually and the offset recovers on roll-out', () => {
  assert.equal(flight.advanceBankDrop(0, Math.PI / 3, STEP), 0);
  let state = level;
  for (let tick = 0; tick < 240; tick++) {
    const next = steer(state, 1);
    assert.ok(next.drop >= state.drop && next.drop - state.drop < 12 * STEP);
    assert.ok(next.drop <= 6);
    assert.equal(flight.advanceBankDrop(state.drop, -next.bank, STEP), next.drop);
    state = next;
  }
  assert.ok(state.drop >= 4);

  for (let tick = 0; tick < 60; tick++) {
    const next = steer(state, 0);
    assert.ok(next.drop >= 0 && next.drop <= state.drop);
    assert.ok(state.drop - next.drop < 14 * STEP);
    state = next;
  }
  assert.equal(state.drop, 0);
});

test('fixed-step flight banks and turns while remaining in its altitude band', () => {
  const ground = () => 35;
  const options = parseStageOptions('?t=0&seed=23');
  const replay = () => {
    const stage = createStage(options, ground);
    const initialAltitude = stage.player.altitude;
    let unwrappedYaw = 0;
    let ticksToHalfTurn = 0;
    for (let tick = 1; tick <= 180; tick++) {
      const yaw = stage.player.yaw;
      stepStage(stage, { turn: 1 }, ground);
      const delta = stage.player.yaw - yaw;
      unwrappedYaw += Math.atan2(Math.sin(delta), Math.cos(delta));
      if (!ticksToHalfTurn && unwrappedYaw >= Math.PI) ticksToHalfTurn = tick;
    }
    const baselineTicks = Math.ceil(Math.PI / (flight.TURN_RATE * STEP));
    assert.ok(ticksToHalfTurn && Math.abs(ticksToHalfTurn / baselineTicks - 1) <= 0.1);
    assert.ok(stage.player.bank >= 1.45);
    const drop = initialAltitude - stage.player.altitude;
    assert.ok(drop >= 4 && drop <= 6);
    assert.ok(inBand(stage.player.altitude, initialAltitude));
    const turnedYaw = stage.player.yaw;
    for (let tick = 0; tick < 60; tick++) stepStage(stage, {}, ground);
    assert.ok(Math.abs(stage.player.yaw - turnedYaw) < 1e-12);
    assert.equal(stage.player.altitude, initialAltitude);
    return stage;
  };
  assert.deepEqual(replay(), replay());
});

test('steep bank at terrain clearance does not store altitude to recover on release', () => {
  const ground = () => 88;
  const stage = createStage(parseStageOptions('?t=0'), ground);
  const floor = stage.player.altitude;
  for (let tick = 0; tick < 180; tick++) stepStage(stage, { turn: 1 }, ground);
  assert.ok(stage.player.bank >= 1.45);
  assert.equal(stage.player.altitude, floor);
  for (let tick = 0; tick < 60; tick++) stepStage(stage, {}, ground);
  assert.equal(stage.player.altitude, floor);
});
