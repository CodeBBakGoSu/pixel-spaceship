import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { REGULAR_FIRE_INTERVAL_SCALE } from './data/run-balance.ts';
import { GNAT } from './data/phases.ts';
import { ROSTER } from './data/roster.ts';
import { planFlyIn, sampleFlyIn, WAVE_FLY_IN_TICKS } from './fly-in.ts';
import type { CombatEvents } from './hostile-events.ts';
import { nearestBand } from './maneuvers.ts';
import { keepInsideArena } from './reach.ts';
import { angleTo, BANDS, clamp, fireHostile, FLAK_LIFE, inBand, MINE_LIMIT, STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import { random } from './stage-random.ts';
import type { Band, Enemy, Ground, Maneuver, Point, Position, StageState } from './stage-types.ts';
import type { SwarmObserver } from './swarm.ts';

export const SKIMMER_WATER = ROSTER.skimmer.waterCeiling;
const COAST_TURNS = [0.65, -0.65, 1.3, -1.3, 2.05, -2.05, Math.PI];
const MAX_TURN = 3.2 * STEP;
// Ease most of a speed or bank change over the next 0.18 seconds.
const STEERING_BLEND = 1 - Math.exp(-STEP / 0.06);
const TERRAIN_HOLD_TICKS = 18;
const ESCORT_SPAN = 19, ESCORT_AFT = 13;
const FLYBY_SPEED = 76, FLYBY_LANE = 31, LANE_LEEWAY = 32, CROSS_AHEAD = 62;
const CROSS_TRAVEL = 92, CROSS_EXIT = 43;

function shotInterval(state: StageState, ticks: number): number {
  return state.run ? Math.round(ticks * REGULAR_FIRE_INTERVAL_SCALE * HEAT_TIERS[state.heat].shotIntervalScale) : ticks;
}

type AttackTell = 'gun' | 'strafe' | 'tail' | 'mine' | 'aegis' | 'carrier';

export function postponeEnemyShot(enemy: Enemy, until: number): void {
  enemy.shotAt = Math.max(enemy.shotAt, until);
  const tell = enemy.tell;
  if (tell && tell.kind !== 'snipe' && tell.kind !== 'flak' && tell.kind !== 'gnat') {
    tell.until = Math.max(tell.until, until);
  }
}

function attackReady(state: StageState, enemy: Enemy, kind: AttackTell, ticks: number, events?: CombatEvents): boolean {
  if (enemy.tell?.kind === kind) {
    if (state.tick < enemy.tell.until) return false;
    delete enemy.tell;
    return true;
  }
  if (state.tick < enemy.shotAt - ticks) return false;
  enemy.tell = { kind, started: state.tick, until: state.tick + ticks };
  events?.tell?.(kind, enemy.x, enemy.z, enemy.alt);
  return false;
}

function lowestRosterBand(): Band {
  let lowest: Band = ROSTER.bands.low;
  for (let band = 0; band < BANDS.length; band++) {
    if (BANDS[band] < BANDS[lowest]) lowest = band as Band;
  }
  return lowest;
}

const bandHeight = (band: Band, floor: number) => BANDS[band] < BANDS[ROSTER.bands.low]
  ? floor + ROSTER.skimmer.skimClearance : BANDS[band];

export function makeEnemy(state: StageState, x: number, z: number, band: Band, kind: EnemyKind = 'patrol', offset = 0): Enemy {
  const spec = ENEMY_KINDS[kind];
  if (kind === 'skimmer') band = lowestRosterBand();
  return {
    id: ++state.nextId, kind, x, z, alt: BANDS[band] + offset, hp: spec.hp,
    yaw: Math.atan2(state.player.x - x, state.player.z - z), vx: 0, vz: 0, bank: 0,
    band, offset, shotAt: state.tick + shotInterval(state, spec.firstShot),
    maneuverAt: state.tick + (kind === 'harrier' ? 0 : 102), maneuver: null, hitUntil: 0, shotDown: false,
  };
}

export function bomberWingPosition(state: StageState, bomber: Enemy, ground: Ground, side: number): Point {
  const fx = Math.sin(bomber.yaw), fz = Math.cos(bomber.yaw);
  const point = {
    x: bomber.x + fz * ESCORT_SPAN * side - fx * ESCORT_AFT,
    z: bomber.z - fx * ESCORT_SPAN * side - fz * ESCORT_AFT,
  };
  keepInsideArena(point, state.arena);
  if (ground(point.x, point.z) + 22 <= bomber.alt) return point;
  return bomber;
}

export function addBomberEscort(state: StageState, bomber: Enemy, ground: Ground): void {
  for (const side of [-1, 1]) {
    const { x, z } = bomberWingPosition(state, bomber, ground, side);
    const escort = makeEnemy(state, x, z, 1, 'patrol', bomber.offset);
    escort.yaw = bomber.yaw;
    escort.formation = { leader: bomber.id, side };
    state.enemies.push(escort);
  }
}

export function warnHarrier(state: StageState, enemy: Enemy, maneuver: Maneuver, aft: number, lateral: number, events?: CombatEvents): void {
  if (enemy.kind !== 'harrier' || enemy.maneuver || state.tick < enemy.maneuverAt || aft <= 0 || aft > 115
    || Math.abs(lateral) > aft * 0.75 || (maneuver.kind !== 'immelmann' && maneuver.kind !== 'split-s')) return;
  const exitBand = nearestBand(maneuver.exitAltitude);
  if (exitBand !== enemy.band) {
    enemy.maneuver = { phase: 'warning', band: (enemy.band + Math.sign(exitBand - enemy.band)) as Band,
      diveAt: state.tick + ROSTER.harrier.bandHopWarningTicks };
    events?.tell?.('dive', enemy.x, enemy.z, enemy.alt);
  }
}

function moveBetweenBands(state: StageState, e: Enemy, ground: Ground, speed: number): boolean {
  const move = e.maneuver;
  if (!move || state.tick < move.diveAt) return false;
  move.phase = 'diving';
  const floor = ground(e.x, e.z);
  const target = bandHeight(move.band, floor) + e.offset;
  const error = Math.max(target, floor + 22) - e.alt;
  e.alt += Math.sign(error) * Math.min(Math.abs(error), speed * STEP);
  if (Math.abs(e.alt - target) > 1e-6) return false;
  e.alt = target;
  e.band = move.band;
  e.maneuver = null;
  postponeEnemyShot(e, state.tick + 24);
  return true;
}

function followPlayerBand(state: StageState, enemy: Enemy, ground: Ground, events?: CombatEvents): void {
  if (enemy.maneuver?.phase !== 'diving' && state.tick >= enemy.maneuverAt) {
    const target = nearestBand(state.player.altitude);
    if (target === enemy.band) enemy.maneuver = null;
    else if (enemy.maneuver?.band !== target) {
      enemy.maneuver = { phase: 'warning', band: target, diveAt: state.tick + ROSTER.hound.bandLagTicks };
      events?.tell?.('dive', enemy.x, enemy.z, enemy.alt);
    }
  }
  moveBetweenBands(state, enemy, ground, ROSTER.hound.bandSpeed);
}

function headingDelta(yaw: number, target: number): number {
  const delta = target - yaw;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function bankToward(enemy: Enemy, yaw: number): void {
  const turn = clamp(headingDelta(enemy.yaw, yaw), -MAX_TURN, MAX_TURN);
  enemy.yaw += turn;
  enemy.bank += (-turn / STEP * 0.16 - enemy.bank) * STEERING_BLEND;
}

export function beginEnemyFlyIn(state: StageState, enemy: Enemy, ground: Ground, anchor: Point, bend: number): void {
  const { x, z, alt, kind } = enemy;
  const targetAlt = kind === 'skimmer' && enemy.band !== ROSTER.bands.low ? bandHeight(enemy.band, ground(x, z)) : alt;
  const path = planFlyIn(state, anchor, { x, z, alt: targetAlt }, {
    ticks: WAVE_FLY_IN_TICKS, bend, exitSpeed: kind === 'turret' ? 0 : ENEMY_KINDS[kind].speed,
    clearance: kind === 'turret' ? 5 : undefined,
  });
  enemy.entry = path;
  Object.assign(enemy, sampleFlyIn(path, state.tick, ground));
}

function rangeMode(active: boolean | undefined, range: number, threshold: number, margin: number): boolean {
  return range < threshold + (active === undefined ? 0 : active ? margin : -margin);
}

function clearAt(state: StageState, enemy: Enemy, ground: Ground, x: number, z: number): boolean {
  if (enemy.kind === 'skimmer') {
    return Math.hypot(x - state.arena.x, z - state.arena.z) <= state.arena.radius
      && ground(x, z) <= SKIMMER_WATER;
  }
  return ground(x, z) + 22 <= enemy.alt + 0.01;
}

function steer(state: StageState, enemy: Enemy, ground: Ground, targetYaw: number, targetSpeed: number): void {
  const previousSpeed = enemy.flightSpeed ?? targetSpeed;
  const speed = previousSpeed + (targetSpeed - previousSpeed) * STEERING_BLEND;
  enemy.flightSpeed = speed;

  const lookAhead = enemy.kind === 'skimmer' ? ROSTER.skimmer.lookAhead : Math.max(6, speed * 0.38);
  const clearHeading = (yaw: number) => clearAt(state, enemy, ground,
    enemy.x + Math.sin(yaw) * lookAhead, enemy.z + Math.cos(yaw) * lookAhead);
  const held = enemy.terrainTurn;
  if (held && state.tick < held.until) {
    targetYaw = held.yaw;
  } else if (speed > 0.01 && !clearHeading(targetYaw)) {
    // Keep the last viable escape direction while the requested course is blocked.
    if (held && clearHeading(held.yaw)) {
      targetYaw = held.yaw;
    } else {
      const offset = COAST_TURNS.find(turn => clearHeading(targetYaw + turn));
      if (offset !== undefined) {
        targetYaw += offset;
        enemy.terrainTurn = { yaw: targetYaw, until: state.tick + TERRAIN_HOLD_TICKS };
      }
    }
  } else if (held) {
    delete enemy.terrainTurn;
  }

  bankToward(enemy, targetYaw);
  enemy.vx = Math.sin(enemy.yaw) * speed;
  enemy.vz = Math.cos(enemy.yaw) * speed;
}

function clearFlybyPath(state: StageState, ground: Ground, from: Point, to: Point, altitude: number): boolean {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / 16);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + dx * i / steps, z = from.z + dz * i / steps;
    if (Math.hypot(x - state.arena.x, z - state.arena.z) > state.arena.radius - 12 || ground(x, z) + 22 > altitude) return false;
  }
  return true;
}

function planFlyby(state: StageState, enemy: Enemy, ground: Ground, fx: number, fz: number, dx: number, dz: number): Enemy['flyby'] {
  if (state.maneuver || state.boundaryWarning || enemy.maneuver || enemy.formation || state.speed > FLYBY_SPEED - 12
    || (enemy.flybyAt ?? 0) > state.tick) return;
  const aft = dx * fx + dz * fz, lateral = dz * fx - dx * fz;
  if (aft < 42 || aft > 105 || Math.abs(lateral) < 14 || Math.abs(lateral) > 68) return;
  const side = lateral < 0 ? -1 : 1;
  if (state.enemies.some(other => other.hp && other.flyby
    && (other.band === enemy.band || other.flyby.side === side || state.tick - other.flyby.startedAt < TICKS_PER_SECOND))) return;

  const p = state.player;
  const closingTime = (aft + CROSS_AHEAD) / (FLYBY_SPEED - state.speed);
  const reach = CROSS_AHEAD + state.speed * closingTime;
  const wing = { x: p.x + fx * reach + fz * FLYBY_LANE * side, z: p.z + fz * reach - fx * FLYBY_LANE * side };
  const exit = { x: p.x + fx * (reach + CROSS_TRAVEL) - fz * CROSS_EXIT * side,
    z: p.z + fz * (reach + CROSS_TRAVEL) + fx * CROSS_EXIT * side };
  if (!clearFlybyPath(state, ground, enemy, wing, enemy.alt) || !clearFlybyPath(state, ground, wing, exit, enemy.alt)) {
    enemy.flybyAt = state.tick + 30;
    return;
  }
  return { phase: 'overtake', startedAt: state.tick, yaw: p.yaw, side, lane: p.x * fz - p.z * fx + FLYBY_LANE * side };
}

function finishFlyby(state: StageState, enemy: Enemy): false {
  delete enemy.flyby;
  enemy.flybyAt = state.tick + 7 * TICKS_PER_SECOND;
  return false;
}

function moveFlyby(state: StageState, enemy: Enemy, ground: Ground, fx: number, fz: number, dx: number, dz: number): boolean {
  let pass = enemy.flyby ?? planFlyby(state, enemy, ground, fx, fz, dx, dz);
  if (!pass) return false;
  const p = state.player, forwardX = Math.sin(pass.yaw), forwardZ = Math.cos(pass.yaw);
  const ahead = -dx * forwardX - dz * forwardZ, lateral = dz * forwardX - dx * forwardZ;
  const drift = p.x * forwardZ - p.z * forwardX - pass.lane + FLYBY_LANE * pass.side;
  if (state.maneuver || state.speed > FLYBY_SPEED - 6 || state.tick - pass.startedAt >= 8 * TICKS_PER_SECOND
    || Math.abs(angleTo(pass.yaw, fx, fz)) > 0.6 || Math.abs(drift) > LANE_LEEWAY + 16) {
    return finishFlyby(state, enemy);
  }

  if (pass.phase === 'overtake' && ahead >= CROSS_AHEAD && -dx * fx - dz * fz >= 52 && pass.side * lateral >= 22) {
    const target = { x: p.x + forwardX * (ahead + CROSS_TRAVEL) - forwardZ * CROSS_EXIT * pass.side,
      z: p.z + forwardZ * (ahead + CROSS_TRAVEL) + forwardX * CROSS_EXIT * pass.side };
    if (!clearFlybyPath(state, ground, enemy, target, enemy.alt)) return finishFlyby(state, enemy);
    pass = { ...pass, phase: 'cross', target };
  }

  // Absorb small pilot corrections while keeping the pass on its original heading.
  const lane = pass.lane + clamp(drift, -LANE_LEEWAY, LANE_LEEWAY);
  const laneError = lane - (enemy.x * forwardZ - enemy.z * forwardX);
  let wantedYaw = pass.yaw + clamp(laneError * 0.032, -0.48, 0.48);
  if (pass.phase === 'cross') {
    const x = pass.target.x - enemy.x, z = pass.target.z - enemy.z;
    if (ahead < 32 || Math.hypot(x, z) < 8) return finishFlyby(state, enemy);
    wantedYaw = Math.atan2(x, z);
  }
  const turn = clamp(headingDelta(enemy.yaw, wantedYaw), -MAX_TURN, MAX_TURN);
  const yaw = enemy.yaw + turn;
  const look = { x: enemy.x + Math.sin(yaw) * 15, z: enemy.z + Math.cos(yaw) * 15 };
  if (!clearFlybyPath(state, ground, enemy, look, enemy.alt)) return finishFlyby(state, enemy);
  if (pass.phase === 'overtake' && Math.abs(ahead) < 16 && pass.side * lateral < 17) return finishFlyby(state, enemy);
  enemy.flightSpeed ??= 34;
  steer(state, enemy, ground, wantedYaw, FLYBY_SPEED);
  enemy.flyby = pass;
  return true;
}

function pursuitBoost(state: StageState, enemy: Enemy): number {
  for (const spotter of state.enemies) {
    if (spotter.kind === 'spotter' && spotter.hp && !spotter.entry && Math.hypot(spotter.x - enemy.x, spotter.z - enemy.z) <= 125) return 1.2;
  }
  return 1;
}

function moveSkimmer(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.skimmer;
  const { range: maxRange, warningTicks, spread, cooldownTicks } = ROSTER.skimmer;
  const direction = enemy.id % 2 ? 1 : -1;
  enemy.closeRange = rangeMode(enemy.closeRange, range, 60, 6);
  steer(state, enemy, ground, angle + direction * (enemy.closeRange ? 1.25 : 0.34), speed);
  if (range <= maxRange && attackReady(state, enemy, 'strafe', warningTicks, events)) {
    for (const offset of spread) fireHostile(state, enemy, boltSpeed, offset, events);
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  }
}

function moveSpotter(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.spotter;
  const { range: maxRange, warningTicks, cooldownTicks, recoveryTicks } = ROSTER.spotter;
  enemy.closeRange = rangeMode(enemy.closeRange, range, 105, 8);
  enemy.longRange = rangeMode(enemy.longRange, -range, -165, 8);
  const bias = enemy.closeRange ? 2.05 : enemy.longRange ? 0.55 : 1.35;
  steer(state, enemy, ground, angle + bias * (enemy.id % 2 ? 1 : -1), speed);
  if (enemy.tell?.kind === 'snipe') {
    if (state.tick < enemy.tell.until) return;
    const target = enemy.tell.target;
    const offset = target ? angleTo(angle, target.x - enemy.x, target.z - enemy.z) : 0;
    fireHostile(state, enemy, boltSpeed, offset, events);
    delete enemy.tell;
    enemy.shotAt = state.tick + recoveryTicks + shotInterval(state, cooldownTicks);
  } else if (state.tick >= enemy.shotAt && range <= maxRange) {
    const p = state.player;
    const vx = p.vx ?? Math.sin(p.yaw) * state.speed, vz = p.vz ?? Math.cos(p.yaw) * state.speed;
    const radial = vx * Math.sin(angle) + vz * Math.cos(angle);
    const lead = warningTicks * STEP + range / Math.max(boltSpeed * 0.5, boltSpeed - radial);
    const target = { x: p.x + vx * lead, z: p.z + vz * lead, alt: enemy.alt };
    keepInsideArena(target, state.arena);
    enemy.tell = { kind: 'snipe', started: state.tick, until: state.tick + warningTicks, target };
    events?.tell?.('snipe', enemy.x, enemy.z, enemy.alt);
  }
}

function moveTail(state: StageState, enemy: Enemy, ground: Ground, kind: 'hound' | 'harrier', fx: number, fz: number, dx: number, dz: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS[kind], harrier = kind === 'harrier';
  const aft = dx * fx + dz * fz;
  const slot = harrier ? 62 : 29;
  const side = (enemy.id % 2 ? 1 : -1) * (harrier ? 15 : 6);
  const vx = fx * state.speed + (dx - fx * slot + fz * side) * 1.1;
  const vz = fz * state.speed + (dz - fz * slot - fx * side) * 1.1;
  steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(speed, Math.hypot(vx, vz)) * pursuitBoost(state, enemy));
  if (aft >= slot - 11 && aft <= slot + 26 && inBand(enemy.alt, state.player.altitude)
    && Math.abs(dx * fz - dz * fx) < (harrier ? 33 : 23) && enemy.maneuver?.phase !== 'diving'
    && attackReady(state, enemy, 'tail', ROSTER[kind].warningTicks, events)) {
    fireHostile(state, enemy, boltSpeed, 0, events);
    enemy.shotAt = state.tick + shotInterval(state, harrier ? 240 : 180);
  }
}

function moveFlanker(state: StageState, enemy: Enemy, ground: Ground, fx: number, fz: number, dx: number, dz: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.flanker;
  const side = enemy.id % 2 ? 1 : -1;
  const vx = fx * state.speed + (dx + fz * 40 * side) * 1.25;
  const vz = fz * state.speed + (dz - fx * 40 * side) * 1.25;
  steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(speed, Math.hypot(vx, vz)));
  const { range, warningTicks, cooldownTicks } = ROSTER.flanker;
  if (Math.hypot(dx, dz) < range && attackReady(state, enemy, 'strafe', warningTicks, events)) {
    fireHostile(state, enemy, boltSpeed, 0, events);
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  }
}

function moveDiver(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.diver;
  const { warningTicks, range: maxRange, plungeSpeed, climbSpeed, spread } = ROSTER.diver;
  const { low, high } = ROSTER.bands;
  enemy.closeRange = rangeMode(enemy.closeRange, range, 75, 6);
  steer(state, enemy, ground, angle + (enemy.closeRange ? 1.45 : 0.24) * (enemy.id % 2 ? 1 : -1), speed);
  if (!enemy.maneuver && state.tick >= enemy.maneuverAt && (enemy.band === low || range <= maxRange)) {
    const climbing = enemy.band === low;
    enemy.maneuver = { phase: 'warning', band: climbing ? high : low, diveAt: state.tick + (climbing ? 0 : warningTicks) };
    if (!climbing) events?.tell?.('dive', enemy.x, enemy.z, enemy.alt);
    enemy.fanFired = false;
  }
  const plunge = enemy.maneuver?.band === low && state.tick >= enemy.maneuver.diveAt;
  const oldAltitude = enemy.alt;
  const arrived = moveBetweenBands(state, enemy, ground, plunge ? plungeSpeed : climbSpeed);
  const altitude = state.player.altitude;
  if (plunge && enemy.alt < oldAltitude && !enemy.fanFired && range <= maxRange && inBand(enemy.alt, altitude, 4)) {
    for (const offset of spread) fireHostile(state, enemy, boltSpeed, offset, events);
    enemy.fanFired = true;
  }
  if (arrived) enemy.maneuverAt = state.tick + (enemy.band === low ? 105 : 390);
}

function moveBomber(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number,
  events?: CombatEvents, observeSwarm?: SwarmObserver): void {
  enemy.closeRange = rangeMode(enemy.closeRange, range, 96, 8);
  steer(state, enemy, ground, angle + (enemy.closeRange ? 1.7 : 0.65) * (enemy.id % 2 ? 1 : -1), ENEMY_KINDS.bomber.speed);
  if (enemy.carrier) {
    const { warningTicks, range: maxRange, waveSize, cooldownTicks } = ROSTER.carrier;
    if (range <= maxRange && attackReady(state, enemy, 'carrier', warningTicks, events)) {
      spawnEscortGnats(state, enemy, ground, waveSize, observeSwarm);
      enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
    }
    return;
  }

  const { warningTicks, range: maxRange, tailRange, tailHalfAngle, mineOffset, cooldownTicks } = ROSTER.bomber;
  const tail = range <= tailRange && inBand(enemy.alt, state.player.altitude)
    && Math.abs(headingDelta(enemy.yaw + Math.PI, angle)) <= tailHalfAngle;
  if (tail) {
    if (!attackReady(state, enemy, 'gun', warningTicks, events)) return;
    fireHostile(state, enemy, ENEMY_KINDS.bomber.boltSpeed, 0, events);
  } else {
    if (range > maxRange || state.enemyMines.length >= MINE_LIMIT
      || !attackReady(state, enemy, 'mine', warningTicks, events)) return;
    state.enemyMines.push({ x: enemy.x - Math.sin(enemy.yaw) * mineOffset, z: enemy.z - Math.cos(enemy.yaw) * mineOffset,
      alt: enemy.alt, born: state.tick });
  }
  enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
}

function moveAegis(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed, range: maxRange, orbitRange, orbitMargin, orbitAngle, warningTicks, cooldownTicks } = ROSTER.aegis;
  enemy.closeRange = rangeMode(enemy.closeRange, range, orbitRange, orbitMargin);
  const side = enemy.id % 2 ? 1 : -1;
  steer(state, enemy, ground, angle + (enemy.closeRange ? side * orbitAngle : 0), speed);
  if (range <= maxRange && attackReady(state, enemy, 'aegis', warningTicks, events)) {
    fireHostile(state, enemy, boltSpeed, 0, events);
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  }
}

function moveTurret(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { range: maxRange, leadDistance, warningTicks, cooldownTicks } = ROSTER.flak;
  enemy.yaw += clamp(headingDelta(enemy.yaw, angle), -MAX_TURN, MAX_TURN);
  if (enemy.tell?.kind === 'flak') {
    const { x, z, alt, until } = enemy.tell;
    if (state.tick < until) return;
    state.effects.push({ x, z, alt, kind: 'flak', life: FLAK_LIFE });
    delete enemy.tell;
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  } else if (state.tick >= enemy.shotAt && range <= maxRange) {
    const p = state.player;
    const target = { x: p.x + Math.sin(p.yaw) * leadDistance, z: p.z + Math.cos(p.yaw) * leadDistance };
    keepInsideArena(target, state.arena);
    const low = lowestRosterBand();
    const band = low !== ROSTER.bands.low && nearestBand(p.altitude) === low ? low : enemy.band;
    const alt = bandHeight(band, ground(target.x, target.z));
    enemy.tell = { ...target, alt, kind: 'flak', started: state.tick, until: state.tick + warningTicks };
    events?.tell?.('flak', target.x, target.z, alt);
  }
}

function stayWithBomber(state: StageState, enemy: Enemy, ground: Ground): boolean {
  const formation = enemy.formation;
  if (!formation) return false;
  let leader: Enemy | undefined;
  for (const candidate of state.enemies) {
    if (candidate.id === formation.leader && candidate.hp) {
      leader = candidate;
      break;
    }
  }
  if (!leader) {
    delete enemy.formation;
    return false;
  }
  const fx = Math.sin(leader.yaw), fz = Math.cos(leader.yaw);
  const vx = leader.vx + (leader.x + fz * formation.side * ESCORT_SPAN - fx * ESCORT_AFT - enemy.x) * 1.15;
  const vz = leader.vz + (leader.z - fx * formation.side * ESCORT_SPAN - fz * ESCORT_AFT - enemy.z) * 1.15;
  steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(36, Math.hypot(vx, vz)));
  return true;
}

function advancePosition(state: StageState, enemy: Enemy, ground: Ground): void {
  const x = enemy.x + enemy.vx * STEP, z = enemy.z + enemy.vz * STEP;
  if (!clearAt(state, enemy, ground, x, z)) {
    enemy.vx = enemy.vz = 0;
    return;
  }
  enemy.x = x;
  enemy.z = z;
  keepInsideArena(enemy, state.arena);
  if (enemy.kind === 'skimmer' && enemy.band !== ROSTER.bands.low) {
    enemy.alt = bandHeight(enemy.band, ground(enemy.x, enemy.z));
  }
}

function advanceGnat(state: StageState, enemy: Enemy, ground: Ground): void {
  const x = enemy.x + enemy.vx * STEP, z = enemy.z + enemy.vz * STEP;
  if ((enemy.leaveAt !== undefined && state.tick >= enemy.leaveAt)
    || (x - state.arena.x) ** 2 + (z - state.arena.z) ** 2 > state.arena.radius ** 2
    || ground(x, z) + GNAT.clearance > enemy.alt) {
    enemy.hp = 0; // The formation left the fight. This is not a kill.
    return;
  }
  enemy.x = x;
  enemy.z = z;
  const dx = state.player.x - x, dz = state.player.z - z;
  const distance = Math.hypot(dx, dz);
  if (distance > GNAT.spacing && (enemy.vx || enemy.vz)) {
    const blend = ROSTER.gnat.driftResponse * STEP;
    const speed = GNAT.speed / distance;
    enemy.vx += (dx * speed - enemy.vx) * blend;
    enemy.vz += (dz * speed - enemy.vz) * blend;
    enemy.yaw = Math.atan2(enemy.vx, enemy.vz);
  }
}

export function spawnEscortGnats(state: StageState, source: Position & { band: Band }, ground: Ground,
  members: number, observeSwarm?: SwarmObserver): void {
  const live = state.enemies.reduce((count, enemy) => count + Number(enemy.kind === 'gnat' && enemy.hp > 0), 0);
  const room = state.swarmCap - live;
  const aim = Math.atan2(state.player.x - source.x, state.player.z - source.z);
  let spawned = 0;
  for (let i = 0; i < members && spawned < room; i++) {
    const yaw = aim + (2 * (i + 0.5) / members - 1) * ROSTER.gnat.escortHalfFan;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const radius = GNAT.spacing * ROSTER.gnat.escortSpacing;
    const spot = { x: source.x + fx * radius, z: source.z + fz * radius };
    keepInsideArena(spot, state.arena, radius);
    if (ground(spot.x, spot.z) + GNAT.clearance > source.alt) continue;
    const gnat = makeEnemy(state, spot.x, spot.z, source.band, 'gnat');
    gnat.alt = source.alt;
    gnat.leaveAt = state.tick + GNAT.lifeSeconds * TICKS_PER_SECOND;
    gnat.vx = fx * GNAT.speed;
    gnat.vz = fz * GNAT.speed;
    gnat.yaw = yaw;
    gnat.tell = { kind: 'gnat', started: state.tick, until: state.tick + ROSTER.gnat.warningTicks };
    state.enemies.push(gnat);
    spawned++;
  }
  observeSwarm?.(live + spawned, state.swarmCap, members > room);
}

export function advanceEnemies(state: StageState, ground: Ground, events?: CombatEvents, observeSwarm?: SwarmObserver): void {
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const count = state.enemies.length;
  let swarmHeard = false;
  for (let i = 0; i < count; i++) {
    const enemy = state.enemies[i];
    if (!enemy.hp) continue;
    if (enemy.tell && enemy.tell.kind !== 'snipe' && enemy.tell.kind !== 'flak' && state.tick > enemy.tell.until) delete enemy.tell;
    if (enemy.entry) {
      const { yaw, ...pose } = sampleFlyIn(enemy.entry, state.tick, ground);
      bankToward(enemy, yaw);
      Object.assign(enemy, pose);
      if (state.tick >= enemy.entry.arriveAt) {
        enemy.flightSpeed = enemy.entry.exitSpeed;
        if (enemy.kind === 'turret') enemy.bank = 0;
        if (enemy.kind === 'gnat') {
          enemy.tell = { kind: 'gnat', started: state.tick, until: state.tick + ROSTER.gnat.warningTicks };
          if (!swarmHeard) events?.tell?.('gnat', enemy.x, enemy.z, enemy.alt);
          swarmHeard = true;
        }
        delete enemy.entry;
      }
      // Fly-in skips attack AI. Collision checks use the entry flag until arrival.
      continue;
    }
    if (enemy.kind === 'gnat') {
      advanceGnat(state, enemy, ground);
      continue;
    }
    const dx = p.x - enemy.x, dz = p.z - enemy.z, range = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    if (enemy.kind === 'turret') {
      moveTurret(state, enemy, ground, angle, range, events);
      continue;
    }
    if (enemy.course && state.tick >= enemy.course.until) delete enemy.course;
    const course = enemy.course;
    if (course && enemy.flyby) finishFlyby(state, enemy);
    if (!course && (enemy.kind === 'patrol' || enemy.kind === 'interceptor' || enemy.kind === 'flanker')
      && moveFlyby(state, enemy, ground, fx, fz, dx, dz)) {
      advancePosition(state, enemy, ground);
      const pass = enemy.flyby;
      const tell = enemy.kind === 'flanker' ? 'strafe' : 'gun';
      if (pass?.phase === 'cross' && pass.side * (dz * Math.sin(pass.yaw) - dx * Math.cos(pass.yaw)) <= 0
        && attackReady(state, enemy, tell, ROSTER[enemy.kind].warningTicks, events)) {
        fireHostile(state, enemy, ENEMY_KINDS[enemy.kind].boltSpeed, 0, events);
        enemy.shotAt = state.tick + shotInterval(state, 255);
      }
      continue;
    }
    if ((enemy.kind === 'hound' || enemy.kind === 'interceptor') && (range <= ROSTER.hound.bandFollowRange || enemy.maneuver)) {
      followPlayerBand(state, enemy, ground, events);
    }
    if (enemy.kind === 'harrier' && moveBetweenBands(state, enemy, ground, 29)) enemy.maneuverAt = state.tick + 360;
    const intercept = enemy.kind === 'interceptor' && range < ROSTER.interceptor.tailRange
      && dx * fx + dz * fz >= range * Math.cos(ROSTER.interceptor.tailHalfAngle);
    if (course) {
      const tx = course.target.x - enemy.x, tz = course.target.z - enemy.z;
      const remaining = Math.hypot(tx, tz);
      steer(state, enemy, ground, remaining > 0.001 ? Math.atan2(tx, tz) : enemy.yaw, Math.min(course.speed, remaining / STEP));
    } else if (enemy.kind === 'skimmer') {
      moveSkimmer(state, enemy, ground, angle, range, events);
    } else if (enemy.kind === 'spotter') {
      moveSpotter(state, enemy, ground, angle, range, events);
    } else if (enemy.kind === 'hound' || enemy.kind === 'harrier') {
      moveTail(state, enemy, ground, enemy.kind, fx, fz, dx, dz, events);
    } else if (enemy.kind === 'flanker') {
      moveFlanker(state, enemy, ground, fx, fz, dx, dz, events);
    } else if (enemy.kind === 'diver') {
      moveDiver(state, enemy, ground, angle, range, events);
    } else if (enemy.kind === 'bomber') {
      moveBomber(state, enemy, ground, angle, range, events, observeSwarm);
    } else if (enemy.kind === 'aegis') {
      moveAegis(state, enemy, ground, angle, range, events);
    } else if (intercept) {
      const { tailSlot, tailSpeedScale } = ROSTER.interceptor;
      const speed = state.speed - tailSlot;
      const vx = dx + fx * speed, vz = dz + fz * speed;
      const limit = ENEMY_KINDS.interceptor.pursuit * tailSpeedScale;
      steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(limit, Math.hypot(vx, vz)));
    } else if (range > 0.001 && !stayWithBomber(state, enemy, ground)) {
      enemy.longRange = rangeMode(enemy.longRange, -range, -55, 6);
      const trailing = enemy.longRange && dx * fx + dz * fz > 0;
      const weave = Math.sin(state.tick / 91 + enemy.id * 1.79) * (trailing ? 0.112 : 0.32);
      const interceptor = enemy.kind !== 'patrol';
      const stats = ENEMY_KINDS[enemy.kind];
      enemy.closeRange = rangeMode(enemy.closeRange, range, interceptor ? 32 : 14, 4);
      steer(state, enemy, ground, angle + (enemy.closeRange ? 1.45 : weave),
        trailing ? stats.pursuit * pursuitBoost(state, enemy) : stats.speed);
    }
    advancePosition(state, enemy, ground);
    if ((enemy.kind === 'patrol' || enemy.kind === 'interceptor') && range < 185
      && enemy.maneuver?.phase !== 'diving' && attackReady(state, enemy, intercept && inBand(enemy.alt, p.altitude) ? 'tail' : 'gun',
        ROSTER[enemy.kind].warningTicks, events)) {
      fireHostile(state, enemy, ENEMY_KINDS[enemy.kind].boltSpeed, 0, events);
      enemy.shotAt = state.tick + shotInterval(state, 255 + Math.floor(random(state.run ? state.streams.combat : state) * 105));
    }
  }
}
