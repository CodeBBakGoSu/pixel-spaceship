import { MANEUVERS } from './maneuvers.ts';
import type { Point } from './camera.ts';
import type { Track } from './instruments.ts';
import type { Lock, StageState } from './stage-types.ts';
import type { createTranslator, Language } from './i18n.ts';
import type { CockpitLayout, Rect } from './layout.ts';

export type CockpitMotion = { speed: number; climb: number; turn: number };
export type CockpitTarget = { point: Point; range: number; locked: boolean; progress: number };
export type CockpitWarnings = {
  terrain: 'altLow' | 'pullUp' | null; boost: 'active' | 'low' | null;
};

const cardinal = ['cockpit.north', 'cockpit.east', 'cockpit.south', 'cockpit.west'] as const;
const heading = (degrees: number) => (degrees % 360 + 360) % 360;
const threeDigits = (value: number) => String(value).padStart(3, '0');

export function cockpitCacheKey(layout: CockpitLayout, width: number, height: number, language: Language): string {
  return JSON.stringify([width, height, language, layout]);
}

export function cockpitMfdDue(previous: number | null, elapsed: number): boolean {
  return previous === null || elapsed < previous || elapsed - previous >= 1 / 20 - 1e-6;
}

export const cockpitHeadingDegrees = (yaw: number) => heading(yaw * 180 / Math.PI);

export function headingTickLabel(angle: number, t: ReturnType<typeof createTranslator>): string {
  const tick = heading(angle);
  return tick % 90 === 0 ? t(cardinal[tick / 90]) : threeDigits(tick);
}

export function headingTape(yaw: number, step: 15 | 30, t: ReturnType<typeof createTranslator>) {
  const degrees = cockpitHeadingDegrees(yaw);
  const bearing = t('cockpit.bearing', { value: threeDigits(heading(Math.round(degrees))) });
  const ticks: { offset: number; label: string }[] = [];
  for (let angle = Math.ceil((degrees - 60) / step) * step; angle <= degrees + 60; angle += step) {
    ticks.push({ offset: angle - degrees, label: headingTickLabel(angle, t) });
  }
  return { bearing, ticks };
}

export function cockpitTarget(track: Pick<Track, 'id' | 'range'>, point: Point, area: Rect, lock: Lock | null,
  inset = 14): CockpitTarget | null {
  if (point.x < area.x + inset || point.x > area.x + area.width - inset
    || point.y < area.y + inset || point.y > area.y + area.height - inset) return null;
  const matching = lock?.id === track.id ? lock : null;
  return { point, range: Math.round(track.range), locked: matching?.ready ?? false, progress: matching?.progress ?? 0 };
}

export function cockpitWarnings(state: Pick<StageState, 'boosting' | 'boost'>, clearance: number, climb: number,
  result: CockpitWarnings = { terrain: null, boost: null }): CockpitWarnings {
  result.terrain = clearance > 40 ? null
    : clearance <= 26 || (clearance <= 34 && climb < -4) ? 'pullUp' : 'altLow';
  result.boost = !state.boosting || state.boost <= 0 ? null : state.boost <= 0.25 ? 'low' : 'active';
  return result;
}

export function reversalCharge(state: StageState): number {
  if (state.maneuver || state.tick <= state.graceUntil) return 0;
  const cooldown = state.maneuverTrail ? MANEUVERS[state.maneuverTrail.kind].cooldown : 1;
  return Math.max(0, 1 - Math.max(0, state.maneuverReadyAt - state.tick) / cooldown);
}
