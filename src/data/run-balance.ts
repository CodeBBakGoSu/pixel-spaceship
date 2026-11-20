export const LEGACY_BOSS_SECONDS = 105;
export const LEGACY_END_SECONDS = 180;
export const PICKUP_LIMIT = 150;
export const PLAYER_SHOT_LIMIT = 128;
export const HOSTILE_SHOT_LIMIT = 64;
export const REGULAR_SALVAGE_MULTIPLIER = 3;
export const RUN_BEACON_LEAD_SECONDS = 15;
export const ECHO_RATE_BONUS = 0.35;
export const HEAT_ARMOR_SCALES = [1, 1.15, 1.3, 1.45, 1.6, 1.75] as const;
export const WEAPON_FX_LIMIT = 64;
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
  flak: 24,
  ion: 0,
  drones: 16,
  phoenix: 0,
  'bomb-bay': 0,
  arc: 0,
} as const;
