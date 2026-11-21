// Reference palette (Forge "fighter"): saturated cobalt sea, bright layered greens, light-blue haze.
export const SKY = {
  horizon: 0xc6e8fa,
  middle: 0x7abef0,
  zenith: 0x3e8ede,
  bands: 8,
  /** Elevation, rad, at which the sky reaches its zenith colour. */
  span: 0.75,
} as const;

export const HAZE = 0xbce0f6;

export const GROUND_COLORS = {
  deep: 0x2468b4,
  shallow: 0x3f97d2,
  sand: 0xeedca4,
  meadow: 0x86ce4c,
  grass: [0x60b234, 0x4f9e2e],
  hill: 0x7f9a5a,
  rock: 0x928c86,
} as const;

/** Ground shadows: a cool, two-tone shade cast away from a high sun in the north-west. */
export const SHADOW = {
  sunX: 0.26,
  sunZ: -0.17,
  textureSize: 32,
  color: 0x1b3557,
  enemyOpacity: 0.42,
} as const;
