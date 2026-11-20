import type { BuffId, GearId, WeaponId } from './items.ts';

export const STARTER_WEAPONS = ['twin', 'pods', 'seeker', 'phoenix', 'bomb-bay'] as const satisfies readonly WeaponId[];
export const STARTER_BUFFS = [
  'overdrive-coil', 'hull-plating', 'magnet-core', 'capacitor', 'salvage-beacon',
] as const satisfies readonly BuffId[];

export const METRIC_RULES = {
  weakPointHits: 'best',
  multibandWithinFive: 'best',
  maneuvers: 'total',
  orbs: 'total',
  peakAceWipe: 'best',
  bandsKilled: 'bands',
  boostTicks: 'total',
  lockedKills: 'total',
  rearFlareKills: 'total',
  manualBombs: 'total',
} as const;
export type RunMetric = keyof typeof METRIC_RULES;

export const UNLOCK_QUESTS = [
  { id: 'rail', metric: 'weakPointHits', target: 5 },
  { id: 'flak', metric: 'multibandWithinFive', target: 3 },
  { id: 'ion', metric: 'maneuvers', target: 30 },
  { id: 'drones', metric: 'orbs', target: 100 },
  { id: 'arc', metric: 'peakAceWipe', target: 6 },
  { id: 'band-lens', metric: 'bandsKilled', target: 3 },
  { id: 'vector-thrusters', metric: 'boostTicks', target: 60 * 60 },
  { id: 'fire-control', metric: 'lockedKills', target: 20 },
  { id: 'flare-bay', metric: 'rearFlareKills', target: 20 },
  { id: 'ordnance-rack', metric: 'manualBombs', target: 10 },
] as const satisfies readonly { id: GearId; metric: RunMetric; target: number }[];
export type QuestId = (typeof UNLOCK_QUESTS)[number]['id'];

export const HANGAR = {
  hull: { costs: [450, 1100, 2450], requiredRank: 1, perLevel: 1 },
  reroll: { costs: [300, 1100], requiredRank: 1, perLevel: 1 },
  banish: { costs: [750, 2000], requiredRank: 2, perLevel: 1 },
  skip: { costs: [550, 1650], requiredRank: 2, perLevel: 1 },
  magnet: { costs: [400, 1350], requiredRank: 1, perLevel: 0.1 },
  growth: { costs: [700, 1250, 2300, 3900, 6250], requiredRank: 1, perLevel: 0.03 },
  credit: { costs: [400, 950, 1850, 3550, 6500], requiredRank: 1, perLevel: 0.1 },
  ejector: { costs: [10_000], requiredRank: 1, perLevel: 0.5 },
} as const;
export type HangarUpgradeId = keyof typeof HANGAR;
export const HANGAR_IDS = Object.keys(HANGAR) as HangarUpgradeId[];

export const ACE_SCORE_THRESHOLDS = [0, 40_000, 160_000, 350_000, 700_000] as const;
export const RUN_PAYOUT = { creditsPerScore: 1 / 500, wardenCache: 250, retreatScale: 0.5 } as const;

export const HEAT_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type Heat = (typeof HEAT_LEVELS)[number];
export const MAX_HEAT: Heat = 5;
export const HEAT_TIERS = HEAT_LEVELS.map(level => ({
  armorScale: level >= 1 ? 1.15 : 1,
  shotIntervalScale: level >= 2 ? 1 / 1.15 : 1,
  magnetScale: level >= 3 ? 0.8 : 1,
  extraWeakPoint: level >= 4,
  carrierEscort: level >= 5,
  rewardScale: 1 + 0.15 * level,
}));
