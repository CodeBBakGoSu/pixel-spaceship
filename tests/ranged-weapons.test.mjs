import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAce } from '../src/ace.ts';
import { WEAPONS } from '../src/data/items.ts';
import { weaponDamage } from '../src/loadout.ts';
import { ROLLS } from '../src/data/roll.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { advanceRangedShot, advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { advanceShots, BANDS, openReversal, STEP } from '../src/stage-combat.ts';
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
const readyAce = state => {
  const ace = makeAce(state, 0, 120, ground);
  state.boss = ace;
  state.lock = { id: ace.id, progress: 1, ready: true };
  return ace;
};
const lockedSeekers = (state, ace) => {
  advanceRangedWeapons(state, ground);
  return state.shots.filter(shot => shot.kind === 'seeker' && shot.lockId === ace.id);
};
const detonateNear = (state, shot, target) => {
  Object.assign(shot, { x: target.x, z: target.z - 5, alt: target.alt });
  const before = target.hp;
  advanceRangedShot(state, shot, ground);
  return before - target.hp;
};
const assertDamage = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `expected ${expected} damage, got ${actual}`);
const projectiles = (state, count, terrain = ground) => {
  for (let tick = 0; tick < count; tick++) {
    const active = state.shots.length;
    for (let i = 0; i < active; i++) advanceRangedShot(state, state.shots[i], terrain);
    state.shots = state.shots.filter(shot => shot.life > 0);
    state.tick++;
  }
};

test('Seeker vertical travel retains its per-tick rate in both directions and stops without a target', () => {
  for (const direction of [-1, 1]) {
    const state = setup('seeker');
    const target = contact(state, 0, 120, BANDS[direction < 0 ? 0 : 2]);
    advanceRangedWeapons(state, ground);
    const shot = state.shots[0], altitude = shot.alt;
    advanceRangedShot(state, shot, ground);
    assert.ok(Math.abs(shot.alt - altitude - direction * 34 * STEP) < 1e-9);
    target.hp = 0;
    const prior = shot.alt;
    advanceRangedShot(state, shot, ground);
    assert.equal(shot.alt, prior);
    assert.equal(shot.vy, 0);
  }
});

test('Seeker fires three guided missiles and climbs one band, leaving two-band targets alone', () => {
  const state = setup('seeker', 1, low);
  const outOfBand = contact(state, 0, 64, high);
  advanceRangedWeapons(state, ground);
  assert.deepEqual(state.shots, []);
  const adjacent = contact(state, scaleTravel(3), scaleTravel(120), mid);
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 3);
  assert.ok(state.shots.every(shot => shot.kind === 'seeker' && shot.targetId === adjacent.id));
  projectiles(state, 30);
  assert.ok(state.shots.every(shot => shot.alt > low && shot.alt < mid));
  projectiles(state, 125);
  assert.ok(adjacent.hp < 12);
  assert.equal(outOfBand.hp, 12);
});

test('Seeker can line up a close target on an adjacent band', () => {
  const state = setup('seeker', 1, low);
  const adjacent = contact(state, 0, 18, mid);
  advanceRangedWeapons(state, ground);
  projectiles(state, 125);
  assert.ok(adjacent.hp < 12);
});

test('base Seeker volleys at levels one, four, and seven concentrate on the nearest ordinary target', () => {
  for (const level of [1, 4, 7]) {
    const state = setup('seeker', level);
    contact(state, 0, 180);
    const nearest = contact(state, 8, 100);

    assert.equal(state.lock?.ready, undefined);
    advanceRangedWeapons(state, ground);
    const volley = state.shots.filter(shot => shot.kind === 'seeker');

    assert.equal(volley.length, WEAPONS.seeker.tuning.count[level - 1]);
    assert.ok(volley.every(shot => shot.targetId === nearest.id));
    assert.ok(volley.every(shot => shot.lockId === null));
  }
});

test('base Seeker keeps its living original target when a closer distractor appears', () => {
  const state = setup('seeker', 4);
  const original = contact(state, 0, 160);
  advanceRangedWeapons(state, ground);
  const shot = state.shots[0];
  assert.equal(shot.targetId, original.id);

  const distractor = contact(state, 0, 60);
  const originalHp = original.hp, distractorHp = distractor.hp;
  advanceRangedShot(state, shot, ground);

  assert.equal(shot.targetId, original.id);
  assert.equal(original.hp, originalHp);
  assert.equal(distractor.hp, distractorHp);
});

test('base Seeker does not transfer an ordinary missile when its original target is dead or ineligible', () => {
  for (const condition of ['dead', 'out-of-band', 'entry']) {
    const playerAltitude = condition === 'out-of-band' ? high : mid;
    const state = setup('seeker', 4, playerAltitude);
    const original = contact(state, 0, 160, playerAltitude);
    advanceRangedWeapons(state, ground);
    const shot = state.shots[0];
    assert.equal(shot.targetId, original.id, condition);

    const distractor = contact(state, 0, 80, playerAltitude);
    if (condition === 'dead') original.hp = 0;
    if (condition === 'out-of-band') original.alt = low;
    if (condition === 'entry') original.entry = {};
    const startZ = shot.z, startLife = shot.life;

    advanceRangedShot(state, shot, ground);

    assert.equal(shot.targetId, original.id, condition);
    assert.ok(shot.z > startZ, condition);
    assert.equal(shot.vy, 0, condition);
    assert.ok(shot.life < startLife, condition);
    assert.equal(distractor.hp, 12, condition);
  }
});

test('base Seeker with no eligible target flies straight and expires through advanceShots', () => {
  const state = setup('seeker', 4);
  const original = contact(state, 0, 160);
  advanceRangedWeapons(state, ground);
  const shot = state.shots[0];
  state.shots = [shot];
  original.hp = 0;
  const distractor = contact(state, 0, 60);
  const startZ = shot.z, startLife = shot.life;

  advanceShots(state, ground);

  assert.equal(state.shots.length, 1);
  assert.equal(shot.targetId, original.id);
  assert.ok(shot.z > startZ);
  assert.equal(shot.vy, 0);
  assert.ok(shot.life < startLife);
  assert.equal(distractor.hp, 12);

  let ticks = 1;
  while (state.shots.length && ticks < 300) {
    state.tick++;
    advanceShots(state, ground);
    ticks++;
  }
  assert.equal(state.shots.length, 0);
  assert.ok(ticks < 300);
  assert.equal(distractor.hp, 12);
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

test('Seeker multiplies damage only for a currently ready lock on a vulnerable Ace', () => {
  assert.equal(WEAPONS.seeker.tuning.lockedAceDamageScale, 18);
  const state = setup('seeker'), ace = readyAce(state);
  const [shot] = lockedSeekers(state, ace);
  const baseDamage = shot.damage;

  assertDamage(detonateNear(state, shot, ace), baseDamage * WEAPONS.seeker.tuning.lockedAceDamageScale);
  assert.equal(shot.damage, baseDamage);

  for (const [label, playerLock, targetMatches] of [
    ['lost', null, true],
    ['not ready', id => ({ id, progress: 1, ready: false }), true],
    ['different id', id => ({ id: id + 1, progress: 1, ready: true }), true],
    ['different target id', id => ({ id, progress: 1, ready: true }), false],
  ]) {
    const state = setup('seeker'), ace = readyAce(state);
    const [shot] = lockedSeekers(state, ace);
    const baseDamage = shot.damage;
    const targetId = targetMatches ? ace.id : ace.id + 1;
    state.lock = typeof playerLock === 'function' ? playerLock(ace.id) : playerLock;
    shot.targetId = targetId;

    assertDamage(detonateNear(state, shot, ace), baseDamage);
    assert.equal(shot.targetId, targetId, label);
    assert.equal(shot.lockId, ace.id, label);
    assert.equal(shot.life, 0, label);
  }
});

test('Seeker ignores Ace barrel-roll iframe and entry state, then boosts after the iframe expires', () => {
  const state = setup('seeker'), ace = readyAce(state);
  const [invulnerable, vulnerable] = lockedSeekers(state, ace);
  const baseDamage = invulnerable.damage;
  ace.roll = { kind: 'barrel', side: 1, elapsed: ROLLS.barrel.iframeTicks - 1, altitude: ace.alt };

  assert.equal(detonateNear(state, invulnerable, ace), 0);
  assert.equal(ace.hits, 0);
  ace.roll.elapsed = ROLLS.barrel.iframeTicks;
  state.tick++;
  assertDamage(detonateNear(state, vulnerable, ace), baseDamage * WEAPONS.seeker.tuning.lockedAceDamageScale);

  const enteringState = setup('seeker'), enteringAce = readyAce(enteringState);
  const [entryShot] = lockedSeekers(enteringState, enteringAce);
  const entryHp = enteringAce.hp;
  enteringAce.entry = {};
  Object.assign(entryShot, { x: enteringAce.x, z: enteringAce.z - 5, alt: enteringAce.alt });
  advanceRangedShot(enteringState, entryShot, ground);
  assert.equal(enteringAce.hp, entryHp);
  assert.equal(entryShot.targetId, null);
  assert.equal(entryShot.lockId, null);
});

test('Seeker Ace bonus never amplifies ordinary enemy splash', () => {
  for (const keepLock of [true, false]) {
    const state = setup('seeker'), ace = readyAce(state);
    const splash = contact(state, ace.x + 5, ace.z);
    splash.hp = 100;
    const [shot] = lockedSeekers(state, ace);
    const baseDamage = shot.damage;
    if (!keepLock) state.lock = null;

    assertDamage(detonateNear(state, shot, ace), baseDamage * (keepLock ? WEAPONS.seeker.tuning.lockedAceDamageScale : 1));
    assertDamage(100 - splash.hp, baseDamage);
    assert.equal(shot.damage, baseDamage);
  }
});

test('regular-only and retargeted Seekers and locked Flak shells retain base damage', () => {
  const regularState = setup('seeker'), regular = contact(regularState, 0, 120);
  regular.hp = 100;
  advanceRangedWeapons(regularState, ground);
  const regularShot = regularState.shots.find(shot => shot.kind === 'seeker');
  assert.equal(regularShot.lockId, null);
  assertDamage(detonateNear(regularState, regularShot, regular), regularShot.damage);

  const retargetState = setup('seeker'), retargetAce = readyAce(retargetState);
  const retarget = contact(retargetState, 0, 120);
  retarget.hp = 100;
  const [retargetShot] = lockedSeekers(retargetState, retargetAce);
  retargetState.boss = null;
  assertDamage(detonateNear(retargetState, retargetShot, retarget), retargetShot.damage);
  assert.equal(retargetShot.targetId, retarget.id);
  assert.equal(retargetShot.lockId, null);

  const flakState = setup('flak'), flakAce = makeAce(flakState, 0, WEAPONS.flak.tuning.range, ground);
  flakState.boss = flakAce;
  flakState.lock = { id: flakAce.id, progress: 1, ready: true };
  advanceRangedWeapons(flakState, ground);
  const shell = flakState.shots.find(shot => shot.kind === 'flak-shell');
  assert.ok(shell && shell.lockId === flakAce.id);
  Object.assign(shell, { x: flakAce.x, z: flakAce.z, alt: flakAce.alt, vx: 0, vz: 0, fuseAt: flakState.tick });
  const flakDamage = shell.damage;
  const before = flakAce.hp;
  advanceRangedShot(flakState, shell, ground);
  assertDamage(before - flakAce.hp, flakDamage);
});

test('Rail charges for 54 ticks, pierces a line, and ends against intervening terrain', () => {
  const state = setup('rail');
  const terrain = (x, z) => z >= 118 && z <= 126 ? 150 : 35;
  const one = contact(state, 0, 45, mid + 3);
  const two = contact(state, scaleTravel(3), 100);
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

test('Rail level five fires wider beams in its own and the adjacent bands', () => {
  const state = setup('rail', 5, mid);
  const wide = contact(state, scaleTravel(4), 70, mid);
  const below = contact(state, 0, 75, low);
  const above = contact(state, 0, 75, high);
  advanceRangedWeapons(state, ground);
  state.tick = 54;
  advanceRangedWeapons(state, ground);
  for (const target of [wide, below, above]) assert.equal(target.hp, 12 - weaponDamage(state, 'rail', WEAPONS.rail.tuning.damage));
  assert.equal(state.weaponFx.filter(effect => effect.kind === 'rail-beam').length, 3);
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

test('Arc starts on the firing band and chains to an adjacent band with 60 percent damage', () => {
  const state = setup('arc');
  const initial = contact(state, 0, scaleTravel(30));
  const adjacent = contact(state, 0, scaleTravel(60), high);
  const twoAway = contact(state, 0, scaleTravel(72), low);
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
  assert.ok(splash.hp < 12 && splash.hp > targets.at(-1).hp);
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
  const target = makeEnemy(state, 0, scaleTravel(90), 1, 'gnat');
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
