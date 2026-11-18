import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const fixture = kind => createStage(parseStageOptions('?fixture=' + kind), ground);
const advance = (state, count, input = {}) => {
  for (let tick = 0; tick < count; tick++) stepStage(state, tick === 0 ? input : {}, ground);
};

test('a Skimmer stays over water at LOW and fires two planar darts', () => {
  const state = fixture('skimmer');
  assert.equal(state.enemies[0]?.kind, 'skimmer');
  const skimmer = state.enemies[0];
  assert.equal(skimmer.hp, 2);
  skimmer.shotAt = state.tick + 1;
  advance(state, 1);
  const shots = state.shots.filter(shot => shot.kind === 'hostile');
  assert.equal(shots.length, 2);
  assert.ok(shots.every(shot => shot.alt === 75));
  advance(state, 85, { turn: 1 });
  assert.equal(skimmer.alt, 75);
  assert.ok(ground(skimmer.x, skimmer.z) <= 39);
});

test('a Spotter warns for 1.5 s before its bolt and buffs a nearby Hound by 20%', () => {
  const state = fixture('spotter');
  const spotter = state.enemies[0];
  assert.equal(spotter?.kind, 'spotter');
  assert.equal(spotter.hp, 4);
  const hound = fixture('hound').enemies[0];
  hound.id = 91;
  hound.z = spotter.z - 115;
  hound.x = spotter.x;
  state.enemies.push(hound);
  const comparison = structuredClone(state);
  comparison.enemies.shift();
  spotter.shotAt = state.tick + 1;
  advance(state, 1);
  advance(comparison, 1);
  const speed = e => Math.hypot(e.vx, e.vz);
  assert.ok(Math.abs(speed(hound) / speed(comparison.enemies[0]) - 1.2) < 1e-6);
  assert.equal(spotter.tell.until - state.tick, 90);
  advance(state, 89);
  assert.equal(state.shots.filter(shot => shot.alt === 145 && shot.kind === 'hostile').length, 0);
  advance(state, 1);
  assert.equal(state.shots.filter(shot => shot.alt === 145 && shot.kind === 'hostile').length, 1);
});

test('Cobra sends a close Hound past the nose without changing its CRUISE band', () => {
  const state = fixture('hound');
  const hound = state.enemies[0];
  assert.equal(hound?.kind, 'hound');
  hound.z = state.player.z - 20;
  hound.shotAt = state.tick + 120;
  advance(state, 65, { maneuver: 'cobra' });
  assert.ok(hound.z > state.player.z);
  assert.equal(hound.alt, 110);
});
