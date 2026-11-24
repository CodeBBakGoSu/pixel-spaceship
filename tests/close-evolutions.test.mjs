import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleClimb, scaleTravel } from '../src/data/speed.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import {
  acquireAndFire, advanceAutoOrdnance, advanceFlares, advanceRearBombs, advanceShots, openReversal, STEP, FLARE_GRAVITY,
} from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';

const sea = () => 35;
const start = () => createStage(parseStageOptions('?mode=survivors&t=0'), sea);

function evolve(state, weapon, id) {
  state.run.weaponLevels[weapon] = 7;
  (state.run.evolutions ??= {})[weapon] = id;
}

function contact(state, x, z, band = 1) {
  const enemy = makeEnemy(state, state.player.x + x, state.player.z + z, band, 'interceptor', 0);
  state.enemies.push(enemy);
  return enemy;
}

test('Aurora Gatling keeps the six-bolt fan and aims into both adjacent bands', () => {
  const state = start();
  evolve(state, 'twin', 'aurora-gatling');
  const low = contact(state, 4, 85, 0), middle = contact(state, 0, 64), high = contact(state, -4, 85, 2);
  acquireAndFire(state);
  const flat = state.shots.filter(shot => shot.kind === 'twin');
  assert.equal(flat.length, 6);
  assert.ok(flat.every(shot => shot.aurora));
  assert.ok(new Set(flat.map(shot => shot.vx)).size > 1);
  const strafe = state.shots.filter(shot => shot.kind === 'strafe');
  assert.deepEqual(strafe.map(shot => shot.targetBand).sort(), [0, 2]);
  assert.ok(strafe.every(shot => shot.aurora));
  for (let tick = 0; tick < 35; tick++) {
    state.tick++;
    advanceShots(state, sea);
  }
  assert.ok(low.hp < 4 && middle.hp < 4 && high.hp < 4);
});

test('Aurora reversal retains its distinct tracers', () => {
  const state = start();
  evolve(state, 'twin', 'aurora-gatling');
  contact(state, 0, 74);
  openReversal(state, []);
  acquireAndFire(state);
  assert.ok(state.shots.length);
  assert.ok(state.shots.every(shot => shot.reversal && shot.aurora));
});

test('Aegis Halo deals same-height contact damage, replaces pod fire and blocks crossing shots', () => {
  const state = start();
  evolve(state, 'pods', 'aegis-halo');
  const touching = contact(state, scaleTravel(19), 0), otherBand = contact(state, scaleTravel(-19), 0, 2);
  advanceSupportWeapons(state, sea);
  assert.ok(touching.hp < 4);
  assert.equal(otherBand.hp, 4);
  acquireAndFire(state);
  assert.ok(!state.shots.some(shot => shot.kind === 'pods'));
  const p = state.player;
  const bolt = { x: p.x + 55, z: p.z, alt: p.altitude, vx: -3600, vz: 0, life: 2, damage: 2, kind: 'hostile',
    volley: 0, nearMiss: false, lockId: null };
  state.shots.push(bolt);
  advanceShots(state, sea);
  assert.ok(!state.shots.includes(bolt));
  assert.equal(state.hull, state.maxHull);
});

test('Plasma Ribbon preserves an eight-second wall and pulses in its own band', () => {
  const state = start();
  evolve(state, 'ion', 'plasma-ribbon');
  const near = contact(state, 0, scaleTravel(-9)), above = contact(state, 0, scaleTravel(-9), 2);
  state.tick = 1;
  advanceSupportWeapons(state, sea);
  assert.equal(state.ionWake[0].until - state.tick, 480);
  const damage = 4 - near.hp;
  assert.ok(damage > 0);
  assert.equal(above.hp, 4);
  advanceSupportWeapons(state, sea);
  assert.equal(near.hp, 4 - damage);
  state.tick = near.ionReadyAt[0];
  advanceSupportWeapons(state, sea);
  assert.ok(near.hp < 4 - damage);
});

test('Collector Swarm retains its six drones and draws salvage beyond pilot pickup range', () => {
  const state = start();
  evolve(state, 'drones', 'collector-swarm');
  const { x, z } = state.player;
  const pickup = { id: 42, x, z: z + scaleTravel(33), alt: 125, xp: 1, born: 0 };
  state.pickups.push(pickup);
  for (let i = 0; i < 12 && !pickup.collected; i++) {
    state.tick++;
    advanceSupportWeapons(state, sea);
  }
  assert.equal(state.orbitDrones.length, 6);
  assert.ok(pickup.z < z + scaleTravel(33));
  assert.equal(pickup.collected, true);
  stepStage(state, {}, sea);
  assert.equal(state.salvage, 1);
  assert.ok(!state.pickups.includes(pickup));
});

test('Phoenix firebird scales per-tick ascent and descent, falling when no target remains', () => {
  for (const direction of [-1, 1]) {
    const state = start();
    evolve(state, 'phoenix', 'phoenix-rising');
    const target = contact(state, 0, -60, direction < 0 ? 0 : 1);
    advanceAutoOrdnance(state, false);
    const flare = state.flares[0];
    flare.alt = target.alt - direction * 20;
    const altitude = flare.alt;
    advanceFlares(state, sea);
    assert.ok(Math.abs(flare.alt - altitude - direction * scaleClimb(28) * STEP) < 1e-9);
    target.hp = 0;
    const vy = flare.vy;
    advanceFlares(state, sea);
    assert.ok(Math.abs(flare.vy - (vy - FLARE_GRAVITY * STEP)) < 1e-9);
  }
});

test('Phoenix Rising steers its automatic firebird', () => {
  const state = start();
  evolve(state, 'phoenix', 'phoenix-rising');
  contact(state, scaleTravel(18), scaleTravel(-35));
  advanceAutoOrdnance(state, false);
  const flare = state.flares[0];
  assert.ok(flare.phoenix);
  advanceFlares(state, sea);
  assert.ok(flare.vx > 0);
});

test('Carpet Annihilator deploys five collinear automatic bombs', () => {
  const state = start();
  evolve(state, 'bomb-bay', 'carpet-annihilator');
  state.player.yaw = 0.7;
  advanceAutoOrdnance(state, false);
  assert.equal(state.rearBombs.length, 5);
  assert.ok(state.rearBombs.every(bomb => bomb.carpet && bomb.born === state.tick));
  const p = state.player;
  assert.ok(state.rearBombs.every(bomb => Math.abs((bomb.x - p.x) * Math.cos(p.yaw) - (bomb.z - p.z) * Math.sin(p.yaw)) < 1e-9));
  assert.equal(new Set(state.rearBombs.map(bomb => bomb.z)).size, 5);
  assert.equal(state.metrics.bombsDropped, 5);
  assert.equal(state.nextBayDrop, null);
});

test('three ballistic weapons give ordinary Twin and Pod bolts one additional pierce', () => {
  const state = start();
  Object.assign(state.run.weaponLevels, { twin: 5, pods: 1, flak: 1 });
  contact(state, 0, 65);
  contact(state, 35, 5);
  acquireAndFire(state);
  assert.ok(state.shots.some(shot => shot.kind === 'twin' && shot.pierce?.remaining === 3));
  assert.ok(state.shots.some(shot => shot.kind === 'pods' && shot.pierce?.remaining === 2));
});

test('three ordnance weapons increase the automatic bomb blast radius', () => {
  const state = start();
  Object.assign(state.run.weaponLevels, { seeker: 1, phoenix: 1, 'bomb-bay': 1 });
  state.player.altitude = 180;
  advanceAutoOrdnance(state, false);
  state.rearBombs[0].alt = 125;
  contact(state, 0, 0);
  advanceRearBombs(state, sea);
  const blast = state.effects.find(effect => effect.kind === 'bomb-blast');
  assert.ok(Math.abs(blast.radius - scaleTravel(34) * 1.2) < 1e-8);
});
