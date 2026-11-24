import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionDueAt, barrelRollForKey, consumesSpaceRequest, enqueueTimedAction, FlightChord,
  mapSimulationStepTimesToAudioTicks, ROLL_CHORD_MS, simulationStepTime, simulationStepTimesForFrame,
  takeDueActionsAtTick, takeNextActionAtTick,
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

test('capped 4fps step times use the accepted interval prefix and rebase each frame', () => {
  const step = 1 / 60;
  let anchor = 1000, carry = 0;
  for (let frame = 0; frame < 3; frame++) {
    const result = simulationStepTimesForFrame(anchor, 0.2, carry, step);
    assert.equal(result.times.length, 12);
    assert.ok(Math.abs(result.times[0] - (anchor + step * 1000)) < 1e-8);
    assert.ok(Math.abs(result.times.at(-1) - (anchor + 200)) < 1e-8);
    carry = result.carry;
    anchor += 250;
  }
  const pausedAt = 9000;
  const resumed = simulationStepTimesForFrame(pausedAt, 0, 0, step);
  assert.deepEqual(resumed.times, [], 'resetting carry on pause does not retain old frame timestamps');
  assert.deepEqual(takeDueActionsAtTick([], pausedAt), { actions: [], pending: [] });
});

test('rAF fallback keeps accepted step boundaries after the hitstop floor', () => {
  const step = 1 / 60, previousRaf = 1016.67, now = 1037, hitstopUntil = 1020;
  const elapsed = (now - previousRaf) / 1000;
  const acceptedElapsed = Math.min(elapsed, (now - hitstopUntil) / 1000);
  const result = simulationStepTimesForFrame(Math.max(previousRaf, hitstopUntil), acceptedElapsed, 0, step);
  assert.equal(result.times.length, 1);
  assert.ok(result.times[0] >= hitstopUntil);
});

test('4ms render cost does not make a 60Hz RAF timeline lose simulation steps', () => {
  const step = 1 / 60;
  let previousRaf = 0, previousRender = 0, carry = 0, renderCarry = 0, ticks = 0, renderTicks = 0;
  for (let frame = 1; frame <= 600; frame++) {
    const now = frame * 1000 / 60;
    const elapsed = (now - previousRaf) / 1000;
    const renderElapsed = Math.max(0, (now - previousRender) / 1000);
    previousRaf = now;
    const result = simulationStepTimesForFrame(previousRaf - elapsed * 1000, elapsed, carry, step);
    const renderResult = simulationStepTimesForFrame(previousRender, renderElapsed, renderCarry, step);
    ticks += result.times.length;
    renderTicks += renderResult.times.length;
    carry = result.carry;
    renderCarry = renderResult.carry;
    previousRender = now + 4;
  }
  assert.equal(ticks, 600);
  assert.equal(renderTicks, 456, 'replacing the RAF timestamp with its post-render time reproduces the regression');
});

test('90Hz, 144Hz, and 240Hz RAF timelines each retain 600 ticks over ten seconds', () => {
  const step = 1 / 60;
  for (const refreshRate of [90, 144, 240]) {
    let previousRaf = 0, carry = 0, ticks = 0;
    for (let frame = 1; frame <= refreshRate * 10; frame++) {
      const now = frame * 1000 / refreshRate;
      const elapsed = (now - previousRaf) / 1000;
      const result = simulationStepTimesForFrame(previousRaf, elapsed, carry, step);
      ticks += result.times.length;
      carry = result.carry;
      previousRaf = now;
    }
    assert.equal(ticks, 600, `${refreshRate}Hz`);
  }
});

test('all due inputs drain together, with future inputs retained for a later tick', () => {
  const pending = enqueueTimedAction(
    enqueueTimedAction([], { action: 'earlier maneuver', at: 1001 }),
    { action: 'C roll', at: 1002 },
  );
  const due = takeDueActionsAtTick(pending, 1005);
  assert.deepEqual(due.actions.map(input => input.action), ['earlier maneuver', 'C roll']);
  assert.deepEqual(due.pending, []);
  assert.deepEqual(takeDueActionsAtTick(enqueueTimedAction([], { action: 'future', at: 1006 }), 1005), {
    actions: [], pending: [{ action: 'future', at: 1006 }],
  });
});

test('only the action carrying the matching spaceAt consumes the pending Space request', () => {
  assert.equal(consumesSpaceRequest([{ kind: 'roll', turn: 1 }], 1190), false);
  assert.equal(consumesSpaceRequest([{ kind: 'roll', turn: 1, spaceAt: 1180 }], 1190), false);
  assert.equal(consumesSpaceRequest([{ kind: 'roll', turn: 1, spaceAt: 1190 }], 1190), true);
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
