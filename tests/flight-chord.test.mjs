import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionDueAt, barrelRollForKey, enqueueTimedAction, FlightChord, ROLL_CHORD_MS, simulationStepTime,
  takeNextActionAtTick,
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
  assert.deepEqual(chord.pressShift(11 + ROLL_CHORD_MS), { action: 'reversal', at: 10 + ROLL_CHORD_MS });
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
  let pending = enqueueTimedAction([], { action: barrelRollForKey('KeyC', 0), at: pressAt });
  const pendingSpace = { action: { kind: 'reversal', turn: -1 }, at: pressAt };
  const applied = [];

  assert.equal(actionDueAt(pending[0], cueAt), false, 'the event does not affect earlier catch-up ticks');
  assert.equal(actionDueAt(pendingSpace, cueAt), false, 'pending defense grace does not precede its Space event');
  assert.equal(actionDueAt(pendingSpace, tickTimes[3]), true);
  for (const tickTime of tickTimes) {
    const consumed = takeNextActionAtTick(pending, tickTime);
    if (consumed.action !== undefined) applied.push({ action: consumed.action.action, at: tickTime });
    pending = consumed.pending;
  }
  assert.deepEqual(applied, [{ action: 1, at: frameTime }], 'C is consumed at the first tick boundary after the event');
  assert.deepEqual(pending, [], 'the event is consumed exactly once');
});

test('simultaneously caught-up inputs are consumed in timestamp order', () => {
  let pending = enqueueTimedAction([], { action: 'earlier reversal', at: 1079 });
  pending = enqueueTimedAction(pending, { action: 'later C roll', at: 1090 });

  const first = takeNextActionAtTick(pending, 1100);
  assert.deepEqual(first.action, { action: 'earlier reversal', at: 1079 });
  const second = takeNextActionAtTick(first.pending, 1100);
  assert.deepEqual(second.action, { action: 'later C roll', at: 1090 });
  assert.deepEqual(second.pending, []);
});

test('C after an expired Space chord queues the deadline reversal first', () => {
  const chord = new FlightChord();
  assert.equal(chord.pressSpace(999, false), undefined);
  const reversal = chord.flush(1095);
  assert.deepEqual(reversal, { action: 'reversal', at: 999 + ROLL_CHORD_MS });

  let pending = enqueueTimedAction([], reversal);
  pending = enqueueTimedAction(pending, { action: 'C roll', at: 1095 });
  const first = takeNextActionAtTick(pending, 1100);
  assert.equal(first.action?.action, 'reversal');
  const second = takeNextActionAtTick(first.pending, 1100);
  assert.equal(second.action?.action, 'C roll');
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
