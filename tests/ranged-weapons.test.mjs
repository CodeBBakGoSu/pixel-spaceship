import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAce } from '../src/ace.ts';
import { WEAPONS } from '../src/data/items.ts';
import { weaponDamage } from '../src/loadout.ts';
import { ROLLS } from '../src/data/roll.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { advanceRangedShot, advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { BANDS, openReversal, STEP } from '../src/stage-combat.ts';
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

test('Seeker turns in 3D within its climb rate and keeps momentum without a target', () => {
  for (const direction of [-1, 1]) {
    const state = setup('seeker');
    const target = contact(state, 0, 120, BANDS[direction < 0 ? 0 : 2]);
    advanceRangedWeapons(state, ground);
    const shot = state.shots[0], altitude = shot.alt;
    advanceRangedShot(state, shot, ground);
    assert.ok(direction * (shot.alt - altitude) > 0);
    assert.ok(Math.abs(shot.alt - altitude) <= 34 * STEP);
    target.hp = 0;
    const prior = shot.alt;
    const priorVy = shot.vy;
    advanceRangedShot(state, shot, ground);
    assert.ok(Math.abs(shot.alt - prior - priorVy * STEP) < 1e-9);
    assert.equal(shot.vy, priorVy);
  }
});

test('Seeker acquires a target beyond its former altitude window using 3D range', () => {
  const state = setup('seeker', 1, low);
  const target = contact(state, 0, scaleTravel(80), low + 10);
  const distant = contact(state, 0, scaleTravel(180), low + 10);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 3);
  assert.ok(state.shots.every(shot => shot.kind === 'seeker' && shot.targetId === target.id));
  projectiles(state, 125);
  assert.ok(target.hp < 12);
  assert.equal(distant.hp, 12);
});

test('Seeker can line up a close target on an adjacent band', () => {
  const state = setup('seeker', 1, low);
  const adjacent = contact(state, 0, 60, low + 10);
  advanceRangedWeapons(state, ground);
  projectiles(state, 125);
  assert.ok(adjacent.hp < 12);
});

test('Seeker acquires and hits a continuous-height target inside its 3D cone, but ignores one outside it', () => {
  const aligned = setup('seeker', 1, mid);
  const elevated = contact(aligned, 0, 55, mid + 10);
  advanceRangedWeapons(aligned, ground);
  assert.ok(aligned.shots.length > 0);
  assert.ok(aligned.shots.every(shot => shot.targetId === elevated.id));
  projectiles(aligned, 125);
  assert.ok(elevated.hp < 12);

  const outside = setup('seeker', 1, mid);
  contact(outside, 0, 30, mid + 85);
  advanceRangedWeapons(outside, ground);
  assert.equal(outside.shots.length, 0);
});

test('Seeker revalidates retained targets and locked Aces against Survivors range and capture cone', () => {
  const distant = setup('seeker');
  const farTarget = contact(distant, 0, 80);
  advanceRangedWeapons(distant, ground);
  const farShot = distant.shots[0];
  farTarget.z = 100000;
  advanceRangedShot(distant, farShot, ground);
  assert.equal(farShot.targetId, null);

  const offAngle = setup('seeker');
  const sideTarget = contact(offAngle, 0, 80);
  advanceRangedWeapons(offAngle, ground);
  sideTarget.x = 70;
  sideTarget.z = 1;
  advanceRangedShot(offAngle, offAngle.shots[0], ground);
  assert.equal(offAngle.shots[0].targetId, null);

  const state = setup('seeker');
  const target = contact(state, 0, 80);
  advanceRangedWeapons(state, ground);
  const shot = state.shots[0];
  state.boss = { id: 900, hp: 100, entry: false, x: 0, z: 0, alt: shot.alt + 10000 };
  shot.lockId = 900;
  advanceRangedShot(state, shot, ground);
  assert.equal(shot.lockId, null);
  assert.equal(shot.targetId, target.id);

  const outsideCone = setup('seeker');
  const aligned = contact(outsideCone, 0, 80);
  advanceRangedWeapons(outsideCone, ground);
  const aceLockedShot = outsideCone.shots[0];
  outsideCone.boss = { id: 901, hp: 100, entry: false, x: 70, z: 1, alt: aceLockedShot.alt };
  aceLockedShot.lockId = 901;
  advanceRangedShot(outsideCone, aceLockedShot, ground);
  assert.equal(aceLockedShot.lockId, null);
  assert.equal(aceLockedShot.targetId, aligned.id);
});

test('Seeker level five carries six larger blasts and triggers one separate loop volley', () => {
  const state = setup('seeker', 5);
  const target = contact(state, 0, 120);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 6);
  assert.ok(state.shots.every(shot => shot.radius === WEAPONS.seeker.tuning.radius[4]));
  assert.equal(state.weaponFireAt.seeker, 180);
  state.tick = 20;
  state.maneuverTrail = { kind: 'immelmann', startTick: 1 };
  openReversal(state, []);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 12);
  state.tick++;
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 12);
  const first = state.shots[0];
  const splash = contact(state, scaleTravel(14), target.z - 5);
  Object.assign(first, { x: 0, z: target.z - 5 });
  advanceRangedShot(state, first, ground);
  assert.ok(splash.hp < 12);
});

test('Rail charges for 54 ticks, pierces a line, and ends against intervening terrain', () => {
  const state = setup('rail');
  const terrain = (x, z) => z >= 118 && z <= 126 ? 150 : 35;
  const one = contact(state, 0, 45, mid + 3);
  const two = contact(state, scaleTravel(3), 100);
  const wrongHeight = contact(state, 0, 80, mid + 20);
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

test('Rail level five widens one actual-altitude beam without bridging distant heights', () => {
  const state = setup('rail', 5, mid);
  const wide = contact(state, scaleTravel(4), 70, mid);
  const below = contact(state, 0, 75, low);
  const above = contact(state, 0, 75, high);
  advanceRangedWeapons(state, ground);
  state.tick = 54;
  advanceRangedWeapons(state, ground);
  assert.equal(wide.hp, 12 - weaponDamage(state, 'rail', WEAPONS.rail.tuning.damage));
  assert.equal(below.hp, 12);
  assert.equal(above.hp, 12);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'rail-beam').length, 1);
});

test('Flak shell bursts at its scaled range and bridges two bands from their midpoint', () => {
  const state = setup('flak', 1, (mid + high) / 2);
  const range = scaleTravel(90);
  const targets = BANDS.map(alt => contact(state, 0, range, alt));
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots[0]?.kind, 'flak-shell');
  projectiles(state, 35);
  assert.ok(targets.every(enemy => enemy.hp === 12));
  projectiles(state, 1);
  assert.deepEqual(targets.map(enemy => enemy.hp), [12, 10, 10]);
  const burst = state.weaponFx.find(effect => effect.kind === 'flak-blast');
  assert.ok(Math.abs(burst.from.z - range) < 1e-9);
  assert.equal(burst.radius, scaleTravel(22));
});

test('Flak level seven sends twelve radial same-altitude fragments per shell', () => {
  const state = setup('flak', 7);
  contact(state, 0, scaleTravel(89));
  advanceRangedWeapons(state, ground);
  projectiles(state, 36);
  assert.equal(state.shots.length, 36);
  assert.ok(state.shots.every(shot => shot.kind === 'flak-shard' && shot.alt === mid));
  assert.equal(new Set(state.shots.map(shot => Math.atan2(shot.vx, shot.vz))).size, 12);
});

test('Arc chains through the bounded 3D volume with reduced damage on its second link', () => {
  const state = setup('arc');
  const initial = contact(state, 0, scaleTravel(30));
  const adjacent = contact(state, 0, scaleTravel(45), mid + 15);
  const twoAway = contact(state, 0, scaleTravel(72), mid - 50);
  advanceRangedWeapons(state, ground);
  assert.ok(Math.abs(initial.hp - (12 - 1.8)) < 1e-9);
  assert.ok(Math.abs(adjacent.hp - (12 - 1.8 * 0.6)) < 1e-9);
  assert.equal(twoAway.hp, 12);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'arc-link').length, 2);
});

test('Arc level five visits six contacts, then the last link splashes an unvisited neighbour', () => {
  const state = setup('arc', 5);
  const targets = Array.from({ length: 6 }, (_, i) => contact(state, 0, scaleTravel(30 + i * 33)));
  const splash = contact(state, scaleTravel(15), targets.at(-1).z);
  advanceRangedWeapons(state, ground);
  assert.ok(targets.every(enemy => enemy.hp < 12));
  assert.ok(splash.hp < 12 && splash.hp > targets[0].hp);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'arc-link').length, 6);
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'arc-blast').length, 1);
});

test('an inbound enemy and Ace ignore ranged hits until engagement and lock', () => {
  const state = setup('rail');
  const enemy = contact(state, 0, 46);
  enemy.entry = {};
  const ace = state.boss = makeAce(state, 0, 78);
  ace.hp = 12;
  ace.entry = {};
  state.lock = { id: ace.id, progress: 1, ready: true };
  state.railChargeAt = 0;
  advanceRangedWeapons(state, ground);
  assert.equal(enemy.hp, 12);
  assert.equal(ace.hp, 12);
  delete enemy.entry;
  delete state.boss.entry;
  state.railChargeAt = 0;
  state.lock = null;
  advanceRangedWeapons(state, ground);
  assert.equal(enemy.hp, 9);
  assert.equal(ace.hp, 12);
  state.railChargeAt = 0;
  state.lock = { id: ace.id, progress: 1, ready: true };
  advanceRangedWeapons(state, ground);
  assert.equal(ace.hp, 9);
});

test('Rail afterglow can still damage a locked Ace after barrel-roll immunity expires', () => {
  const state = setup('rail', 7);
  const ace = state.boss = makeAce(state, 0, 78);
  ace.roll = { kind: 'barrel', side: 1, elapsed: 0, altitude: mid };
  state.lock = { id: ace.id, progress: 1, ready: true };
  state.railChargeAt = 0;
  advanceRangedWeapons(state, ground);
  state.tick = 1;
  advanceRangedWeapons(state, ground);
  assert.equal(ace.hits, 0);
  state.tick = 2;
  ace.roll.elapsed = ROLLS.barrel.iframeTicks;
  advanceRangedWeapons(state, ground);
  assert.equal(ace.hits, 1);
  state.tick = 3;
  advanceRangedWeapons(state, ground);
  assert.equal(ace.hits, 1);
});

test('the normal fixed-step flight path fires and advances a timed shell', () => {
  const state = setup('flak');
  state.run.weaponLevels = { flak: 1 };
  const target = makeEnemy(state, 0, scaleTravel(90), 1, 'gnat');
  target.alt = state.player.altitude;
  target.hp = 4;
  state.enemies.push(target);
  stepStage(state, {}, ground);
  const shell = state.shots.find(shot => shot.kind === 'flak-shell');
  assert.ok(shell && shell.z > state.player.z);
  while (state.tick < shell.fuseAt) stepStage(state, {}, ground);
  assert.equal(target.hp, 2);
  assert.ok(state.weaponFx.some(effect => effect.kind === 'flak-blast'));
  assert.ok(!state.shots.includes(shell));
});
