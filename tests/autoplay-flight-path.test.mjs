import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';

const sea = () => 35;

function pilotApproachingHigh(altitude) {
  const state = createStage(parseStageOptions('?autoplay=1'), sea);
  const p = state.player;
  p.altitude = altitude;
  state.speed = 104;
  state.pickups.push({ id: 1, x: p.x, z: p.z + 100, alt: 145, xp: 1, born: 0 });
  return state;
}

test('the full pilot levels out before reaching a target band at a steep climb angle', () => {
  const state = pilotApproachingHigh(141);
  state.player.pitch = Math.PI / 6;
  assert.ok(autopilotInput(state, 'full', sea).climb <= 0);
  state.player.pitch = -Math.PI / 6;
  assert.equal(autopilotInput(state, 'full', sea).climb, 1);
});

test('the full pilot projects the approach to a mine from its current flight-path angle', () => {
  const state = pilotApproachingHigh(100);
  const p = state.player;
  state.enemyMines.push({ x: p.x, z: p.z + state.speed * 0.2, alt: 119, born: 0 });
  p.pitch = Math.PI / 6;
  assert.ok(autopilotInput(state, 'full', sea).climb <= 0, 'stay below a mine in the projected climb');
  p.pitch = -Math.PI / 6;
  assert.equal(autopilotInput(state, 'full', sea).climb, 1, 'the dive still keeps the mine clear during pull-up');
});
