import { canManeuver, exitAltitude } from './maneuvers.ts';
import { activeWeakPoint, angleTo, BANDS, clamp, FLAK_RADIUS, HIT_WINDOW, inBand, MAX_ALTITUDE, MINE_RADIUS, TICKS_PER_SECOND, VERTICAL_SPEED } from './stage-combat.ts';
import { createStage, stepStage } from './stage.ts';
import type { Ground, ManeuverKind, Position, StageInput, StageOptions, StageState } from './stage-types.ts';

type PilotMode = 'full' | 'top';
type Route = Position & { kind: 'weak' | 'enemy' | 'pickup' | 'home' };

function nearest<T extends Position>(items: T[], x: number, z: number): T | null {
  let best: T | null = null, range = Infinity;
  for (const item of items) {
    const distance = (item.x - x) ** 2 + (item.z - z) ** 2;
    if (distance < range) {
      best = item;
      range = distance;
    }
  }
  return best;
}

function routeFor(state: StageState, mode: PilotMode): Route {
  const p = state.player;
  if (mode === 'top' && state.boss) {
    const { x, z, alt } = state.boss;
    return { x, z, alt, kind: 'weak' };
  }
  const weak = activeWeakPoint(state);
  if (weak) return { ...weak, kind: 'weak' };
  const pickup = nearest(state.pickups, p.x, p.z);
  if (pickup && Math.hypot(pickup.x - p.x, pickup.z - p.z) <= 150) return { ...pickup, kind: 'pickup' };
  const enemy = nearest(state.enemies, p.x, p.z);
  if (enemy) return { ...enemy, kind: 'enemy' };
  return { x: state.arena.x, z: state.arena.z, alt: BANDS[1], kind: 'home' };
}

function dodgeClimb(state: StageState, mode: PilotMode, climb: number, ground?: Ground): number | undefined {
  const p = state.player;
  const ownX = Math.sin(p.yaw) * state.speed, ownZ = Math.cos(p.yaw) * state.speed;
  const avoid = (threat: Position & { vx?: number; vz?: number }, radius: number): number | undefined => {
    const x = threat.x - p.x, z = threat.z - p.z;
    const vx = (threat.vx ?? 0) - ownX, vz = (threat.vz ?? 0) - ownZ;
    const vv = vx * vx + vz * vz;
    const closest = vv > 0 ? clamp(-(x * vx + z * vz) / vv, 0, 0.6) : 0;
    if (Math.hypot(x + vx * closest, z + vz * closest) >= radius) return;
    if (mode === 'top') return p.altitude >= 120 ? -1 : 1;
    const floor = ground ? ground(p.x + ownX * closest, p.z + ownZ * closest) + 22 : 55;
    const approach = Math.max(floor, p.altitude + climb * VERTICAL_SPEED * Math.max(closest, 0.2));
    if (Math.min(p.altitude, approach) > threat.alt + 13 || Math.max(p.altitude, approach) < threat.alt - 13) return;
    const up = floor > threat.alt - 12 || threat.alt < 86 || (threat.alt <= 150 && p.altitude >= threat.alt);
    const safe = threat.alt + (up ? 12 : -12);
    return up ? clamp((safe - p.altitude) / 2, 0, 1) : clamp((safe - p.altitude) / 2, -1, 0);
  };
  for (const shot of state.shots) {
    if (shot.kind === 'hostile') {
      const dodge = avoid(shot, mode === 'full' ? 11 : 8);
      if (dodge !== undefined) return dodge;
    }
  }
  if (mode === 'full') {
    for (const mine of state.enemyMines) {
      const dodge = avoid(mine, MINE_RADIUS + 5);
      if (dodge !== undefined) return dodge;
    }
    for (const effect of state.effects) {
      if (effect.kind !== 'flak') continue;
      const dodge = avoid(effect, FLAK_RADIUS + 4);
      if (dodge !== undefined) return dodge;
    }
    for (const enemy of state.enemies) {
      if (enemy.tell?.kind === 'flak' && enemy.tell.until - state.tick <= 45) {
        const dodge = avoid(enemy.tell, FLAK_RADIUS + 5);
        if (dodge !== undefined) return dodge;
      }
      const dodge = avoid(enemy, 15);
      if (dodge !== undefined) return dodge;
    }
  }
}

function rearManeuver(state: StageState, target: Route, angle: number, range: number): ManeuverKind | undefined {
  if (target.kind !== 'enemy' || Math.abs(angle) < Math.PI * 155 / 180) return;
  const { altitude } = state.player;
  if (inBand(altitude, target.alt)) {
    if (range >= 10 && range <= 24 && canManeuver(state, 'cobra')) return 'cobra';
    if (range >= 65 && range <= 115 && canManeuver(state, 'j-turn')) return 'j-turn';
  }
  if (range < 65 || range > 115) return;
  const kind = target.alt > altitude ? 'immelmann' : 'split-s';
  if (canManeuver(state, kind) && inBand(exitAltitude(altitude, kind), target.alt)) return kind;
}

function hasRearBombTarget(state: StageState): boolean {
  if (!state.bombs || state.tick < state.bombReadyAt) return false;
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  return state.enemies.some(enemy => {
    const x = enemy.x - p.x, z = enemy.z - p.z;
    if (x * fx + z * fz >= 0) return false;
    const dx = x + 14 * fx, dz = z + 14 * fz;
    const vv = enemy.vx ** 2 + enemy.vz ** 2;
    const time = vv > 0 ? clamp(-(dx * enemy.vx + dz * enemy.vz) / vv, 0, 2) : 0;
    const altitude = p.altitude - Math.max(0, time - 0.45) * 24;
    return inBand(altitude, enemy.alt) && Math.hypot(dx + time * enemy.vx, dz + time * enemy.vz) <= 16;
  });
}

export function autopilotInput(state: StageState, mode: PilotMode = 'full', ground?: Ground): StageInput {
  if (state.phase === 'draft') return { pick: state.draft[0] };
  if (state.phase !== 'playing' || state.paused) return {};
  if (state.maneuver) return {};
  const p = state.player, target = routeFor(state, mode);
  const dx = target.x - p.x, dz = target.z - p.z;
  const range = Math.hypot(dx, dz), angle = angleTo(p.yaw, dx, dz);
  const delta = target.alt - p.altitude;
  const withinCoarse = Math.abs(delta) <= HIT_WINDOW;
  const climb = mode === 'top' ? (withinCoarse ? 0 : Math.sign(delta)) : clamp(delta / 5, -1, 1);
  // Extend after each boss pass. Turning tightly around a stationary target would keep it off the nose.
  const extending = target.kind === 'weak' && range < 72 && Math.abs(angle) > Math.PI * 0.58;
  const turn = extending ? 0 : target.kind === 'home' && range < 34 ? 0.65 : clamp(angle * 2.35, -1, 1);

  let view: StageState['view'] = 'overhead';
  if (mode === 'full' && target.kind !== 'home') {
    if (Math.abs(delta) > 12) view = 'chase';
    else if (target.kind === 'weak' || (target.kind === 'enemy' && Math.abs(angle) < 0.35 && range < 115)) view = 'cockpit';
  }
  const dodge = state.invulnerability === 0 ? dodgeClimb(state, mode, climb, ground) : undefined;
  const maneuver = mode === 'full' && dodge === undefined ? rearManeuver(state, target, angle, range) : undefined;
  const extend = mode === 'full' && target.kind === 'enemy' && Math.abs(angle) > Math.PI * 0.86
    && range > 24 && range < 65 && !state.boundaryWarning && canManeuver(state, 'immelmann');
  const boost = extend || (range > 155 && Math.abs(angle) < 0.2 && state.level < 3);
  return {
    turn: extend ? 0 : turn, climb: dodge ?? (extend ? 0 : climb), boost, maneuver,
    toggleView: state.view !== view,
    bomb: mode === 'full' && !maneuver && hasRearBombTarget(state),
  };
}

function holdAboveTraffic(state: StageState): StageInput {
  const p = state.player, a = state.arena;
  const dx = a.x - p.x, dz = a.z - p.z;
  const turn = Math.hypot(dx, dz) > 155 ? clamp(angleTo(p.yaw, dx, dz) * 2.35, -1, 1) : 0.58;
  return { turn, climb: clamp((MAX_ALTITUDE - p.altitude) / 4, 0, 1) };
}

export function seekStage(options: StageOptions, ground: Ground): StageState {
  if (options.time === null) return createStage(options, ground);
  const target = Math.round(options.time * TICKS_PER_SECOND);
  const initial = createStage(options, ground);
  const startOptions = target < initial.tick ? { ...options, fixture: null } : options;

  // A replay must be able to reach any active tick. Once the core is the last
  // objective, fly a holding pattern so an early clear cannot truncate the seek.
  const replay = (flight: StageState, conservative: boolean): StageState => {
    while (flight.tick < target && (flight.phase === 'playing' || flight.phase === 'draft')) {
      const holding = conservative || flight.boss?.weakPoints[flight.boss.index]?.kind === 'core';
      stepStage(flight, flight.phase === 'playing' && holding ? holdAboveTraffic(flight) : autopilotInput(flight, 'full', ground), ground);
    }
    return flight;
  };
  let flight = replay(startOptions === options ? initial : createStage(startOptions, ground), false);
  if (flight.tick < target) flight = replay(createStage(startOptions, ground), true);
  if (options.view) flight.view = options.view;
  flight.wipe = flight.viewTag = 0;
  return flight;
}
