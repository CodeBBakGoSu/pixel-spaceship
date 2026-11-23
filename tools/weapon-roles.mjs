import { fileURLToPath } from 'node:url';
import { makeAce } from '../src/ace.ts';
import { BANDS, acquireAndFire, advanceShots } from '../src/stage-combat.ts';
import { advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { makeGnat } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';

const SEED = 23;
const TICKS = 900;
const TICKS_PER_SECOND = 60;
const LEVEL = 4;
const MID_BAND = 1;
const MID_ALTITUDE = BANDS[MID_BAND];
const TARGET_COUNT = 30;
const APPROACH_SPEED = 60;
const WEAPONS = ['twin', 'pods', 'seeker'];
const ground = () => 35;

export function createComparisonState(weapon) {
  if (!WEAPONS.includes(weapon)) throw new RangeError(`Unsupported P0 comparison weapon: ${weapon}`);
  const state = createStage(parseStageOptions(`?mode=survivors&t=0&seed=${SEED}&heat=0`), ground);
  if (!state.run) throw new Error('The role comparison requires a Survivors run.');
  state.run.weapons = [weapon];
  state.run.buffs = [];
  state.run.weaponLevels = { [weapon]: LEVEL };
  state.run.buffLevels = {};
  state.run.evolutions = {};
  state.run.damageUpgrades = 0;
  state.player.x = 0;
  state.player.z = 0;
  state.player.altitude = MID_ALTITUDE;
  state.player.yaw = 0;
  state.bombs = 0;
  state.flareCharges = 0;
  state.rearBombs = [];
  state.maneuver = null;
  state.maneuverTrail = null;
  state.reversal = null;
  return state;
}

function setupSnapshot(state, weapon) {
  return {
    seed: state.seed,
    selectedWeapon: weapon,
    weaponLevel: state.run.weaponLevels[weapon],
    activeWeapons: Object.keys(state.run.weaponLevels),
    activeBuffLevels: Object.keys(state.run.buffLevels),
    evolutions: Object.keys(state.run.evolutions),
    damageUpgrades: state.run.damageUpgrades,
    overdrive: Boolean(state.reversal),
    manualWeapons: Boolean(state.bombs || state.flareCharges || state.rearBombs.length),
    playerLockReady: Boolean(state.lock?.ready),
    pilot: { x: state.player.x, z: state.player.z, altitude: state.player.altitude, yaw: state.player.yaw },
  };
}

function createAcquisitionTracker() {
  return { recording: false, selectedTargetIds: new Set(), hitTargetIds: new Set(), seekerTargetIds: new Set() };
}

function trackAcquisitionTarget(target, tracker) {
  return new Proxy(target, {
    get(source, property, receiver) {
      if (tracker.recording && (property === 'vx' || property === 'vz')) tracker.selectedTargetIds.add(source.id);
      return Reflect.get(source, property, receiver);
    },
  });
}

function makeMetrics(state, weapon, targets, tracker) {
  return {
    setup: setupSnapshot(state, weapon),
    targetAvailability: { scheduled: targets.length, liveTargetTicks: 0 },
    acquisition: tracker,
    firedProjectiles: 0,
  };
}

function projectileWeapon(shot) {
  return shot.weapon ?? (shot.kind === 'strafe' ? 'twin' : shot.kind);
}

function resolveCombatTick(state, weapon, targets, metrics) {
  const existingShots = new Set(state.shots);
  const hpBefore = new Map(targets.map(target => [target.id, target.hp]));
  metrics.acquisition.recording = true;
  acquireAndFire(state);
  metrics.acquisition.recording = false;
  advanceRangedWeapons(state, ground);
  for (const shot of state.shots) {
    if (existingShots.has(shot) || projectileWeapon(shot) !== weapon) continue;
    metrics.firedProjectiles++;
    if (shot.kind === 'seeker' && shot.targetId !== null) {
      metrics.acquisition.selectedTargetIds.add(shot.targetId);
      metrics.acquisition.seekerTargetIds.add(shot.targetId);
    }
  }
  advanceShots(state, ground);
  for (const target of targets) {
    if (target.hp < hpBefore.get(target.id)) metrics.acquisition.hitTargetIds.add(target.id);
  }
}

function finishMetrics(metrics) {
  return {
    setup: metrics.setup,
    targetAvailability: metrics.targetAvailability,
    acquisition: {
      selectedTargetIds: [...metrics.acquisition.selectedTargetIds].sort((a, b) => a - b),
      hitTargetIds: [...metrics.acquisition.hitTargetIds].sort((a, b) => a - b),
      seekerTargetIds: [...metrics.acquisition.seekerTargetIds].sort((a, b) => a - b),
    },
    firedProjectiles: metrics.firedProjectiles,
  };
}

function runForwardColumn(weapon) {
  const state = createComparisonState(weapon);
  const tracker = createAcquisitionTracker();
  const targets = Array.from({ length: TARGET_COUNT }, (_, i) => {
    const enemy = makeGnat(state, 0, 120 + 20 * i, MID_BAND);
    if (enemy.hp !== 1) throw new Error(`Expected a standard Gnat to have 1 HP, got ${enemy.hp}.`);
    const target = trackAcquisitionTarget(enemy, tracker);
    target.vx = 0;
    target.vz = -APPROACH_SPEED;
    state.enemies.push(target);
    return target;
  });
  const metrics = makeMetrics(state, weapon, targets, tracker);
  const killedAhead = new Set();
  const crossedAlive = new Set();

  for (let i = 0; i < TICKS; i++) {
    state.tick++;
    metrics.targetAvailability.liveTargetTicks += state.enemies.filter(target => target.hp > 0).length;
    for (const target of state.enemies) {
      target.x += target.vx / TICKS_PER_SECOND;
      target.z += target.vz / TICKS_PER_SECOND;
    }
    const hpBefore = new Map(targets.map(target => [target.id, target.hp]));
    resolveCombatTick(state, weapon, targets, metrics);
    for (const target of targets) {
      if (hpBefore.get(target.id) > 0 && target.hp === 0 && target.z > state.player.z) killedAhead.add(target.id);
      if (target.z <= state.player.z && target.hp > 0) crossedAlive.add(target.id);
    }
    state.enemies = state.enemies.filter(target => target.hp > 0 && target.z > state.player.z);
  }

  return {
    ...finishMetrics(metrics),
    outcome: { uniqueKillsWhileAhead: [...killedAhead].length, crossedAlive: [...crossedAlive].length },
  };
}

function runSideApproach(weapon) {
  const state = createComparisonState(weapon);
  const tracker = createAcquisitionTracker();
  const sideById = new Map();
  const targets = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < TARGET_COUNT / 2; i++) {
      const target = trackAcquisitionTarget(makeGnat(state, side * (120 + 20 * i), 0, MID_BAND, 'sting'), tracker);
      target.vx = -side * APPROACH_SPEED;
      target.vz = 0;
      sideById.set(target.id, side);
      targets.push(target);
      state.enemies.push(target);
    }
  }
  const metrics = makeMetrics(state, weapon, targets, tracker);
  const intruded = new Set();

  for (let i = 0; i < TICKS; i++) {
    state.tick++;
    metrics.targetAvailability.liveTargetTicks += state.enemies.filter(target => target.hp > 0).length;
    for (const target of state.enemies) {
      target.x += target.vx / TICKS_PER_SECOND;
      target.z += target.vz / TICKS_PER_SECOND;
    }
    for (const target of targets) {
      if (target.hp > 0 && Math.hypot(target.x - state.player.x, target.z - state.player.z) <= 20) intruded.add(target.id);
    }
    resolveCombatTick(state, weapon, targets, metrics);
    state.enemies = state.enemies.filter(target => target.hp > 0 && sideById.get(target.id) * target.x > 0);
  }

  return { ...finishMetrics(metrics), outcome: { uniqueAliveIntrusionsWithin20m: intruded.size } };
}

function runLockedAce(weapon) {
  const state = createComparisonState(weapon);
  const tracker = createAcquisitionTracker();
  const ace = trackAcquisitionTarget(makeAce(state, 0, 120, ground), tracker);
  state.boss = ace;
  state.lock = { id: ace.id, progress: 1, ready: true };
  const initialHp = ace.hp;
  const initialHits = ace.hits;
  const metrics = makeMetrics(state, weapon, [ace], tracker);

  for (let i = 0; i < TICKS; i++) {
    state.tick++;
    metrics.targetAvailability.liveTargetTicks += ace.hp > 0 ? 1 : 0;
    resolveCombatTick(state, weapon, [ace], metrics);
  }

  const hpDamage = initialHp - ace.hp;
  const actualHitCount = ace.hits - initialHits;
  return {
    ...finishMetrics(metrics),
    outcome: {
      initialHp,
      maxHp: ace.maxHp,
      remainingHp: ace.hp,
      hpDamage,
      hpDamagePerSecond: hpDamage / (TICKS / TICKS_PER_SECOND),
      actualHitCount,
      shotsStillInFlight: state.shots.filter(shot => projectileWeapon(shot) === weapon).length,
      damagePerFiredShot: metrics.firedProjectiles ? hpDamage / metrics.firedProjectiles : 0,
      damagePerAceHit: actualHitCount ? hpDamage / actualHitCount : null,
    },
  };
}

function ranking(rows, metric, higherIsBetter) {
  const values = Object.entries(rows).map(([weapon, row]) => [weapon, metric(row)]);
  const best = Math[higherIsBetter ? 'max' : 'min'](...values.map(([, value]) => value));
  const leaders = values.filter(([, value]) => value === best).map(([weapon]) => weapon);
  return leaders.length === 1 ? leaders[0] : 'tie';
}

function verdict(expectedWinner, measuredWinner) {
  const meetsCriterion = expectedWinner === measuredWinner;
  return { expectedWinner, measuredWinner, status: meetsCriterion ? 'MET' : 'NOT MET', meetsCriterion };
}

export function runComparison() {
  const forward = Object.fromEntries(WEAPONS.map(weapon => [weapon, runForwardColumn(weapon)]));
  const sides = Object.fromEntries(WEAPONS.map(weapon => [weapon, runSideApproach(weapon)]));
  const ace = Object.fromEntries(WEAPONS.map(weapon => [weapon, runLockedAce(weapon)]));
  return {
    scope: 'Controlled mechanics comparison only: scripted target trajectories, no spawn director or enemy AI; not a survival simulation.',
    fixedSetup: {
      seed: SEED,
      ticks: TICKS,
      seconds: TICKS / TICKS_PER_SECOND,
      weaponLevel: LEVEL,
      weapons: WEAPONS,
      altitude: { band: 'mid', value: MID_ALTITUDE },
      buffs: [],
      evolutions: [],
      damageUpgrades: 0,
      overdrive: false,
      manualWeapons: false,
      pilot: { x: 0, z: 0, yaw: 0, userInput: false },
    },
    scenarios: {
      forwardGnatColumn: {
        scene: { target: 'ordinary 1-HP Gnat', count: TARGET_COUNT, x: 0, firstZ: 120, spacing: 20,
          lastZ: 120 + 20 * (TARGET_COUNT - 1), velocity: { x: 0, z: -APPROACH_SPEED } },
        results: forward,
        verdict: verdict('twin', ranking(forward, row => row.outcome.uniqueKillsWhileAhead, true)),
      },
      sideStingApproach: {
        scene: { target: 'same-band Sting Gnat', count: TARGET_COUNT, perSide: TARGET_COUNT / 2,
          firstAbsX: 120, spacing: 20, lastAbsX: 120 + 20 * (TARGET_COUNT / 2 - 1), z: 0,
          speedTowardCenter: APPROACH_SPEED, removeAfterCenterCrossing: true },
        results: sides,
        verdict: verdict('pods', ranking(sides, row => row.outcome.uniqueAliveIntrusionsWithin20m, false)),
      },
      lockedAce: {
        scene: { target: 'stationary vulnerable Ace', position: { x: 0, z: 120 }, readyLockAtStart: true },
        results: ace,
        verdict: verdict('seeker', ranking(ace, row => row.outcome.hpDamagePerSecond, true)),
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(runComparison(), null, 2));
}
