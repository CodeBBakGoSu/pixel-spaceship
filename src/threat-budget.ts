import { TICKS_PER_SECOND } from './simulation-time.ts';
import { HOSTILE_BOLT_LIFE } from './data/hostile-fire.ts';
import type { StageState } from './stage-types.ts';

export type ThreatRequest = {
  tick: number;
  activeFromTick?: number;
  activeUntilTick?: number;
  source: string;
  points: 1 | 2;
  bearing: number;
};

export type ThreatSpend = ThreatRequest;
export type ThreatBudgetState = { spends: ThreatSpend[] };

export const THREAT_BUDGET = {
  windowTicks: 20 * TICKS_PER_SECOND,
  firstMinutePoints: 4,
  minuteScale: 1.15,
  growthMinutes: 7,
  maxDirections: 2,
  directionTicks: Math.ceil(HOSTILE_BOLT_LIFE * TICKS_PER_SECOND),
  spacingTicks: TICKS_PER_SECOND / 2,
} as const;

export function createThreatBudget(): ThreatBudgetState {
  return { spends: [] };
}

export function threatBudgetAt(tick: number): number {
  const minute = Math.min(THREAT_BUDGET.growthMinutes, Math.floor(Math.max(0, tick) / (60 * TICKS_PER_SECOND)));
  return THREAT_BUDGET.firstMinutePoints * THREAT_BUDGET.minuteScale ** minute;
}

function bearingSector(bearing: number): number {
  const turn = (bearing % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(turn / (Math.PI / 4)) % 8;
}

function withinBudget(events: readonly ThreatSpend[], tick: number): boolean {
  const starts = [tick, ...events.map(event => event.tick)];
  return starts.every(start => {
    const points = events.reduce((total, event) =>
      total + Number(event.tick >= start && event.tick < start + THREAT_BUDGET.windowTicks) * event.points, 0);
    return points <= threatBudgetAt(start);
  });
}

export function trySpendThreat(state: StageState, request: ThreatRequest): boolean {
  if (!state.run || !state.threatBudget) return true;

  const activeFromTick = request.activeFromTick ?? request.tick;
  const activeUntilTick = request.activeUntilTick ?? request.tick + THREAT_BUDGET.directionTicks;
  if (activeUntilTick <= activeFromTick) return false;
  const directionStart = activeFromTick;
  const windowStart = request.tick - THREAT_BUDGET.windowTicks;
  const spends = state.threatBudget.spends.filter(event => event.tick >= windowStart
    || (event.activeUntilTick ?? event.tick + THREAT_BUDGET.directionTicks) > directionStart);
  if (spends.some(event => Math.abs(event.tick - request.tick) < THREAT_BUDGET.spacingTicks)) return false;

  const proposed = [...spends, { ...request, activeFromTick, activeUntilTick }];
  if (!withinBudget(proposed, request.tick)) return false;

  const activeDirections = new Set(proposed.filter(event =>
    (event.activeFromTick ?? event.tick) < activeUntilTick
      && activeFromTick < (event.activeUntilTick ?? event.tick + THREAT_BUDGET.directionTicks),
  ).map(event => bearingSector(event.bearing)));
  if (activeDirections.size > THREAT_BUDGET.maxDirections) return false;

  state.threatBudget.spends = proposed;
  return true;
}
