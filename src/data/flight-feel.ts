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
  cockpitWidening: 3,
  chaseCloser: 0.16,
  chaseSink: 3,
  chaseBankScale: 0.15,
  chaseBankRate: 8,
  chaseYawRate: 4.5,
  chaseYawLimit: 22 * Math.PI / 180,
  phoneBankLimit: 25 * Math.PI / 180,
  tremble: { size: 0.03, sizeVertical: 0.1, rate: 31, rateVertical: 47, speedLimit: 1.2 },
  shockDecay: 4.5,
  shockRate: 91,
  shockVertical: { size: 0.65, rate: 0.79 },
  shockSize: { hit: 0.86, parry: 0.57, explosion: 0.42 },
  explosionRange: scaleTravel(105),
  burstSize: 0.6,
  largeBurstMinimumLife: 0.65,
  rollTrailMinimumIntervals: 4,
  // Climb and dive presentation. Render-only: these read the sim, never write it.
  pitch: { rate: 14, limit: 40 * Math.PI / 180 },
  chaseAltitude: { carry: 0.4, steepCarry: 0.3, catchUp: 2.5, maneuverCatchUp: 12 },
  chaseTilt: { scale: 0.55, drop: 0.8, aim: 0.9 },
  head: { stiffness: 64, damping: 11, climbSink: 0.1, boostSink: 0.2, turnLean: 0.18, limit: 0.24 },
} as const;
