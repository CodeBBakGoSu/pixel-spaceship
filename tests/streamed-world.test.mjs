import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceChestSpawns } from '../src/chests.ts';
import { CHESTS } from '../src/data/items.ts';
import { PHASES } from '../src/data/phases.ts';
import { PICKUP_LIMIT } from '../src/data/run-balance.ts';
import { WORLD_SITES } from '../src/data/world.ts';
import { WAVE_FLY_IN_TICKS } from '../src/fly-in.ts';
import { spawnWave, WAVES } from '../src/spawn-director.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { acquireAndFire, advanceShots, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { makeEnemy, placeSkimEnemy } from '../src/stage-enemies.ts';
import { spawnSwarm } from '../src/swarm.ts';
import { World } from '../src/world.ts';
import { BANDS } from '../src/bands.ts';

test('ground is seeded and remains continuous across chunk seams at distant coordinates', () => {
  const world = new World(93), replay = new World(93), other = new World(94);
  const samples = [[-4096, 127.125], [2048, -864.5], [8192, -4096], [-16640, 5700]];
  assert.deepEqual(samples.map(([x, z]) => world.height(x, z)), samples.map(([x, z]) => replay.height(x, z)));
  assert.notDeepEqual(samples.map(([x, z]) => world.height(x, z)), samples.map(([x, z]) => other.height(x, z)));
  for (const [x, z] of samples) {
    assert.ok(Math.abs(world.height(x - 0.001, z) - world.height(x + 0.001, z)) < 0.01);
    assert.ok(Math.abs(world.height(x, z - 0.001) - world.height(x, z + 0.001)) < 0.01);
  }
});

test('the player can cross the former rim, descend into SKIM and climb back to MID', () => {
  const ground = (x, z) => 35 + Math.max(0, Math.min(18, (z - 1900) / 10));
  const state = createStage(parseStageOptions('?autoplay=1'), ground);
  Object.assign(state.player, { x: -4200, z: 1870, altitude: 125, yaw: 0 });
  for (let i = 0; i < 480; i++) {
    stepStage(state, { climb: -1 }, ground);
    assert.ok(state.player.altitude >= ground(state.player.x, state.player.z) + 10);
  }
  const p = state.player;
  assert.ok(p.z > 2200);
  assert.equal(p.skim, 'land');
  assert.equal(p.altitude, ground(p.x, p.z) + 14);
  for (let i = 0; i < 60; i++) stepStage(state, { climb: 1 }, ground);
  assert.equal(p.skim, undefined);
  assert.ok(state.climbRate > 0);
  const remainingTicks = Math.max(0, Math.ceil((BANDS[1] - p.altitude) / state.climbRate * TICKS_PER_SECOND));
  for (let i = 0; i < remainingTicks; i++) stepStage(state, { climb: 1 }, ground);
  assert.ok(p.altitude >= BANDS[1]);
});

test('wave, swarm and carrier placement preserves local density far from Reach', () => {
  const ground = () => 35;
  function placement(x, z) {
    const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=4'), ground);
    state.tick = CHESTS[0].second * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS;
    Object.assign(state.player, { x, z, yaw: 0.3 });
    spawnWave(state, WAVES[0], ground);
    spawnSwarm(state, PHASES[0], 5, ground, state.streams.spawn);
    advanceChestSpawns(state, ground);
    assert.ok(state.enemies.some(enemy => enemy.carrier));
    assert.equal(state.enemies.filter(enemy => enemy.kind === 'gnat').length, 5);
    assert.ok(state.enemies.some(enemy => enemy.kind === 'patrol'));
    return state.enemies.map(({ entry, kind }) => [kind,
      Math.round(entry.target.x - x), Math.round(entry.target.z - z), entry.target.alt]);
  }
  assert.deepEqual(placement(12_800, -14_240), placement(0, 0));
});

test('a world XP well pays immediately at the orb cap and stays consumed on revisit', () => {
  const ground = () => 35;
  const state = createStage(parseStageOptions('?fixture=world&mode=survivors&seed=19&x=3612&z=2387'), ground);
  const well = state.worldSites.find(site => site.kind === 'xp' && Math.hypot(site.x - state.player.x, site.z - state.player.z) < 500);
  Object.assign(state.player, { x: well.x, z: well.z, altitude: well.alt });
  state.pickups = Array.from({ length: PICKUP_LIMIT }, (_, id) => ({ id, xp: 1, x: well.x + 75, z: well.z, alt: well.alt, born: 0 }));
  stepStage(state, {}, ground);
  assert.equal(state.salvage, WORLD_SITES.wellXp);
  assert.equal(state.pickups.reduce((xp, orb) => xp + orb.xp, 0), PICKUP_LIMIT);
  state.player.z += WORLD_SITES.spacing * 3;
  stepStage(state, {}, ground);
  state.player.z = well.z;
  stepStage(state, {}, ground);
  assert.equal(state.salvage, WORLD_SITES.wellXp);
  assert.equal(state.worldSites.find(site => site.id === well.id).claimed, true);
});

test('Twin can strafe a SKIM target from LOW and suppresses DIVE when already skimming', () => {
  const ground = () => 35;
  const state = createStage(parseStageOptions('?fixture=world'), ground);
  const p = state.player;
  p.altitude = 75;
  const skimmer = makeEnemy(state, p.x, p.z + 70, 0, 'skimmer');
  placeSkimEnemy(skimmer, ground);
  state.enemies = [skimmer];
  acquireAndFire(state);
  assert.equal(state.shots[0]?.kind, 'strafe');
  for (let i = 0; i < 60; i++) advanceShots(state, ground);
  assert.equal(skimmer.hp, 1);

  state.shots = [];
  p.altitude = 65;
  p.skim = 'water';
  const turret = makeEnemy(state, p.x, p.z + 70, 0, 'turret');
  placeSkimEnemy(turret, ground);
  state.enemies = [turret];
  state.tick = state.strafeAt;
  state.wrongLayer = { id: turret.id, since: state.tick - 20 };
  acquireAndFire(state);
  assert.equal(state.altitudeHint, null);
  assert.equal(state.wrongLayer, null);
  const downward = state.shots.filter(shot => (shot.kind === 'twin' && shot.vy < 0) || shot.kind === 'strafe');
  assert.ok(downward.length >= 1);
  assert.ok(state.shots.some(shot => shot.kind === 'strafe' && shot.targetAltitude === turret.alt));
  for (let i = 0; i < 60; i++) advanceShots(state, ground);
  assert.ok(turret.hp < 4);
  assert.equal(Number((4 - turret.hp).toFixed(4)) % 1.25, 0);
});
