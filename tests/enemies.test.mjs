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

test('Flankers hold to the side at their assigned weapon height', () => {
  const state = fixture('flanker');
  const flanker = state.enemies[0];
  assert.equal(flanker?.kind, 'flanker');
  advance(state, 180);
  const angle = Math.abs(Math.atan2(flanker.x - state.player.x, flanker.z - state.player.z));
  assert.ok(angle >= 70 * Math.PI / 180 && angle <= 100 * Math.PI / 180);
  assert.ok([75, 145].includes(flanker.alt));
});

test('a rear Harrier telegraphs one adjacent hop in answer to an Immelmann', () => {
  const state = fixture('harrier');
  const harrier = state.enemies[0];
  assert.equal(harrier?.kind, 'harrier');
  harrier.x = state.player.x;
  harrier.z = state.player.z - 78;
  advance(state, 1, { maneuver: 'immelmann' });
  assert.equal(harrier.maneuver?.band, 2);
  assert.equal(harrier.maneuver?.diveAt - state.tick, 75);
  advance(state, 75);
  assert.equal(harrier.maneuver?.phase, 'diving');
  advance(state, 75);
  assert.equal(harrier.alt, 145);
  assert.equal(harrier.maneuver, null);
});

test('a Diver flashes for 1.2 s and fires one three-way fan during its plunge', () => {
  const state = fixture('diver');
  const diver = state.enemies[0];
  assert.equal(diver?.kind, 'diver');
  diver.maneuverAt = state.tick + 1;
  advance(state, 1);
  assert.equal(diver.maneuver?.diveAt - state.tick, 72);
  advance(state, 72);
  assert.ok(diver.alt < 145);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);
  for (let i = 0; i < 65 && !state.shots.some(shot => shot.kind === 'hostile'); i++) advance(state, 1);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 3);
});

test('a Bomber has two patrol escorts and its mines fall from CRUISE to LOW', () => {
  const state = fixture('bomber');
  const bomber = state.enemies[0];
  assert.equal(bomber?.kind, 'bomber');
  assert.equal(bomber.hp, 10);
  assert.equal(state.enemies.filter(enemy => enemy.formation?.leader === bomber.id).length, 2);
  bomber.shotAt = state.tick + 1;
  advance(state, 1);
  assert.equal(state.enemyMines.length, 1);
  const mine = state.enemyMines[0];
  assert.ok(mine.alt > 109 && mine.alt <= 110);
  advance(state, 160, { turn: 1 });
  assert.equal(mine.alt, 75);
});

test('a landmark turret fixes a single-band flak position after a 1.4 s warning', () => {
  const state = fixture('turret');
  const turret = state.enemies[0];
  assert.equal(turret?.kind, 'turret');
  assert.equal(turret.alt, ground(turret.x, turret.z) + 5);
  turret.shotAt = state.tick + 1;
  advance(state, 1);
  assert.equal(turret.tell?.until - state.tick, 84);
  const warning = { ...turret.tell };
  advance(state, 84);
  const puff = state.effects.find(effect => effect.kind === 'flak');
  assert.deepEqual([puff.x, puff.z, puff.alt], [warning.x, warning.z, warning.alt]);
});

test('an airborne straggler relocates ahead after six seconds without dropping salvage', () => {
  const state = fixture('hound');
  const hound = state.enemies[0];
  hound.z = -553;
  hound.hp = 2;
  hound.shotAt = state.tick + 1800;
  advance(state, 359);
  assert.ok(hound.z < state.player.z - 380);
  advance(state, 1);
  assert.ok(hound.z > state.player.z + 100);
  assert.equal(hound.hp, 2);
  assert.equal(state.pickups.length, 0);
});

test('a Split-S does not pull a water-only Skimmer through a sea stack', () => {
  const state = fixture('skimmer');
  Object.assign(state.player, { x: 288, z: 308, yaw: 0, altitude: 110 });
  const skimmer = state.enemies[0];
  Object.assign(skimmer, { x: 288, z: 208 });
  advance(state, 90, { maneuver: 'split-s' });
  assert.equal(skimmer.alt, 75);
  assert.ok(ground(skimmer.x, skimmer.z) <= 39);
});

test('a far turret transfers only to a vacant landmark ahead and keeps its HP', () => {
  const state = fixture('turret');
  const turret = state.enemies[0];
  Object.assign(state.player, { x: 288, z: 125, yaw: 0, altitude: 145 });
  Object.assign(turret, { farTicks: 359, hp: 2 });
  advance(state, 1);
  assert.ok(turret.x > 200 && turret.z > state.player.z);
  assert.equal(turret.alt, ground(turret.x, turret.z) + 5);
  assert.equal(turret.hp, 2);
  assert.equal(state.pickups.length, 0);
});
