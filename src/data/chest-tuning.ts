import type { ChestId } from './items.ts';
import type { Band } from '../stage-types.ts';
import { ROSTER } from './roster.ts';
import { scaleTravel } from './speed.ts';

// --- S7e lane ---
export const CARRIER_TUNING = {
  'coast-supply': { band: ROSTER.bands.high, hp: 7, range: scaleTravel(110) },
  'first-evolution': { band: ROSTER.bands.high, hp: 11, range: scaleTravel(117) },
  'siege-supply': { band: ROSTER.bands.high, hp: 15, range: scaleTravel(121) },
  'second-evolution': { band: ROSTER.bands.high, hp: 18, range: scaleTravel(126) },
} as const satisfies Record<ChestId, { band: Band; hp: number; range: number }>;

export const CHEST_PICKUP_RADIUS = scaleTravel(14);
