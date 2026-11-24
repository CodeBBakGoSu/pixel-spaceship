import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleTravel } from '../src/data/speed.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { advanceFlares } from '../src/stage-combat.ts';
import { World } from '../src/world.ts';

const empty = (level = 1) => {
  const state = createStage(parseStageOptions('?fixture=flare'));
  state.tick = 1;
  state.run.weaponLevels.phoenix = level;
  state.enemies = [];
  state.twinAt = state.podsAt = Infinity;
  return state;
};

const run = (state, ticks, input = {}, ground) => {
  for (let i = 0; i < ticks; i++) stepStage(state, input, ground);
};

function contact(state, aft, band, kind = 'patrol', lateral = 0) {
  const { x, z } = state.player;
  const enemy = makeEnemy(state, x + scaleTravel(lateral), z - scaleTravel(aft), band, kind);
  state.enemies.push(enemy);
  return enemy;
}

test('a volley ejects four fanned rank-seven flares aft and inherits the faster launch from boost', () => {
  const cruise = empty(7), boosted = empty(7);
  cruise.player.yaw = boosted.player.yaw = Math.PI / 5;
  const fx = Math.sin(cruise.player.yaw), fz = Math.cos(cruise.player.yaw);
  run(cruise, 1);
  run(boosted, 1, { boost: true });
  assert.equal(cruise.flares?.length, 4);
  assert.equal(boosted.flares?.length, 4);
  const spread = cruise.flares.map(flare => flare.vx * fz - flare.vz * fx);
  assert.ok(Math.min(...spread) < scaleTravel(-12) && Math.max(...spread) > scaleTravel(12));
  for (const state of [cruise, boosted]) {
    for (const flare of state.flares) {
      assert.ok((flare.x - state.player.x) * fx + (flare.z - state.player.z) * fz < scaleTravel(-5));
      assert.ok(flare.vx * fx + flare.vz * fz < state.speed);
    }
  }
  const zSpeed = state => state.flares[2].vx * fx + state.flares[2].vz * fz;
  assert.ok(zSpeed(boosted) - zSpeed(cruise) > scaleTravel(15));
});

test('a volley sinks through the next altitude band and burns out at two seconds', () => {
  const state = empty();
  run(state, 1);
  assert.ok(state.flares?.length);
  const flare = state.flares[0], initial = flare.alt;
  run(state, 60);
  assert.ok(flare.alt < initial - 10 && flare.alt > 88);
  run(state, 59);
  assert.ok(flare.alt < 76 && state.flares.includes(flare));
  run(state, 1);
  assert.equal(state.flares.length, 0);
});

test('a same-band Hound aft burns and takes damage over time while the contacts above and ahead escape', () => {
  const state = empty();
  const target = contact(state, 21, 1, 'hound');
  const above = contact(state, 21, 2, 'hound');
  const ahead = contact(state, -24, 1, 'hound');
  run(state, 1);
  for (let i = 0; i < 25 && !state.flareHit; i++) run(state, 1);
  assert.ok(state.flareHit?.until > state.tick);
  assert.ok(target.burnUntil > state.tick);
  assert.ok(0 < target.hp && target.hp < 3);
  assert.equal(above.hp, 3);
  assert.equal(ahead.hp, 3);
  const healthOnIgnition = target.hp;
  run(state, 28);
  assert.ok(target.hp < healthOnIgnition);
  assert.equal(above.burnUntil, undefined);
  assert.equal(ahead.burnUntil, undefined);
});

test('the Ace burns at a slower damage cadence after a rear flare hit', () => {
  const state = createStage(parseStageOptions('?fixture=boss&mode=survivors'));
  state.run.weaponLevels.phoenix = 1;
  const ace = state.boss;
  ace.yaw = 0;
  const { x, z, alt } = ace;
  Object.assign(state.player, { x, z: z + scaleTravel(21), altitude: alt });
  state.twinAt = state.podsAt = Infinity;
  run(state, 1);
  for (let i = 0; i < 25 && !ace.burnUntil; i++) run(state, 1);
  assert.ok(ace.burnUntil > state.tick);
  assert.ok(ace.hp < ace.maxHp);
  state.flares.length = 0;
  const healthOnIgnition = ace.hp;
  run(state, 30);
  assert.equal(ace.hp, healthOnIgnition);
  run(state, 65);
  assert.equal(ace.hp, healthOnIgnition - 1);
});

test('flares can fire during the scripted half-loop', () => {
  const state = empty();
  state.weaponFireAt.phoenix = state.tick + 20;
  run(state, 1, { maneuver: 'immelmann' });
  run(state, 18);
  run(state, 1);
  assert.equal(state.maneuver?.kind, 'immelmann');
  assert.equal(state.flares[0].born, state.tick);
});

test('switching weapons reuses the open rear view for the newly released payload', () => {
  const state = empty();
  state.run.weaponLevels['bomb-bay'] = 1;
  state.run.weaponLevels.phoenix = 0;
  run(state, 1);
  const { since, until } = state.rearGlimpse;
  run(state, 12);
  state.run.weaponLevels.phoenix = 1;
  run(state, 1);
  assert.equal(state.rearGlimpse?.since, since);
  assert.equal(state.rearGlimpse?.kind, 'flare');
  assert.ok(state.rearGlimpse?.until > until);
});

test('a sinking flare reaches a contact when it enters its altitude window mid-tick', () => {
  const state = empty();
  const lower = contact(state, 80, 0, 'hound');
  run(state, 1);
  const flare = state.flares[0];
  Object.assign(flare, { x: lower.x, z: lower.z, alt: lower.alt + 4.6, vx: 0, vz: 0, vy: -12 });
  advanceFlares(state, () => 35);
  assert.ok(lower.burnUntil > state.tick);
});

test('a delayed bomb blast reopens the rear view at the impact location', () => {
  const state = empty();
  state.run.weaponLevels['bomb-bay'] = 1;
  state.run.weaponLevels.phoenix = 0;
  run(state, 1);
  assert.equal(state.rearGlimpse?.kind, 'bomb');
  assert.equal(state.rearGlimpse?.since, state.tick);
  const until = state.rearGlimpse.until;
  run(state, until - state.tick + 1);
  assert.equal(state.rearGlimpse, null);
  assert.equal(state.rearBombs.length, 1);
  for (let i = 0; i < 150 && state.rearBombs.length; i++) run(state, 1);
  const blast = state.effects.find(effect => effect.kind === 'bomb-blast');
  assert.ok(blast);
  assert.equal(state.rearGlimpse?.since, state.tick);
  assert.equal(state.rearGlimpse?.kind, 'bomb');
  assert.deepEqual(state.rearGlimpse?.target, { x: blast.x, z: blast.z, alt: blast.alt });
  assert.ok(state.rearGlimpse?.until >= state.tick + 35);
});

test('a low contact hit after the launch window reopens the rear view', () => {
  const state = empty();
  const below = contact(state, 84, 0, 'patrol');
  run(state, 1);
  const launchWindow = state.rearGlimpse?.until;
  assert.ok(launchWindow > state.tick);
  const flare = state.flares[0];
  state.tick = launchWindow + 1;
  Object.assign(flare, { x: below.x, z: below.z, alt: below.alt + 4.6, vx: 0, vz: 0, vy: -12 });
  advanceFlares(state, () => 35);
  assert.ok(below.burnUntil > state.tick);
  assert.ok(state.tick > launchWindow);
  assert.equal(state.rearGlimpse?.kind, 'flare');
  assert.ok(state.rearGlimpse?.until > launchWindow);
  assert.equal(state.rearGlimpse?.kind, 'flare');
  assert.equal(state.rearGlimpse?.target?.alt, 75);
});

test('the flare review fixture has moving three-band tails and automatically burns pursuers', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const create = () => createStage(parseStageOptions('?fixture=flare'), ground);
  const state = create(), player = { ...state.player };
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'chase');
  assert.deepEqual([...new Set(state.enemies.map(enemy => enemy.alt))].sort((a, b) => a - b), [75, 125, 180]);
  assert.ok(state.enemies.every(enemy => enemy.z < player.z));
  const before = state.enemies.map(enemy => enemy.z);
  run(state, 1, {}, ground);
  assert.ok(state.player.z > player.z);
  assert.ok(before.some((z, index) => state.enemies[index].z !== z));
  run(state, 28, {}, ground);
  assert.ok(state.enemies.some(enemy => enemy.burnUntil > state.tick));
  assert.ok(state.rearGlimpse?.target);
});

test('without either weapon old manual inputs cannot create ordnance; equipping starts automatic fire', () => {
  const state = empty(0);
  run(state, 30, { flare: true, bomb: true });
  assert.equal(state.flares.length, 0);
  assert.equal(state.rearBombs.length, 0);
  assert.equal(state.metrics.bombsDropped, 0);
  assert.equal(state.rearGlimpse, null);
  state.run.weaponLevels.phoenix = 1;
  run(state, 1);
  assert.equal(state.flares.length, 1);
  assert.equal(state.rearBombs.length, 0);
  state.run.weaponLevels['bomb-bay'] = 1;
  run(state, 1);
  assert.equal(state.rearBombs.length, 1);
  assert.equal(state.metrics.bombsDropped, 1);
  run(state, 1, { pause: true });
  run(state, 500);
  assert.equal(state.metrics.bombsDropped, 1);
});
