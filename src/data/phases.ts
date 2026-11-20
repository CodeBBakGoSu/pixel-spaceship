import type { RegularEnemyKind } from '../enemy-kinds.ts';
import type { Band } from '../stage-types.ts';
import { ROSTER } from './roster.ts';
import { scaleTravel } from './speed.ts';

export const PHASE_SECONDS = 120;
export const LULL_SECONDS = 15;
export const RUN_BOSS_SECONDS = 4 * PHASE_SECONDS;
export const RUN_END_SECONDS = RUN_BOSS_SECONDS + PHASE_SECONDS;
export const SWARM_CAPS = { mobile: 50, desktop: 80 } as const;
export const GNAT = {
  hp: 1, xp: 1, speed: scaleTravel(32), lifeSeconds: 12, range: scaleTravel(134), clearance: 22, spacing: scaleTravel(11),
} as const;

export type SwarmFormation = 'ring' | 'line' | 'vee';
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
    regularCap: 8, regularPerMinute: 14, enemies: coast,
    gnatsPerMinute: 25, gnatStart: 45, packSize: 6, formations: ['vee', 'line'], bands: [1, 1, 0, 2], splitBands: false,
  },
  {
    id: 'skirmish', starts: PHASE_SECONDS, ends: 2 * PHASE_SECONDS, lull: LULL_SECONDS, hpScale: 1.12,
    regularCap: 16, regularPerMinute: 16, enemies: skirmish,
    gnatsPerMinute: 55, gnatStart: 0, packSize: 9, formations: ['ring', 'line'], bands: [0, 1, 2], splitBands: false,
  },
  {
    id: 'siege', starts: 2 * PHASE_SECONDS, ends: 3 * PHASE_SECONDS, lull: LULL_SECONDS, hpScale: 1.12 ** 2,
    regularCap: 24, regularPerMinute: 18, enemies: siege,
    gnatsPerMinute: 90, gnatStart: 0, packSize: 12, formations: ['line', 'vee', 'ring'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'storm', starts: 3 * PHASE_SECONDS, ends: RUN_BOSS_SECONDS, lull: LULL_SECONDS, hpScale: 1.12 ** 3,
    regularCap: 24, regularPerMinute: 20, enemies: [...siege, harrier],
    gnatsPerMinute: 130, gnatStart: 0, packSize: 14, formations: ['ring', 'vee', 'line'], bands: [0, 1, 2], splitBands: true,
  },
  {
    id: 'ace', starts: RUN_BOSS_SECONDS, ends: RUN_END_SECONDS, lull: 0, hpScale: 1.12 ** 3,
    regularCap: 14, regularPerMinute: 8, enemies: [patrol, interceptor, harrier],
    gnatsPerMinute: 60, gnatStart: 0, packSize: 10, formations: ['vee', 'ring'], bands: [0, 1, 2], splitBands: false,
  },
];

export function phaseAt(seconds: number): RunPhase {
  const index = Math.floor(seconds / PHASE_SECONDS);
  return PHASES[Math.min(PHASES.length - 1, Math.max(0, index))];
}
