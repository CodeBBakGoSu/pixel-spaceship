import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import {
  acquireAndFire, advanceAutoOrdnance, advanceFlares, advanceRearBombs, advanceShots,
  bombCapacity, dropFlares, dropRearBomb, flareCapacity, hurtEnemy, openReversal,
} from '../src/stage-combat.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';
import { weaponCooldown } from '../src/loadout.ts';
import { STARTER_BUFFS, STARTER_WEAPONS } from '../src/data/meta.ts';

const ground = () => 35;
const start = () => createStage(parseStageOptions('?mode=survivors&t=0'), ground);

test('a new phase sortie draws from the five starter weapons and five starter buffs', () => {
  const state = start();
  assert.deepEqual(state.run.weapons, STARTER_WEAPONS);
  assert.deepEqual(state.run.buffs, STARTER_BUFFS);
});

test('Band Lens admits a direct Twin shot outside the unmodified window', () => {
  const state = start();
  const enemy = makeEnemy(state, state.player.x, state.player.z + 85, 1, 'patrol', 10);
  state.enemies = [enemy];
  acquireAndFire(state);
  assert.equal(state.shots.length, 0);
  state.run.buffLevels['band-lens'] = 2;
  acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'twin').length, 2);
});

test('Vector Thrusters increase climb, turn and boost recovery', () => {
  const reference = start();
  const upgraded = start();
  reference.boost = upgraded.boost = 0;
  upgraded.run.buffLevels['vector-thrusters'] = 3;
  const input = { climb: 1, turn: 0.5 };
  stepStage(reference, input, ground);
  stepStage(upgraded, input, ground);
  assert.ok(upgraded.player.altitude > reference.player.altitude);
  assert.ok(upgraded.player.yaw > reference.player.yaw);
  assert.ok(upgraded.boost > reference.boost);
});

test('taking Hull Plating through a real draft raises and repairs hull', () => {
  const state = start();
  state.hull = 1;
  state.run.weapons = [];
  state.run.buffs = ['hull-plating'];
  state.xp = 16;
  stepStage(state, {}, ground);
  const card = state.run.cards.find(card => card.id === 'hull-plating');
  assert.ok(card);
  const { tick, maxHull } = state;
  stepStage(state, { pick: 'hull-plating' }, ground);
  assert.equal(state.tick, tick);
  assert.equal(state.maxHull, maxHull + card.nextLevel);
  assert.equal(state.hull, 1 + card.nextLevel);
  assert.equal(state.run.buffLevels['hull-plating'], card.nextLevel);
});

test('Magnet Core expands both pickup reach and its altitude window', () => {
  const without = start(), withMagnet = start();
  for (const state of [without, withMagnet]) {
    state.pickups.push({ id: 105, x: state.player.x, z: state.player.z + 52, alt: 122, xp: 4, born: 0 });
  }
  withMagnet.run.buffLevels['magnet-core'] = 2;
  stepStage(without, {}, ground);
  stepStage(withMagnet, {}, ground);
  assert.equal(without.pickups[0].pulling, false);
  assert.equal(withMagnet.pickups[0].pulling, true);
  assert.ok(withMagnet.pickups[0].z < without.pickups[0].z);
});

test('Salvage Beacon carries sub-unit XP across pickups and boosts run credits', () => {
  const state = start();
  state.run.buffLevels['salvage-beacon'] = 3;
  for (let i = 0; i < 10; i++) {
    state.pickups.push({ id: 100 + i, x: state.player.x, z: state.player.z + 1, alt: 110, xp: 1, born: 0 });
  }
  stepStage(state, {}, ground);
  assert.equal(state.salvage, 10);
  assert.equal(state.xp, 14);
  assert.ok(Math.abs(state.run.credits - 13) < 1e-9);
  assert.ok(Math.abs(state.xpRemainder - 0.95) < 1e-9);
});

test('Overdrive Coil extends a reversal and Capacitor shortens the forward firing cadence', () => {
  const state = start();
  state.run.buffLevels['overdrive-coil'] = 3;
  state.run.buffLevels.capacitor = 3;
  const { x, z } = state.player;
  state.enemies = [makeEnemy(state, x, z + 70, 1, 'patrol', 0)];
  acquireAndFire(state);
  assert.equal(state.twinAt - state.tick, 17);
  state.weaponFireAt['bomb-bay'] = 340;
  state.podsAt = 90;
  state.tick = 30;
  openReversal(state, []);
  assert.equal(state.reversal.until - state.tick, 210);
  assert.equal(state.weaponFireAt['bomb-bay'], 212);
  assert.equal(state.podsAt, 65);
  state.tick = state.reversal.until - 1;
  assert.equal(weaponCooldown(state, 'bomb-bay', 360), 295);
});

test('Fire Control shortens a real weak-point lock and crits use only the combat RNG', () => {
  function sequence() {
    const state = createStage(parseStageOptions('?mode=survivors&fixture=boss&seed=21'), ground);
    const point = state.boss.weakPoints[0];
    const { x, z, altitude } = state.player;
    Object.assign(point, { x, z: z + 90, alt: altitude });
    state.run.buffLevels['fire-control'] = 3;
    state.twinAt = Infinity;
    for (let tick = 1; tick <= 12; tick++) {
      acquireAndFire(state);
      assert.equal(state.lock.ready, tick === 12);
    }
    const spawn = state.streams.spawn.rng;
    const enemy = makeEnemy(state, x, z + 60, 1, 'patrol', 0);
    enemy.hp = 100;
    const strikes = [];
    for (let i = 0; i < 35; i++) {
      const hp = enemy.hp;
      hurtEnemy(state, enemy, 1);
      strikes.push(hp - enemy.hp);
    }
    assert.equal(state.streams.spawn.rng, spawn);
    assert.ok(strikes.includes(1) && strikes.includes(2));
    return strikes;
  }
  assert.deepEqual(sequence(), sequence());
});

test('Flare Bay increases stock, reload speed and burn duration', () => {
  const state = start();
  state.tick = 1;
  state.run.buffLevels['flare-bay'] = 3;
  const capacity = flareCapacity(state);
  state.flareCharges = capacity;
  dropFlares(state, 0, 0);
  assert.equal(capacity, 6);
  assert.equal(state.flareCharges, 5);
  assert.equal(state.flareReloadAt - state.tick, 273);
  const flare = state.flares[2];
  const enemy = makeEnemy(state, flare.x, flare.z, 1, 'interceptor', 0);
  state.enemies = [enemy];
  advanceFlares(state, ground);
  assert.equal(enemy.burnUntil - state.tick, 142);
  state.tick = state.flareReloadAt;
  advanceFlares(state, ground);
  assert.equal(state.flareCharges, capacity);
});

test('Ordnance Rack expands manual stores, recharge and blast reach', () => {
  const state = start();
  state.tick = 1;
  state.run.buffLevels['ordnance-rack'] = 3;
  state.bombs = bombCapacity(state);
  assert.equal(state.bombs, 6);
  dropRearBomb(state);
  const bomb = state.rearBombs[0];
  assert.equal(state.bombs, 5);
  assert.equal(state.bombReloadAt - state.tick, 293);
  const trigger = makeEnemy(state, bomb.x, bomb.z, 1, 'patrol', 0);
  const edge = makeEnemy(state, bomb.x + 42, bomb.z, 1, 'patrol', 0);
  state.enemies = [trigger, edge];
  advanceRearBombs(state, ground);
  assert.equal(edge.hp, 0);
  assert.ok(state.effects.find(effect => effect.kind === 'bomb-blast').radius > 42);
  state.tick = state.bombReloadAt;
  advanceRearBombs(state, ground);
  assert.equal(state.bombs, 6);
});

test('Twin Cannon level five fires paired bolts with a single penetration and more damage', () => {
  const state = start();
  const { x, z } = state.player;
  state.run.weaponLevels.twin = 5;
  state.enemies = [makeEnemy(state, x, z + 75, 1, 'patrol', 0)];
  acquireAndFire(state);
  assert.equal(state.shots.length, 4);
  assert.equal(state.twinAt, 18);
  assert.ok(state.shots.every(shot => shot.kind === 'twin' && shot.pierce.remaining === 2 && shot.damage === 1.15));
});

test('Wing Pods add a rear bolt at level five and keep their same-band restriction', () => {
  const state = start();
  const { x, z } = state.player;
  state.run.weaponLevels.pods = 5;
  state.enemies = [makeEnemy(state, x - 22, z - 66, 2, 'patrol', 0)];
  acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'pods').length, 0);
  state.enemies[0].alt = 110;
  acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'pods').length, 2);
  assert.equal(state.podsAt, 36);
});

test('Ion Wake makes a vertical damage curtain and level five attracts salvage along it', () => {
  const state = start();
  state.tick = 10;
  const { x, z } = state.player;
  state.run.weaponLevels.ion = 5;
  state.ionWake = [{ x, z: z - 34, alt: 75, until: 100 }, { x, z: z - 60, alt: 145, until: 100 }];
  const inside = makeEnemy(state, x, z - 49, 1, 'interceptor', 0);
  const outside = makeEnemy(state, x + 12, z - 49, 1, 'interceptor', 0);
  state.enemies = [inside, outside];
  state.pickups.push({ id: 606, x, z: z - 52, alt: 110, xp: 1, born: 0 });
  advanceSupportWeapons(state);
  assert.ok(inside.hp < 3);
  assert.equal(outside.hp, 4);
  assert.equal(state.pickups[0].pulling, true);
  const hp = inside.hp;
  advanceSupportWeapons(state);
  assert.equal(inside.hp, hp);
});

test('orbit drones damage same-altitude contacts, block enemy bolts, and shoot at level five', () => {
  const state = start();
  state.run.weaponLevels.drones = 5;
  const { x, z } = state.player;
  const contact = makeEnemy(state, x, z + 22.5, 1, 'interceptor', 0);
  state.enemies = [contact];
  advanceSupportWeapons(state);
  assert.equal(state.orbitDrones.length, 3);
  assert.ok(state.orbitDrones.some(drone => drone.alt > 117));
  assert.ok(contact.hp < 4);
  assert.ok(state.shots.some(shot => shot.kind === 'drone-bolt'));
  const bolt = { x, z: z + 32, alt: 110, vx: 0, vz: -900, life: 2, damage: 2, kind: 'hostile',
    volley: 0, nearMiss: false, lockId: null };
  state.shots.push(bolt);
  advanceShots(state, ground);
  assert.ok(!state.shots.includes(bolt));
  assert.equal(state.hull, state.maxHull);
});

test('Phoenix Flares drop one automatic flare and spread at level five without spending a manual charge', () => {
  const state = start();
  state.tick = 100;
  state.run.weaponLevels.phoenix = 5;
  advanceAutoOrdnance(state, false);
  assert.equal(state.flareCharges, 3);
  assert.equal(state.flares.length, 1);
  assert.equal(state.flares[0].lifeTicks, 180);
  const { x, z } = state.flares[0];
  const first = makeEnemy(state, x, z, 1, 'interceptor', 0);
  const neighbor = makeEnemy(state, x + 9, z, 1, 'interceptor', 0);
  const above = makeEnemy(state, x, z, 2, 'interceptor', 0);
  state.enemies = [first, neighbor, above];
  advanceFlares(state, ground);
  assert.ok(first.hp < 3);
  assert.equal(neighbor.burnUntil, first.burnUntil);
  assert.equal(above.burnUntil, undefined);
});

test('Bomb Bay double-drops at level five, detonates below launch band and leaves manual stock intact', () => {
  const state = start();
  state.tick = 40;
  state.player.altitude = 145;
  state.run.weaponLevels['bomb-bay'] = 5;
  advanceAutoOrdnance(state, false);
  state.tick = state.nextBayDrop;
  advanceAutoOrdnance(state, false);
  assert.equal(state.bombs, 3);
  assert.equal(state.rearBombs.length, 2);
  assert.ok(state.rearBombs.every(bomb => bomb.weapon === 'bomb-bay'));
  const [bomb] = state.rearBombs;
  const low = makeEnemy(state, bomb.x, bomb.z, 1, 'interceptor', 0);
  const high = makeEnemy(state, bomb.x, bomb.z, 2, 'interceptor', 0);
  state.enemies = [low, high];
  advanceRearBombs(state, ground);
  assert.equal(high.hp, 4);
  assert.equal(state.rearBombs.length, 2, 'the launcher cannot pre-detonate in its own band');
  state.tick += 60;
  bomb.alt = 110;
  advanceRearBombs(state, ground);
  assert.equal(low.hp, 0);
  assert.equal(high.hp, 4);
});

test('headless Heat raises regular armor while leaving the seeded formation unchanged', () => {
  const base = start();
  const hot = createStage({ ...parseStageOptions('?mode=survivors&t=0'), heat: 5 }, ground);
  for (let i = 0; i < 45; i++) {
    stepStage(base, {}, ground);
    stepStage(hot, {}, ground);
  }
  assert.ok(base.enemies.length > 0);
  assert.deepEqual(hot.enemies.map(e => e.entry), base.enemies.map(e => e.entry));
  assert.ok(hot.enemies.every((e, index) => e.hp > base.enemies[index].hp));
});
