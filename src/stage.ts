import { advanceBank, boostAirspeed, BOOST_TURN_RATE, CRUISE_SPEED, TURN_RATE } from './flight.ts';
import { advanceManeuver, BODY_GRACE_TICKS, canManeuver, exitAltitude, MANEUVERS,
  maneuverAllowsControl, TRAIL_SAMPLE_TICKS, turnExitBurst } from './maneuvers.ts';
import { ENEMY_KINDS, isNewEnemyKind, type NewEnemyKind } from './enemy-kinds.ts';
import { addBomberEscort, advanceEnemies, makeEnemy, warnHarrier } from './stage-enemies.ts';
import { relocateStragglers, spawnWave, trimEscorts, WAVES } from './spawn-director.ts';
import { random } from './stage-random.ts';
import { ARENA, BEACON_SIGNAL_SECONDS, isLandmarkId, keepInsideArena, LANDMARKS, RIM_PUSH, RIM_WARNING } from './reach.ts';
import {
  acquireAndFire, advanceEnemyHazards, advanceFlares, advanceRearBombs, advanceShots, angleTo, BANDS, clamp,
  dropFlares, dropRearBomb, fireHostile, hurtPlayer, inBand, MAX_ALTITUDE, MAX_BOMBS, MAX_FLARES, MIN_ALTITUDE,
  openReversal, REAR_GLIMPSE_TICKS, STEP, TICKS_PER_SECOND, VERTICAL_SPEED, WIPE_DURATION,
} from './stage-combat.ts';
import type { Band, Boss, DraftId, Ground, Maneuver, ManeuverKind, Outcome, StageInput, StageOptions, StageState } from './stage-types.ts';

export { activeWeakPoint } from './stage-combat.ts';
export const END_TICK = 180 * TICKS_PER_SECOND;
export const BOSS_TICK = 105 * TICKS_PER_SECOND;
const BOSS_SIGNAL = 3 * TICKS_PER_SECOND;
const BOSS_ORBIT_PER_TICK = 0.010;
const VIEWS = ['overhead', 'chase', 'cockpit'] as const;
const seaLevel: Ground = () => 35;

export function parseStageOptions(search: string): StageOptions {
  const q = new URLSearchParams(search);
  const v = q.get('view');
  const fixture = q.get('fixture');
  const seed = q.get('seed') ?? '';
  const time = q.has('t') ? Number(q.get('t')) : NaN;
  return {
    seed: /^-?\d+$/.test(seed) && Number.isSafeInteger(Number(seed)) ? Number(seed) >>> 0 : 1,
    view: v === 'top' ? 'overhead' : v === 'overhead' || v === 'chase' || v === 'cockpit' ? v : null,
    fixture: fixture === 'stack' || fixture === 'draft' || fixture === 'boss' || fixture === 'pursuit' || fixture === 'flare'
      || fixture === 'reversal' || fixture === 'flyby' || fixture === 'rear-threat' || fixture === 'strafe'
      || isLandmarkId(fixture) || isNewEnemyKind(fixture) ? fixture : null,
    time: Number.isFinite(time) ? clamp(time, 0, 180) : null,
    autoplay: q.get('autoplay') === '1',
    touch: q.get('touch') === '1',
  };
}

function makeBoss(state: StageState, x: number, z: number): Boss {
  const high = BANDS[2] + (random(state) - 0.5) * 11;
  const low = BANDS[0] + (random(state) - 0.5) * 11;
  const core = BANDS[1] + (random(state) < 0.5 ? -1 : 1) * (4.5 + random(state) * 1.5);
  return {
    x, z, alt: BANDS[1], orbitAngle: state.seed * 1.79, orbitStartTick: state.tick, index: 0, changedTick: state.tick, exposeTick: state.tick + BOSS_SIGNAL,
    shotAt: state.tick + BOSS_SIGNAL + 90,
    weakPoints: [
      { id: ++state.nextId, kind: 'pod', band: 2, x, z, alt: high, hp: 10, maxHp: 10, hits: 0, window: 8, vx: 0, vz: 0 },
      { id: ++state.nextId, kind: 'pod', band: 0, x, z, alt: low, hp: 10, maxHp: 10, hits: 0, window: 8, vx: 0, vz: 0 },
      { id: ++state.nextId, kind: 'core', band: 1, x, z, alt: core, hp: 8, maxHp: 8, hits: 0, window: 3, vx: 0, vz: 0 },
    ],
  };
}

function positionWeakPoints(boss: Boss, tick: number): void {
  const travel = Math.max(0, tick - boss.orbitStartTick) * BOSS_ORBIT_PER_TICK;
  const speed = tick < boss.orbitStartTick ? 0 : BOSS_ORBIT_PER_TICK * TICKS_PER_SECOND;
  for (const [index, point] of boss.weakPoints.entries()) {
    // A rotating gantry carries the exposed hardware, with altitude fixed for each seeded part.
    const radius = point.kind === 'core' ? 17 : 41;
    const angle = boss.orbitAngle + travel + [0, Math.PI, 0.8][index];
    const sin = Math.sin(angle), cos = Math.cos(angle);
    point.x = boss.x + radius * sin;
    point.z = boss.z + radius * cos;
    point.vx = radius * speed * cos;
    point.vz = -radius * speed * sin;
  }
}

function updateBoss(state: StageState): void {
  const boss = state.boss;
  if (!boss) return;
  positionWeakPoints(boss, state.tick);
  const point = boss.weakPoints[boss.index];
  if (state.tick >= boss.shotAt && point?.hp) {
    for (const spread of [-0.21, 0, 0.21]) fireHostile(state, point, 68, spread);
    boss.shotAt = state.tick + 255;
  }
}

function advanceWeakPoint(state: StageState): boolean {
  const boss = state.boss;
  if (!boss || boss.weakPoints[boss.index].hp > 0) return false;
  const next = boss.weakPoints.findIndex(point => point.hp > 0);
  if (next === -1) return true;
  boss.index = next;
  boss.changedTick = state.tick;
  boss.exposeTick = state.tick + BOSS_SIGNAL;
  boss.shotAt = boss.exposeTick + 90;
  state.lock = null;
  return false;
}

export function requiredXp(level: StageState['level']): number | null {
  return level === 1 ? 6 : level === 2 ? 10 : null;
}

function openDraft(state: StageState, pending: Outcome | null): void {
  const nextTwin: DraftId = state.twinRank === 1 ? 'twin-2' : 'twin-3';
  const choices: DraftId[] = [nextTwin];
  if (state.podRank === 1) choices.push('pods-2');
  if (state.twinDamage === 1) choices.push('twin-damage');
  if (state.podDamage === 1) choices.push('pods-damage');
  state.draft = choices.slice(0, 3);
  state.phase = 'draft';
  state.resultPending = pending;
  state.boostRelease = true;
  state.boosting = false;
}

function selectDraft(state: StageState, id: DraftId): void {
  if (!state.draft.includes(id) || state.level === 3) return;
  state.xp -= requiredXp(state.level)!;
  state.level = state.level === 1 ? 2 : 3;
  state.picks.push(id);
  state.draft = [];
  if (id === 'twin-2') state.twinRank = 2;
  if (id === 'twin-3') state.twinRank = 3;
  if (id === 'pods-2') state.podRank = 2;
  if (id === 'twin-damage') state.twinDamage = 2;
  if (id === 'pods-damage') state.podDamage = 2;
  state.graceUntil = state.tick + 18;
  const pending = state.resultPending;
  const cost = requiredXp(state.level);
  if (cost !== null && state.xp >= cost) {
    openDraft(state, pending);
  } else {
    state.resultPending = null;
    if (pending) finish(state, pending);
    else state.phase = 'playing';
  }
}

const fixtureBands: Record<NewEnemyKind, Band> = {
  skimmer: 0, spotter: 2, hound: 1, flanker: 2, harrier: 1, diver: 2, bomber: 1, turret: 1,
};

function applyFixture(state: StageState, fixture: StageOptions['fixture'], ground: Ground): void {
  if (!fixture) return;
  const landmark = isLandmarkId(fixture) ? LANDMARKS[fixture] : null;
  const seconds = landmark ? BEACON_SIGNAL_SECONDS : fixture === 'draft' ? 45 : fixture === 'boss' ? 108 : 30;
  state.tick = seconds * TICKS_PER_SECOND;
  state.nextWave = WAVES.findIndex(wave => wave.time > seconds);
  if (landmark) {
    Object.assign(state.player, { x: landmark.x, z: landmark.z - 70, altitude: landmark.alt });
  } else if (isNewEnemyKind(fixture)) {
    state.nextWave = WAVES.length;
    const p = state.player;
    if (fixture === 'skimmer') Object.assign(p, { x: LANDMARKS.strait.x, z: LANDMARKS.strait.z - 48 });
    if (fixture === 'turret') Object.assign(p, { x: LANDMARKS.ridge.x - 18, z: LANDMARKS.ridge.z - 65, altitude: 130 });
    const x = fixture === 'turret' ? LANDMARKS.ridge.x : p.x + (fixture === 'hound' ? 0 : 12);
    const z = p.z + (fixture === 'spotter' ? 90 : fixture === 'turret' ? 65 : 62);
    const enemy = makeEnemy(state, x, z, fixtureBands[fixture], fixture);
    if (fixture === 'turret') enemy.alt = ground(x, z) + 5;
    state.enemies.push(enemy);
    if (fixture === 'bomber') addBomberEscort(state, enemy, ground);
  } else if (fixture === 'stack') {
    for (const band of [0, 1, 2] as const) {
      state.enemies.push(makeEnemy(state, state.player.x, state.player.z + 60, band));
    }
  } else if (fixture === 'pursuit') {
    const p = state.player;
    for (const [band, lateral, aft] of [[0, -10, 73], [1, -5, 66], [1, 5, 74], [2, 8, 81]] as const) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, band);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
  } else if (fixture === 'flare') {
    const p = state.player;
    state.nextWave = WAVES.length;
    // Start the review on a reload so both close contacts are available for a manual drop.
    state.podsAt = state.tick + 150;
    for (const [band, lateral, aft, kind] of [
      [1, -6, 22, 'hound'], [1, 7, 29, 'hound'], [0, 52, 80, 'patrol'], [2, 10, 40, 'patrol'],
    ] as const) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, band, kind);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
  } else if (fixture === 'reversal') {
    const p = state.player;
    state.nextWave = WAVES.length;
    for (const [lateral, aft] of [[-18, 72], [-8, 76], [2, 82], [10, 88], [20, 94], [30, 100]]) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, 2);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
    state.enemies.push(makeEnemy(state, p.x - 15, p.z - 101, 0));
  } else if (fixture === 'flyby') {
    const p = state.player;
    p.z -= 48;
    p.altitude = BANDS[2] - 11;
    state.nextWave = WAVES.length;
    for (const [lateral, aft, band, kind] of [[-26, 53, 2, 'interceptor'], [31, 64, 1, 'patrol']] as const) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, band, kind);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
  } else if (fixture === 'rear-threat') {
    const p = state.player;
    state.speed = CRUISE_SPEED;
    state.nextWave = WAVES.length;
    state.enemies.push(makeEnemy(state, p.x - 17, p.z - 62, 2), makeEnemy(state, p.x + 16, p.z - 74, 0));
    fireHostile(state, { x: p.x, z: p.z - 48, alt: p.altitude }, 78);
  } else if (fixture === 'strafe') {
    const p = state.player;
    p.altitude = BANDS[2];
    state.nextWave = WAVES.length;
    state.enemies.push(
      makeEnemy(state, p.x + 8, p.z + 89, 1),
      makeEnemy(state, p.x - 60, p.z + 99, 1),
      makeEnemy(state, p.x - 18, p.z + 83, 0),
    );
  } else if (fixture === 'draft') {
    state.xp = state.salvage = 6;
    state.salvageBands[1] = 6;
    openDraft(state, null);
  } else {
    // Keep the fixture clear for a reproducible approach to the first weak point.
    state.boss = makeBoss(state, state.player.x, state.player.z + 109);
    state.boss.orbitAngle = Math.PI;
    state.boss.orbitStartTick = state.tick + 4 * TICKS_PER_SECOND;
    positionWeakPoints(state.boss, state.tick);
    state.boss.changedTick = BOSS_TICK;
    state.boss.exposeTick = state.tick;
    state.boss.shotAt = state.tick + 90;
  }
}

export function createStage(options: StageOptions = parseStageOptions(''), ground: Ground = seaLevel): StageState {
  const x = ARENA.x, z = ARENA.z - 85;
  const state: StageState = {
    phase: options.fixture || options.autoplay || options.time !== null ? 'playing' : 'title',
    paused: false, resultPending: null, seed: options.seed, rng: options.seed, nextId: 0, nextVolley: 0, tick: 0, nextWave: 0,
    view: options.view ?? (options.fixture === 'pursuit' || options.fixture === 'flare' ? 'chase' : 'overhead'), initialView: options.view, wipe: 0, viewTag: 0,
    arena: { ...ARENA }, boundaryWarning: false,
    player: { x, z, altitude: Math.max(BANDS[1], ground(x, z) + 22), yaw: 0, bank: 0 },
    speed: 0, climbRate: 0, hull: 8, maxHull: 8, hitsTaken: 0, rank: null, invulnerability: 0,
    boost: 1, boosting: false, boostTicks: 0, bombs: MAX_BOMBS, bombReadyAt: 0, bombReloadAt: null, rearBombs: [], enemyMines: [],
    flares: [], flareCharges: MAX_FLARES, flareReadyAt: 0, flareReloadAt: null, flareHit: null, rearGlimpse: null,
    maneuver: null, maneuverTrail: null, maneuverReadyAt: 0, bodyGraceUntil: 0, reversal: null,
    xp: 0, level: 1, salvage: 0, salvageBands: [0, 0, 0],
    draft: [], picks: [], graceUntil: 0, boostRelease: false, twinRank: 1, podRank: 1, twinDamage: 1, podDamage: 1,
    twinAt: 0, strafeAt: 0, podsAt: 0, score: 0, enemies: [], pickups: [], shots: [], effects: [], boss: null, lock: null,
    wrongLayer: null, altitudeHint: null,
  };
  applyFixture(state, options.fixture, ground);
  return state;
}

function finish(state: StageState, outcome: Outcome): void {
  state.phase = outcome;
  state.boosting = false;
  const hits = state.hitsTaken;
  state.rank = hits === 0 ? 'S' : hits <= 2 ? 'A' : hits === 3 ? 'B' : 'C';
  if (outcome === 'clear') state.score += 2500;
}

function startManeuver(state: StageState, kind: ManeuverKind, turn: number): void {
  const p = state.player, spec = MANEUVERS[kind];
  const maneuver: Maneuver = {
    kind, elapsed: 0, yaw: p.yaw,
    altitude: p.altitude, exitAltitude: exitAltitude(p.altitude, kind), side: turn < 0 ? -1 : 1,
  };
  state.maneuver = maneuver;
  const trail = state.maneuverTrail = {
    kind, startTick: state.tick, yaw: p.yaw, side: maneuver.side, exitAltitude: maneuver.exitAltitude,
    limited: (kind === 'immelmann' || kind === 'split-s') && maneuver.exitAltitude === p.altitude,
    points: [{ x: p.x, z: p.z, alt: p.altitude }], pursuers: [] as number[],
  };
  state.boost -= spec.boost;
  state.boostRelease = true;
  state.lock = state.wrongLayer = state.altitudeHint = null;

  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const until = state.tick + (kind === 'immelmann' || kind === 'split-s' ? spec.flipTick : spec.ticks) + 30;
  for (const enemy of state.enemies) {
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const aft = -dx * fx - dz * fz, lateral = dx * fz - dz * fx;
    if (enemy.hp && enemy.kind !== 'turret' && aft > 3 && Math.hypot(dx, dz) <= 190) trail.pursuers.push(enemy.id);
    warnHarrier(state, enemy, maneuver, aft, lateral);
    if (enemy.kind === 'turret' || enemy.kind === 'skimmer' || enemy.maneuver || !inBand(enemy.alt, maneuver.exitAltitude)) continue;
    if (aft <= 0 || Math.abs(lateral) > aft * Math.tan(25 * Math.PI / 180)) continue;
    if (aft >= 34 && aft <= 140) {
      const lane = clamp(lateral + (enemy.id % 3 - 1) * 3, -28, 28);
      enemy.course = { target: { x: p.x - fx * 64 + fz * lane, z: p.z - fz * 64 - fx * lane },
        speed: enemy.kind === 'interceptor' ? 40 : 32, until };
    }
    if (enemy.course) {
      keepInsideArena(enemy.course.target, state.arena);
      enemy.maneuverAt = Math.max(enemy.maneuverAt, until);
    }
  }
}

function reverseHeading(state: StageState, entryYaw: number): void {
  const p = state.player, fx = Math.sin(entryYaw), fz = Math.cos(entryYaw);
  p.yaw = Math.atan2(-fx, -fz);
  for (const enemy of state.enemies) {
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    if (dx * fx + dz * fz < 0 && Math.hypot(dx, dz) <= 160) enemy.shotAt = Math.max(enemy.shotAt, state.tick + 25);
  }
}

function fly(state: StageState, input: StageInput, ground: Ground, grace: boolean, controlled: boolean): void {
  const p = state.player, a = state.arena, maneuver = state.maneuver;
  if (!input.boost) state.boostRelease = false;
  const boostHeld = controlled && !grace && !!input.boost && !state.boostRelease;
  const priorBoost = state.boosting;
  state.boosting = boostHeld && state.boost > 0;
  state.boostTicks = state.boosting ? (priorBoost ? state.boostTicks + 1 : 1) : 0;
  if (maneuver?.kind !== 'j-turn') state.boost = clamp(state.boost + (boostHeld ? -0.5 : 0.35) * STEP, 0, 1);
  let altitude: number;
  if (maneuver && !controlled) {
    const motion = advanceManeuver(maneuver);
    state.speed = motion.speed;
    p.bank = 0;
    const fx = Math.sin(maneuver.yaw), fz = Math.cos(maneuver.yaw);
    p.x += fx * motion.distance + fz * motion.slide;
    p.z += fz * motion.distance - fx * motion.slide;
    altitude = motion.altitude;
    if (motion.reverse) {
      reverseHeading(state, maneuver.yaw);
      state.maneuverReadyAt = state.tick + MANEUVERS[maneuver.kind].cooldown;
      if (maneuver.kind !== 'j-turn' && state.maneuverTrail) openReversal(state, state.maneuverTrail.pursuers);
    }
  } else {
    if (maneuver) maneuver.elapsed++;
    const turn = clamp(input.turn ?? 0, -1, 1);
    p.bank = advanceBank(p.bank, turn, STEP);
    const yaw = p.yaw + turn * (state.boosting ? BOOST_TURN_RATE : TURN_RATE) * STEP;
    p.yaw = angleTo(0, Math.sin(yaw), Math.cos(yaw));
    const thrust = state.boosting ? boostAirspeed(state.boostTicks) : CRUISE_SPEED * (1 + turnExitBurst(state));
    state.speed = thrust * (1 - Math.abs(turn) * 0.25);
    p.x += Math.sin(p.yaw) * state.speed * STEP;
    p.z += Math.cos(p.yaw) * state.speed * STEP;
    altitude = p.altitude + clamp(input.climb ?? 0, -1, 1) * VERTICAL_SPEED * STEP;
  }
  const dx = p.x - a.x, dz = p.z - a.z;
  const distance = Math.hypot(dx, dz);
  state.boundaryWarning = distance > a.radius - RIM_WARNING;
  if (distance > a.radius - RIM_PUSH) {
    const inward = maneuver?.kind === 'j-turn' ? 0 : Math.min(96, (distance - a.radius + RIM_PUSH) * 2.2) * STEP;
    const bound = Math.min(a.radius, distance - inward);
    p.x = a.x + dx * bound / distance;
    p.z = a.z + dz * bound / distance;
  }
  const prior = p.altitude;
  p.altitude = clamp(altitude, Math.max(MIN_ALTITUDE, ground(p.x, p.z) + 22), MAX_ALTITUDE);
  state.climbRate = (p.altitude - prior) / STEP;
}

function advanceSalvage(state: StageState, ground: Ground): void {
  const p = state.player;
  for (const enemy of state.enemies) {
    if (!enemy.shotDown) continue;
    const xp = ENEMY_KINDS[enemy.kind].xp;
    state.score += xp * 100;
    state.pickups.push({ id: ++state.nextId, x: enemy.x, z: enemy.z,
      alt: enemy.kind === 'turret' ? Math.max(BANDS[0], ground(enemy.x, enemy.z) + 22) : enemy.alt,
      xp, born: state.tick, reversal: enemy.reversalKill });
    state.effects.push({ kind: 'burst', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.42 });
  }
  state.enemies = state.enemies.filter(enemy => enemy.hp > 0);
  const horizontalSpeed = Math.hypot(p.vx ?? 0, p.vz ?? 0);
  state.pickups = state.pickups.filter(pickup => {
    if (state.tick - pickup.born >= 60 * TICKS_PER_SECOND) return false;
    if (!inBand(p.altitude, pickup.alt)) {
      pickup.pulling = false;
      return true;
    }
    const dx = p.x - pickup.x, dz = p.z - pickup.z;
    const range = Math.hypot(dx, dz);
    if (range > 8 && (pickup.pulling || range <= 42)) {
      const speed = Math.min(155, horizontalSpeed + (pickup.reversal ? 75 : 45));
      const pull = Math.min(range, speed * STEP) / range;
      const x = pickup.x + dx * pull, z = pickup.z + dz * pull;
      pickup.pulling = true;
      if (ground(x, z) < pickup.alt && ground((pickup.x + x) / 2, (pickup.z + z) / 2) < pickup.alt) {
        pickup.x = x;
        pickup.z = z;
      }
    }
    if (Math.hypot(p.x - pickup.x, p.z - pickup.z) <= 8) {
      state.xp += pickup.xp;
      state.salvage += pickup.xp;
      const band = pickup.alt < 92.5 ? 0 : pickup.alt > 127.5 ? 2 : 1;
      state.salvageBands[band] += pickup.xp;
      return false;
    }
    return true;
  });
}

/** Advance exactly one 60 Hz tick. A modal consumes input without ticking the sortie. */
export function stepStage(state: StageState, input: StageInput = {}, ground: Ground = seaLevel): void {
  if (state.phase === 'draft') {
    if (input.pick) selectDraft(state, input.pick);
    return;
  }
  if (state.phase !== 'playing') {
    if (input.start) {
      Object.assign(state, createStage({ ...parseStageOptions(''), seed: state.seed, view: state.initialView, time: 0 }, ground));
    }
    return;
  }
  if (input.pause) {
    state.paused = !state.paused;
    state.boosting = false;
    return;
  }
  if (state.paused) return;

  state.tick++;
  const grace = state.tick <= state.graceUntil;
  const glimpse = state.rearGlimpse;
  if (glimpse) {
    if ((input.bomb || input.flare) && state.tick <= glimpse.until) glimpse.until = Math.max(glimpse.until, state.tick + REAR_GLIMPSE_TICKS);
    else if (state.tick >= glimpse.until) state.rearGlimpse = null;
  }
  if (input.toggleView && !grace) {
    state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length];
    state.wipe = WIPE_DURATION;
    state.viewTag = 1.12;
  } else {
    state.wipe = Math.max(0, state.wipe - STEP);
    state.viewTag = Math.max(0, state.viewTag - STEP);
  }
  state.invulnerability = Math.max(0, state.invulnerability - STEP);
  for (const effect of state.effects) effect.life -= STEP;
  state.effects = state.effects.filter(effect => effect.life > 0);
  if (input.maneuver && canManeuver(state, input.maneuver)) startManeuver(state, input.maneuver, input.maneuverTurn ?? input.turn ?? 0);
  const maneuver = state.maneuver;
  const { x, z } = state.player;
  const controlled = maneuverAllowsControl(maneuver);
  fly(state, input, ground, grace, controlled);
  const vx = state.player.vx = (state.player.x - x) / STEP;
  const vz = state.player.vz = (state.player.z - z) / STEP;
  if (maneuver && state.maneuverTrail && (maneuver.elapsed % TRAIL_SAMPLE_TICKS === 0 || maneuver.elapsed === MANEUVERS[maneuver.kind].ticks)) {
    const { x, z, altitude } = state.player;
    state.maneuverTrail.points.push({ x, z, alt: altitude });
  }

  if (state.tick === BOSS_TICK && !state.boss) {
    state.boss = makeBoss(state, LANDMARKS.atoll.x, LANDMARKS.atoll.z);
    trimEscorts(state);
  }
  const wave = WAVES[state.nextWave];
  if (wave && state.tick === wave.time * TICKS_PER_SECOND) {
    spawnWave(state, wave, ground);
    state.nextWave++;
  }

  relocateStragglers(state, ground);
  advanceEnemies(state, ground);
  updateBoss(state);
  advanceRearBombs(state, ground);
  advanceFlares(state, ground);
  if (controlled) {
    if (input.bomb && !grace) dropRearBomb(state);
    acquireAndFire(state);
  }
  if (input.flare) dropFlares(state, vx, vz);
  if (maneuver && maneuver.elapsed === MANEUVERS[maneuver.kind].ticks) {
    if (state.maneuverTrail) {
      state.maneuverTrail.actualExit = state.player.altitude;
      if (maneuver.kind === 'j-turn') openReversal(state, state.maneuverTrail.pursuers);
    }
    state.maneuver = null;
    state.bodyGraceUntil = state.tick + BODY_GRACE_TICKS;
  }
  advanceShots(state, ground);
  advanceEnemyHazards(state, ground);

  if (state.tick > state.bodyGraceUntil) {
    const p = state.player;
    for (const enemy of state.enemies) {
      if (enemy.hp && inBand(enemy.alt, p.altitude) && Math.hypot(enemy.x - p.x, enemy.z - p.z) < 7) {
        hurtPlayer(state);
        enemy.hp = 0;
      }
    }
  }
  advanceSalvage(state, ground);
  const defeated = advanceWeakPoint(state);
  const outcome = defeated ? 'clear' : state.tick >= END_TICK ? 'timeout' : null;
  const cost = requiredXp(state.level);
  if (!state.hull) finish(state, 'lost');
  else if (cost !== null && state.xp >= cost) openDraft(state, outcome);
  else if (outcome) finish(state, outcome);
}
