import { GNAT, SWARM_CAPS } from './data/phases.ts';
import { ROSTER } from './data/roster.ts';
import { scaleTravel } from './data/speed.ts';

export const ENEMY_KINDS = {
  patrol: { hp: 2, xp: 1, cap: 24, firstShot: 86, speed: scaleTravel(22), pursuit: scaleTravel(32), boltSpeed: scaleTravel(58) },
  interceptor: { hp: 4, xp: 2, cap: 24, firstShot: 95, speed: scaleTravel(31), pursuit: scaleTravel(42), boltSpeed: scaleTravel(75) },
  skimmer: { hp: 2, xp: 1, cap: 4, firstShot: 91, speed: scaleTravel(32), boltSpeed: scaleTravel(85) },
  spotter: { hp: 4, xp: 2, cap: 2, firstShot: 95, speed: scaleTravel(18), boltSpeed: scaleTravel(102) },
  hound: { hp: 3, xp: 1, cap: 3, firstShot: 100, speed: scaleTravel(60), boltSpeed: scaleTravel(74) },
  flanker: { hp: 3, xp: 1, cap: 2, firstShot: 96, speed: scaleTravel(62), boltSpeed: scaleTravel(69) },
  harrier: { hp: 4, xp: 2, cap: 1, firstShot: 100, speed: scaleTravel(58), boltSpeed: scaleTravel(72) },
  diver: { hp: 4, xp: 2, cap: 2, firstShot: 110, speed: scaleTravel(30), boltSpeed: scaleTravel(76) },
  bomber: { hp: 10, xp: 3, cap: 6, firstShot: 100, speed: scaleTravel(16), boltSpeed: scaleTravel(58) },
  turret: { hp: 4, xp: 1, cap: 12, firstShot: 105 },
  aegis: ROSTER.aegis,
  gnat: { hp: GNAT.hp, xp: GNAT.xp, cap: SWARM_CAPS.desktop, firstShot: 0, speed: GNAT.speed },
} as const;

export type EnemyKind = keyof typeof ENEMY_KINDS;
export type RegularEnemyKind = Exclude<EnemyKind, 'gnat'>;
export type NewEnemyKind = Exclude<RegularEnemyKind, 'patrol' | 'interceptor' | 'aegis'>;

export function isNewEnemyKind(value: string | null): value is NewEnemyKind {
  return value !== null && value !== 'patrol' && value !== 'interceptor' && value !== 'gnat' && value !== 'aegis'
    && Object.prototype.hasOwnProperty.call(ENEMY_KINDS, value);
}

export const NEW_ENEMY_KINDS = Object.keys(ENEMY_KINDS).filter(isNewEnemyKind);
