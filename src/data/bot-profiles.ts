import type { DraftChoiceId } from './items.ts';
import { scaleTravel } from './speed.ts';

export const BOT_PROFILE_IDS = ['skilled', 'average', 'weak'] as const;
export type BotProfileId = typeof BOT_PROFILE_IDS[number];

export type BotProfile = {
  reactionDelayTicks: number;
  aimErrorRad: number;
  dodgeQuality: number;
  rollUse: number;
  parryTiming: number;
  rollDodgeQuality: number;
  // --- S7d lane ---
  skimUse: number;
  maneuverUse: number;
  altitudeUse: number;
  pickupGreed: number;
  draftPickQuality: number;
  chestPick: number;
  billsHandling: number;
  // --- S7e lane ---
  aceLead: number;
  aceWarningTicks: number;
};

export const BOT_PROFILES = {
  skilled: {
    reactionDelayTicks: 2, aimErrorRad: 0.02, dodgeQuality: 0.98, maneuverUse: 0.98,
    rollUse: 0.84, parryTiming: 0.94, rollDodgeQuality: 0.9,
    skimUse: 0.75,
    altitudeUse: 0.98, pickupGreed: 1, draftPickQuality: 0.97, chestPick: 0.98, billsHandling: 0.96,
    aceLead: 1, aceWarningTicks: 22,
  },
  average: {
    reactionDelayTicks: 9, aimErrorRad: 0.10, dodgeQuality: 0.60, maneuverUse: 0.52,
    rollUse: 0.16, parryTiming: 0.58, rollDodgeQuality: 0.56,
    skimUse: 0.35,
    altitudeUse: 0.65, pickupGreed: 0.65, draftPickQuality: 0.63, chestPick: 0.65, billsHandling: 0.56,
    aceLead: 0.52, aceWarningTicks: 9,
  },
  weak: {
    reactionDelayTicks: 19, aimErrorRad: 0.34, dodgeQuality: 0.08, maneuverUse: 0.23,
    rollUse: 0.035, parryTiming: 0.2, rollDodgeQuality: 0.28,
    skimUse: 0.08,
    altitudeUse: 0.24, pickupGreed: 0.28, draftPickQuality: 0.09, chestPick: 0.35, billsHandling: 0.22,
    aceLead: 0.51, aceWarningTicks: 0,
  },
} as const satisfies Record<BotProfileId, BotProfile>;

export const BOT_POLICY = {
  scoutTicks: 90, sightRange: scaleTravel(205), salvageSightRange: scaleTravel(260), salvageSightMinimum: scaleTravel(42),
  bandSwitchCost: 0.6, salvageValue: 1.8, threatCost: 0.7,
  lookaheadMin: 0.1, lookaheadMax: 0.6, dodgeMarginMin: 0, dodgeMarginMax: scaleTravel(5.5),
  turnGain: 2.35, pairBonus: 1.6, familyBonus: 0.8, emptyWeaponBonus: 2.7,
  levelValue: 0.75, riskHullCost: 2, repairValue: 5, missingHullValue: 1.7,
  rollAnticipation: 0.22, rollPredictionMargin: scaleTravel(2.2),
} as const;

export const PILOT_ROUTE = {
  rallyRange: scaleTravel(145),
  clearLaneRange: scaleTravel(120),
  pickupRange: scaleTravel(150),
  skimApproachRange: scaleTravel(180),
  homeTurnRange: scaleTravel(34),
  cockpitRange: scaleTravel(115),
  reversalMinRange: scaleTravel(65),
  reversalMaxRange: scaleTravel(115),
  extensionMinRange: scaleTravel(24),
  boostRange: scaleTravel(155),
  patrolMargin: scaleTravel(80),
  // Predict impact in seconds and add margin around actual hit volumes.
  bulletMargin: { full: scaleTravel(5.5), top: scaleTravel(2.5) },
  mineMargin: scaleTravel(5),
  flakMargin: scaleTravel(4),
  bodyMargin: scaleTravel(8),
} as const;

// --- S7e lane ---
export const ACE_PILOT = {
  leadSeconds: 0.72, pursuitRange: scaleTravel(153), extensionRange: scaleTravel(45),
  extensionAngle: Math.PI * 0.69, warningMargin: 15, warningClimb: 13,
} as const;

export const BOT_DRAFT_VALUES = {
  twin: 5, pods: 4.7, seeker: 4.9, rail: 3.8, flak: 4.3, ion: 3, drones: 4.5, phoenix: 3.4,
  'bomb-bay': 4.2, arc: 4.4, 'overdrive-coil': 4.2, 'hull-plating': 6, 'magnet-core': 3.8,
  'band-lens': 4.9, 'vector-thrusters': 4.7, 'flare-bay': 3, 'ordnance-rack': 3.5, 'fire-control': 4.2,
  capacitor: 4.9, 'salvage-beacon': 4.6, repair: 0, damage: 4.8, credits: 0.5,
} as const satisfies Record<DraftChoiceId, number>;
