import type { HostileShape } from './data/hostile-fire.ts';
import type { Shot } from './stage-types.ts';

/** Observers only. These events and their bookkeeping are outside the saved simulation state. */
export type CombatEvents = {
  muzzle?(shot: Shot, shape: HostileShape, x: number, z: number, alt: number): void;
  impact?(shot: Shot, x: number, z: number, alt: number): void;
  graze?(shot: Shot, x: number, z: number, alt: number): void;
  hit?(damage: number, fromX: number, fromZ: number, fromAlt: number): void;
  roll?(side: -1 | 1, barrel: boolean): void;
  parry?(shot: Shot, x: number, z: number, alt: number): void;
};
