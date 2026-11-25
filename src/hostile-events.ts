import type { HostileShape } from './data/hostile-fire.ts';
import type { EnemyKind } from './enemy-kinds.ts';
import type { AceTell, PickupCollectedEvent, PickupEvent, Position, Shot } from './stage-types.ts';

export type { PickupCollectedEvent, PickupEvent } from './stage-types.ts';
export type AceDefeatEvent = { id: number; position: Position; tick: number; outcome: 'defeated' };

// --- S7e lane ---
export type CombatTell = 'snipe' | 'flak' | 'dive' | 'tail' | 'strafe' | 'mine' | 'aegis' | 'carrier' | 'gnat'
  | 'gun' | 'missile' | 'roll' | 'ace-down';

/** Observers only. These events and their bookkeeping are outside the saved simulation state. */
export type CombatEvents = {
  muzzle?(shot: Shot, shape: HostileShape, x: number, z: number, alt: number): void;
  impact?(shot: Shot, x: number, z: number, alt: number): void;
  graze?(shot: Shot, x: number, z: number, alt: number): void;
  hit?(damage: number, fromX: number, fromZ: number, fromAlt: number): void;
  roll?(side: -1 | 1, barrel: boolean): void;
  parry?(shot: Shot, x: number, z: number, alt: number): void;
  tell?(kind: CombatTell, x: number, z: number, alt: number): void;
  aceTellFired?(tell: AceTell): void;
  destroyed?(kind: EnemyKind, elite: boolean, id?: number, position?: Position, tick?: number, formationId?: number, armored?: boolean): void;
  pickupDropped?(event: PickupEvent): void;
  pickupContacted?(event: PickupEvent): void;
  pickupCollected?(event: PickupCollectedEvent): void;
  aceDefeated?(event: AceDefeatEvent): void;
  aceArrival?(): void;
  pickupDropped?(event: PickupEvent): void;
  pickupContacted?(event: PickupEvent): void;
  pickupCollected?(event: PickupCollectedEvent): void;
};
