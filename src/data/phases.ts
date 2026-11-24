import type { RegularEnemyKind } from '../enemy-kinds.ts';
import type { Band } from '../stage-types.ts';
import { ROSTER } from './roster.ts';
import { scaleTravel } from './speed.ts';

export const PHASE_SECONDS = 120;
export const MINUTE_SECONDS = 60;
export const LULL_SECONDS = 15;
export const RUN_BOSS_SECONDS = 4 * PHASE_SECONDS;
export const RUN_END_SECONDS = RUN_BOSS_SECONDS + PHASE_SECONDS;
export const SWARM_CAPS = { mobile: 120, desktop: 200 } as const;
export const GNAT = {
  hp: 1, xp: 1, speed: scaleTravel(32), lifeSeconds: 12, range: scaleTravel(134), clearance: 22, spacing: scaleTravel(11),
  armored: { hp: 3, xp: 3 }, sting: { contactDamage: 1 },
} as const;

export type GnatVariant = 'armored' | 'sting';

export type SwarmEventKind = 'ring';
export type SwarmEvent = { kind: SwarmEventKind; start: number; duration: number };
export const SWARM_EVENTS: readonly SwarmEvent[] = [
  { kind: 'ring', start: 110, duration: 15 }, { kind: 'ring', start: 315, duration: 10 },
];
export const SWARM_EVENT = {
  restSeconds: 15, ringSize: 72,
  ringRadius: scaleTravel(145), ringExitRadius: scaleTravel(12),
} as const;

export function swarmWindowAt(seconds: number): SwarmEvent | undefined {
  return SWARM_EVENTS.find(event => seconds >= event.start && seconds < event.start + event.duration + SWARM_EVENT.restSeconds);
}

export type SwarmFormation = 'ring' | 'line' | 'vee' | 'encircle';
export type RegularSpawn = {
  kind: RegularEnemyKind;
  band: Band | 'flank';
  bearing: number;
  range: number;
  weight: number;
};
export type RunPhase = {
  id: 'coast' | 'skirmish' | 'siege' | 'storm' | 'ace';
  starts: number;
  ends: number;
  lull: number;
  hpScale: number;
  regularCap: number;
  regularPerMinute: number;
  enemies: readonly RegularSpawn[];
  gnatsPerMinute: number;
  gnatsPerMinuteMobile: number;
  gnatFloor: number;
  gnatFloorMobile: number;
  eliteShare: number;
  gnatShare: Readonly<Record<GnatVariant, number>>;
  gnatStart: number;
  packSize: number;
  formations: readonly SwarmFormation[];
  bands: readonly Band[];
  splitBands: boolean;
};

const patrol: RegularSpawn = { kind: 'patrol', band: 1, bearing: 9, range: scaleTravel(132), weight: 6 };
const skimmer: RegularSpawn = { kind: 'skimmer', band: 0, bearing: -17, range: scaleTravel(136), weight: 3 };
const turret: RegularSpawn = { kind: 'turret', band: 1, bearing: 0, range: scaleTravel(141), weight: 2 };
const interceptor: RegularSpawn = { kind: 'interceptor', band: 2, bearing: 25, range: scaleTravel(147), weight: 3 };
const spotter: RegularSpawn = { kind: 'spotter', band: 2, bearing: 14, range: scaleTravel(170), weight: 2 };
const hound: RegularSpawn = { kind: 'hound', band: 1, bearing: 180, range: scaleTravel(92), weight: 2 };
const diver: RegularSpawn = { kind: 'diver', band: 2, bearing: -5, range: scaleTravel(162), weight: 3 };
const flanker: RegularSpawn = { kind: 'flanker', band: 'flank', bearing: 48, range: scaleTravel(148), weight: 2 };
const bomber: RegularSpawn = { kind: 'bomber', band: 1, bearing: 5, range: scaleTravel(167), weight: 1 };
const harrier: RegularSpawn = { kind: 'harrier', band: 1, bearing: -157, range: scaleTravel(104), weight: 2 };
const aegis: RegularSpawn = { kind: 'aegis', band: ROSTER.bands.mid, bearing: -34, range: scaleTravel(155), weight: 1 };
// Aegis uses the elite share; no other phase pool can randomly spawn a new type.
const coast = [{ ...patrol, weight: patrol.weight - aegis.weight }, aegis, skimmer, turret];
const skirmish = [...coast, interceptor, spotter, hound];
const siege = [...skirmish, diver, flanker, bomber];
const elites = (pool: readonly RegularSpawn[], share: number): RegularSpawn[] => {
  const others = pool.filter(entry => entry.kind !== 'aegis');
  const total = others.reduce((sum, entry) => sum + entry.weight, 0);
  return [...others, { ...aegis, weight: total * share / (1 - share) }];
};
const storm = [...siege, harrier];

export const PHASES: readonly RunPhase[] = [
  {
    id: 'coast', starts: 0, ends: MINUTE_SECONDS, lull: 0, hpScale: 1,
    regularCap: 8, regularPerMinute: 14, enemies: elites(coast, 0.005), eliteShare: 0.005, gnatFloor: 22, gnatFloorMobile: 14,
    gnatShare: { armored: 0, sting: 0 },
    gnatsPerMinute: 70, gnatsPerMinuteMobile: 50, gnatStart: 20, packSize: 10,
    formations: ['vee', 'line'], bands: [1, 1, 0, 2], splitBands: false,
  },
  {
    id: 'coast', starts: MINUTE_SECONDS, ends: 2 * MINUTE_SECONDS, lull: 0, hpScale: 1,
    regularCap: 8, regularPerMinute: 14, enemies: elites(coast, 0.01), eliteShare: 0.01, gnatFloor: 22, gnatFloorMobile: 14,
    gnatShare: { armored: 0, sting: 0 },
    gnatsPerMinute: 70, gnatsPerMinuteMobile: 50, gnatStart: 0, packSize: 10,
    formations: ['vee', 'line'], bands: [1, 1, 0, 2], splitBands: false,
  },
  {
    id: 'skirmish', starts: 2 * MINUTE_SECONDS, ends: 3 * MINUTE_SECONDS, lull: 0, hpScale: 1.12,
    regularCap: 16, regularPerMinute: 16, enemies: elites(skirmish, 0.02), eliteShare: 0.02, gnatFloor: 44, gnatFloorMobile: 37,
    gnatShare: { armored: 0, sting: 0.10 },
    gnatsPerMinute: 160, gnatsPerMinuteMobile: 160, gnatStart: 0, packSize: 18,
    formations: ['ring', 'line'], bands: [0, 1, 2], splitBands: false,
  },
  {
    id: 'skirmish', starts: 3 * MINUTE_SECONDS, ends: 4 * MINUTE_SECONDS, lull: 0, hpScale: 1.12,
    regularCap: 16, regularPerMinute: 16, enemies: elites(skirmish, 0.03), eliteShare: 0.03, gnatFloor: 44, gnatFloorMobile: 37,
    gnatShare: { armored: 0, sting: 0.10 },
    gnatsPerMinute: 160, gnatsPerMinuteMobile: 160, gnatStart: 0, packSize: 18,
    formations: ['ring', 'line'], bands: [0, 1, 2], splitBands: false,
  },
  {
    id: 'siege', starts: 4 * MINUTE_SECONDS, ends: 5 * MINUTE_SECONDS, lull: 0, hpScale: 1.12 ** 2,
    regularCap: 26, regularPerMinute: 19, enemies: elites(siege, 0.04), eliteShare: 0.04, gnatFloor: 90, gnatFloorMobile: 72,
    gnatShare: { armored: 0.15, sting: 0.10 },
    gnatsPerMinute: 320, gnatsPerMinuteMobile: 320, gnatStart: 0, packSize: 28,
    formations: ['line', 'vee', 'ring', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'siege', starts: 5 * MINUTE_SECONDS, ends: 6 * MINUTE_SECONDS, lull: 0, hpScale: 1.12 ** 2,
    regularCap: 26, regularPerMinute: 19, enemies: elites(siege, 0.05), eliteShare: 0.05, gnatFloor: 90, gnatFloorMobile: 72,
    gnatShare: { armored: 0.15, sting: 0.10 },
    gnatsPerMinute: 320, gnatsPerMinuteMobile: 320, gnatStart: 0, packSize: 28,
    formations: ['line', 'vee', 'ring', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'storm', starts: 6 * MINUTE_SECONDS, ends: 7 * MINUTE_SECONDS, lull: 0, hpScale: 1.12 ** 3,
    regularCap: 30, regularPerMinute: 23, enemies: elites(storm, 0.06), eliteShare: 0.06, gnatFloor: 130, gnatFloorMobile: 92,
    gnatShare: { armored: 0.25, sting: 0.15 },
    gnatsPerMinute: 480, gnatsPerMinuteMobile: 480, gnatStart: 0, packSize: 36,
    formations: ['ring', 'vee', 'line', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'storm', starts: 7 * MINUTE_SECONDS, ends: 8 * MINUTE_SECONDS, lull: 0, hpScale: 1.12 ** 3,
    regularCap: 30, regularPerMinute: 23, enemies: elites(storm, 0.08), eliteShare: 0.08, gnatFloor: 130, gnatFloorMobile: 92,
    gnatShare: { armored: 0.25, sting: 0.15 },
    gnatsPerMinute: 480, gnatsPerMinuteMobile: 480, gnatStart: 0, packSize: 36,
    formations: ['ring', 'vee', 'line', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'ace', starts: RUN_BOSS_SECONDS, ends: 9 * MINUTE_SECONDS, lull: 0, hpScale: 1.12 ** 3,
    regularCap: 34, regularPerMinute: 0, enemies: [], eliteShare: 0, gnatFloor: 0, gnatFloorMobile: 0,
    gnatShare: { armored: 0.25, sting: 0.20 },
    gnatsPerMinute: 0, gnatsPerMinuteMobile: 0, gnatStart: 0, packSize: 0,
    formations: ['vee', 'ring', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'ace', starts: 9 * MINUTE_SECONDS, ends: RUN_END_SECONDS, lull: 0, hpScale: 1.12 ** 3,
    regularCap: 34, regularPerMinute: 0, enemies: [], eliteShare: 0, gnatFloor: 0, gnatFloorMobile: 0,
    gnatShare: { armored: 0.25, sting: 0.20 },
    gnatsPerMinute: 0, gnatsPerMinuteMobile: 0, gnatStart: 0, packSize: 0,
    formations: ['vee', 'ring', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
];

export function phaseAt(seconds: number): RunPhase {
  const index = Math.floor(seconds / MINUTE_SECONDS);
  return PHASES[Math.min(PHASES.length - 1, Math.max(0, index))];
}

export function gnatVariantAt(phase: RunPhase, roll: number): GnatVariant | undefined {
  const { sting, armored } = phase.gnatShare;
  return roll < sting ? 'sting' : roll < sting + armored ? 'armored' : undefined;
}
