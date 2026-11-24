import assert from 'node:assert/strict';
import test from 'node:test';
import { ACE, ACE_PHASES } from '../src/data/ace.ts';
import { drawAceLocks } from '../src/ace-sights.ts';
import { aceDodgeWindow, advanceAce } from '../src/ace.ts';
import {
  actionDueAt, barrelRollForKey, consumesSpaceRequest, enqueueTimedAction, FlightChord, ROLL_CHORD_MS, simulationStepTime,
  simulationStepTimesForFrame, takeDueActionsAtTick, takeNextActionAtTick,
} from '../src/flight-chord.ts';
import { maneuverForKey } from '../src/maneuvers.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const ground = () => 0;
const step = (state, input = {}) => stepStage(state, input, ground);
function duel() {
  const state = createStage(parseStageOptions('?fixture=ace&cue=duel&view=chase'), ground);
  for (let i = 0; i < 120 && !state.boss.tell; i++) step(state);
  assert.equal(state.boss.tell?.kind, 'missile');
  assert.ok(state.lock.progress > 0 && !state.lock.ready);
  return state;
}

function sightFrame(state, field = { x: 10, y: 20, width: 700, height: 400 },
  canvas = { width: 800, height: 480 }, firedTell = null, playerRadius = 20) {
  const corners = [], rings = [], dashes = [];
  const ctx = { canvas, save() {}, restore() {}, beginPath() {}, stroke() {}, rect() {}, clip() {}, lineTo() {},
    moveTo(x, y) { corners.push([x, y]); }, arc(x, y, r) { rings.push([x, y, r]); },
    setLineDash(dash) { dashes.push([...dash]); } };
  const projection = { projectAirframe(_, subject) {
    return { x: subject === 'boss' ? 450 : 350, y: subject === 'boss' ? 180 : 300, radius: subject === 'boss' ? 20 : playerRadius };
  } };
  drawAceLocks(ctx, state, projection, field, firedTell);
  return { corners, rings, dashes };
}

for (const [phase, kind] of [[1, 'gun'], [2, 'missile']]) {
  test(`live phase ${phase} Ace fixture keeps its first ${kind} tell through release`, () => {
    const state = createStage(parseStageOptions(`?fixture=ace&phase=${phase}&live=1`), ground);
    const ace = state.boss, tell = ace.tell;
    const hostileShots = () => state.shots.filter(shot => shot.kind === 'hostile');
    assert.equal(tell?.kind, kind);
    while (state.tick < tell.until - 1) {
      step(state);
      assert.equal(ace.tell?.kind, kind);
      assert.equal(hostileShots().length, 0);
    }
    step(state);
    assert.equal(ace.tell, null);
    assert.equal(hostileShots().length, ACE_PHASES[phase][kind].length);
  });
}

const splitS = { maneuver: maneuverForKey('Space', 0, -1) };
const immelmann = { maneuver: maneuverForKey('Space', 0, 1) };
for (const [label, input, ticksLeft, dodged] of [
  ['W + Space on release', immelmann, 0, true],
  ['S + Space at the opening edge', splitS, ACE.lock.dodgeTicks, true],
  ['barrel roll inside the window', { roll: true, turn: 1 }, 6, true],
  ['S + Space one tick too early', splitS, ACE.lock.dodgeTicks + 1, false],
  ['S + Space after release', splitS, -1, false],
  ['straight flight', {}, 0, false],
]) {
  test(`head-on Ace lock: ${label}`, () => {
    const state = duel(), until = state.boss.tell.until;
    while (state.tick < until - ticksLeft - 1) step(state);
    assert.ok(state.lock.ready);
    step(state, input);
    if (dodged) {
      assert.equal(state.boss.tell, null, 'the warning ends immediately');
      assert.ok(state.boss.attackAt > until);
    }
    let launched = false;
    while (state.tick < until + 30) {
      launched ||= state.shots.some(shot => shot.hostileKind === 'ace-missile');
      step(state);
    }
    assert.equal(launched, !dodged);
    assert.equal(state.hull === state.maxHull, dodged);
  });
}

test('a reversal request on cooldown does not break the lock', () => {
  const state = duel(), until = state.boss.tell.until;
  state.maneuverReadyAt = until + 60;
  while (state.tick < until - 1) step(state);
  step(state, splitS);
  assert.equal(state.maneuver, null);
  assert.ok(state.shots.some(shot => shot.hostileKind === 'ace-missile'));
});

test('Space-first Shift chord crossing the fire tick resolves to one accepted roll', () => {
  const state = duel(), until = state.boss.tell.until, chord = new FlightChord();
  while (state.tick < until - 1) step(state);
  const now = 1000;
  assert.equal(chord.pressSpace(now, false), undefined);
  step(state, { spacePending: splitS.maneuver });
  assert.equal(state.tick, until);
  assert.equal(state.boss.tell?.dodgeGraceUntil, until + Math.ceil(ROLL_CHORD_MS * 60 / 1000));
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);

  const action = chord.pressShift(now + 20);
  assert.deepEqual(action, { action: 'roll', at: now + 20 });
  step(state, { roll: action?.action === 'roll', rollTurn: 0 });
  assert.equal(state.roll?.elapsed, 0);
  assert.equal(state.maneuver, null);
  assert.equal(state.boss.tell, null);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);
});

test('late W/S + Space resolves to an accepted maneuver and cancels only its salvo', () => {
  const state = duel(), until = state.boss.tell.until, chord = new FlightChord();
  while (state.tick < until - 1) step(state);
  const now = 2000;
  assert.equal(chord.pressSpace(now, false), undefined);
  for (let elapsed = 16; elapsed < ROLL_CHORD_MS; elapsed += 16) {
    assert.equal(chord.flush(now + elapsed), undefined);
    step(state, { spacePending: splitS.maneuver });
  }
  assert.equal(state.boss.tell?.dodgeGraceUntil, until + Math.ceil(ROLL_CHORD_MS * 60 / 1000));
  const action = chord.flush(now + ROLL_CHORD_MS);
  assert.deepEqual(action, { action: 'reversal', at: now + ROLL_CHORD_MS });
  step(state, { maneuver: splitS.maneuver, maneuverTurn: 0 });
  assert.equal(state.maneuver?.kind, splitS.maneuver);
  assert.equal(state.maneuverTrail?.startTick, state.tick);
  assert.equal(state.boss.tell, null);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);
});

test('cooldown-blocked pending Space does not defer or cancel the Ace salvo', () => {
  const state = duel(), until = state.boss.tell.until;
  while (state.tick < until - 1) step(state);
  state.maneuverReadyAt = until + 60;
  state.rollReadyAt = until + 60;
  step(state, { spacePending: splitS.maneuver });
  assert.equal(state.tick, until);
  assert.equal(state.boss.tell, null);
  assert.equal(state.maneuver, null);
  assert.equal(state.roll, undefined);
  assert.ok(state.shots.some(shot => shot.hostileKind === 'ace-missile'));
});

test('between-frame C input reaches its matching dodge tick and is not deferred when cooldown-blocked', () => {
  const run = cooldownBlocked => {
    const state = duel();
    const windowTick = state.boss.tell.until - ACE.lock.dodgeTicks;
    while (state.tick < windowTick - 3) step(state);
    if (cooldownBlocked) state.rollReadyAt = windowTick + 60;

    const frameTime = 2100, fixedStep = 1 / 60;
    let carry = 4 * fixedStep;
    const tickTimes = [];
    while (carry >= fixedStep) {
      tickTimes.push(simulationStepTime(frameTime, carry, fixedStep));
      carry -= fixedStep;
    }
    const cueAt = tickTimes[2];
    const pressAt = cueAt + 5;
    let pending = enqueueTimedAction([], {
      action: { kind: 'roll', turn: barrelRollForKey('KeyC', 0) }, at: pressAt,
    });
    assert.equal(actionDueAt(pending[0], cueAt), false, 'the input is not retroactive to the cue tick');

    for (let index = 0; index < tickTimes.length; index++) {
      const queued = takeNextActionAtTick(pending, tickTimes[index]);
      if (queued.action !== undefined) {
        assert.equal(index, 3, 'the event is consumed at the first simulation boundary after the press');
        step(state, { roll: queued.action.action.kind === 'roll', rollTurn: queued.action.action.turn });
      } else step(state);
      pending = queued.pending;
    }
    assert.equal(state.tick, windowTick + 1);
    assert.deepEqual(pending, [], 'the queued event is consumed once even if stage cooldown rejects it');
    if (cooldownBlocked) {
      assert.equal(state.roll, undefined);
      assert.ok(state.boss.tell, 'a blocked roll does not cancel the Ace salvo');
      for (let i = 0; i < 61; i++) step(state);
      assert.equal(state.roll, undefined, 'the blocked input is not replayed after cooldown');
    } else {
      assert.equal(state.roll?.elapsed, 0);
      assert.equal(state.boss.tell, null, 'the roll at the corresponding catch-up tick cancels the salvo');
    }
  };

  run(false);
  run(true);
});

test('4fps capped catch-up applies post-cue C in the window and prioritizes it over a due maneuver', () => {
  const state = duel();
  const windowTick = state.boss.tell.until - ACE.lock.dodgeTicks;
  while (state.tick < windowTick - 11) step(state);
  assert.equal(state.tick, windowTick - 11);

  const fixedStep = 1 / 60;
  let frameAnchor = 1000, carry = 0;
  const cueAt = frameAnchor + (windowTick - state.tick) * fixedStep * 1000;
  const cAt = cueAt + 2;
  let pending = enqueueTimedAction([], {
    action: { kind: 'maneuver', press: { kind: 'j-turn', turn: 1 } }, at: cAt - 1,
  });
  pending = enqueueTimedAction(pending, {
    action: { kind: 'roll', turn: barrelRollForKey('KeyC', 0) }, at: cAt,
  });

  for (let frame = 0; frame < 3; frame++) {
    const result = simulationStepTimesForFrame(frameAnchor, 0.2, carry, fixedStep);
    assert.equal(result.times.length, 12);
    for (const tickTime of result.times) {
      const due = takeDueActionsAtTick(pending, tickTime);
      const accepted = due.actions.find(input => input.action.kind === 'roll') ?? due.actions[0];
      if (accepted) {
        assert.ok(state.tick >= windowTick, 'C is not applied before the visible window');
        step(state, accepted.action.kind === 'roll'
          ? { roll: true, rollTurn: accepted.action.turn }
          : { maneuver: accepted.action.press.kind, maneuverTurn: accepted.action.press.turn });
      } else step(state);
      pending = due.pending;
    }
    carry = result.carry;
    frameAnchor += 250;
    if (frame === 0) {
      assert.equal(state.boss.tell, null);
      assert.equal(state.roll?.elapsed, 0);
      assert.deepEqual(pending, [], 'same-step maneuver is consumed rather than replayed');
    }
  }
  assert.equal(state.boss.tell, null);
});

test('Space grace survives until C is consumed after the fire tick', () => {
  const state = duel(), until = state.boss.tell.until;
  while (state.tick < until - 1) step(state);
  const request = { action: splitS.maneuver, at: 955 };
  let pending = enqueueTimedAction([], {
    action: { kind: 'roll', turn: barrelRollForKey('KeyC', 1), spaceAt: request.at }, at: 1005,
  });
  const fixedStep = 1 / 60, frameTime = 1000 + fixedStep * 1000;
  const tickTimes = [
    simulationStepTime(frameTime, 2 * fixedStep, fixedStep),
    simulationStepTime(frameTime, fixedStep, fixedStep),
  ];

  for (let index = 0; index < tickTimes.length; index++) {
    const next = takeNextActionAtTick(pending, tickTimes[index]);
    const spacePending = actionDueAt(request, tickTimes[index])
      && next.action?.action.spaceAt !== request.at ? request.action : undefined;
    const input = next.action?.action;
    step(state, {
      spacePending,
      roll: input?.kind === 'roll',
      rollTurn: input?.kind === 'roll' ? input.turn : undefined,
    });
    pending = next.pending;
    if (index === 0) {
      assert.equal(state.tick, until);
      assert.equal(state.boss.tell?.dodgeGraceUntil, until + Math.ceil(ROLL_CHORD_MS * 60 / 1000),
        'the fire-tick grace sees Space before the later C event');
    }
  }
  assert.deepEqual(pending, []);
  assert.equal(state.roll?.elapsed, 0);
  assert.equal(state.boss.tell, null, 'C is applied on its later tick inside the pending-space grace');
});

test('cooldown-blocked C does not consume newer W+Space grace before its chord deadline', () => {
  const state = duel(), until = state.boss.tell.until;
  while (state.tick < until - 1) step(state);
  state.boost = 100;
  state.maneuverReadyAt = until;
  state.rollReadyAt = until + 60;
  const request = { action: { kind: maneuverForKey('Space', 0, 1), turn: 0 }, at: 1190 };
  const chord = new FlightChord();
  chord.pressSpace(request.at, false);
  const queued = enqueueTimedAction([], {
    action: { kind: 'roll', turn: barrelRollForKey('KeyC', 1) }, at: 1175,
  });
  const due = takeDueActionsAtTick(queued, 1200);
  const consumes = consumesSpaceRequest(due.actions.map(input => input.action), request.at);
  assert.equal(consumes, false, 'the older C does not own the newer Space grace');
  assert.ok(request.action.kind);
  step(state, {
    roll: true,
    rollTurn: 1,
    spacePending: actionDueAt(request, 1200) && !consumes ? request.action.kind : undefined,
  });
  assert.equal(state.tick, until);
  assert.equal(state.boss.tell?.dodgeGraceUntil, until + Math.ceil(ROLL_CHORD_MS * 60 / 1000));
  assert.equal(state.roll, undefined, 'the old C input is blocked by cooldown');
  assert.equal(chord.flush(1250), undefined, 'W+Space remains pending before its 1270ms deadline');

  for (const tickTime of [1216, 1233, 1250]) {
    step(state, {
      spacePending: actionDueAt(request, tickTime) && !consumes ? request.action.kind : undefined,
    });
    assert.ok(state.boss.tell, 'pending W+Space keeps the grace alive through the fire frame');
  }
  assert.deepEqual(chord.flush(1270), { action: 'reversal', at: 1270 });
});

test('late Shift resolves Space at its saved deadline before a later catch-up input', () => {
  const state = duel(), until = state.boss.tell.until, chord = new FlightChord();
  while (state.tick < until - 1) step(state);
  assert.equal(chord.pressSpace(999, false), undefined);
  const resolved = chord.pressShift(1090);
  assert.deepEqual(resolved, { action: 'reversal', at: 999 + ROLL_CHORD_MS });
  let pending = enqueueTimedAction([], {
    action: { kind: 'maneuver', press: { kind: splitS.maneuver, turn: 0 }, spaceAt: 999 }, at: resolved.at,
  });
  pending = enqueueTimedAction(pending, {
    action: { kind: 'roll', turn: barrelRollForKey('KeyC', 1), spaceAt: 999 }, at: 1095,
  });
  const fixedStep = 1 / 60, frameTime = 1100, carry = 7 * fixedStep, tickTimes = [];
  let remaining = carry;
  while (remaining >= fixedStep) {
    tickTimes.push(simulationStepTime(frameTime, remaining, fixedStep));
    remaining -= fixedStep;
  }
  assert.ok(tickTimes[0] <= 1000 && tickTimes.at(-1) === frameTime);

  const consumed = [];
  for (const tickTime of tickTimes) {
    const next = takeNextActionAtTick(pending, tickTime);
    const spacePending = actionDueAt({ action: splitS.maneuver, at: 999 }, tickTime)
      && next.action?.action.spaceAt !== 999 ? splitS.maneuver : undefined;
    const action = next.action?.action;
    if (next.action) consumed.push(next.action.action.kind);
    step(state, {
      spacePending,
      maneuver: action?.kind === 'maneuver' ? action.press.kind : undefined,
      maneuverTurn: action?.kind === 'maneuver' ? action.press.turn : undefined,
      roll: action?.kind === 'roll',
      rollTurn: action?.kind === 'roll' ? action.turn : undefined,
    });
    pending = next.pending;
  }
  assert.deepEqual(pending, []);
  assert.deepEqual(consumed, ['maneuver', 'roll'], 'the later C action does not replace the earlier resolved reversal');
  assert.equal(state.maneuver?.kind, splitS.maneuver);
  assert.equal(state.boss.tell, null, 'the action reaches the tick covered by the original grace');
});

test('gun aim drops on loss of bearing, altitude or range before release', () => {
  for (const loseAim of [
    (state) => { state.boss.yaw += Math.PI; },
    (state) => { state.player.altitude += ACE.attack.bandWindow + 1; },
    (state) => { state.boss.z = state.player.z + ACE.attack.range + 1; },
  ]) {
    const state = createStage(parseStageOptions('?fixture=ace&cue=gun'), ground);
    const until = state.boss.tell.until;
    loseAim(state);
    state.tick++;
    advanceAce(state, ground);
    assert.equal(state.boss.tell, null);
    assert.ok(state.boss.attackAt > until);
    assert.equal(state.shots.length, 0);
  }
});

test('sights converge two circles into the dodge window and preserve chase and cockpit anchors', () => {
  const state = duel(), tell = state.boss.tell;
  const start = sightFrame(state, undefined, undefined, null, 70);
  const [startOuter, startReference] = start.rings;
  assert.equal(start.rings.length, 2);
  assert.deepEqual(startOuter.slice(0, 2), [350, 300]);
  assert.deepEqual(startReference.slice(0, 2), [350, 300]);
  assert.ok(startOuter[2] >= startReference[2] * 2);
  assert.equal(startReference[2], 22, 'the fixed reference ring keeps its original radius');
  assert.ok(startOuter[2] >= 74, 'the initial outer ring encloses the projected ship with clearance');
  assert.ok(startOuter[2] <= Math.min(700, 400) * 0.28, 'the outer ring remains within its viewport radius limit');
  assert.equal(start.corners.length, 4, 'the Ace-target lock brackets remain unchanged');
  assert.deepEqual(start.dashes, [[9, 5], []]);

  const preWindowTicks = Math.max(1, tell.until - tell.since - ACE.lock.dodgeTicks);
  const halfwayState = { ...state, tick: tell.since + Math.floor(preWindowTicks / 2) };
  const [halfwayOuter, halfwayReference] = sightFrame(halfwayState, undefined, undefined, null, 70).rings;
  const [startOuterGap, halfwayOuterGap] = [startOuter[2] - startReference[2], halfwayOuter[2] - halfwayReference[2]];
  assert.equal(halfwayReference[2], startReference[2]);

  while (state.tick < tell.until - ACE.lock.dodgeTicks - 1) step(state);
  const beforeWindow = sightFrame(state, undefined, undefined, null, 70);
  const [beforeOuter, beforeReference] = beforeWindow.rings;
  assert.equal(aceDodgeWindow(tell, state.tick), false);
  assert.ok(beforeOuter[2] - beforeReference[2] < startOuter[2] - startReference[2]);

  while (state.tick < tell.until - ACE.lock.dodgeTicks) step(state);
  const window = sightFrame(state, undefined, undefined, null, 70);
  const [windowOuter, windowReference] = window.rings;
  assert.equal(aceDodgeWindow(tell, state.tick), true);
  assert.equal(windowReference[2], startReference[2], 'the reference radius stays fixed');
  assert.ok(windowOuter[2] > windowReference[2]);
  assert.ok(windowOuter[2] - windowReference[2] <= windowReference[2] * 0.3, 'the circles nearly overlap at window entry');
  assert.ok(startOuterGap - halfwayOuterGap > halfwayOuterGap - (windowOuter[2] - windowReference[2]),
    'the outer ring contracts faster in the first half of the tell');
  assert.ok(beforeOuter[2] - beforeReference[2] > windowOuter[2] - windowReference[2]);
  assert.ok(windowOuter[2] < beforeOuter[2]);
  assert.deepEqual(window.dashes, [[], []]);

  state.view = 'cockpit';
  const cockpit = sightFrame(state);
  assert.deepEqual(cockpit.rings.map(ring => ring.slice(0, 2)), [[360, 220], [360, 220]]);
  assert.deepEqual(cockpit.rings.map(ring => ring[2]), window.rings.map(ring => ring[2]));

  state.view = 'chase';
  state.tick = tell.until;
  const fireTick = sightFrame(state);
  assert.equal(fireTick.rings[0][2], fireTick.rings[1][2], 'the outer ring exactly overlaps the reference at fire');
  state.boss.tell = null;
  assert.deepEqual(sightFrame(state).rings, [], 'both circles disappear when the tell ends');
  state.boss.tell = { ...tell, kind: 'roll' };
  assert.deepEqual(sightFrame(state).rings, [], 'roll tells do not draw attack circles');
  state.paused = true;
  assert.deepEqual(sightFrame(state).rings, [], 'paused state clears the warning');
});

test('dodge-circle overlap is phase-length invariant and scales with the viewport', () => {
  const ratios = [];
  for (const [phase, kind] of [[1, 'gun'], [2, 'missile']]) {
    const state = createStage(parseStageOptions(`?fixture=ace&phase=${phase}&live=1`), ground);
    const tell = state.boss.tell;
    assert.equal(tell.kind, kind);
    state.tick = tell.until - ACE.lock.dodgeTicks;
    assert.equal(aceDodgeWindow(tell, state.tick), true);
    const [outer, reference] = sightFrame(state).rings;
    ratios.push((outer[2] - reference[2]) / reference[2]);
  }
  assert.ok(ratios.every(ratio => ratio > 0 && ratio <= 0.3));
  assert.ok(Math.abs(ratios[0] - ratios[1]) < 0.001, 'gun and missile tell lengths enter the window at the same relative gap');

  const mobile = createStage(parseStageOptions('?fixture=ace&phase=2&live=1'), ground);
  const mobileField = { x: 0, y: 0, width: 340, height: 600 };
  mobile.tick = mobile.boss.tell.since;
  const cappedStart = sightFrame(mobile, mobileField, { width: 360, height: 640 }, null, 120);
  assert.equal(cappedStart.rings[0][2], Math.min(mobileField.width, mobileField.height) * 0.28,
    'a large projected ship respects the smaller viewport limit');
  mobile.tick = mobile.boss.tell.until - ACE.lock.dodgeTicks;
  const small = sightFrame(mobile, mobileField, { width: 360, height: 640 });
  const [smallOuter, smallReference] = small.rings;
  assert.ok(Math.abs((smallOuter[2] - smallReference[2]) / smallReference[2] - ratios[1]) < 0.001,
    'window overlap scales with the viewport rather than warning duration');
});

test('fired tell emits one exact-overlap render cue; accepted dodge does not', () => {
  const state = duel(), tell = state.boss.tell, fired = [];
  while (state.tick < tell.until - 1) step(state);
  stepStage(state, {}, ground, undefined, { aceTellFired: value => fired.push(value) });
  assert.equal(state.tick, tell.until);
  assert.equal(state.boss.tell, null);
  assert.deepEqual(fired, [tell]);
  const frame = sightFrame(state, undefined, undefined, fired[0]);
  assert.equal(frame.rings.length, 2);
  assert.equal(frame.rings[0][2], frame.rings[1][2]);

  const dodged = duel(), dodgeTell = dodged.boss.tell;
  let firedAfterDodge = false;
  while (dodged.tick < dodgeTell.until - ACE.lock.dodgeTicks - 1) step(dodged);
  stepStage(dodged, { maneuver: splitS.maneuver }, ground, undefined, {
    aceTellFired: () => { firedAfterDodge = true; },
  });
  assert.equal(dodged.boss.tell, null);
  assert.equal(firedAfterDodge, false);
  assert.deepEqual(sightFrame(dodged).rings, []);
});
