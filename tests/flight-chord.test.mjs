import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionDueAt, barrelRollForKey, FlightChord, ROLL_CHORD_MS, simulationStepTime, takeActionAtTick,
} from '../src/flight-chord.ts';

test('Space while either Shift is held rolls immediately and never queues a reversal', () => {
  const chord = new FlightChord();
  assert.deepEqual(chord.pressSpace(100, true), { action: 'roll', at: 100 });
  assert.equal(chord.flush(100 + ROLL_CHORD_MS + 1), undefined);
});

test('Shift catches Space in either order within the chord window', () => {
  const chord = new FlightChord();
  assert.equal(chord.pressSpace(100, false), undefined);
  assert.equal(chord.flush(100 + ROLL_CHORD_MS - 1), undefined);
  assert.deepEqual(chord.pressShift(100 + ROLL_CHORD_MS), { action: 'roll', at: 100 + ROLL_CHORD_MS });
  assert.equal(chord.flush(300), undefined);
});

test('Space alone queues one reversal and late Shift keeps that choice', () => {
  const chord = new FlightChord();
  chord.pressSpace(10, false);
  assert.deepEqual(chord.pressShift(11 + ROLL_CHORD_MS), { action: 'reversal', at: 11 + ROLL_CHORD_MS });
  assert.equal(chord.flush(500), undefined);
  chord.pressSpace(500, false);
  assert.deepEqual(chord.flush(500 + ROLL_CHORD_MS), { action: 'reversal', at: 500 + ROLL_CHORD_MS });
  assert.equal(chord.flush(900), undefined);
});

test('Shift resolves a pending Space as a roll in either order', () => {
  const chord = new FlightChord();
  assert.deepEqual(chord.pressSpace(100, true), { action: 'roll', at: 100 });
  assert.equal(chord.flush(100 + ROLL_CHORD_MS), undefined);

  assert.equal(chord.pressSpace(200, false), undefined);
  assert.equal(chord.flush(200 + ROLL_CHORD_MS - 1), undefined);
  assert.deepEqual(chord.pressShift(200 + ROLL_CHORD_MS - 1), { action: 'roll', at: 200 + ROLL_CHORD_MS - 1 });
});

test('a between-frame C press waits for its corresponding catch-up tick', () => {
  const frameTime = 2100, step = 1 / 60;
  let carry = 4 * step;
  const tickTimes = [];
  while (carry >= step) {
    tickTimes.push(simulationStepTime(frameTime, carry, step));
    carry -= step;
  }
  const cueAt = tickTimes[2];
  const pressAt = cueAt + 5;
  let pending = { action: barrelRollForKey('KeyC', 0), at: pressAt };
  const pendingSpace = { action: { kind: 'reversal', turn: -1 }, at: pressAt };
  const applied = [];

  assert.equal(actionDueAt(pending, cueAt), false, 'the event does not affect earlier catch-up ticks');
  assert.equal(actionDueAt(pendingSpace, cueAt), false, 'pending defense grace does not precede its Space event');
  assert.equal(actionDueAt(pendingSpace, tickTimes[3]), true);
  for (const tickTime of tickTimes) {
    const consumed = takeActionAtTick(pending, tickTime);
    if (consumed.action !== undefined) applied.push({ action: consumed.action, at: tickTime });
    pending = consumed.pending;
  }
  assert.deepEqual(applied, [{ action: 1, at: frameTime }], 'C is consumed at the first tick boundary after the event');
  assert.equal(pending, undefined, 'the event is consumed exactly once');
});

test('Shift+Space and delayed W/S+Space actions keep their arbitration resolution timestamps', () => {
  const chord = new FlightChord();
  const spaceAt = 2000;
  assert.equal(chord.pressSpace(spaceAt, false), undefined);
  const shiftAt = spaceAt + 24;
  const roll = chord.pressShift(shiftAt);
  assert.deepEqual(roll, { action: 'roll', at: shiftAt });
  assert.equal(actionDueAt(roll, shiftAt - 1), false);
  assert.equal(actionDueAt(roll, shiftAt), true);

  chord.pressSpace(3000, false);
  const deadline = 3000 + ROLL_CHORD_MS;
  assert.deepEqual(chord.flush(deadline + 20), { action: 'reversal', at: deadline });
});

test('closing flight controls cancels an unresolved gesture', () => {
  const chord = new FlightChord();
  chord.pressSpace(20, false);
  chord.reset();
  assert.equal(chord.pressShift(25), undefined);
  assert.equal(chord.flush(200), undefined);
});

test('only C requests a dedicated barrel roll, even with the stick centered', () => {
  assert.equal(barrelRollForKey('KeyC', 0), 1);
  assert.equal(barrelRollForKey('KeyC', 0, -1), -1);
  assert.equal(barrelRollForKey('KeyC', 1, -1), 1);
  assert.equal(barrelRollForKey('KeyC', -1, 1), -1);
  for (const key of ['KeyX', 'KeyK', 'Space', 'ShiftLeft']) assert.equal(barrelRollForKey(key, 1), undefined);
});

test('C follows weak current mouse steering opposite the remembered direction', () => {
  for (const turn of [-0.15, -0.18, -0.20]) {
    assert.equal(barrelRollForKey('KeyC', turn, 1), -1);
  }
});
