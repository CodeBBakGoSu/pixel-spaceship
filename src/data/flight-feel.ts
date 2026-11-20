import { SPEED_SCALE, scaleTravel } from './speed.ts';

const chaseScale = 1 + (SPEED_SCALE - 1) * 0.4;
const topScale = 1 + (SPEED_SCALE - 1) * 0.55;

export const FLIGHT_CAMERA = {
  far: scaleTravel(1060),
  rearFar: scaleTravel(640),
  top: { minHeight: 127 * topScale, phoneHalfWidth: 105 * topScale, desktopHalfWidth: 125 * topScale },
  chase: {
    setback: 46 * chaseScale,
    portraitSetback: 30 * chaseScale,
    lookAhead: scaleTravel(105),
    maneuverRetreat: { immelmann: 22 * chaseScale, 'split-s': 18 * chaseScale, 'j-turn': 29 * chaseScale },
  },
} as const;

export const FLIGHT_FEEL = {
  boostAttackSeconds: 0.25,
  boostReleaseSeconds: 0.5,
  boostAttackRate: 5,
  boostReleaseRate: 2.4,
  chaseWidening: 12,
  cockpitWidening: 8,
  chaseCloser: 0.16,
  chaseSink: 3,
  chaseBankScale: 0.4,
  chaseBankRate: 8,
  chaseYawRate: 10,
  chaseYawLimit: 10 * Math.PI / 180,
  phoneBankLimit: 25 * Math.PI / 180,
  tremble: { size: 0.17, sizeVertical: 0.56, rate: 31, rateVertical: 47, speedLimit: 1.2 },
  shockDecay: 4.5,
  shockRate: 91,
  shockVertical: { size: 0.65, rate: 0.79 },
  shockSize: { hit: 0.86, parry: 0.57, explosion: 0.42 },
  explosionRange: scaleTravel(105),
  burstSize: 0.6,
  rollTrailMinimumIntervals: 4,
} as const;
