import { ROLLS, ROLL_COOLDOWN_TICKS, ROLL_PARRY_TICKS, ROLL_TURN_DEADZONE } from './data/roll.ts';
import type { CombatEvents } from './hostile-events.ts';
import type { Roll, StageState } from './stage-types.ts';

export function canRoll(state: StageState): boolean {
  return state.phase === 'playing' && !state.paused && state.hull > 0
    && !state.roll && !state.maneuver && state.tick > state.graceUntil && state.tick >= (state.rollReadyAt ?? 0);
}

export function advanceRoll(state: StageState, requestedTurn: number | undefined, events?: CombatEvents): void {
  const active = state.roll;
  if (active && ++active.elapsed >= ROLLS[active.kind].ticks) delete state.roll;
  if (requestedTurn === undefined || !canRoll(state)) return;
  const barrel = Math.abs(requestedTurn) >= ROLL_TURN_DEADZONE;
  const side = barrel ? (requestedTurn < 0 ? -1 : 1) : (state.player.lastTurn ?? 1);
  if (barrel) state.player.lastTurn = side;
  state.roll = { kind: barrel ? 'barrel' : 'aileron', side, elapsed: 0, altitude: state.player.altitude };
  state.rollReadyAt = state.tick + ROLL_COOLDOWN_TICKS;
  events?.roll?.(side, barrel);
}

export function rollParryActive(roll?: Roll | null): boolean {
  return !!roll && roll.elapsed < ROLL_PARRY_TICKS;
}

export function rollBoltImmune(roll?: Roll | null): boolean {
  // The parry includes ages 21–23 for an aileron roll, beyond its nominal i-frames.
  return !!roll && roll.elapsed < Math.max(ROLL_PARRY_TICKS, ROLLS[roll.kind].iframeTicks);
}

function easedProgress(age: number, ticks: number): number {
  const progress = age / ticks;
  return progress * progress * (3 - 2 * progress);
}

/** Match the ship model's negative Z-axis bank for a right roll. */
export function rollAttitude(roll: Roll): number {
  return -roll.side * 2 * Math.PI * easedProgress(roll.elapsed + 1, ROLLS[roll.kind].ticks);
}

export function rollLateralStep(roll: Roll): number {
  const { ticks, lateral } = ROLLS[roll.kind];
  const previous = easedProgress(roll.elapsed, ticks), current = easedProgress(roll.elapsed + 1, ticks);
  return roll.side * lateral * (current - previous);
}

export function rollAltitude(roll: Roll): number {
  const { lift, ticks } = ROLLS[roll.kind];
  const angle = 2 * Math.PI * (roll.elapsed + 1) / ticks;
  return roll.altitude + lift * Math.sin(angle) ** 3;
}
