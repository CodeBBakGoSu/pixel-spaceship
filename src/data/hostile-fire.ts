import type { EnemyKind } from '../enemy-kinds.ts';

export const HOSTILE_HIT_RADIUS = 5.5;
export const HOSTILE_GRAZE_RADIUS = HOSTILE_HIT_RADIUS * 1.6;
export const HOSTILE_IFRAME_TICKS = 60;

export type HostileShape = 'orb' | 'needle' | 'diamond';
export type HostileSourceKind = EnemyKind | 'pod' | 'core';

const HOSTILE_SHAPES = {
  patrol: 'orb', skimmer: 'orb', hound: 'orb', flanker: 'orb', gnat: 'orb',
  interceptor: 'needle', spotter: 'needle', harrier: 'needle', diver: 'needle',
  turret: 'diamond', bomber: 'diamond', pod: 'diamond', core: 'diamond',
} as const satisfies Record<HostileSourceKind, HostileShape>;

export function hostileShape(kind?: HostileSourceKind): HostileShape {
  return kind === undefined ? 'orb' : HOSTILE_SHAPES[kind];
}
