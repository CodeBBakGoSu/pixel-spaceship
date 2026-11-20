import { clamp, STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import type { FlyIn, Ground, Point, Position, StageState } from './stage-types.ts';

export const WAVE_FLY_IN_TICKS = 1.5 * TICKS_PER_SECOND;
const RIM_CLEARANCE = 70;
const MIN_APPROACH_DISTANCE = 640;
const TRANSIT_ALTITUDE = 150;
const FLIGHT_CLEARANCE = 22;

function exitDistance(start: Point, center: Point, radius: number, fx: number, fz: number): number {
  const x = start.x - center.x, z = start.z - center.z;
  const projection = x * fx + z * fz;
  return -projection + Math.sqrt(Math.max(0, projection ** 2 + radius ** 2 - x ** 2 - z ** 2));
}

export function planFlyIn(state: Pick<StageState, 'arena' | 'tick' | 'player'>, anchor: Point, target: Position,
  plan: { ticks: number; bend: number; exitSpeed: number; clearance?: number }): FlyIn {
  const { arena } = state;
  const outward = Math.atan2(target.x - anchor.x, target.z - anchor.z);
  const fx = Math.sin(outward), fz = Math.cos(outward);
  // Follow the engagement bearing outward until the entry point clears both the rim and the nearby view.
  const run = Math.max(MIN_APPROACH_DISTANCE,
    exitDistance(target, arena, arena.radius + RIM_CLEARANCE, fx, fz),
    exitDistance(target, state.player, MIN_APPROACH_DISTANCE, fx, fz));
  return {
    origin: { x: target.x + fx * run, z: target.z + fz * run, alt: Math.max(TRANSIT_ALTITUDE, target.alt) },
    target, startedAt: state.tick, arriveAt: state.tick + plan.ticks,
    bend: plan.bend, exitSpeed: plan.exitSpeed, clearance: plan.clearance ?? FLIGHT_CLEARANCE,
  };
}

export function sampleFlyIn(path: FlyIn, tick: number, ground: Ground) {
  const { origin, target, bend, exitSpeed, clearance } = path;
  const ticks = path.arriveAt - path.startedAt, seconds = ticks * STEP;
  const time = clamp((tick - path.startedAt) / ticks, 0, 1);
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const tail = 1 - time, linear = exitSpeed * seconds / Math.hypot(dx, dz);
  // Most of the distance is traveled early. The linear part preserves the handoff speed.
  const progress = 1 - tail * (linear + (1 - linear) * tail ** 2);
  const rate = (linear + 3 * (1 - linear) * tail ** 2) / seconds;
  const remaining = 1 - progress;
  const side = bend * progress * remaining ** 2;
  const tangent = bend * remaining * (1 - 3 * progress);
  const tx = dx + dz * tangent, tz = dz - dx * tangent;
  const x = time === 1 ? target.x : origin.x + dx * progress + dz * side;
  const z = time === 1 ? target.z : origin.z + dz * progress - dx * side;
  const descent = time ** 2 * (3 - 2 * time);
  const floor = ground(x, z) + FLIGHT_CLEARANCE + (clearance - FLIGHT_CLEARANCE) * descent;
  const alt = Math.max(target.alt + (origin.alt - target.alt) * (1 - descent), floor);
  return { x, z, alt, yaw: Math.atan2(tx, tz), vx: tx * rate, vz: tz * rate };
}
