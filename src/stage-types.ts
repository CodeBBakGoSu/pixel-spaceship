import type { Segment } from './camera.ts';
import type { EnemyKind, NewEnemyKind } from './enemy-kinds.ts';
import type { LandmarkId } from './reach.ts';

export type Fixture = 'stack' | 'draft' | 'boss' | 'pursuit' | 'flare' | 'reversal' | 'flyby' | 'rear-threat' | 'strafe'
  | LandmarkId | NewEnemyKind;
export type StageOptions = {
  seed: number;
  view: Segment | null;
  fixture: Fixture | null;
  time: number | null;
  autoplay: boolean;
  touch: boolean;
};
export type DraftId = 'twin-2' | 'twin-3' | 'pods-2' | 'twin-damage' | 'pods-damage';
export type Outcome = 'clear' | 'timeout' | 'lost';
export type ManeuverKind = 'immelmann' | 'split-s' | 'j-turn';
export type Maneuver = {
  kind: ManeuverKind;
  elapsed: number;
  yaw: number;
  altitude: number;
  exitAltitude: number;
  side: -1 | 1;
};
export type ManeuverTrail = {
  kind: ManeuverKind;
  startTick: number;
  yaw: number;
  side: -1 | 1;
  exitAltitude: number;
  actualExit?: number;
  limited: boolean;
  points: Position[];
  pursuers: number[];
};
export type StageInput = {
  turn?: number;
  climb?: number;
  maneuver?: ManeuverKind;
  maneuverTurn?: number;
  boost?: boolean;
  bomb?: boolean;
  flare?: boolean;
  toggleView?: boolean;
  start?: boolean;
  pause?: boolean;
  pick?: DraftId;
};

export type Point = { x: number; z: number };
export type Position = Point & { alt: number };
export type Ground = (x: number, z: number) => number;
export type Band = 0 | 1 | 2;
export type Enemy = Position & {
  id: number;
  kind: EnemyKind;
  hp: number;
  yaw: number;
  vx: number;
  vz: number;
  bank: number;
  shotAt: number;
  hitUntil: number;
  shotDown: boolean;
  band: Band;
  offset: number;
  maneuverAt: number;
  maneuver: { phase: 'warning' | 'diving'; band: Band; diveAt: number } | null;
  tell?: { kind: 'snipe'; until: number } | (Position & { kind: 'flak'; until: number });
  formation?: { leader: number; side: number };
  fanFired?: boolean;
  farTicks?: number;
  flightSpeed?: number;
  closeRange?: boolean;
  longRange?: boolean;
  terrainTurn?: { yaw: number; until: number };
  course?: { target: Point; speed: number; until: number };
  flyby?: { startedAt: number; yaw: number; side: -1 | 1; lane: number } &
    ({ phase: 'overtake' } | { phase: 'cross'; target: Point });
  flybyAt?: number;
  burnUntil?: number;
  burnNextAt?: number;
};
export type Pickup = Position & { id: number; xp: number; born: number };
export type Shot = Position & {
  vx: number;
  vz: number;
  life: number;
  damage: number;
  volley: number;
  nearMiss: boolean;
  lockId: number | null;
} & (
  { kind: 'twin' | 'pods' | 'hostile'; reversal?: { targetId: number }; reversalTick?: number } |
  { kind: 'strafe'; targetBand: Band; vy: number; reversal?: never; reversalTick?: never }
);
export type RearBomb = Position & { born: number; vx: number; vz: number };
export type Flare = Position & { born: number; vx: number; vz: number; vy: number };
export type RearGlimpse = { kind: 'bomb' | 'flare'; since: number; until: number; target?: Position };
export type EnemyMine = Position & { born: number };
export type Effect = Position & (
  { kind: 'hit' | 'burst' | 'bomb-blast'; life: number } |
  { kind: 'flak'; life: number } |
  { kind: 'miss'; life: number; delta: number; vx: number; vz: number }
);
export type WeakPoint = Position & {
  id: number;
  kind: 'pod' | 'core';
  band: Band;
  hp: number;
  maxHp: number;
  hits: number;
  window: number;
  vx: number;
  vz: number;
  burnUntil?: number;
  burnNextAt?: number;
};
export type Boss = {
  x: number;
  z: number;
  alt: number;
  weakPoints: WeakPoint[];
  orbitAngle: number;
  orbitStartTick: number;
  index: number;
  exposeTick: number;
  changedTick: number;
  shotAt: number;
};
export type Lock = { id: number; progress: number; ready: boolean };
export type StageState = {
  phase: 'title' | 'playing' | 'draft' | Outcome;
  paused: boolean;
  resultPending: Outcome | null;
  seed: number;
  rng: number;
  nextId: number;
  nextVolley: number;
  tick: number;
  nextWave: number;
  view: Segment;
  initialView: Segment | null;
  wipe: number;
  viewTag: number;
  arena: { x: number; z: number; radius: number };
  boundaryWarning: boolean;
  player: { x: number; z: number; altitude: number; yaw: number; bank: number; vx?: number; vz?: number };
  speed: number;
  climbRate: number;
  hull: number;
  maxHull: number;
  hitsTaken: number;
  rank: 'S' | 'A' | 'B' | 'C' | null;
  invulnerability: number;
  boost: number;
  boosting: boolean;
  boostTicks: number;
  bombs: number;
  bombReadyAt: number;
  bombReloadAt: number | null;
  rearBombs: RearBomb[];
  flares: Flare[];
  flareCharges: number;
  flareReadyAt: number;
  flareReloadAt: number | null;
  flareHit: { until: number } | null;
  rearGlimpse: RearGlimpse | null;
  enemyMines: EnemyMine[];
  maneuver: Maneuver | null;
  maneuverTrail: ManeuverTrail | null;
  maneuverReadyAt: number;
  bodyGraceUntil: number;
  reversal: {
    startTick: number;
    until: number;
    pursuers: readonly number[];
    kills: number;
    nextShotAt: number;
    shownUntil: number;
  } | null;
  xp: number;
  level: 1 | 2 | 3;
  salvage: number;
  salvageBands: [number, number, number];
  draft: DraftId[];
  picks: DraftId[];
  graceUntil: number;
  boostRelease: boolean;
  twinRank: 1 | 2 | 3;
  podRank: 1 | 2;
  twinDamage: number;
  podDamage: number;
  twinAt: number;
  podsAt: number;
  strafeAt: number;
  score: number;
  enemies: Enemy[];
  pickups: Pickup[];
  shots: Shot[];
  effects: Effect[];
  boss: Boss | null;
  lock: Lock | null;
  wrongLayer: { id: number; since: number } | null;
  altitudeHint: { delta: number } | null;
};
