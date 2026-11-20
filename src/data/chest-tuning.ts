import type { ChestId } from './items.ts';
import type { Band } from '../stage-types.ts';
import { ROSTER } from './roster.ts';

// --- S7e lane ---
export const CARRIER_TUNING = {
  'coast-supply': { band: ROSTER.bands.high, hp: 7, range: 110 },
  'first-evolution': { band: ROSTER.bands.high, hp: 11, range: 117 },
  'siege-supply': { band: ROSTER.bands.high, hp: 15, range: 121 },
  'second-evolution': { band: ROSTER.bands.high, hp: 18, range: 126 },
} as const satisfies Record<ChestId, { band: Band; hp: number; range: number }>;

export const CHEST_PICKUP_RADIUS = 14;
