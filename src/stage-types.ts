import type { Segment } from './camera.ts';
import type { EnemyKind, NewEnemyKind } from './enemy-kinds.ts';
import type { MidbossScheduleState } from './midboss-schedule.ts';
import type { ThreatBudgetState } from './threat-budget.ts';
import type { LandmarkId, WorldSite } from './reach.ts';
import type { FlightBand } from './bands.ts';
import type { ChestId, DraftChoiceId, EvolutionId, GearId, WeaponId } from './data/items.ts';
import type { GnatVariant, RunPhase, SwarmEventKind } from './data/phases.ts';
import type { ChestState } from './chests.ts';
import type { BillState } from './bills.ts';
import type { Profile, RunMetrics, hangarLoadout } from './meta.ts';
import type { RunProgression } from './progression.ts';
import type { RangedShotFields } from './ranged-weapons.ts';
import type { RollKind } from './data/roll.ts';

export type Fixture = 'stack' | 'draft' | 'boss' | 'pursuit' | 'flare' | 'reversal' | 'flyby' | 'rear-threat' | 'strafe'
  | 'ace' | 'roster' | 'world' | LandmarkId | NewEnemyKind;
export type StageOptions = {
  seed: number;
  view: Segment | null;
  fixture: Fixture | null;
  time: number | null;
  autoplay: boolean;
  touch: boolean;
  // --- S7e lane ---
  acePhase?: AcePhase;
  fixtureCue?: string;
  mode?: 'legacy' | 'survivors';
  mobile?: boolean;
  aceRank?: number;
  heat?: number;
  profile?: Profile;
  daily?: boolean;
  // --- S7d lane ---
  worldFixture?: Point & { skim: boolean };
};
export type LegacyDraftId = 'twin-2' | 'twin-3' | 'pods-2' | 'twin-damage' | 'pods-damage';
export type DraftId = LegacyDraftId | DraftChoiceId;
export type Outcome = 'clear' | 'timeout' | 'lost' | 'retreated';
export type ManeuverKind = 'immelmann' | 'split-s' | 'j-turn';
export type Maneuver = {
  kind: ManeuverKind;
  elapsed: number;
  yaw: number;
  altitude: number;
  exitAltitude: number;
  altitudeFloor?: number;
  altitudeCeiling?: number;
  side: -1 | 1;
  skimExit?: true;
};
export type Roll = {
  kind: RollKind;
  side: -1 | 1;
  /** Zero on the activation tick. */
  elapsed: number;
  altitude: number;
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
  spacePending?: ManeuverKind;
  roll?: boolean;
  rollTurn?: number;
  boost?: boolean;
  toggleView?: boolean;
  start?: boolean;
  pause?: boolean;
  pick?: DraftId;
  reroll?: boolean;
  banish?: DraftChoiceId;
  skip?: boolean;
  chestPick?: WeaponId | 'open' | 'continue';
  retreat?: boolean;
  launch?: { profile: Profile; heat: number; seed: number; daily: boolean };
};

export type ChestReward = { kind: 'evolution'; id: EvolutionId } | { kind: 'upgrade'; id: DraftChoiceId; level?: number };
export type KillCredit = { weapon?: WeaponId; locked?: boolean; rear?: boolean };
export type RunSummary = { seconds: number; credits: number; unlocked: GearId[]; aceCache: boolean };

export type Point = { x: number; z: number };
export type Position = Point & { alt: number };
export type PickupKind = 'salvage' | 'magnet';
export type MagnetSourceKind = 'elite' | 'midboss';
export type PickupEvent = { pickupId: number; kind: PickupKind; position: Position; tick: number; sourceEventId?: number };
export type PickupCollectedEvent = PickupEvent & { xp: number; credits: number; playerPosition: Position };
export type PickupCapture = { capturedAtTick: number; arriveAtTick: number; origin: Position; curve: { x: number; z: number; amount: number } };
export type Ground = (x: number, z: number) => number;
export type Band = 0 | 1 | 2;
export type FlyIn = {
  origin: Position;
  target: Position;
  startedAt: number;
  arriveAt: number;
  bend: number;
  exitSpeed: number;
  clearance: number;
};
export type Enemy = Position & {
  id: number;
  kind: EnemyKind;
  gnatVariant?: GnatVariant;
  hp: number;
  maxHp?: number;
  yaw: number;
  vx: number;
  vz: number;
  bank: number;
  shotAt: number;
  hitUntil: number;
  shotDown: boolean;
  band: Band;
  offset: number;
  entry?: FlyIn;
  leaveAt?: number;
  directorIntro?: true;
  introAttackDone?: true;
  eventFlight?: Point;
  carrier?: ChestId;
  sortieBoss?: { eventId: string; id: SortieMinibossKind; startTick: number; role: 'leader' | 'escort' };
  killCredit?: KillCredit;
  maneuverAt: number;
  maneuver: { phase: 'warning' | 'diving'; band: Band; diveAt: number } | null;
  // --- S7e lane ---
  tell?: EnemyTell;
  formation?: { leader: number; side: number };
  crosswing?: {
    mate: number;
    side: -1 | 1;
    sideYaw?: number;
    phase?: 'warning' | 'crossing' | 'recovery' | 'cancelled';
    until?: number;
    isolationUntil?: number;
    target?: Point;
  };
  elite?: true;
  eliteVolley?: { started: number; secondAt: number };
  escortClearYaw?: number;
  charge?: { phase: 'warning' | 'charging' | 'recovery'; yaw: number; target: Point; until: number };
  manta?: {
    phase: 'approach' | 'climb' | 'warning' | 'pass' | 'exit';
    playerHeight: number;
    passAltitude: number;
    approach: Point;
    passStart?: Position;
    passEnd?: Position;
    exitTarget?: Point;
    until?: number;
  };
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
  reversalKill?: boolean;
  // --- S7d lane ---
  skim?: true;
  skimWater?: true;
  burnUntil?: number;
  burnNextAt?: number;
  burnDamage?: number;
  burnCredit?: KillCredit;
  ionReadyAt?: [number, number, number];
  droneReadyAt?: number;
  aegisReadyAt?: number;
};
export type EnemyTell = { until: number; started?: number } & (
  { kind: 'snipe'; target?: Position } |
  { kind: 'gun' | 'strafe' | 'tail' | 'mine' | 'aegis' | 'carrier' | 'gnat' } |
  { kind: 'charge' | 'crossing' | 'pass'; target: Position } |
  { kind: 'repair'; targetId: number } |
  (Position & { kind: 'flak' })
);
export type Pickup = Position & { id: number; kind?: PickupKind; xp: number; born: number; pulling?: boolean; reversal?: boolean; collected?: boolean;
  skim?: true; capture?: PickupCapture; captureRequestTicks?: number; source?: { eventId: number; kind: MagnetSourceKind };
  recovery?: { until: number; sourceAlt: number } };
type ShotCommon = Position & {
  vx: number;
  vz: number;
  vy?: number;
  life: number;
  damage: number;
  volley: number;
  nearMiss: boolean;
  lockId: number | null;
  aurora?: true;
  tracerScale?: number;
  pierce?: { remaining: number; hits: number[] };
};
export type Shot = ShotCommon & (
  { kind: 'twin' | 'pods' | 'hostile'; hostileKind?: 'ace-missile'; reversal?: { remaining: number; hits: number[] }; reversalTick?: number } |
  { kind: 'strafe'; targetBand: FlightBand; targetAltitude?: number; vy: number; reversal?: never; reversalTick?: never } |
  { kind: 'drone-bolt'; weapon: 'drones'; reversal?: never; reversalTick?: never } |
  (RangedShotFields & { reversal?: never; reversalTick?: never })
);
export type RearBomb = Position & { born: number; vx: number; vz: number; weapon?: 'bomb-bay';
  radius?: number; damage?: number; ceiling?: number; carpet?: true; groundFire?: true };
export type Flare = Position & { born: number; vx: number; vz: number; vy: number; weapon?: 'phoenix';
  lifeTicks?: number; burnTicks?: number; damage?: number; spread?: number; phoenix?: true; sourceBand?: FlightBand };
export type WeaponFx = {
  kind: 'rail-charge' | 'rail-beam' | 'rail-glow' | 'arc-link' | 'flak-blast' | 'seeker-blast' | 'arc-blast' | 'flare-spread' | 'ground-fire';
  from: Position;
  to?: Position;
  radius?: number;
  halfHeight?: number;
  damage?: number;
  hits?: number[];
  ceiling?: number;
  until: number;
};
export type RearGlimpse = { kind: 'bomb' | 'flare'; since: number; until: number; target?: Position };
export type EnemyMine = Position & { born: number };
export type Effect = Position & (
  { kind: 'hit' | 'burst'; life: number } |
  { kind: 'bomb-blast'; life: number; radius?: number } |
  { kind: 'flak'; life: number } |
  { kind: 'miss'; life: number; delta: number; vx: number; vz: number }
);
// --- S7e lane ---
export type AcePhase = 1 | 2 | 3;
export type AceTell = Position & { kind: 'gun' | 'missile' | 'roll'; since: number; until: number;
  dodgeGraceUntil?: number };
export type AceReengagement = {
  phase: 'evade' | 'approach' | 'line';
  startedAt: number;
  side: -1 | 1;
  scheduledLineAt?: number;
  lineStartedAt?: number;
  lineUntil?: number;
};
export type Ace = Position & {
  id: number;
  kind: 'ace';
  band: FlightBand;
  hp: number;
  maxHp: number;
  hits: number;
  hitUntil: number;
  yaw: number;
  vx: number;
  vz: number;
  bank: number;
  bankDrive: number;
  bankDrop: number;
  pitch: number;
  entry?: FlyIn;
  phase: AcePhase;
  bandAt: number;
  bandSide: -1 | 1;
  side: -1 | 1;
  boosting: boolean;
  tail: boolean;
  tailReadyAt: number;
  breakUntil: number;
  tell: AceTell | null;
  attacks: number;
  attackAt: number;
  roll: Roll | null;
  rollReadyAt: number;
  reengageAt?: number;
  reengagement?: AceReengagement;
  defeatedAt: number | null;
  crashed: boolean;
  burnUntil?: number;
  burnNextAt?: number;
  burnDamage?: number;
  ionReadyAt?: [number, number, number];
  droneReadyAt?: number;
  aegisReadyAt?: number;
};
export type SortieMinibossKind = 'armored-transport' | 'escort-commander';
export type SortieMinibossCue = {
  id: SortieMinibossKind;
  kind: 'midboss';
  startTick: number;
  maxDurationTicks: number;
  threatSource: string;
};
export type SortieMiniboss = {
  cue: SortieMinibossCue;
  actorId: number;
  phase: 'cross' | 'turn' | 'charge' | 'recover' | 'line';
  phaseStartedAt: number;
  side: -1 | 1;
  lineUntil: number | null;
  nextThreatAt: number;
  escortIds: [number, number];
  endTick: number | null;
  outcome: 'defeated' | 'retreated' | null;
};
export type Lock = { id: number; progress: number; ready: boolean };
export type StageState = {
  phase: 'title' | 'playing' | 'draft' | 'chest' | Outcome;
  paused: boolean;
  resultPending: Outcome | null;
  pendingFinish?: { outcome: Outcome; terminalTick: number; settlementTick: number };
  seed: number;
  rng: number;
  streams: Record<'spawn' | 'chest' | 'bills' | 'combat', { rng: number }> & { magnetDrop?: { rng: number } };
  run: RunProgression | null;
  profile: Profile;
  daily: boolean;
  hangar: ReturnType<typeof hangarLoadout>;
  metrics: RunMetrics;
  threatBudget?: ThreatBudgetState;
  midbossSchedule?: MidbossScheduleState;
  phaseDirector?: {
    intro: number; six: boolean; seven: boolean; manta: boolean; isolationUntil: number; introIds: number[];
    sixTellUntil: number; sixCrosswingStarted: boolean; sixTwinStarted: boolean;
  };
  killBandTicks: [number, number, number];
  killAltitudeTicks?: { tick: number; alt: number }[];
  ejectorUsed: boolean;
  summary: RunSummary | null;
  phaseNotice: { phase: RunPhase['id']; kind: 'start' | 'lull'; until: number; repaired: number } | null;
  phaseRepairMask?: number;
  swarmNotice?: { kind: SwarmEventKind; band: Band; until: number }
    | { kind: 'rest'; until: number } | { kind: 'recovery'; until: number };
  bills: BillState;
  lastHitTick: number;
  chests: ChestState;
  chestReveal: ChestReward[] | null;
  swarmCap: number;
  aceRank: number;
  heat: number;
  weaponFireAt: Partial<Record<WeaponId, number>>;
  railChargeAt: number | null;
  railRepeatAt?: number;
  seekerEchoAt: number;
  weaponFx: WeaponFx[];
  ionWake: (Position & { until: number; lane?: number })[];
  orbitDrones: (Position & { yaw: number })[];
  nextBayDrop: number | null;
  bayDropsLeft?: number;
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
  // --- S7d lane ---
  worldRegion?: Point & { spacing?: number };
  worldSites?: WorldSite[];
  claimedSites?: Record<string, true>;
  rally?: Position;
  player: {
    x: number; z: number; altitude: number; yaw: number; bank: number;
    /** Flight-path angle in radians, positive when climbing. */
    pitch: number;
    bankDrive?: number; bankDrop?: number; lastTurn?: -1 | 1; vx?: number; vz?: number;
    skim?: 'water' | 'land';
  };
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
  rearBombs: RearBomb[];
  flares: Flare[];
  flareHit: { until: number } | null;
  rearGlimpse: RearGlimpse | null;
  enemyMines: EnemyMine[];
  maneuver: Maneuver | null;
  maneuverTrail: ManeuverTrail | null;
  maneuverReadyAt: number;
  roll?: Roll | null;
  rollReadyAt?: number;
  bodyGraceUntil: number;
  reversal: {
    startTick: number;
    until: number;
    pursuers: readonly number[];
    kills: number;
    killTicks: number[];
    streak: number;
    burstAt?: number;
    nextShotAt: number;
    shownUntil: number;
  } | null;
  xp: number;
  xpRemainder: number;
  level: number;
  kills: number;
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
  boss: Ace | null;
  sortieBoss?: SortieMiniboss | null;
  suppressedSwarmEvents?: number[];
  lock: Lock | null;
  wrongLayer: { id: number; since: number } | null;
  altitudeHint: { delta: number } | null;
};
