import { WORLD_TERRAIN } from './data/world.ts';
import type { Ace, Band, Enemy, StageState } from './stage-types.ts';

export const BANDS = [75, 110, 145] as const;
export const SKIM_BAND = 3;
export type FlightBand = Band | typeof SKIM_BAND;
const BAND_ORDER: readonly FlightBand[] = [SKIM_BAND, 0, 1, 2];

export const SKIM = {
  clearance: 30,
  minClearance: 25,
  maxClearance: 35,
  inputThreshold: 0.15,
  magnetScale: 1.3,
  groundDamageScale: 1.25,
  turretHeight: 5,
} as const;

export const skimAltitude = (ground: number = WORLD_TERRAIN.seaLevel): number => ground + SKIM.clearance;

export function fixedBand(altitude: number): Band {
  return altitude <= (BANDS[0] + BANDS[1]) / 2 ? 0 : altitude <= (BANDS[1] + BANDS[2]) / 2 ? 1 : 2;
}

export function playerBand(player: Pick<StageState['player'], 'altitude' | 'skim'>): FlightBand {
  return player.skim ? SKIM_BAND : fixedBand(player.altitude);
}

export function canCueAltitude(player: Pick<StageState['player'], 'altitude' | 'skim'>, targetAltitude: number): boolean {
  return !player.skim || targetAltitude >= player.altitude;
}

export function contactBand(enemy: Enemy | Ace): FlightBand {
  const skim = enemy.kind === 'ace' ? enemy.band === SKIM_BAND : enemy.skim;
  return skim && !enemy.entry ? SKIM_BAND : fixedBand(enemy.alt);
}

export function adjacentBand(band: FlightBand, direction: -1 | 1): FlightBand | null {
  return BAND_ORDER[BAND_ORDER.indexOf(band) + direction] ?? null;
}

export function bandDistance(a: FlightBand, b: FlightBand): number {
  return Math.abs(BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));
}

export function bandAltitude(band: FlightBand, ground?: number): number {
  return band === SKIM_BAND ? skimAltitude(ground) : BANDS[band];
}
