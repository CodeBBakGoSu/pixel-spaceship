import test from 'node:test';
import assert from 'node:assert/strict';
import { barrelRollForKey, FlightChord, ROLL_CHORD_MS } from '../src/flight-chord.ts';

test('Space while either Shift is held rolls immediately and never queues a reversal', () => {
  const chord = new FlightChord();
  assert.equal(chord.pressSpace(100, true), 'roll');
  assert.equal(chord.flush(100 + ROLL_CHORD_MS + 1), undefined);
});

test('Shift catches Space in either order within the chord window', () => {
  const chord = new FlightChord();
  assert.equal(chord.pressSpace(100, false), undefined);
  assert.equal(chord.flush(100 + ROLL_CHORD_MS - 1), undefined);
  assert.equal(chord.pressShift(100 + ROLL_CHORD_MS), 'roll');
  assert.equal(chord.flush(300), undefined);
});

test('Space alone queues one reversal and late Shift keeps that choice', () => {
  const chord = new FlightChord();
  chord.pressSpace(10, false);
  assert.equal(chord.pressShift(11 + ROLL_CHORD_MS), 'reversal');
  assert.equal(chord.flush(500), undefined);
  chord.pressSpace(500, false);
  assert.equal(chord.flush(500 + ROLL_CHORD_MS), 'reversal');
  assert.equal(chord.flush(900), undefined);
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
  for (const turn of [-0.15, -0.18, -0.2]) {
    assert.equal(barrelRollForKey('KeyC', turn, 1), turn);
  }
});
