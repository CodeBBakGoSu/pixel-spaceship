import type { ChestId } from './items.ts';
import type { Band } from '../stage-types.ts';

export const CARRIER_TUNING = {
  'coast-supply': { band: 1, hp: 7, range: 110 },
  'first-evolution': { band: 2, hp: 11, range: 117 },
  'siege-supply': { band: 0, hp: 15, range: 121 },
  'second-evolution': { band: 1, hp: 18, range: 126 },
} as const satisfies Record<ChestId, { band: Band; hp: number; range: number }>;

export const CHEST_PICKUP_RADIUS = 14;
