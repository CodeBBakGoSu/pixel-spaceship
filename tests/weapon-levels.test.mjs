import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS } from '../src/bands.ts';
import { DRAFT_RULES, WEAPON_IDS, WEAPONS } from '../src/data/items.ts';
import { PLAYER_SHOT_LIMIT } from '../src/data/run-balance.ts';
import { advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { acquireAndFire, advanceAutoOrdnance, advanceRearBombs, advanceShots } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';

const ground = () => 35;
const [low, mid, high] = BANDS;
const levels = [1, 2, 3, 4, 5, 6, 7];
const start = (weapon, level) => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  state.run.weaponLevels = { [weapon]: level };
  Object.assign(state.player, { x: 0, z: 0, altitude: mid, yaw: 0 });
  return state;
};
const spawn = (state, x, z, alt = mid) => {
  const target = makeEnemy(state, x, z, 1, 'patrol', alt - mid);
  target.hp = 100;
  state.enemies.push(target);
  return target;
};

test('every indexed weapon tune comfortably supports ranks one through seven', () => {
  assert.equal(DRAFT_RULES.maxWeaponLevel, 7);
  for (const id of WEAPON_IDS) {
    for (const [key, values] of Object.entries(WEAPONS[id].tuning)) {
      if (Array.isArray(values)) assert.equal(values.length, 7, `${id}.${key}`);
    }
  }
});

test('a rank-seven Twin fan keeps two shots aimed at its distant primary target', () => {
  for (const evolved of [false, true]) {
    const state = start('twin', 7);
    if (evolved) state.run.evolutions.twin = 'aurora-gatling';
    const target = spawn(state, 0, 300);
    acquireAndFire(state);
    assert.equal(state.shots.length, 6);
    for (; state.tick < 37; state.tick++) advanceShots(state, ground);
    assert.equal(target.hp, 98);
  }
});

test('Wing Pods widen acquisition and scale each flank and rear volley independently', () => {
  const totals = [2, 4, 4, 5, 7, 7, 8];
  for (const level of levels) {
    const state = start('pods', level);
    spawn(state, -65, -12);
    spawn(state, 65, -12);
    spawn(state, 0, -90);
    acquireAndFire(state);
    assert.equal(state.shots.length, totals[level - 1]);
    assert.ok(state.shots.every(shot => (shot.pierce?.remaining ?? 1) === (level >= 6 ? 2 : 1)));
  }
  for (const [distance, rank] of [[145, 3], [184, 7]]) {
    for (const level of [rank - 1, rank]) {
      const state = start('pods', level);
      const far = spawn(state, distance, 0);
      acquireAndFire(state);
      for (let tick = 0; tick < 22; tick++) advanceShots(state, ground);
      assert.equal(far.hp < 100, level >= rank);
    }
  }
});

test('Seeker counts and blast radii rise at separate ranks', () => {
  for (const level of levels) {
    const state = start('seeker', level);
    spawn(state, 0, 80);
    advanceRangedWeapons(state, ground);
    assert.equal(state.shots.length, [3, 4, 4, 5, 6, 6, 8][level - 1]);
    assert.ok(state.shots.every(shot => shot.radius === [24, 24, 31.2, 31.2, 31.2, 38.4, 38.4][level - 1]));
  }
});

test('Rail adds width, reach, vertical lanes, a delayed pulse, and a timed damaging afterglow', () => {
  for (const level of levels) {
    const state = start('rail', level);
    spawn(state, 0, 80, low);
    spawn(state, 0, 80, mid);
    spawn(state, 0, 80, high);
    advanceRangedWeapons(state, ground);
    state.tick = 54;
    advanceRangedWeapons(state, ground);
    const beams = state.weaponFx.filter(fx => fx.kind === 'rail-beam');
    assert.deepEqual(beams.map(fx => fx.from.alt), level < 3 ? [mid] : level < 5 ? [mid, low] : [mid, low, high]);
    assert.ok(beams.every(fx => fx.radius === (level === 1 ? 6 : level < 7 ? 9 : 12)
      && fx.to.z === (level < 4 ? 450 : 562.5)));
    assert.equal(state.railRepeatAt, level < 6 ? undefined : 72);
    const newTarget = spawn(state, 0, 90);
    state.tick = 55;
    advanceRangedWeapons(state, ground);
    assert.equal(newTarget.hp < 100, level === 7);
    const hp = newTarget.hp;
    state.tick = 71;
    advanceRangedWeapons(state, ground);
    assert.equal(newTarget.hp, hp, 'one lingering application per target before the echo');
    state.tick = 72;
    advanceRangedWeapons(state, ground);
    assert.equal(newTarget.hp < hp, level >= 6);
    assert.ok(state.weaponFx.filter(fx => fx.kind === 'rail-glow').every(fx => [84, 102].includes(fx.until)));
  }
});

test('Flak separates shell count, burst radius, and fragments without exceeding the player shot budget', () => {
  for (const level of levels) {
    const state = start('flak', level);
    spawn(state, 0, 175);
    advanceRangedWeapons(state, ground);
    const count = [1, 1, 2, 2, 2, 3, 3][level - 1];
    const fragments = level < 4 ? 0 : level < 7 ? 6 : 12;
    assert.equal(state.shots.length, count);
    assert.ok(state.shots.every(shot => shot.fragmentCount === fragments
      && shot.radius === (level < 2 ? 44 : level < 5 ? 50.6 : 57.2)));
    if (level === 7) {
      for (let i = 0; i < PLAYER_SHOT_LIMIT - 5; i++) state.shots.push({
        kind: 'twin', x: 1, z: -1000, alt: mid, vx: 0, vz: 1,
        life: 5, volley: 0, nearMiss: false, lockId: null, damage: 0,
      });
    }
    for (; state.tick <= 35; state.tick++) advanceShots(state, ground);
    const shards = state.shots.filter(shot => shot.kind === 'flak-shard');
    if (level < 7) assert.equal(shards.length, count * fragments);
    else assert.ok(shards.length > 0 && state.shots.length <= PLAYER_SHOT_LIMIT);
  }
});

test('Ion Wake has separate lanes and levels widen hits, extend life, and pull salvage', () => {
  for (const level of levels) {
    const state = start('ion', level);
    const atWideEdge = spawn(state, 20, -18);
    state.pickups = [{ id: 501, x: 12, z: -18, alt: mid, xp: 1, born: 0 }];
    advanceSupportWeapons(state, ground);
    assert.equal(state.ionWake.length, level < 4 ? 1 : level < 7 ? 2 : 3);
    assert.ok(state.ionWake.every(mote => mote.until === (level < 2 ? 240 : 300)));
    assert.equal(atWideEdge.hp < 100, level >= 4);
    assert.equal(!!state.pickups[0].pulling, level >= 5);
    if (level >= 4) assert.deepEqual(state.ionWake.filter(mote => mote.lane).map(mote => mote.x), [-12, 12]);
  }
});

test('Orbit Drones remain independent, gain their own ranged fire, and split into two rings', () => {
  for (const level of levels) {
    const state = start('drones', level);
    spawn(state, 0, 46);
    advanceSupportWeapons(state, ground);
    assert.equal(state.orbitDrones.length, [2, 3, 3, 4, 4, 5, 6][level - 1]);
    const radii = new Set(state.orbitDrones.map(drone => Math.round(Math.hypot(drone.x, drone.z))));
    assert.deepEqual([...radii], level < 3 ? [36] : level < 7 ? [45] : [45, 32]);
    assert.equal(state.shots.some(shot => shot.kind === 'drone-bolt'), level >= 5);
  }
});

test('Phoenix and Bomb Bay change count, lifetime, radius and lingering fire as equipped ranks grow', () => {
  for (const level of levels) {
    const phoenix = start('phoenix', level);
    advanceAutoOrdnance(phoenix, false);
    assert.equal(phoenix.flares.length, [1, 1, 2, 2, 3, 3, 4][level - 1]);
    assert.ok(phoenix.flares.every(flare => flare.lifeTicks === (level < 2 ? 120 : 180)
      && (flare.spread ?? 0) === (level < 4 ? 0 : level < 6 ? 26 : 39)));
    const bay = start('bomb-bay', level);
    advanceAutoOrdnance(bay, false);
    while (bay.nextBayDrop !== null) {
      bay.tick = bay.nextBayDrop;
      advanceAutoOrdnance(bay, false);
    }
    assert.equal(bay.rearBombs.length, [1, 1, 2, 2, 3, 3, 4][level - 1]);
    assert.ok(bay.rearBombs.every(bomb => bomb.radius === (level < 2 ? 68 : level < 4 ? 78.2 : 88.4)));
    bay.rearBombs = [bay.rearBombs[0]];
    Object.assign(bay.rearBombs[0], { born: bay.tick, alt: 36 });
    advanceRearBombs(bay, ground);
    const fire = bay.weaponFx.find(fx => fx.kind === 'ground-fire');
    assert.equal(!!fire, level >= 6);
    if (!fire) continue;
    const inFire = spawn(bay, 1, 1, 39), above = spawn(bay, 1, 1, low);
    bay.tick += 89;
    advanceRearBombs(bay, ground);
    assert.equal(inFire.hp, 99);
    assert.equal(above.hp, 100);
    const late = spawn(bay, 1, 1, 39);
    bay.tick = fire.until;
    advanceRearBombs(bay, ground);
    assert.equal(late.hp, 100);
  }
});

test('Arc scales jumps, endpoint bursts, and two distinct chains', () => {
  for (const level of levels) {
    const state = start('arc', level);
    for (let i = 0; i < 8; i++) {
      spawn(state, -67, 78 + i * 63);
      spawn(state, 67, 78 + i * 63);
    }
    advanceRangedWeapons(state, ground);
    const links = state.weaponFx.filter(fx => fx.kind === 'arc-link');
    assert.equal(links.length, [3, 4, 5, 5, 6, 12, 16][level - 1]);
    assert.equal(links.filter(fx => fx.from.z === 0).length, level < 6 ? 1 : 2);
    assert.equal(state.weaponFx.filter(fx => fx.kind === 'arc-blast').length, level < 4 ? 0 : level < 6 ? 1 : 2);
    assert.equal(new Set(links.map(fx => `${fx.to.x}/${fx.to.z}`)).size, links.length);
  }
});
