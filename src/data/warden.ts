import type { Band } from '../stage-types.ts';

type WardenPart = {
  kind: 'pod' | 'core';
  band: Band;
  armor: number;
  opensAfterSeconds: number;
  hitWindow: number;
  orbitRadius: number;
  orbitOffset: number;
  salvo: { periodTicks: number; speed: number; spread: readonly number[] };
};

const HIGH_POD: WardenPart = {
  kind: 'pod', band: 2, armor: 47, opensAfterSeconds: 3, hitWindow: 8, orbitRadius: 41, orbitOffset: 0,
  salvo: { periodTicks: 252, speed: 64, spread: [-0.2, 0, 0.2] },
};
const LOW_POD: WardenPart = {
  kind: 'pod', band: 0, armor: 43, opensAfterSeconds: 30, hitWindow: 8, orbitRadius: 41, orbitOffset: Math.PI,
  salvo: { periodTicks: 276, speed: 68, spread: [-0.11, 0.11] },
};
const AFT_POD: WardenPart = {
  kind: 'pod', band: 2, armor: 44, opensAfterSeconds: 62, hitWindow: 8, orbitRadius: 47, orbitOffset: -Math.PI / 3,
  salvo: { periodTicks: 270, speed: 72, spread: [-0.31, -0.1, 0.1, 0.31] },
};
const HEAT_RELAY: WardenPart = {
  kind: 'pod', band: 1, armor: 36, opensAfterSeconds: 79, hitWindow: 8, orbitRadius: 39, orbitOffset: Math.PI / 2,
  salvo: { periodTicks: 216, speed: 72, spread: [-0.24, 0, 0.24] },
};
const CORE: WardenPart = {
  kind: 'core', band: 1, armor: 31, opensAfterSeconds: 108, hitWindow: 4, orbitRadius: 17, orbitOffset: 0.8,
  salvo: { periodTicks: 216, speed: 76, spread: [-0.28, 0, 0.28] },
};

export const WARDEN_PACING = {
  parts: [HIGH_POD, LOW_POD, AFT_POD, CORE],
  heatParts: [HIGH_POD, LOW_POD, AFT_POD, HEAT_RELAY, CORE],
  firstSalvoSeconds: 3.5,
  partWarningSeconds: 2,
  orbitSpeed: 0.0072,
  altitudeJitter: 11,
  coreOffset: 4.5,
  coreJitter: 1.5,
} as const;
