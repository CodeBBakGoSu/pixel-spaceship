export const ROLL_CHORD_MS = 80;
export const ROLL_COOLDOWN_TICKS = 78;
export const ROLL_PARRY_TICKS = 24;
export const ROLL_TURN_DEADZONE = 0.2;
export const ROLL_PARRY_XP = 1;

export const ROLLS = {
  aileron: { ticks: 30, iframeTicks: 21, lateral: 0, lift: 0 },
  barrel: { ticks: 42, iframeTicks: 27, lateral: 20, lift: 3 },
} as const;

export type RollKind = keyof typeof ROLLS;
