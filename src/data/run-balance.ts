import { scaleTravel } from './speed.ts';

export const LEGACY_BOSS_SECONDS = 105;
export const LEGACY_END_SECONDS = 180;
export const PICKUP_LIMIT = 150;
export const PLAYER_SHOT_LIMIT = 128;
export const HOSTILE_SHOT_LIMIT = 64;
export const REGULAR_SALVAGE_MULTIPLIER = 3;
export const RUN_BEACON_LEAD_SECONDS = 15;
export const ECHO_RATE_BONUS = 0.35;
export const SURVIVOR_START_HULL = 10;
export const SURVIVOR_PLAYER_DAMAGE = 3;
export const REGULAR_FIRE_INTERVAL_SCALE = 0.62;
export const SURVIVOR_XP_SCALE = 1.15;
export const PHASE_REPAIR_HULL = 2;
export const PHASE_REPAIR_SECONDS = [105, 225, 345, 465] as const;
export const CARRIER_REPAIR_HULL = 1;
export const PHASE_CREDIT_BONUS = 25;
export const BILL_CREDIT_BONUS = 25;
export const PHASE_NOTICE_TICKS = 210;
export const WEAPON_FX_LIMIT = 64;

export const PLAYER_PROJECTILES = {
  boltSpeed: scaleTravel(320), reversalSpeed: scaleTravel(485), strafeSpeed: scaleTravel(230),
  strafeMinRange: scaleTravel(28), strafeRange: scaleTravel(135),
} as const;

export const REAR_ORDNANCE = {
  bomb: { proximity: scaleTravel(16), clearRadius: scaleTravel(40) },
  flare: { aftOffset: scaleTravel(8), kick: scaleTravel(70), fanSpacing: scaleTravel(3.4), lateralSpeed: scaleTravel(10) },
} as const;

export const REPLAY_RISK_HULL = 4;
export const REPLAY_DRAFT_PRIORITY = [
  'repair', 'hull-plating', 'twin', 'pods', 'band-lens', 'flak', 'seeker', 'rail', 'arc',
  'capacitor', 'magnet-core', 'salvage-beacon', 'damage',
] as const;

export const WEAPON_PROJECTILE_LIMITS = {
  twin: 40,
  pods: 24,
  seeker: 24,
  rail: 0,
  flak: 40,
  ion: 0,
  drones: 16,
  phoenix: 0,
  'bomb-bay': 0,
  arc: 0,
} as const;
