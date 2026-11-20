import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/data/items.ts';
import { advanceRangedShot, advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { BANDS, openReversal } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const ground = () => 35;
const [low, mid, high] = BANDS;
const setup = (weapon, level = 1, alt = mid) => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), ground);
  state.run.weaponLevels = { [weapon]: level };
  Object.assign(state.player, { x: 0, z: 0, altitude: alt, yaw: 0 });
  return state;
};
const contact = (state, x, z, alt = mid) => {
  const enemy = makeEnemy(state, x, z, 1, 'patrol', alt - mid);
  enemy.hp = 12;
  state.enemies.push(enemy);
  return enemy;
};
const projectiles = (state, count, terrain = ground) => {
  for (let tick = 0; tick < count; tick++) {
    const active = state.shots.length;
    for (let i = 0; i < active; i++) advanceRangedShot(state, state.shots[i], terrain);
    state.shots = state.shots.filter(shot => shot.life > 0);
    state.tick++;
  }
};

test('Seeker fires three guided missiles and climbs one band, leaving two-band targets alone', () => {
  const state = setup('seeker', 1, low);
  const outOfBand = contact(state, 0, 64, high);
  advanceRangedWeapons(state, ground);
  assert.deepEqual(state.shots, []);
  const adjacent = contact(state, 3, 120, mid);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 3);
  assert.ok(state.shots.every(shot => shot.kind === 'seeker' && shot.targetId === adjacent.id));
  projectiles(state, 30);
  assert.ok(state.shots.every(shot => shot.alt > low && shot.alt < mid));
  projectiles(state, 110);
  assert.ok(adjacent.hp < 12);
  assert.equal(outOfBand.hp, 12);
});

test('Seeker can line up a close target on an adjacent band', () => {
  const state = setup('seeker', 1, low);
  const adjacent = contact(state, 0, 18, mid);
  advanceRangedWeapons(state, ground);
  projectiles(state, 110);
  assert.ok(adjacent.hp < 12);
});

test('Seeker level five carries four larger blasts and triggers one separate loop volley', () => {
  const state = setup('seeker', 5);
  const target = contact(state, 0, 120);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 4);
  assert.ok(state.shots.every(shot => shot.radius === WEAPONS.seeker.tuning.radius[4]));
  assert.equal(state.weaponFireAt.seeker, 153);
  state.tick = 20;
  state.maneuverTrail = { kind: 'immelmann', startTick: 1 };
  openReversal(state, []);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 8);
  state.tick++;
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 8);
  const first = state.shots[0];
  const splash = contact(state, 14, target.z - 5);
  Object.assign(first, { x: 0, z: target.z - 5 });
  advanceRangedShot(state, first, ground);
  assert.ok(splash.hp < 12);
});

test('Rail charges for 54 ticks, pierces a line, and ends against intervening terrain', () => {
  const state = setup('rail');
  const terrain = (x, z) => z >= 118 && z <= 126 ? 150 : 35;
  const one = contact(state, 0, 45, mid + 3);
  const two = contact(state, 3, 100);
  const wrongHeight = contact(state, 0, 80, mid + 3.01);
  const behindWall = contact(state, 0, 150);
  advanceRangedWeapons(state, terrain);
  assert.equal(state.railChargeAt, 54);
  assert.ok(state.weaponFx.some(effect => effect.kind === 'rail-charge'));
  state.tick = 53;
  advanceRangedWeapons(state, terrain);
  assert.equal(one.hp, 12);
  state.tick++;
  advanceRangedWeapons(state, terrain);
  assert.equal(one.hp, 9);
  assert.equal(two.hp, 9);
  assert.equal(wrongHeight.hp, 12);
  assert.equal(behindWall.hp, 12);
  assert.equal(state.weaponFireAt.rail, 54 + 144);
});

test('Rail level five widens and pierces an additional lower band', () => {
  const state = setup('rail', 5, high);
  const wide = contact(state, 4, 70, high);
  const below = contact(state, 0, 75, mid);
  const tooLow = contact(state, 0, 75, low);
  advanceRangedWeapons(state, ground);
  state.tick = 54;
  advanceRangedWeapons(state, ground);
  for (const target of [wide, below]) assert.ok(Math.abs(target.hp - (12 - 3.75 * 1.15)) < 1e-9);
  assert.equal(tooLow.hp, 12);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'rail-beam').length, 2);
});

test('Flak shell bursts around 90 metres and bridges two bands from their midpoint', () => {
  const state = setup('flak', 1, (mid + high) / 2);
  const targets = BANDS.map(alt => contact(state, 0, 90, alt));
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots[0]?.kind, 'flak-shell');
  projectiles(state, 35);
  assert.ok(targets.every(enemy => enemy.hp === 12));
  projectiles(state, 1);
  assert.deepEqual(targets.map(enemy => enemy.hp), [12, 10, 10]);
  const burst = state.weaponFx.find(effect => effect.kind === 'flak-blast');
  assert.ok(Math.abs(burst.from.z - 90) < 1e-9);
  assert.equal(burst.radius, 22);
});

test('Flak level five sends six radial same-altitude fragments', () => {
  const state = setup('flak', 5);
  contact(state, 0, 89);
  advanceRangedWeapons(state, ground);
  projectiles(state, 36);
  assert.equal(state.shots.length, 6);
  assert.ok(state.shots.every(shot => shot.kind === 'flak-shard' && shot.alt === mid));
  assert.equal(new Set(state.shots.map(shot => Math.atan2(shot.vx, shot.vz))).size, 6);
});

test('Arc starts on the firing band and chains to an adjacent band with 60 percent damage', () => {
  const state = setup('arc');
  const initial = contact(state, 0, 30);
  const adjacent = contact(state, 0, 60, high);
  const twoAway = contact(state, 0, 72, low);
  advanceRangedWeapons(state, ground);
  assert.ok(Math.abs(initial.hp - (12 - 1.8)) < 1e-9);
  assert.ok(Math.abs(adjacent.hp - (12 - 1.8 * 0.6)) < 1e-9);
  assert.equal(twoAway.hp, 12);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'arc-link').length, 2);
});

test('Arc level five visits six contacts, then the last link splashes an unvisited neighbour', () => {
  const state = setup('arc', 5);
  const targets = Array.from({ length: 6 }, (_, i) => contact(state, 0, 30 + i * 33));
  const splash = contact(state, 15, targets.at(-1).z);
  advanceRangedWeapons(state, ground);
  assert.ok(targets.every(enemy => enemy.hp < 12));
  assert.ok(splash.hp < 12 && splash.hp > targets.at(-1).hp);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'arc-link').length, 6);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'arc-blast').length, 1);
});

test('an inbound enemy and Warden weak point ignore ranged hits until engagement and lock', () => {
  const state = setup('rail');
  const enemy = contact(state, 0, 46);
  enemy.entry = {};
  const weak = { id: 99, x: 0, z: 78, alt: mid, window: 3, kind: 'core', hp: 12, hits: 0 };
  state.boss = { weakPoints: [weak], index: 0, exposeTick: 0, entry: {} };
  state.lock = { id: weak.id, progress: 1, ready: true };
  state.railChargeAt = 0;
  advanceRangedWeapons(state, ground);
  assert.equal(enemy.hp, 12);
  assert.equal(weak.hp, 12);
  delete enemy.entry;
  delete state.boss.entry;
  state.railChargeAt = 0;
  state.lock = null;
  advanceRangedWeapons(state, ground);
  assert.equal(enemy.hp, 9);
  assert.equal(weak.hp, 12);
  state.railChargeAt = 0;
  state.lock = { id: weak.id, progress: 1, ready: true };
  advanceRangedWeapons(state, ground);
  assert.equal(weak.hp, 9);
});

test('the normal fixed-step flight path fires and advances a timed shell', () => {
  const state = setup('flak');
  const target = makeEnemy(state, 0, 90, 1, 'gnat');
  target.hp = 3;
  state.enemies.push(target);
  stepStage(state, {}, ground);
  const shell = state.shots.find(shot => shot.kind === 'flak-shell');
  assert.ok(shell && shell.z > state.player.z);
  while (state.tick < shell.fuseAt) stepStage(state, {}, ground);
  assert.equal(target.hp, 1);
  assert.ok(state.weaponFx.some(effect => effect.kind === 'flak-blast'));
  assert.ok(!state.shots.includes(shell));
});
