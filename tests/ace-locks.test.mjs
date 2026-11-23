import assert from 'node:assert/strict';
import test from 'node:test';
import { ACE } from '../src/data/ace.ts';
import { drawAceLocks } from '../src/ace-sights.ts';
import { advanceAce } from '../src/ace.ts';
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

test('sights converge from live lock clocks and disappear when their own lock is gone', () => {
  const state = duel(), tell = state.boss.tell;
  const render = () => {
    const corners = [], rings = [], dashes = [];
    const ctx = { canvas: { width: 800, height: 480 }, save() {}, restore() {}, beginPath() {}, stroke() {},
      rect() {}, clip() {}, lineTo() {}, moveTo(x, y) { corners.push([x, y]); },
      arc(x, y, r) { rings.push([x, y, r]); }, setLineDash(dash) { dashes.push(dash); } };
    const projection = { projectAirframe(_, subject) {
      return { x: subject === 'boss' ? 450 : 350, y: subject === 'boss' ? 180 : 300, radius: 20 };
    } };
    drawAceLocks(ctx, state, projection, { x: 10, y: 20, width: 700, height: 400 });
    return { corners, rings, dashes };
  };
  const start = render();
  assert.equal(start.corners.length, 8);
  assert.ok(start.dashes.length);
  while (state.tick < tell.until - ACE.lock.dodgeTicks) step(state);
  const ready = render();
  assert.deepEqual(ready.rings[0].slice(0, 2), [350, 300]);
  assert.ok(ready.rings[0][2] < start.rings[0][2]);
  assert.ok(ready.corners[0][1] > start.corners[0][1]);
  assert.deepEqual(ready.dashes, []);
  state.view = 'cockpit';
  assert.deepEqual(render().rings[0].slice(0, 2), [360, 220]);
  state.view = 'overhead';
  state.lock = null;
  assert.equal(render().corners.length, 4);
  state.boss.tell = { ...tell, kind: 'roll' };
  assert.deepEqual(render().rings, []);
  state.boss.tell = tell;
  state.paused = true;
  assert.deepEqual(render().rings, []);
});
