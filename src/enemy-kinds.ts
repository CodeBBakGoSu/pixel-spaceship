export const ENEMY_KINDS = {
  patrol: { hp: 2, xp: 1, cap: 24, firstShot: 86, speed: 22, pursuit: 32, boltSpeed: 58 },
  interceptor: { hp: 4, xp: 2, cap: 24, firstShot: 95, speed: 31, pursuit: 42, boltSpeed: 75 },
  skimmer: { hp: 2, xp: 1, cap: 4, firstShot: 91, speed: 32, boltSpeed: 85 },
  spotter: { hp: 4, xp: 2, cap: 2, firstShot: 95, speed: 18, boltSpeed: 102 },
  hound: { hp: 3, xp: 1, cap: 3, firstShot: 100, speed: 60, boltSpeed: 74 },
  flanker: { hp: 3, xp: 1, cap: 2, firstShot: 96, speed: 62, boltSpeed: 69 },
  harrier: { hp: 4, xp: 2, cap: 1, firstShot: 100, speed: 58, boltSpeed: 64 },
  diver: { hp: 4, xp: 2, cap: 2, firstShot: 110, speed: 30, boltSpeed: 76 },
  bomber: { hp: 10, xp: 3, cap: 6, firstShot: 100, speed: 16 },
  turret: { hp: 4, xp: 1, cap: 12, firstShot: 105 },
} as const;

export type EnemyKind = keyof typeof ENEMY_KINDS;
export type NewEnemyKind = Exclude<EnemyKind, 'patrol' | 'interceptor'>;

export function isNewEnemyKind(value: string | null): value is NewEnemyKind {
  return value !== null && value !== 'patrol' && value !== 'interceptor'
    && Object.prototype.hasOwnProperty.call(ENEMY_KINDS, value);
}

export const NEW_ENEMY_KINDS = Object.keys(ENEMY_KINDS).filter(isNewEnemyKind);
