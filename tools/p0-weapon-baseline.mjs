import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAce } from '../src/ace.ts';
import { BANDS } from '../src/bands.ts';
import { BUFF_IDS, WEAPON_IDS } from '../src/data/items.ts';
import { CRUISE_SPEED } from '../src/flight.ts';
import { random, rngStream } from '../src/stage-random.ts';
import { advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { acquireAndFire, advanceAutoOrdnance, advanceEnemyHazards, advanceFlares, advanceRearBombs,
  advanceShots, STEP, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';

export const BASELINE_TICKS = 900;
export const BASELINE_SEED = 23;
export const BASELINE_LEVEL = 4;
export const MID_ALTITUDE = BANDS[1];
export const INTRUSION_RADIUS = 20;

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_ROOT = resolve(REPO_ROOT, 'src');
const HARNESS_PATH = fileURLToPath(import.meta.url);
const GROUND = () => 35;
const NEUTRAL_INPUT = { turn: 0, climb: 0, roll: 0, boost: false, bomb: false, flare: false };
const PLAYER_PATH = Object.freeze({
  kind: 'neutral-forward-cruise', x: 0, yaw: 0, altitude: MID_ALTITUDE,
  speed: CRUISE_SPEED, input: NEUTRAL_INPUT,
});

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function sha256Tree(root) {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  const digest = createHash('sha256');
  for (const path of files.sort()) {
    digest.update(relative(root, path).replaceAll('\\', '/'));
    digest.update('\0');
    digest.update(readFileSync(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const playerZ = tick => CRUISE_SPEED * tick * STEP;
const clamp01 = value => Math.max(0, Math.min(1, value));

function targetPosition(target, tick) {
  const progress = clamp01((tick - target.spawnTick) / (target.approachTicks ?? 1));
  switch (target.motion) {
    case 'fixed-ahead':
      return { x: target.x, z: playerZ(target.spawnTick) + target.forwardOffset, alt: target.alt };
    case 'relative':
      return { x: target.x, z: playerZ(tick) + target.zOffset, alt: target.alt };
    case 'approach':
      return {
        x: target.side * (target.startX + (target.endX - target.startX) * progress),
        z: playerZ(tick) + target.zOffset,
        alt: target.alt,
      };
    case 'orbit': {
      const angle = 2 * Math.PI * (tick / target.periodTicks + target.index / target.count);
      return {
        x: Math.sin(angle) * target.radius * target.radialScale,
        z: playerZ(tick) + Math.cos(angle) * target.radius * target.radialScale,
        alt: target.alt + Math.sin(angle) * target.tilt,
      };
    }
    case 'fixed-world':
      return { x: target.x, z: playerZ(target.spawnTick) + target.zOffset, alt: target.alt };
    default:
      throw new Error(`Unknown target motion: ${target.motion}`);
  }
}

function targetPlan(targets) {
  return targets.map(target => ({
    id: target.id,
    kind: target.kind,
    spawnTick: target.spawnTick,
    positions: Array.from({ length: BASELINE_TICKS - target.spawnTick + 1 }, (_, index) => {
      const tick = target.spawnTick + index;
      return { tick, ...targetPosition(target, tick) };
    }),
  }));
}

function makeSpawnRng(seed, name) {
  return rngStream(seed, `p0-weapon-baseline:${name}`);
}

function buildFixtures(seed) {
  const fixtures = [];
  const randomFor = name => makeSpawnRng(seed, name);
  const add = fixture => fixtures.push({ durationTicks: BASELINE_TICKS, ...fixture });

  const forwardRng = randomFor('forward-column');
  const forwardTargets = Array.from({ length: 13 }, (_, index) => {
    const spawnTick = 1 + index * 60 + Math.floor(random(forwardRng) * 8);
    return {
      id: `gnat-${String(index + 1).padStart(2, '0')}`,
      kind: 'gnat', variant: 'regular', motion: 'fixed-ahead', spawnTick,
      x: Math.round((random(forwardRng) - 0.5) * 16 * 100) / 100,
      forwardOffset: 200 + Math.round(random(forwardRng) * 30), alt: MID_ALTITUDE,
    };
  });
  for (const weapon of ['twin', 'pods', 'seeker']) add({
    id: `primary-forward-${weapon}`, group: 'primary-forward', kind: 'forward-column', weapon,
    condition: 'seeded static Gnat column in a narrow forward lane', targets: forwardTargets,
  });

  const stingRng = randomFor('bilateral-stings');
  const stingTargets = Array.from({ length: 8 }, (_, index) => ({
    id: `sting-${String(index + 1).padStart(2, '0')}`,
    kind: 'gnat', variant: 'sting', motion: 'approach', spawnTick: 1 + index * 90,
    side: index % 2 ? -1 : 1, startX: 122 + Math.round(random(stingRng) * 16), endX: 0,
    approachTicks: 180, zOffset: Math.round((random(stingRng) - 0.5) * 12), alt: MID_ALTITUDE,
  }));
  for (const weapon of ['twin', 'pods', 'seeker']) add({
    id: `primary-stings-${weapon}`, group: 'primary-stings', kind: 'bilateral-sting-waves', weapon,
    condition: 'alternating left/right same-altitude Stings approach the player path', targets: stingTargets,
  });

  for (const range of [{ name: 'near', distance: 60 }, { name: 'middle', distance: 180 }, { name: 'far', distance: 300 }]) {
    const ace = {
      id: `ace-${range.name}`, kind: 'ace', motion: 'relative', spawnTick: 1,
      x: 0, zOffset: range.distance, alt: MID_ALTITUDE, hp: 1200,
    };
    for (const weapon of ['twin', 'pods', 'seeker']) add({
      id: `primary-ace-${range.name}-${weapon}`, group: `primary-ace-${range.name}`,
      kind: 'vulnerable-ready-locked-ace', weapon, condition: `kinematic vulnerable Ace at ${range.distance} m`,
      ace, lockPolicy: 'ready', targets: [],
    });
  }

  const diagnosticAce = { id: 'ace-middle-lock-diagnostic', kind: 'ace', motion: 'relative', spawnTick: 1,
    x: 0, zOffset: 180, alt: MID_ALTITUDE, hp: 1200 };
  for (const lockPolicy of ['ready', 'suppressed']) add({
    id: `seeker-lock-diagnostic-${lockPolicy}`, group: 'seeker-lock-diagnostic',
    pairGroup: 'seeker-lock-diagnostic', kind: 'seeker-lock-diagnostic', weapon: 'seeker',
    condition: lockPolicy === 'ready' ? 'automatic ready lock retained' : 'same target with lock suppressed after acquisition',
    ace: diagnosticAce, lockPolicy, targets: [],
  });

  const railRng = randomFor('rail-pair');
  const railBase = Array.from({ length: 12 }, (_, index) => ({
    id: `rail-${String(index + 1).padStart(2, '0')}`,
    kind: 'patrol', motion: 'fixed-ahead', spawnTick: 1 + Math.floor(index / 4) * 300,
    x: 0, forwardOffset: 220 + (index % 4) * 55 + Math.round(random(railRng) * 4), alt: MID_ALTITUDE,
  }));
  for (const condition of ['aligned', 'dispersed']) add({
    id: `rail-${condition}`, group: 'role-rail', pairGroup: 'role-rail', kind: 'rail-charge',
    weapon: 'rail', condition: condition === 'aligned'
      ? 'targets begin aligned in the firing lane and remain stationary during charge'
      : 'same schedule begins laterally dispersed; targets remain stationary during charge',
    targets: railBase.map((target, index) => ({ ...target,
      x: condition === 'aligned' ? 0 : (index % 2 ? -1 : 1) * (75 + Math.round(random(railRng) * 18)),
    })),
  });

  const flakRng = randomFor('flak-pair');
  const flakBase = Array.from({ length: 5 }, (_, index) => ({
    id: `flak-${index + 1}`, kind: 'patrol', motion: 'fixed-ahead', spawnTick: 1,
    x: Math.round((random(flakRng) - 0.5) * 16), forwardOffset: 180 + Math.round((random(flakRng) - 0.5) * 12),
    alt: MID_ALTITUDE,
  }));
  for (const condition of ['burst-point-cluster', 'close-inside-burst-envelope']) add({
    id: `flak-${condition}`, group: 'role-flak', pairGroup: 'role-flak', kind: 'flak-burst', weapon: 'flak',
    condition: condition === 'burst-point-cluster' ? 'cluster centred on the predicted burst point' : 'same cluster displaced inside the short-range envelope',
    targets: flakBase.map(target => ({ ...target,
      forwardOffset: condition === 'burst-point-cluster' ? target.forwardOffset : 25 + target.forwardOffset - 180,
    })),
  });

  const ionRng = randomFor('ion-pair');
  const ionBase = Array.from({ length: 4 }, (_, index) => ({
    id: `ion-${index + 1}`, kind: 'patrol', motion: 'relative', spawnTick: 1 + index * 150,
    x: Math.round((random(ionRng) - 0.5) * 6), zOffset: 0, alt: MID_ALTITUDE,
  }));
  for (const condition of ['pursuit-crosses-wake', 'untouched-front']) add({
    id: `ion-${condition}`, group: 'role-ion', pairGroup: 'role-ion', kind: 'ion-wake', weapon: 'ion',
    condition: condition === 'pursuit-crosses-wake' ? 'pursuer follows the rear wake path' : 'same target follows ahead of the player',
    targets: ionBase.map(target => ({ ...target, zOffset: condition === 'pursuit-crosses-wake' ? -18 : 18 })),
  });

  for (const condition of ['on-orbit', 'outside-orbit']) add({
    id: `drones-${condition}`, group: 'role-drones', pairGroup: 'role-drones', kind: 'orbit-contact', weapon: 'drones',
    condition: condition === 'on-orbit' ? 'target follows one Lv4 drone orbit' : 'same path offset beyond the orbit contact radius',
    interceptHostile: true,
    targets: [{ id: 'drone-contact', kind: 'patrol', motion: 'orbit', spawnTick: 1,
      radius: 45, radialScale: condition === 'on-orbit' ? 1 : 70 / 45,
      periodTicks: 145, index: 0, count: 4, tilt: 10, alt: MID_ALTITUDE }],
  });

  for (const condition of ['rear', 'front']) add({
    id: `phoenix-${condition}`, group: 'role-phoenix', pairGroup: 'role-phoenix', kind: 'phoenix-rear-pursuit', weapon: 'phoenix',
    condition: condition === 'rear' ? 'same-band pursuer follows 80 m behind' : 'same-band target is 80 m ahead',
    targets: [{ id: 'phoenix-target', kind: 'patrol', motion: 'relative', spawnTick: 1,
      x: 8, zOffset: condition === 'rear' ? -80 : 80, alt: 120 }],
  });

  for (const condition of ['below', 'above']) add({
    id: `bomb-bay-${condition}`, group: 'role-bomb-bay', pairGroup: 'role-bomb-bay', kind: 'bomb-bay-vertical-coverage', weapon: 'bomb-bay',
    condition: condition === 'below' ? 'target beneath the bomb launch altitude' : 'same-position target above the launch ceiling',
    targets: [{ id: 'bomb-target', kind: 'patrol', motion: 'fixed-world', spawnTick: 1,
      x: 0, zOffset: 0, alt: condition === 'below' ? 50 : 150 }],
  });

  const arcSpawnTick = 1;
  add({
    id: 'arc-connected-chain', group: 'role-arc', pairGroup: 'role-arc', kind: 'arc-adjacent-band-chain', weapon: 'arc',
    comparisonMode: 'qualitative-chain-coverage-not-matched-damage',
    condition: 'five targets form a connected mid/high-band chain inside jump spacing',
    targets: [125, 180, 125, 180, 125].map((alt, index) => ({
      id: `arc-target-${index + 1}`, kind: 'patrol', motion: 'fixed-ahead', spawnTick: arcSpawnTick,
      x: 0, forwardOffset: 80 + index * 40, alt,
    })),
  });
  add({
    id: 'arc-isolated-ace', group: 'role-arc', pairGroup: 'role-arc', kind: 'arc-isolated-ace', weapon: 'arc',
    comparisonMode: 'qualitative-chain-coverage-not-matched-damage',
    condition: 'one isolated vulnerable Ace at the same forward range',
    ace: { id: 'arc-isolated-ace', kind: 'ace', motion: 'relative', spawnTick: arcSpawnTick,
      x: 0, zOffset: 80, alt: MID_ALTITUDE, hp: 1200 }, targets: [],
  });

  return fixtures;
}

function playerPath() {
  return Array.from({ length: BASELINE_TICKS }, (_, index) => {
    const tick = index + 1;
    return { tick, x: 0, z: playerZ(tick), alt: MID_ALTITUDE, yaw: 0, input: NEUTRAL_INPUT };
  });
}

function bandFor(altitude) {
  return altitude <= (BANDS[0] + BANDS[1]) / 2 ? 0 : altitude <= (BANDS[1] + BANDS[2]) / 2 ? 1 : 2;
}

function createEnemy(state, spec, tick) {
  const position = targetPosition(spec, tick);
  const band = bandFor(position.alt);
  const enemy = makeEnemy(state, position.x, position.z, band, spec.kind, position.alt - BANDS[band]);
  enemy.alt = position.alt;
  enemy.band = band;
  enemy.offset = position.alt - BANDS[band];
  enemy.hp = spec.hp ?? enemy.hp;
  enemy.shotAt = Number.MAX_SAFE_INTEGER;
  if (spec.kind === 'gnat' && spec.variant === 'sting') enemy.gnatVariant = 'sting';
  const next = targetPosition(spec, Math.min(BASELINE_TICKS, tick + 1));
  enemy.vx = (next.x - position.x) / STEP;
  enemy.vz = (next.z - position.z) / STEP;
  return enemy;
}

function assertFixture(fixture, weapon) {
  if (!WEAPON_IDS.includes(weapon)) throw new Error(`Unknown weapon: ${weapon}`);
  if (!fixture || !fixture.id || !Array.isArray(fixture.targets)) throw new Error('Fixture requires id and targets');
  if (fixture.durationTicks !== BASELINE_TICKS) throw new Error(`Fixture ${fixture.id} must run ${BASELINE_TICKS} ticks`);
  const ids = fixture.targets.map(target => target.id);
  if (new Set(ids).size !== ids.length) throw new Error(`Fixture ${fixture.id} contains duplicate target IDs`);
  for (const target of fixture.targets) {
    if (!target.id || !target.kind || !target.motion || !Number.isInteger(target.spawnTick)
      || target.spawnTick < 1 || target.spawnTick > BASELINE_TICKS) {
      throw new Error(`Fixture ${fixture.id} has an invalid target schedule`);
    }
  }
}

export function simulateFixture(fixture, weapon = fixture?.weapon, seed = BASELINE_SEED) {
  assertFixture(fixture, weapon);
  const state = createStage(parseStageOptions(`?mode=survivors&t=0&seed=${seed}`), GROUND);
  Object.assign(state.player, { x: 0, z: 0, altitude: MID_ALTITUDE, yaw: 0, vx: 0, vz: CRUISE_SPEED });
  state.run.weaponLevels = { [weapon]: BASELINE_LEVEL };
  state.run.buffLevels = Object.fromEntries(BUFF_IDS.map(id => [id, 0]));
  state.run.evolutions = {};
  state.run.weapons = [weapon];
  state.run.buffs = [];
  state.run.damageUpgrades = 0;
  state.run.weaponSlots = 1;
  state.run.buffSlots = 0;
  state.heat = 0;
  state.speed = CRUISE_SPEED;

  const activeWeapons = Object.entries(state.run.weaponLevels).filter(([, level]) => level > 0);
  assert.deepEqual(activeWeapons, [[weapon, BASELINE_LEVEL]]);
  assert.ok(Object.values(state.run.buffLevels).every(level => level === 0));
  assert.deepEqual(Object.keys(state.run.evolutions), []);
  assert.equal(state.run.damageUpgrades, 0);

  const initialManualInventory = { bombs: state.bombs, flareCharges: state.flareCharges };
  const expectedByTick = new Map();
  for (const target of fixture.targets) {
    const scheduled = expectedByTick.get(target.spawnTick) ?? [];
    scheduled.push(target);
    expectedByTick.set(target.spawnTick, scheduled);
  }
  const spawned = new Map();
  const audit = new Map();
  const path = playerPath();
  const plan = targetPlan([...fixture.targets, ...(fixture.ace ? [fixture.ace] : [])]);
  const targetPlanSha256 = sha256(plan);
  let lockReadyTicks = 0;
  let naturallyReadyLockTicks = 0;
  let droneInterception = null;
  let emittedProjectileCount = 0;
  const emittedProjectilesByWeapon = {};
  let automaticFlareCount = 0;
  const automaticFlaresByWeapon = {};
  let automaticBombCount = 0;
  const automaticBombsByWeapon = {};
  let ticksRun = 0;
  let ace = null;
  if (fixture.ace) {
    ace = makeAce(state, 0, playerZ(fixture.ace.spawnTick) + fixture.ace.zOffset, GROUND);
    ace.hp = fixture.ace.hp;
    ace.maxHp = fixture.ace.hp;
    ace.band = bandFor(fixture.ace.alt);
    ace.alt = fixture.ace.alt;
    delete ace.entry;
    ace.roll = null;
    ace.hitUntil = 0;
    state.boss = ace;
    if (fixture.lockPolicy) state.lock = { id: ace.id, progress: 1, ready: true };
    audit.set(fixture.ace.id, {
      targetId: fixture.ace.id, nativeId: ace.id, kind: 'ace', spawnTick: fixture.ace.spawnTick,
      initialHp: ace.hp, finalHp: ace.hp, actualDamage: 0, deathTick: null,
      successfulHitCount: 0, crossedAlive: false, entered20mAlive: false,
    });
  }

  for (let tick = 1; tick <= BASELINE_TICKS; tick++) {
    ticksRun++;
    state.tick = tick;
    Object.assign(state.player, { x: 0, z: playerZ(tick), altitude: MID_ALTITUDE, yaw: 0, vx: 0, vz: CRUISE_SPEED });

    for (const spec of expectedByTick.get(tick) ?? []) {
      const enemy = createEnemy(state, spec, tick);
      state.enemies.push(enemy);
      spawned.set(spec.id, { spec, enemy });
      audit.set(spec.id, {
        targetId: spec.id, nativeId: enemy.id, kind: spec.kind, variant: spec.variant ?? null,
        spawnTick: tick, initialHp: enemy.hp, finalHp: enemy.hp, actualDamage: 0, deathTick: null,
        crossedTick: null, crossedAlive: false, killedBeforePlane: false,
        entered20mTick: null, entered20mAlive: false,
      });
    }

    for (const { spec, enemy } of spawned.values()) {
      if (!enemy.hp) continue;
      const position = targetPosition(spec, tick);
      const next = targetPosition(spec, Math.min(BASELINE_TICKS, tick + 1));
      Object.assign(enemy, position, { vx: (next.x - position.x) / STEP, vz: (next.z - position.z) / STEP });
      if (fixture.kind === 'forward-column' && audit.get(spec.id).crossedTick === null && enemy.z <= state.player.z) {
        const record = audit.get(spec.id);
        record.crossedTick = tick;
        record.crossedAlive = enemy.hp > 0;
      }
      if (fixture.kind === 'bilateral-sting-waves' && audit.get(spec.id).entered20mTick === null
        && Math.hypot(enemy.x - state.player.x, enemy.alt - state.player.altitude, enemy.z - state.player.z) <= INTRUSION_RADIUS) {
        const record = audit.get(spec.id);
        record.entered20mTick = tick;
        record.entered20mAlive = enemy.hp > 0;
      }
    }

    if (ace) {
      Object.assign(ace, { x: 0, z: state.player.z + fixture.ace.zOffset, alt: fixture.ace.alt, vx: 0, vz: CRUISE_SPEED });
    }

    const beforeHp = new Map(state.enemies.map(enemy => [enemy.id, enemy.hp]));
    const beforeAceHp = ace?.hp ?? 0;

    advanceRearBombs(state, GROUND);
    advanceFlares(state, GROUND);
    const shotsBefore = new Set(state.shots);
    const flaresBefore = new Set(state.flares);
    const bombsBefore = new Set(state.rearBombs);
    acquireAndFire(state);
    if (state.lock?.ready) naturallyReadyLockTicks++;
    if (fixture.lockPolicy === 'suppressed') state.lock = null;
    if (state.lock?.ready) lockReadyTicks++;
    advanceRangedWeapons(state, GROUND);
    advanceSupportWeapons(state, GROUND);
    advanceAutoOrdnance(state, false);

    for (const shot of state.shots) {
      if (shotsBefore.has(shot) || shot.kind === 'hostile') continue;
      const weaponId = shot.weapon ?? (shot.kind === 'twin' || shot.kind === 'pods' ? shot.kind : null);
      if (!weaponId) continue;
      emittedProjectileCount++;
      emittedProjectilesByWeapon[weaponId] = (emittedProjectilesByWeapon[weaponId] ?? 0) + 1;
    }
    for (const flare of state.flares) {
      if (flaresBefore.has(flare)) continue;
      automaticFlareCount++;
      const weaponId = flare.weapon ?? 'manual-flare';
      automaticFlaresByWeapon[weaponId] = (automaticFlaresByWeapon[weaponId] ?? 0) + 1;
    }
    for (const bomb of state.rearBombs) {
      if (bombsBefore.has(bomb)) continue;
      automaticBombCount++;
      const weaponId = bomb.weapon ?? 'manual-bomb';
      automaticBombsByWeapon[weaponId] = (automaticBombsByWeapon[weaponId] ?? 0) + 1;
    }

    if (fixture.interceptHostile && tick === 120) {
      const drone = state.orbitDrones[0];
      assert.ok(drone, `${fixture.id} needs the drone orbit before interception`);
      const shot = {
        x: drone.x - 1, z: drone.z, alt: drone.alt, vx: CRUISE_SPEED, vz: 0,
        life: 1, damage: 1, kind: 'hostile', volley: ++state.nextVolley,
        nearMiss: false, lockId: null,
      };
      state.shots.push(shot);
      advanceShots(state, GROUND);
      droneInterception = { tick, intercepted: shot.life <= 0, source: 'hostile projectile crossing orbit' };
    } else {
      advanceShots(state, GROUND);
    }
    advanceEnemyHazards(state, GROUND);

    for (const enemy of state.enemies) {
      const record = [...audit.values()].find(item => item.nativeId === enemy.id);
      const priorHp = beforeHp.get(enemy.id) ?? enemy.hp;
      record.finalHp = enemy.hp;
      record.actualDamage = record.initialHp - enemy.hp;
      if (priorHp > 0 && enemy.hp <= 0 && record.deathTick === null) record.deathTick = tick;
      if (fixture.kind === 'forward-column' && record.deathTick !== null) {
        record.killedBeforePlane = record.crossedTick === null || record.deathTick < record.crossedTick;
      }
    }
    if (ace) {
      const record = audit.get(fixture.ace.id);
      record.finalHp = ace.hp;
      record.actualDamage = record.initialHp - ace.hp;
      record.successfulHitCount = ace.hits;
      if (beforeAceHp > 0 && ace.hp <= 0 && record.deathTick === null) record.deathTick = tick;
    }

    const expectedIds = new Set([...spawned.values()].map(({ enemy }) => enemy.id));
    assert.ok(state.enemies.every(enemy => expectedIds.has(enemy.id)), `Unexpected enemy in ${fixture.id}`);
    assert.equal(state.boss?.id ?? null, ace?.id ?? null, `Unexpected boss in ${fixture.id}`);
    assert.equal(state.pickups.length, 0, `Unexpected pickup in ${fixture.id}`);
    assert.equal(state.enemyMines.length, 0, `Unexpected mine in ${fixture.id}`);
  }

  assert.equal(ticksRun, BASELINE_TICKS);
  assert.equal(state.tick, BASELINE_TICKS);
  assert.equal(spawned.size, fixture.targets.length);
  assert.equal(state.enemies.length, fixture.targets.length);
  assert.deepEqual(initialManualInventory, { bombs: state.bombs, flareCharges: state.flareCharges });
  if (ace && fixture.kind === 'vulnerable-ready-locked-ace') assert.ok(ace.hp > 0, `Ace HP depleted in ${fixture.id}`);
  if (fixture.interceptHostile) assert.equal(droneInterception?.intercepted, true, 'Orbit interception was not observed');

  const targetAudit = [...audit.values()].map(record => ({
    ...record,
    killed: record.finalHp <= 0,
  }));
  const targetDamage = targetAudit.reduce((sum, record) => sum + record.actualDamage, 0);
  const killedTargets = targetAudit.filter(target => target.killed).length;
  const result = {
    id: fixture.id,
    group: fixture.group,
    pairGroup: fixture.pairGroup ?? null,
    kind: fixture.kind,
    condition: fixture.condition,
    comparisonMode: fixture.comparisonMode ?? 'matched-condition-observation',
    metricScope: fixture.group === 'primary-ace-far'
      ? 'range/flight diagnostic; not common-effective-range acceptance'
      : fixture.comparisonMode ?? 'baseline-role observation',
    weapon,
    weaponLevel: BASELINE_LEVEL,
    seed,
    ticksRun,
    durationSeconds: ticksRun / TICKS_PER_SECOND,
    altitude: MID_ALTITUDE,
    playerPathSha256: sha256(path),
    inputSha256: sha256(NEUTRAL_INPUT),
    targetPlanSha256,
    timetableSha256: sha256({ seed, ticks: [...new Set([
      ...fixture.targets.map(target => target.spawnTick), ...(fixture.ace ? [fixture.ace.spawnTick] : []),
    ])].sort((a, b) => a - b) }),
    targetCount: targetAudit.length,
    targetDamage,
    killedTargets,
    killsBeforePlane: targetAudit.filter(target => target.killedBeforePlane).length,
    crossedAlive: targetAudit.filter(target => target.crossedAlive).length,
    crossedAliveIds: targetAudit.filter(target => target.crossedAlive).map(target => target.targetId),
    intrusions20m: targetAudit.filter(target => target.entered20mAlive).length,
    intrusionIds: targetAudit.filter(target => target.entered20mAlive).map(target => target.targetId),
    emittedProjectileCount,
    emittedProjectilesByWeapon,
    automaticFlareCount,
    automaticFlaresByWeapon,
    automaticBombCount,
    automaticBombsByWeapon,
    saturation: {
      completeClear: targetAudit.length > 0 && killedTargets === targetAudit.length,
      targetCeiling: targetAudit.length,
      interpretation: 'a full-clear is fixture ceiling saturation, not a meaningful tie',
    },
    ace: ace ? {
      range: fixture.ace.zOffset,
      initialHp: fixture.ace.hp,
      finalHp: ace.hp,
      actualCappedHpReduction: fixture.ace.hp - ace.hp,
      damagePerSecond: (fixture.ace.hp - ace.hp) / (ticksRun / TICKS_PER_SECOND),
      successfulHitCount: ace.hits,
      lockReadyTicks,
      naturallyReadyLockTicks,
      lockPolicy: fixture.lockPolicy,
      depleted: ace.hp <= 0,
      kinematic: true,
      evasionAndAi: 'disabled; position fixed at player-relative range and altitude',
    } : null,
    droneInterception,
    fixtureConditions: {
      targetCondition: fixture.condition,
      targets: fixture.targets.map(target => ({ ...target })),
      ace: fixture.ace ? { ...fixture.ace } : null,
      lockPolicy: fixture.lockPolicy ?? null,
      interceptHostile: !!fixture.interceptHostile,
      comparisonMode: fixture.comparisonMode ?? null,
    },
    targetAudit,
  };

  assert.ok(targetAudit.every(target => target.finalHp >= 0));
  assert.ok(targetAudit.every(target => target.actualDamage === target.initialHp - target.finalHp));
  return result;
}

function resultSignature(result) {
  return JSON.stringify(result);
}

function assertComparisonInvariants(results, fixtures) {
  const byGroup = new Map();
  for (const result of results) {
    const list = byGroup.get(result.group) ?? [];
    list.push(result);
    byGroup.set(result.group, list);
  }
  for (const [group, entries] of byGroup) {
    if (group.startsWith('primary-') && entries.length > 1) {
      assert.equal(new Set(entries.map(entry => entry.playerPathSha256)).size, 1, `${group} player path differs by weapon`);
      assert.equal(new Set(entries.map(entry => entry.targetPlanSha256)).size, 1, `${group} target schedule differs by weapon`);
      assert.equal(new Set(entries.map(entry => entry.timetableSha256)).size, 1, `${group} timetable differs by weapon`);
    }
  }

  const pairGroups = new Map();
  for (const fixture of fixtures.filter(item => item.pairGroup)) {
    const list = pairGroups.get(fixture.pairGroup) ?? [];
    list.push(fixture);
    pairGroups.set(fixture.pairGroup, list);
  }
  for (const [group, pair] of pairGroups) {
    assert.equal(pair.length, 2, `${group} must have exactly two target conditions`);
    const pairResults = results.filter(result => result.pairGroup === group);
    assert.equal(pairResults.length, 2, `${group} did not produce both paired observations`);
    assert.equal(new Set(pairResults.map(result => result.playerPathSha256)).size, 1, `${group} player path differs`);
    assert.equal(new Set(pairResults.map(result => result.inputSha256)).size, 1, `${group} input differs`);
    assert.equal(new Set(pairResults.map(result => result.timetableSha256)).size, 1, `${group} spawn timetable differs`);
    assert.equal(new Set(pairResults.map(result => result.seed)).size, 1, `${group} seed differs`);
    assert.equal(new Set(pairResults.map(result => result.weapon)).size, 1, `${group} weapon differs`);
    assert.equal(new Set(pairResults.map(result => result.weaponLevel)).size, 1, `${group} weapon level differs`);
    assert.equal(new Set(pairResults.map(result => result.durationSeconds)).size, 1, `${group} duration differs`);
    assert.equal(new Set(pairResults.map(result => result.altitude)).size, 1, `${group} altitude differs`);
    assert.ok(pair[0].condition !== pair[1].condition, `${group} target condition did not change`);
  }
}

export function buildBaseline({ seed = BASELINE_SEED, verifyRepeatability = true } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Seed must be a non-negative safe integer');
  const fixtures = buildFixtures(seed);
  const results = fixtures.map(fixture => simulateFixture(fixture, fixture.weapon, seed));
  assertComparisonInvariants(results, fixtures);

  if (verifyRepeatability) {
    const replay = fixtures.map(fixture => simulateFixture(fixture, fixture.weapon, seed));
    assert.deepEqual(replay.map(resultSignature), results.map(resultSignature), 'Baseline replay changed observations');
  }

  const repoHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const repoBranch = execFileSync('git', ['branch', '--show-current'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const conditions = {
    seed,
    durationTicks: BASELINE_TICKS,
    ticksPerSecond: TICKS_PER_SECOND,
    durationSeconds: BASELINE_TICKS / TICKS_PER_SECOND,
    playerPath: PLAYER_PATH,
    weaponLevel: BASELINE_LEVEL,
    oneWeaponOnly: true,
    buffs: 'all levels zero; no buffs equipped',
    evolutions: 'none',
    familyEffects: 'none (one weapon only)',
    manualBombsAndFlares: 'disabled; inventory unchanged',
    automaticWeaponOrdnance: 'enabled for selected Phoenix or Bomb Bay',
    targetMotion: 'seeded prescribed kinematics, independent of weapon until target death',
    targetSchedule: 'named rngStream(seed, p0-weapon-baseline:<fixture>) for seeded fixture variation',
    stagePhaseSpawns: 'not run; direct fixture scheduler only',
    intrusionRadius: { value: INTRUSION_RADIUS, units: 'raw 3D world units', scaleTravelApplied: false },
    aceFixture: 'vulnerable 1200-HP boss at fixed player-relative range and altitude; no movement, evasion or AI',
    aceRangeInterpretation: '300 m is a range/flight diagnostic, not common-effective-range acceptance',
  };
  const conditionRecord = {
    conditions,
    fixtures: results.map(({ id, fixtureConditions }) => ({ id, ...fixtureConditions })),
  };
  const payload = {
    schemaVersion: 1,
    interpretation: 'BASELINE ONLY / not P0 final',
    source: {
      commit: repoHead,
      commitLabel: 'runtime HEAD',
      branch: repoBranch,
      srcTreeSha256: sha256Tree(SRC_ROOT),
      harnessSha256: sha256File(HARNESS_PATH),
    },
    conditions: conditionRecord,
    conditionsSha256: sha256(conditionRecord),
    fixtures: results,
    repeatability: { checked: verifyRepeatability, replayCount: verifyRepeatability ? 2 : 1 },
  };
  return { ...payload, artifactSha256: sha256(payload) };
}

const CONDITION_KO = {
  'rail-aligned': '충전 시작부터 사선에 정렬된 정지 표적',
  'rail-dispersed': '충전 시작부터 횡방향 이격된 정지 표적',
  'flak-burst-point-cluster': '예측 폭발 지점의 군집 표적',
  'flak-close-inside-burst-envelope': '근거리 폭발 범위 안의 표적',
  'ion-pursuit-crosses-wake': '후방 웨이크 경로를 따르는 추격 표적',
  'ion-untouched-front': '플레이어 앞의 비접촉 표적',
  'drones-on-orbit': '드론 궤도 위 표적',
  'drones-outside-orbit': '궤도 바깥 표적',
  'phoenix-rear': '후방의 같은 고도 추격 표적',
  'phoenix-front': '전방의 같은 고도 표적',
  'bomb-bay-below': '폭탄 발사 고도 아래 표적',
  'bomb-bay-above': '폭탄 상한 위 표적',
  'arc-connected-chain': '연결된 인접 밴드 군집',
  'arc-isolated-ace': '고립된 취약 Ace',
};

function roleEvidence(first, second) {
  if (first.pairGroup === 'role-arc') {
    const chain = [first, second].find(result => result.kind === 'arc-adjacent-band-chain');
    const isolated = [first, second].find(result => result.kind === 'arc-isolated-ace');
    return `정량 피해 비교 아님: 연결 사슬 fixture ${chain.killedTargets}/${chain.targetCount} 처치; 별도 고립 Ace fixture HP 피해 ${isolated.ace.actualCappedHpReduction.toFixed(3)} (${isolated.ace.successfulHitCount}회 명중). 표적 수·종류·HP·운동 조건이 달라 연쇄 범위에 대한 정성 증거로만 해석.`;
  }
  const format = result => {
    const ceiling = result.saturation.completeClear ? 'CEILING SATURATED; not a meaningful tie' : 'not full-clear';
    const emissions = [
      `${result.emittedProjectileCount} 발사체`,
      result.automaticFlareCount ? `${result.automaticFlareCount} 자동 플레어` : '',
      result.automaticBombCount ? `${result.automaticBombCount} 자동 폭탄` : '',
    ].filter(Boolean).join(', ');
    return `${CONDITION_KO[result.id] ?? result.condition}: ${result.targetDamage.toFixed(3)} 피해, ${result.killedTargets}/${result.targetCount} 격추, ${emissions}, ${ceiling}`;
  };
  return `${format(first)}; ${format(second)}`;
}

export function renderKoreanReport(baseline, jsonPath) {
  const rows = baseline.fixtures;
  const primary = rows.filter(row => row.group.startsWith('primary-'));
  const roles = rows.filter(row => row.pairGroup && row.pairGroup !== 'seeker-lock-diagnostic');
  const pairGroups = [...new Set(roles.map(row => row.pairGroup))];
  const scenarioKo = {
    'forward-column': '전방 Gnat 열',
    'bilateral-sting-waves': '양측 동일 고도 Sting 접근',
    'vulnerable-ready-locked-ace': '취약 상태 ready-lock 단일 Ace',
  };
  const report = [
    '# P0 무기 역할 베이스라인 실험',
    '',
    '> **BASELINE ONLY / P0 최종 검증 아님.** 수치는 고정 조건의 관찰값이며, 기대 순위·합격 임계값을 적용하지 않았다.',
    '',
    `- 실행 시점 HEAD: \`${baseline.source.commit}\` (runtime HEAD; branch \`${baseline.source.branch}\`)`,
    `- src 트리 SHA-256: \`${baseline.source.srcTreeSha256}\`; harness SHA-256: \`${baseline.source.harnessSha256}\``,
    `- 조건 SHA-256: \`${baseline.conditionsSha256}\``,
    `- 원시 JSON: \`${jsonPath}\``,
    `- 시드 ${baseline.conditions.conditions.seed}; ${baseline.conditions.conditions.durationTicks}틱 / ${baseline.conditions.conditions.ticksPerSecond}Hz (${baseline.conditions.conditions.durationSeconds}초); 고도 ${baseline.conditions.conditions.playerPath.altitude}; Lv${baseline.conditions.conditions.weaponLevel} 단일 무기.`,
    '- 입력은 방향/상승/롤 중립, 부스트·수동 폭탄·수동 플레어 사용 안 함. 고정된 중간 고도 정면 경로를 모든 비교에 공유했다.',
    '- 버프·진화·무기 가족 효과 없음. 단계 스폰 없이 기존 전투 업데이트 루틴을 정상 전투 순서로 호출했다.',
    '',
    '## 주요 비교',
    '',
    '| 시나리오 | 무기 | 표적/거리 | 관측 | 발사체 / Ace 명중 | 표적 포화 |',
    '|---|---|---|---|---:|---|',
  ];
  for (const row of primary) {
    let observation;
    if (row.kind === 'forward-column') {
      observation = `플레이어 평면 전 Gnat 처치 ${row.killsBeforePlane}; 생존 횡단 ${row.crossedAlive} (${row.crossedAliveIds.join(', ') || '없음'})`;
    } else if (row.kind === 'bilateral-sting-waves') {
      observation = `원시 3D 반경 20 진입 생존 ID ${row.intrusions20m} (${row.intrusionIds.join(', ') || '없음'})`;
    } else {
      observation = `실제 HP 감소 ${row.ace.actualCappedHpReduction.toFixed(3)}; ${row.ace.damagePerSecond.toFixed(3)} HP/s; 잔여 ${row.ace.finalHp.toFixed(3)}/${row.ace.initialHp}; ready lock ${row.ace.lockReadyTicks}/${row.ticksRun}틱`;
    }
    const rangeNote = row.metricScope.startsWith('range/flight diagnostic') ? ' (range/flight diagnostic; not acceptance)' : '';
    const subject = row.kind === 'vulnerable-ready-locked-ace' ? `1 Ace @ ${row.ace.range} m${rangeNote}` : `${row.targetCount}개 표적`;
    const emissions = [
      `${row.emittedProjectileCount} 발사체`,
      row.automaticFlareCount ? `${row.automaticFlareCount} 자동 플레어` : '',
      row.automaticBombCount ? `${row.automaticBombCount} 자동 폭탄` : '',
      row.ace ? `Ace 성공 명중 ${row.ace.successfulHitCount}` : '',
    ].filter(Boolean).join('; ');
    const saturation = row.saturation.completeClear
      ? `포화 ${row.killedTargets}/${row.targetCount}; full-clear 동률로 해석 금지`
      : '미포화';
    report.push(`| ${scenarioKo[row.kind] ?? row.kind} | ${row.weapon} | ${subject} | ${observation} | ${emissions} | ${saturation} |`);
  }
  report.push('', '## 역할 강점/약점 증거',
    '- Rail 표적은 충전 중 정지했다. 정렬/분산 차이는 충전 시작 시의 위치 조건이며, 표적이 충전 중 이동하는 비교가 아니다.',
    '- Arc 행은 표적 수·종류·HP·운동이 다른 fixture 간 정성적 연쇄 범위 증거이며 matched damage comparison이 아니다.',
    '', '| 무기 | 조건 A 관측 | 조건 B 관측 | 기록된 증거 |', '|---|---|---|---|');
  const labels = {
    'role-rail': 'Rail: 충전 시작 위치 정렬 / 횡방향 이격',
    'role-flak': 'Flak: 예측 폭발점 군집 / 근거리 표적',
    'role-ion': 'Ion Wake: 후방 추격 경로 교차 / 전방 비접촉',
    'role-drones': 'Orbit Drones: 궤도 접촉 / 궤도 바깥',
    'role-phoenix': 'Phoenix: 후방 추격 표적 / 전방 표적',
    'role-bomb-bay': 'Bomb Bay: 아래 표적 / 발사 상한 위 표적',
    'role-arc': 'Arc: 연결된 인접 밴드 군집 / 고립 Ace',
  };
  for (const group of pairGroups) {
    const pair = roles.filter(row => row.pairGroup === group);
    report.push(`| ${labels[group] ?? group} | ${CONDITION_KO[pair[0].id] ?? pair[0].condition} | ${CONDITION_KO[pair[1].id] ?? pair[1].condition} | ${roleEvidence(pair[0], pair[1])} |`);
  }
  const lockPair = rows.filter(row => row.pairGroup === 'seeker-lock-diagnostic');
  report.push('', '## Seeker 잠금 진단', '');
  for (const row of lockPair) report.push(`- ${row.ace.lockPolicy === 'ready' ? '준비 완료 잠금 유지' : '획득 후 잠금 억제'}: 발사체 ${row.emittedProjectileCount}; 성공 명중 ${row.ace.successfulHitCount}; 실제 HP 피해 ${row.ace.actualCappedHpReduction.toFixed(3)}; ready lock ${row.ace.lockReadyTicks}/${row.ticksRun}틱; 표적 잔여 HP ${row.ace.finalHp.toFixed(3)}/${row.ace.initialHp}.`);
  report.push('', '## 해석 및 한계',
    '- 이는 지정된 15초 fixture에서 얻은 재현 가능한 관찰값뿐이며, PE의 최종 P0 판정이나 무기 순위·밸런스 결론이 아니다.',
    '- 보스는 취약 상태로 고정된 플레이어 상대 거리/고도에 유지했다. 실제 Ace 이동·회피·AI 및 일반 단계 스폰과의 상호작용은 검증하지 않는다.',
    '- 일반 적은 시드 기반 스폰표와 선언된 직선/상대좌표 운동을 사용한다. 사망 후에는 이동을 중단하고, 20m 판정은 scaleTravel 없이 원시 3D 좌표를 사용한다.',
    '- 300m Ace는 range/flight 진단 전용이며 공통 유효 사거리의 acceptance가 아니다. 해당 거리의 Seeker 0-hit 결과를 일반 무기 순위로 해석하지 않는다.',
    '- 모든 표적의 ID, 초기/최종 HP, 실제 캡 적용 피해, Ace 성공 명중 수, 발사체/자동 폭탄·플레어 배출 수, 사망/횡단/침입 시점은 JSON에서 확인할 수 있다.',
    '- 전체 격추는 표적 수 상한 포화로 표시했다. 같은 full-clear 결과를 의미 있는 동률로 간주하지 않는다.',
    '- 재생 명령:',
    '  ```sh',
    `  node --experimental-strip-types tools/p0-weapon-baseline.mjs --seed ${baseline.conditions.conditions.seed} --out-dir ${dirname(jsonPath)}`,
    '  ```',
    '',
    `- 재현성 검사: ${baseline.repeatability.checked ? '동일 입력으로 전체 fixture를 두 번 실행해 결과 일치 확인' : '생략'}.`,
    `- 아티팩트 SHA-256: \`${baseline.artifactSha256}\``,
    '');
  return report.join('\n');
}

function parseCli(argv) {
  const result = { seed: BASELINE_SEED, outDir: resolve(homedir(), 'p0-weapon-baseline-artifacts') };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--seed' && argv[index + 1] !== undefined) result.seed = Number(argv[++index]);
    else if (arg === '--out-dir' && argv[index + 1] !== undefined) result.outDir = resolve(argv[++index]);
    else if (arg === '--help') return { help: true };
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return result;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.help) {
    console.log('Usage: node --experimental-strip-types tools/p0-weapon-baseline.mjs [--seed N] [--out-dir PATH]');
    return null;
  }
  const baseline = buildBaseline({ seed: options.seed });
  mkdirSync(options.outDir, { recursive: true });
  const jsonPath = resolve(options.outDir, 'p0-weapon-baseline.json');
  const reportPath = resolve(options.outDir, 'p0-weapon-baseline.ko.md');
  writeFileSync(jsonPath, `${JSON.stringify(baseline, null, 2)}\n`);
  writeFileSync(reportPath, renderKoreanReport(baseline, jsonPath));
  console.log(`Baseline output directory: ${options.outDir}`);
  console.log(`Raw JSON: ${jsonPath}`);
  console.log(`Korean report: ${reportPath}`);
  console.log(`Source HEAD: ${baseline.source.commit}`);
  console.log(`Conditions SHA-256: ${baseline.conditionsSha256}`);
  console.log(`Artifact SHA-256: ${baseline.artifactSha256}`);
  console.log(`Fixtures: ${baseline.fixtures.length}; repeatability: ${baseline.repeatability.checked ? 'verified' : 'skipped'}; ticks per fixture: ${BASELINE_TICKS}`);
  return { baseline, jsonPath, reportPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
