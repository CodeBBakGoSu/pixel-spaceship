export const ENEMY_KINDS = {
  patrol: { hp: 2, xp: 1, cap: 24, firstShot: 260 },
  interceptor: { hp: 4, xp: 2, cap: 24, firstShot: 345 },
  skimmer: { hp: 2, xp: 1, cap: 4, firstShot: 150 },
  spotter: { hp: 4, xp: 2, cap: 2, firstShot: 100 },
  hound: { hp: 3, xp: 1, cap: 3, firstShot: 180 },
} as const;

export type EnemyKind = keyof typeof ENEMY_KINDS;
export type NewEnemyKind = Exclude<EnemyKind, 'patrol' | 'interceptor'>;

export function isNewEnemyKind(value: string | null): value is NewEnemyKind {
  return value !== null && value !== 'patrol' && value !== 'interceptor'
    && Object.prototype.hasOwnProperty.call(ENEMY_KINDS, value);
}

export const NEW_ENEMY_KINDS = Object.keys(ENEMY_KINDS).filter(isNewEnemyKind);
