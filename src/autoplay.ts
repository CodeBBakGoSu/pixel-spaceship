import { activeWeakPoint, angleTo, BANDS, clamp, HIT_WINDOW, TICKS_PER_SECOND } from './stage-combat.ts';
import { createStage, stepStage } from './stage.ts';
import type { Ground, Position, StageInput, StageOptions, StageState } from './stage-types.ts';

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

function routeFor(state: StageState): Route {
  const p = state.player;
  const weak = activeWeakPoint(state);
  if (weak) return { ...weak, kind: 'weak' };
  const pickup = nearest(state.pickups, p.x, p.z);
  if (pickup && Math.hypot(pickup.x - p.x, pickup.z - p.z) <= 150) return { ...pickup, kind: 'pickup' };
  const enemy = nearest(state.enemies, p.x, p.z);
  if (enemy) return { ...enemy, kind: 'enemy' };
  return { x: state.arena.x, z: state.arena.z, alt: BANDS[1], kind: 'home' };
}

function dodgeDirection(state: StageState): number {
  const p = state.player;
  for (const shot of state.shots) {
    if (shot.kind !== 'hostile' || Math.abs(shot.alt - p.altitude) > HIT_WINDOW + 4) continue;
    const x = shot.x - p.x, z = shot.z - p.z;
    const vx = shot.vx - Math.sin(p.yaw) * state.speed, vz = shot.vz - Math.cos(p.yaw) * state.speed;
    const vv = vx * vx + vz * vz;
    const closest = vv > 0 ? -(x * vx + z * vz) / vv : -1;
    if (closest >= 0 && closest < 0.55 && Math.hypot(x + vx * closest, z + vz * closest) < 8) {
      return p.altitude > 151 || (p.altitude > 84 && p.altitude < shot.alt) ? -1 : 1;
    }
  }
  return 0;
}

export function autopilotInput(state: StageState, mode: PilotMode = 'full'): StageInput {
  if (state.phase === 'draft') return { pick: state.draft[0] };
  if (state.phase !== 'playing' || state.paused) return {};
  const p = state.player, target = routeFor(state);
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
  const boost = range > 155 && Math.abs(angle) < 0.2 && state.level < 3;
  const dodge = mode === 'full' && state.invulnerability === 0 ? dodgeDirection(state) : 0;
  return {
    turn, climb: dodge || climb, boost,
    toggleView: state.view !== view,
    bomb: dodge !== 0 && state.hull <= 4 && state.bombs > 0,
  };
}

export function seekStage(options: StageOptions, ground: Ground): StageState {
  const state = createStage(options, ground);
  if (options.time === null) return state;
  const target = Math.round(options.time * TICKS_PER_SECOND);
  const flight = target < state.tick ? createStage({ ...options, fixture: null }, ground) : state;
  while (flight.tick < target && (flight.phase === 'playing' || flight.phase === 'draft')) {
    stepStage(flight, autopilotInput(flight), ground);
  }
  if (options.view) flight.view = options.view;
  flight.wipe = flight.viewTag = 0;
  return flight;
}
