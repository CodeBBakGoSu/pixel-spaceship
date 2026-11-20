import test from 'node:test';
import assert from 'node:assert/strict';
import { autopilotInput } from '../src/autoplay.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { World } from '../src/world.ts';

const empty = () => {
  const state = createStage(parseStageOptions('?fixture=flare'));
  state.enemies = [];
  state.twinAt = state.podsAt = Infinity;
  return state;
};

const run = (state, ticks, input = {}, ground) => {
  for (let i = 0; i < ticks; i++) stepStage(state, input, ground);
};

function contact(state, aft, band, kind = 'patrol', lateral = 0) {
  const { x, z } = state.player;
  const enemy = makeEnemy(state, x + lateral, z - aft, band, kind);
  state.enemies.push(enemy);
  return enemy;
}

test('a volley ejects five fanned flares aft and inherits the faster launch from boost', () => {
  const cruise = empty(), boosted = empty();
  cruise.player.yaw = boosted.player.yaw = Math.PI / 5;
  const fx = Math.sin(cruise.player.yaw), fz = Math.cos(cruise.player.yaw);
  run(cruise, 1, { flare: true });
  run(boosted, 1, { flare: true, boost: true });
  assert.equal(cruise.flares?.length, 5);
  assert.equal(boosted.flares?.length, 5);
  assert.equal(cruise.flareCharges, 2);
  const spread = cruise.flares.map(flare => flare.vx * fz - flare.vz * fx);
  assert.ok(Math.min(...spread) < -12 && Math.max(...spread) > 12);
  for (const state of [cruise, boosted]) {
    for (const flare of state.flares) {
      assert.ok((flare.x - state.player.x) * fx + (flare.z - state.player.z) * fz < -5);
      assert.ok(flare.vx * fx + flare.vz * fz < state.speed);
    }
  }
  const zSpeed = state => state.flares[2].vx * fx + state.flares[2].vz * fz;
  assert.ok(zSpeed(boosted) - zSpeed(cruise) > 15);
});

test('a volley sinks through the next altitude band and burns out at two seconds', () => {
  const state = empty();
  run(state, 1, { flare: true });
  assert.ok(state.flares?.length);
  const flare = state.flares[2], initial = flare.alt;
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
  run(state, 1, { flare: true });
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
  const state = createStage(parseStageOptions('?fixture=boss'));
  const ace = state.boss;
  ace.yaw = 0;
  const { x, z, alt } = ace;
  Object.assign(state.player, { x, z: z + 21, altitude: alt });
  state.twinAt = state.podsAt = Infinity;
  run(state, 1, { flare: true });
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
  run(state, 1, { maneuver: 'immelmann' });
  run(state, 18);
  run(state, 1, { flare: true });
  assert.equal(state.maneuver?.kind, 'immelmann');
  assert.equal(state.flareCharges, 2);
  assert.ok(state.flares?.length);
});

test('three flare charges refill one at a time using active ticks after a brief launch gap', () => {
  const state = empty(), start = state.tick;
  run(state, 1, { flare: true });
  assert.equal(state.flareCharges, 2);
  run(state, 35, { flare: true });
  assert.equal(state.flareCharges, 2);
  run(state, 1, { flare: true });
  assert.equal(state.flareCharges, 1);
  run(state, 36, { flare: true });
  assert.equal(state.flareCharges, 0);
  run(state, 1, { pause: true });
  run(state, 500, { flare: true });
  assert.equal(state.flareCharges, 0);
  run(state, 1, { pause: true });
  run(state, start + 420 - state.tick);
  assert.equal(state.flareCharges, 0);
  for (const charges of [1, 2, 3]) {
    run(state, charges === 1 ? 1 : 420);
    assert.equal(state.flareCharges, charges);
  }
  assert.equal(state.flareReloadAt, null);
});

test('pressing either weapon extends one rear view even while its stores are unavailable', () => {
  const state = empty();
  run(state, 1, { flare: true });
  const { since, until } = state.rearGlimpse ?? {};
  assert.equal(since, state.tick);
  assert.ok(until - since >= 72 && until - since <= 90);
  run(state, 12);
  const charges = state.flareCharges;
  run(state, 1, { flare: true });
  assert.equal(state.flareCharges, charges);
  assert.equal(state.rearGlimpse?.since, since);
  assert.ok(state.rearGlimpse?.until > until);
  state.bombs = 0;
  const extended = state.rearGlimpse?.until;
  run(state, 1, { bomb: true });
  assert.equal(state.rearGlimpse?.since, since);
  assert.ok(state.rearGlimpse?.until > extended);
  const lastFrame = state.rearGlimpse.until - 1;
  run(state, lastFrame - state.tick);
  run(state, 1, { bomb: true });
  assert.equal(state.rearGlimpse?.since, since);
  run(state, state.rearGlimpse.until - state.tick + 1);
  assert.equal(state.rearGlimpse, null);
  state.flareCharges = 0;
  run(state, 1, { bomb: true, flare: true });
  assert.equal(state.rearGlimpse, null);
});

test('switching weapons reuses the open rear view for the newly released payload', () => {
  const state = empty();
  run(state, 1, { bomb: true });
  const { since, until } = state.rearGlimpse;
  run(state, 12);
  run(state, 1, { flare: true });
  assert.equal(state.rearGlimpse?.since, since);
  assert.equal(state.rearGlimpse?.kind, 'flare');
  assert.ok(state.rearGlimpse?.until > until);
});

test('a sinking flare reaches a contact when it enters its altitude window mid-tick', () => {
  const state = empty();
  const lower = contact(state, 80, 0, 'hound');
  run(state, 1, { flare: true });
  const flare = state.flares[2];
  Object.assign(flare, { x: lower.x, z: lower.z, alt: 83.1, vx: 0, vz: 0, vy: -12 });
  run(state, 1);
  assert.ok(lower.burnUntil > state.tick);
});

test('a delayed bomb blast reopens the rear view at the impact location', () => {
  const state = empty();
  run(state, 1, { bomb: true });
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
  const below = contact(state, 84, 0);
  run(state, 1, { flare: true });
  const launchWindow = state.rearGlimpse?.until;
  assert.ok(launchWindow > state.tick);
  for (let i = 0; i < 119 && !state.flareHit; i++) run(state, 1);
  assert.ok(below.burnUntil > state.tick);
  assert.ok(state.tick > launchWindow);
  assert.equal(state.rearGlimpse?.since, state.tick);
  assert.equal(state.rearGlimpse?.kind, 'flare');
  assert.equal(state.rearGlimpse?.target?.alt, 75);
});

test('the full pilot fires on a nearby tail and holds its flare when the contact climbs above it', () => {
  const state = empty();
  const target = contact(state, 24, 1, 'hound');
  assert.equal(autopilotInput(state, 'full').flare, true);
  target.alt = 145;
  assert.equal(autopilotInput(state, 'full').flare, false);
});

test('the flare review fixture has moving three-band tails and shows both real weapon outcomes', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const create = () => createStage(parseStageOptions('?fixture=flare'), ground);
  const state = create(), player = { ...state.player };
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'chase');
  assert.deepEqual([...new Set(state.enemies.map(enemy => enemy.alt))].sort((a, b) => a - b), [75, 110, 145]);
  assert.ok(state.enemies.every(enemy => enemy.z < player.z));
  const before = state.enemies.map(enemy => enemy.z);
  run(state, 1, { flare: true }, ground);
  assert.ok(state.player.z > player.z);
  assert.ok(state.enemies.some((enemy, index) => enemy.z !== before[index]));
  run(state, 28, {}, ground);
  assert.ok(state.enemies.some(enemy => enemy.burnUntil > state.tick));
  assert.ok(state.rearGlimpse?.target);

  const bomb = create();
  run(bomb, 1, { bomb: true }, ground);
  run(bomb, 28, {}, ground);
  assert.ok(bomb.effects.some(effect => effect.kind === 'bomb-blast'));
  assert.ok(bomb.enemies.length < state.enemies.length);
  assert.ok(bomb.rearGlimpse?.target);
});
