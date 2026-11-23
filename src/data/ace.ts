import { scaleTravel } from './speed.ts';

export const ACE = {
  hull: { legacy: 42, survivors: 1200, heatArmorScale: 1.2 },
  phaseHealth: { cover: 0.66, desperate: 0.33 },
  entry: { ticks: 120, bend: 0.23 },
  flight: {
    clearance: 22, turnGain: 2.35, breakTurn: 0.22, deepTurnDrag: 0.475,
    interceptSeconds: 0.32, tailDistance: scaleTravel(72), tailRange: scaleTravel(127), tailCos: 0.48,
    closeRange: scaleTravel(24), breakTicks: 65, warningCooldown: 180,
    verticalScale: 0.8, pitchScale: 0.46, bandStepDelay: 90,
  },
  attack: { startDelay: 82, range: scaleTravel(156), cone: 0.58, leadSeconds: 0.34, bandWindow: 11 },
  lock: { dodgeTicks: 18, releaseCone: 0.85 },
  gun: { warningTicks: 33, speedScale: 1.58 },
  missile: { warningTicks: 52, speedScale: 1.46, turnRate: 0.76, life: 2.45 },
  roll: { warningTicks: 17, threatSeconds: 0.47, threatMargin: scaleTravel(4), recoverTicks: 95 },
  cover: { gnats: 8, distance: scaleTravel(38), side: scaleTravel(34), formationTicks: 510 },
  defeat: { maxTicks: 125, turnRate: 1.8, fallSpeed: 66, bankRate: 9, pitch: 0.5, trailTicks: 12, blastLife: 0.68, score: 2500 },
  hitRadius: 7,
  burnInterval: 54,
} as const;

export const ACE_PHASES = {
  1: { speedScale: 0.98, bandTicks: 438, fireTicks: 211, rollTicks: 450, afterburner: false, missileEvery: 3,
    gun: [-0.14, 0, 0.14], missile: [0] },
  2: { speedScale: 1.04, bandTicks: 358, fireTicks: 181, rollTicks: 340, afterburner: false, missileEvery: 2,
    gun: [-0.16, 0, 0.16], missile: [-0.12, 0.12] },
  3: { speedScale: 1.09, bandTicks: 294, fireTicks: 143, rollTicks: 240, afterburner: true, missileEvery: 2,
    gun: [-0.18, -0.06, 0.06, 0.18], missile: [-0.19, 0, 0.19] },
} as const;
