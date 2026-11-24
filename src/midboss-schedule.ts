import { LULL_SECONDS } from './data/phases.ts';
import { TICKS_PER_SECOND } from './simulation-time.ts';
import type { StageState } from './stage-types.ts';

export type MidbossId = 'armored-transport' | 'escort-commander';
export type MidbossCue = {
  id: MidbossId;
  kind: 'midboss';
  startTick: number;
  maxDurationTicks: number;
  threatSource: `midboss:${MidbossId}`;
};
export type MidbossOutcome = 'defeated' | 'escaped';
export type MidbossResult = { id: MidbossId; endedAt: number; outcome: MidbossOutcome };
export type MidbossScheduleState = {
  next: number;
  active: MidbossCue | null;
  restUntil: number;
  lastResult: MidbossResult | null;
};

const MAX_DURATION_TICKS = 30 * TICKS_PER_SECOND;
const schedule: readonly Omit<MidbossCue, 'startTick' | 'maxDurationTicks'>[] = [
  { id: 'armored-transport', kind: 'midboss', threatSource: 'midboss:armored-transport' },
  { id: 'escort-commander', kind: 'midboss', threatSource: 'midboss:escort-commander' },
];
const startTicks = [205, 400].map(seconds => seconds * TICKS_PER_SECOND);

export function createMidbossSchedule(): MidbossScheduleState {
  return { next: 0, active: null, restUntil: 0, lastResult: null };
}

export function consumeMidbossCue(state: StageState): MidbossCue | null {
  const midboss = state.midbossSchedule;
  if (!state.run || !midboss || midboss.active) return null;
  const entry = schedule[midboss.next];
  const startTick = startTicks[midboss.next];
  if (!entry || state.tick !== startTick) return null;
  const cue: MidbossCue = { ...entry, startTick, maxDurationTicks: MAX_DURATION_TICKS };
  midboss.next++;
  midboss.active = cue;
  return cue;
}

export function finishMidbossEncounter(state: StageState, result: MidbossResult): MidbossResult | null {
  const midboss = state.midbossSchedule;
  const active = midboss?.active;
  if (!active || active.id !== result.id || state.tick !== result.endedAt
    || result.endedAt < active.startTick || result.endedAt > active.startTick + active.maxDurationTicks) return null;
  midboss.active = null;
  midboss.restUntil = result.endedAt + LULL_SECONDS * TICKS_PER_SECOND;
  midboss.lastResult = result;
  return result;
}

export function midbossSpawnsBlocked(state: StageState): boolean {
  const midboss = state.midbossSchedule;
  if (!state.run || !midboss) return false;
  if (state.tick < midboss.restUntil) return true;
  const active = midboss.active;
  if (active && state.tick <= active.startTick + active.maxDurationTicks) return true;
  const startTick = startTicks[midboss.next];
  return startTick !== undefined && state.tick >= startTick && state.tick <= startTick + MAX_DURATION_TICKS;
}
