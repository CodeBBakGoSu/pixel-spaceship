import type { RegularEnemyKind } from '../enemy-kinds.ts';
import type { Band } from '../stage-types.ts';
import { ROSTER } from './roster.ts';
import { scaleTravel } from './speed.ts';

export const PHASE_SECONDS = 120;
export const LULL_SECONDS = 15;
export const RUN_BOSS_SECONDS = 4 * PHASE_SECONDS;
export const RUN_END_SECONDS = RUN_BOSS_SECONDS + PHASE_SECONDS;
export const SWARM_CAPS = { mobile: 120, desktop: 200 } as const;
export const GNAT = {
  hp: 1, xp: 1, speed: scaleTravel(32), lifeSeconds: 12, range: scaleTravel(134), clearance: 22, spacing: scaleTravel(11),
  armored: { hp: 3, xp: 3 }, sting: { contactDamage: 1 },
} as const;

export type GnatVariant = 'armored' | 'sting';

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
  gnatFloor: number;
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
// Aegis takes one patrol slot, preserving the other kinds' selection ranges.
const coast = [{ ...patrol, weight: patrol.weight - aegis.weight }, aegis, skimmer, turret];
const skirmish = [...coast, interceptor, spotter, hound];
const siege = [...skirmish, diver, flanker, bomber];

export const PHASES: readonly RunPhase[] = [
  {
    id: 'coast', starts: 0, ends: PHASE_SECONDS, lull: LULL_SECONDS, hpScale: 1,
    regularCap: 8, regularPerMinute: 14, enemies: coast, gnatFloor: 22,
    gnatShare: { armored: 0, sting: 0 },
    gnatsPerMinute: 70, gnatStart: 20, packSize: 10, formations: ['vee', 'line'], bands: [1, 1, 0, 2], splitBands: false,
  },
  {
    id: 'skirmish', starts: PHASE_SECONDS, ends: 2 * PHASE_SECONDS, lull: LULL_SECONDS, hpScale: 1.12,
    regularCap: 16, regularPerMinute: 16, enemies: skirmish, gnatFloor: 44,
    gnatShare: { armored: 0, sting: 0.10 },
    gnatsPerMinute: 160, gnatStart: 0, packSize: 18, formations: ['ring', 'line'], bands: [0, 1, 2], splitBands: false,
  },
  {
    id: 'siege', starts: 2 * PHASE_SECONDS, ends: 3 * PHASE_SECONDS, lull: LULL_SECONDS, hpScale: 1.12 ** 2,
    regularCap: 26, regularPerMinute: 19, enemies: siege, gnatFloor: 84,
    gnatShare: { armored: 0.15, sting: 0.10 },
    gnatsPerMinute: 320, gnatStart: 0, packSize: 28, formations: ['line', 'vee', 'ring', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'storm', starts: 3 * PHASE_SECONDS, ends: RUN_BOSS_SECONDS, lull: LULL_SECONDS, hpScale: 1.12 ** 3,
    regularCap: 30, regularPerMinute: 23, enemies: [...siege, harrier], gnatFloor: 130,
    gnatShare: { armored: 0.25, sting: 0.15 },
    gnatsPerMinute: 480, gnatStart: 0, packSize: 36, formations: ['ring', 'vee', 'line', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'ace', starts: RUN_BOSS_SECONDS, ends: RUN_END_SECONDS, lull: 0, hpScale: 1.12 ** 3,
    regularCap: 34, regularPerMinute: 28, enemies: [patrol, interceptor, harrier], gnatFloor: 166,
    gnatShare: { armored: 0.25, sting: 0.20 },
    gnatsPerMinute: 600, gnatStart: 0, packSize: 40, formations: ['vee', 'ring', 'encircle'], bands: [0, 1, 2], splitBands: true,
  },
];

export function phaseAt(seconds: number): RunPhase {
  const index = Math.floor(seconds / PHASE_SECONDS);
  return PHASES[Math.min(PHASES.length - 1, Math.max(0, index))];
}

export function gnatVariantAt(phase: RunPhase, roll: number): GnatVariant | undefined {
  const { sting, armored } = phase.gnatShare;
  return roll < sting ? 'sting' : roll < sting + armored ? 'armored' : undefined;
}
