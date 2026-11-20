import { clamp, STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import type { FlyIn, Ground, Point, Position, StageState } from './stage-types.ts';
import { FLY_IN_WORLD } from './data/world.ts';

export const WAVE_FLY_IN_TICKS = 1.5 * TICKS_PER_SECOND;
const { minApproachDistance, transitAltitude, clearance: flightClearance } = FLY_IN_WORLD;

function exitDistance(start: Point, center: Point, radius: number, fx: number, fz: number): number {
  const x = start.x - center.x, z = start.z - center.z;
  const projection = x * fx + z * fz;
  return -projection + Math.sqrt(Math.max(0, projection ** 2 + radius ** 2 - x ** 2 - z ** 2));
}

export function planFlyIn(state: Pick<StageState, 'tick' | 'player'>, anchor: Point, target: Position,
  plan: { ticks: number; bend: number; exitSpeed: number; clearance?: number }): FlyIn {
  const outward = Math.atan2(target.x - anchor.x, target.z - anchor.z);
  const fx = Math.sin(outward), fz = Math.cos(outward);
  // Start each approach outside the local fight regardless of where the pilot has traveled.
  const run = Math.max(minApproachDistance, exitDistance(target, state.player, minApproachDistance, fx, fz));
  return {
    origin: { x: target.x + fx * run, z: target.z + fz * run, alt: Math.max(transitAltitude, target.alt) },
    target, startedAt: state.tick, arriveAt: state.tick + plan.ticks,
    bend: plan.bend, exitSpeed: plan.exitSpeed, clearance: plan.clearance ?? flightClearance,
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
  const floor = ground(x, z) + flightClearance + (clearance - flightClearance) * descent;
  const alt = Math.max(target.alt + (origin.alt - target.alt) * (1 - descent), floor);
  return { x, z, alt, yaw: Math.atan2(tx, tz), vx: tx * rate, vz: tz * rate };
}
