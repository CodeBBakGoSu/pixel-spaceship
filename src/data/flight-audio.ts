import { scaleTravel } from './speed.ts';

export const FLIGHT_AUDIO = {
  mixHeadroom: 0.69,
  mixLimiterKnee: 0.70,
  glideSeconds: 0.055,
  fadeInSeconds: 0.042,
  fadeOutSeconds: 0.032,
  minGainChange: 0.0005,
  minFrequencyChange: 0.5,
  filterQ: 0.7,
  noise: { sampleRate: 24_000, seconds: 1.2, seed: 0x3dd30a41 },
  engine: { idleHz: 50, speedHz: 94, idleGain: 0.027, speedGain: 0.080, cutoffHz: 445, noiseMix: 0.16 },
  afterburner: { gain: 0.13, cutoffHz: 210, boostHz: 700 },
  wind: { gain: 0.077, cutoffHz: 1_520 },
  samples: {
    engine: { minRate: 0.85, maxRate: 1.25, idleGain: 0.34, velocityGain: 0.60 },
    afterburner: { gain: 0.76, fadeSeconds: 0.12 },
    wind: { gain: 0.76, cockpitScale: 1.28, topScale: 0.44, cutoffHz: 12_000, topCutoffHz: 1_100 },
  },
  rush: {
    bankStart: 0.24, bankFull: 1.5, bankGain: 0.021,
    diveStart: 7, diveFull: 54, diveGain: 0.025, diveHz: 1_580,
    lowStart: 45, lowFull: 22, lowGain: 0.027, lowHz: 690,
    cutoffHz: 760,
  },
  flyby: { radius: scaleTravel(39), altitudeWindow: 23, minRelativeSpeed: scaleTravel(33), maxTickGap: 7 },
  cues: {
    flyby: { seconds: 0.265, cooldown: 0.42, attack: 0.065, filter: 0.13, sweep: 0.45, gain: 0.20, seed: 0x78d92b45 },
    cloud: { seconds: 0.365, cooldown: 0.42, attack: 0.054, filter: 0.08, sweep: 0.17, gain: 0.25, seed: 0x1c5692de },
  },
} as const;
