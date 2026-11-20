import type { DraftChoiceId } from './items.ts';

export const BOT_PROFILE_IDS = ['skilled', 'average', 'weak'] as const;
export type BotProfileId = typeof BOT_PROFILE_IDS[number];

export type BotProfile = {
  reactionDelayTicks: number;
  aimErrorRad: number;
  dodgeQuality: number;
  maneuverUse: number;
  altitudeUse: number;
  pickupGreed: number;
  draftPickQuality: number;
  chestPick: number;
  billsHandling: number;
};

export const BOT_PROFILES = {
  skilled: {
    reactionDelayTicks: 2, aimErrorRad: 0.02, dodgeQuality: 0.98, maneuverUse: 0.98,
    altitudeUse: 0.98, pickupGreed: 1, draftPickQuality: 0.97, chestPick: 0.98, billsHandling: 0.96,
  },
  average: {
    reactionDelayTicks: 9, aimErrorRad: 0.17, dodgeQuality: 0.58, maneuverUse: 0.52,
    altitudeUse: 0.58, pickupGreed: 0.65, draftPickQuality: 0.63, chestPick: 0.65, billsHandling: 0.56,
  },
  weak: {
    reactionDelayTicks: 19, aimErrorRad: 0.46, dodgeQuality: 0.04, maneuverUse: 0.23,
    altitudeUse: 0.24, pickupGreed: 0.36, draftPickQuality: 0.17, chestPick: 0.35, billsHandling: 0.22,
  },
} as const satisfies Record<BotProfileId, BotProfile>;

export const BOT_POLICY = {
  scoutTicks: 90, sightRange: 205, salvageSightRange: 260, salvageSightMinimum: 42,
  bandSwitchCost: 0.6, salvageValue: 1.8, threatCost: 0.7,
  lookaheadMin: 0.1, lookaheadMax: 0.6, dodgeMarginMin: 0, dodgeMarginMax: 5.5,
  turnGain: 2.35, pairBonus: 1.6, familyBonus: 0.8, emptyWeaponBonus: 2.7,
  levelValue: 0.75, riskHullCost: 2, repairValue: 5, missingHullValue: 1.7,
} as const;

export const BOT_DRAFT_VALUES = {
  twin: 5, pods: 4.7, seeker: 4.9, rail: 3.8, flak: 4.3, ion: 3, drones: 4.5, phoenix: 3.4,
  'bomb-bay': 4.2, arc: 4.4, 'overdrive-coil': 4.2, 'hull-plating': 6, 'magnet-core': 3.8,
  'band-lens': 4.9, 'vector-thrusters': 4.7, 'flare-bay': 3, 'ordnance-rack': 3.5, 'fire-control': 4.2,
  capacitor: 4.9, 'salvage-beacon': 4.6, repair: 0, damage: 4.8, credits: 0.5,
} as const satisfies Record<DraftChoiceId, number>;
