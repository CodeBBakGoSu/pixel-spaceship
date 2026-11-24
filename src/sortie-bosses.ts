import { HIT_WINDOW, MAX_ALTITUDE, STEP, TICKS_PER_SECOND, TWIN_CONE, angleTo, clamp, fireHostile } from './stage-combat.ts';
import { CARRIER_TUNING } from './data/chest-tuning.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { HOSTILE_SHOT_LIMIT } from './data/run-balance.ts';
import { scaleTravel } from './data/speed.ts';
import { makeEnemy } from './stage-enemies.ts';
import type { CombatEvents } from './hostile-events.ts';
import type { Enemy, Ground, Position, SortieMiniboss, SortieMinibossCue, StageState } from './stage-types.ts';
import { add3d, distance3d, normalize3d, scale3d, type SpatialPoint, type SpatialVector } from './sortie-spatial-adapter.ts';

export const SORTIE_MINIBOSS_CUES: readonly SortieMinibossCue[] = [
  { id: 'armored-transport', kind: 'midboss', startTick: 205 * TICKS_PER_SECOND,
    maxDurationTicks: 30 * TICKS_PER_SECOND, threatSource: 'midboss:armored-transport' },
  { id: 'escort-commander', kind: 'midboss', startTick: 400 * TICKS_PER_SECOND,
    maxDurationTicks: 30 * TICKS_PER_SECOND, threatSource: 'midboss:escort-commander' },
];

export const SORTIE_REST_TICKS = 15 * TICKS_PER_SECOND;
export const SORTIE_BOSS_HIT_RADIUS = scaleTravel(14);

export type ThreatSpendRequest = { tick: number; source: string; points: 1 | 2; bearing: number };
export type ThreatSpendHook = (state: StageState, request: ThreatSpendRequest) => boolean;

export type SortieBossHooks = {
  consumeMidbossCue(state: StageState): SortieMinibossCue | null;
  finishMidbossEncounter(state: StageState, result: {
    id: SortieMinibossCue['id']; endedAt: number; outcome: 'defeated' | 'escaped';
  }): void;
  trySpendThreat: ThreatSpendHook;
  dropMagnet(state: StageState, request: {
    sourceEventId: number;
    sourceKind: 'elite' | 'midboss';
    position: Position;
  }, events?: CombatEvents): void;
};

export const STANDALONE_SORTIE_BOSS_HOOKS: SortieBossHooks = {
  consumeMidbossCue: state => SORTIE_MINIBOSS_CUES.find(cue => cue.startTick === state.tick) ?? null,
  finishMidbossEncounter: () => {},
  trySpendThreat: () => true,
  dropMagnet: () => {},
};

const DURATION = {
  transportCross: 6 * TICKS_PER_SECOND,
  turn: 3 * TICKS_PER_SECOND,
  commanderCharge: 3 * TICKS_PER_SECOND,
  commanderRecover: 3 * TICKS_PER_SECOND,
  line: 4 * TICKS_PER_SECOND,
  attackCadence: 5 * TICKS_PER_SECOND,
};
function playerPoint(state: StageState): SpatialPoint {
  return { x: state.player.x, z: state.player.z, alt: state.player.altitude };
}

function playerVelocity(state: StageState): SpatialVector {
  return {
    x: state.player.vx ?? Math.sin(state.player.yaw) * state.speed,
    z: state.player.vz ?? Math.cos(state.player.yaw) * state.speed,
    alt: 0,
  };
}

function playerInArena(state: StageState): boolean {
  return Math.hypot(state.player.x - state.arena.x, state.player.z - state.arena.z) <= state.arena.radius;
}

function arenaPosition(state: StageState, point: SpatialPoint): SpatialPoint {
  if (!playerInArena(state)) return point;
  const offset = { x: point.x - state.arena.x, z: point.z - state.arena.z, alt: 0 };
  const distance = Math.hypot(offset.x, offset.z);
  const limit = Math.max(0, state.arena.radius - scaleTravel(64));
  if (distance <= limit || distance === 0) return point;
  const bounded = scale3d(normalize3d(offset), limit);
  return { ...point, x: state.arena.x + bounded.x, z: state.arena.z + bounded.z };
}

function playerForward(state: StageState): SpatialVector {
  const velocity = playerVelocity(state);
  const speed = Math.hypot(velocity.x, velocity.z);
  return speed > 0.01 ? { x: velocity.x / speed, z: velocity.z / speed, alt: 0 }
    : { x: Math.sin(state.player.yaw), z: Math.cos(state.player.yaw), alt: 0 };
}

function escortPosition(state: StageState, actor: Enemy, side: number, ground: Ground): Position {
  const forward = { x: Math.sin(actor.yaw), z: Math.cos(actor.yaw), alt: 0 };
  const right = { x: Math.cos(actor.yaw), z: -Math.sin(actor.yaw), alt: 0 };
  const offset = add3d(scale3d(right, scaleTravel(29) * side), scale3d(forward, -scaleTravel(14)));
  const position = arenaPosition(state, add3d(actor, offset));
  const floor = Math.min(MAX_ALTITUDE, ground(position.x, position.z) + 22);
  return { ...position, alt: clamp(actor.alt, floor, MAX_ALTITUDE) };
}

function createEscorts(state: StageState, boss: SortieMiniboss, actor: Enemy, ground: Ground): [number, number] {
  return [-1, 1].map(side => {
    const position = escortPosition(state, actor, side, ground);
    const escort = makeEnemy(state, position.x, position.z, 2, 'interceptor');
    Object.assign(escort, position, {
      vx: actor.vx, vz: actor.vz, yaw: actor.yaw,
      shotAt: Number.MAX_SAFE_INTEGER, maneuverAt: Number.MAX_SAFE_INTEGER,
      sortieBoss: { eventId: boss.cue.id, id: boss.cue.id, startTick: boss.cue.startTick, role: 'escort' as const },
    });
    state.enemies.push(escort);
    return escort.id;
  }) as [number, number];
}

function moveEscorts(state: StageState, boss: SortieMiniboss, actor: Enemy, ground: Ground): void {
  for (const id of boss.escortIds) {
    const escort = state.enemies.find(enemy => enemy.id === id && enemy.hp > 0);
    if (!escort) continue;
    const previous = { x: escort.x, z: escort.z };
    const target = escortPosition(state, actor, id === boss.escortIds[0] ? -1 : 1, ground);
    const dx = target.x - escort.x, dz = target.z - escort.z;
    const distance = Math.hypot(dx, dz);
    const correction = Math.min(scaleTravel(65), distance * 1.4);
    const wanted = {
      x: actor.vx + (distance > 0.001 ? dx / distance * correction : 0),
      z: actor.vz + (distance > 0.001 ? dz / distance * correction : 0),
    };
    const acceleration = scaleTravel(70) * STEP;
    escort.vx += clamp(wanted.x - escort.vx, -acceleration, acceleration);
    escort.vz += clamp(wanted.z - escort.vz, -acceleration, acceleration);
    const bounded = arenaPosition(state, {
      x: escort.x + escort.vx * STEP, z: escort.z + escort.vz * STEP, alt: escort.alt,
    });
    escort.x = bounded.x;
    escort.z = bounded.z;
    escort.vx = (escort.x - previous.x) / STEP;
    escort.vz = (escort.z - previous.z) / STEP;
    const floor = Math.min(MAX_ALTITUDE, ground(escort.x, escort.z) + 22);
    const desiredAlt = clamp(state.player.altitude, floor, MAX_ALTITUDE);
    escort.alt = clamp(escort.alt + clamp(desiredAlt - escort.alt, -scaleTravel(40) * STEP, scaleTravel(40) * STEP),
      floor, MAX_ALTITUDE);
    escort.yaw = Math.atan2(state.player.x - escort.x, state.player.z - escort.z);
  }
}

export function startSortieMiniboss(state: StageState, ground: Ground, hooks: SortieBossHooks): void {
  if (!state.run) return;
  const cue = hooks.consumeMidbossCue(state);
  if (!cue || cue.kind !== 'midboss') return;
  const p = state.player;
  const forward = { x: Math.sin(p.yaw), z: Math.cos(p.yaw), alt: 0 };
  const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw), alt: 0 };
  const side: -1 | 1 = cue.id === 'armored-transport' ? -1 : 1;
  const lateral = cue.id === 'armored-transport' ? -scaleTravel(150) : scaleTravel(140);
  const ahead = cue.id === 'armored-transport' ? scaleTravel(95) : scaleTravel(120);
  const position = arenaPosition(state, add3d(playerPoint(state), add3d(scale3d(forward, ahead), scale3d(right, lateral))));
  const floor = ground(position.x, position.z);
  const actor = makeEnemy(state, position.x, position.z, 2, 'bomber');
  actor.alt = clamp(p.altitude, floor + 22, MAX_ALTITUDE);
  const carrierId = cue.id === 'armored-transport' ? 'first-evolution' : 'second-evolution';
  actor.hp = Math.round(CARRIER_TUNING[carrierId].hp * HEAT_TIERS[state.heat].armorScale);
  actor.carrier = carrierId;
  actor.sortieBoss = { eventId: cue.id, id: cue.id, startTick: cue.startTick, role: 'leader' };
  actor.shotAt = Number.MAX_SAFE_INTEGER;
  actor.maneuverAt = Number.MAX_SAFE_INTEGER;
  actor.yaw = p.yaw;
  actor.vx = actor.vz = 0;
  state.enemies.push(actor);
  const runtime: SortieMiniboss = {
    cue, actorId: actor.id, phase: cue.id === 'armored-transport' ? 'cross' : 'charge',
    phaseStartedAt: state.tick, side, lineUntil: null, nextThreatAt: cue.startTick
      + (cue.id === 'armored-transport' ? DURATION.transportCross : TICKS_PER_SECOND),
    escortIds: [0, 0], endTick: null, outcome: null,
  };
  state.sortieBoss = runtime;
  runtime.escortIds = createEscorts(state, runtime, actor, ground);
}

function desiredVelocity(state: StageState, boss: SortieMiniboss, actor: Enemy): SpatialVector {
  const base = playerVelocity(state);
  const forward = playerForward(state);
  const right = { x: forward.z, z: -forward.x, alt: 0 };
  if (boss.cue.id === 'armored-transport') {
    if (boss.phase === 'cross') return add3d(base, scale3d(right, scaleTravel(42)));
    if (boss.phase === 'turn') {
      const target = arenaPosition(state, add3d(playerPoint(state), scale3d(forward, ACE_RETURN_DISTANCE)));
      const delta = { x: target.x - actor.x, z: target.z - actor.z, alt: 0 };
      const distance = Math.hypot(delta.x, delta.z);
      const speed = Math.max(scaleTravel(120), Math.hypot(base.x, base.z) + scaleTravel(16));
      return distance > 0.001 ? scale3d(normalize3d(delta), speed) : base;
    }
    return base;
  }
  if (boss.phase === 'charge') return add3d(base, scale3d(right, -boss.side * scaleTravel(120)));
  if (boss.phase === 'recover') {
    const target = arenaPosition(state, add3d(playerPoint(state), scale3d(forward, ACE_RETURN_DISTANCE)));
    const delta = { x: target.x - actor.x, z: target.z - actor.z, alt: 0 };
    const distance = Math.hypot(delta.x, delta.z);
    return distance > 0.001 ? scale3d(normalize3d(delta), scaleTravel(120)) : { x: 0, z: 0, alt: 0 };
  }
  return base;
}

const ACE_RETURN_DISTANCE = scaleTravel(75);

function moveActor(state: StageState, boss: SortieMiniboss, actor: Enemy, ground: Ground): void {
  const wanted = desiredVelocity(state, boss, actor);
  const acceleration = scaleTravel(boss.phase === 'recover'
    || (boss.cue.id === 'armored-transport' && boss.phase === 'turn') ? 180 : 45) * STEP;
  const previous = { x: actor.x, z: actor.z };
  actor.vx += clamp(wanted.x - actor.vx, -acceleration, acceleration);
  actor.vz += clamp(wanted.z - actor.vz, -acceleration, acceleration);
  const bounded = arenaPosition(state, {
    x: actor.x + actor.vx * STEP,
    z: actor.z + actor.vz * STEP,
    alt: actor.alt,
  });
  actor.x = bounded.x;
  actor.z = bounded.z;
  const groundHeight = ground(actor.x, actor.z);
  const floor = Math.min(MAX_ALTITUDE, groundHeight + 22);
  const desiredAlt = clamp(state.player.altitude, floor, MAX_ALTITUDE);
  actor.alt = clamp(actor.alt + clamp(desiredAlt - actor.alt, -scaleTravel(40) * STEP, scaleTravel(40) * STEP),
    floor, MAX_ALTITUDE);
  const vx = actor.x - previous.x, vz = actor.z - previous.z;
  if (Math.hypot(vx, vz) > 0) actor.yaw = Math.atan2(vx, vz);
  actor.bank = clamp((actor.vx - wanted.x) / Math.max(1, scaleTravel(45)), -0.5, 0.5);
}

function enterLine(state: StageState, boss: SortieMiniboss): void {
  boss.phase = 'line';
  boss.phaseStartedAt = state.tick;
  boss.lineUntil = state.tick + DURATION.line;
}

function advancePhase(state: StageState, boss: SortieMiniboss, actor: Enemy): void {
  const elapsed = state.tick - boss.phaseStartedAt;
  if (boss.cue.id === 'armored-transport') {
    if (boss.phase === 'cross' && state.tick - boss.cue.startTick >= DURATION.transportCross) {
      boss.phase = 'turn';
      boss.phaseStartedAt = state.tick;
    } else if (boss.phase === 'turn' && elapsed >= DURATION.turn
      && distance3d(actor, playerPoint(state)) <= scaleTravel(WEAPON_RANGE)
      && Math.abs(angleTo(state.player.yaw, actor.x - state.player.x, actor.z - state.player.z)) <= TWIN_CONE
      && Math.abs(actor.alt - state.player.altitude) <= HIT_WINDOW) enterLine(state, boss);
    else if (boss.phase === 'line' && boss.lineUntil !== null && state.tick >= boss.lineUntil) {
      boss.phase = 'turn';
      boss.phaseStartedAt = state.tick;
      boss.lineUntil = null;
    }
    return;
  }
  if (boss.phase === 'charge' && elapsed >= DURATION.commanderCharge) {
    boss.phase = 'recover';
    boss.phaseStartedAt = state.tick;
  } else if (boss.phase === 'recover' && elapsed >= DURATION.commanderRecover
    && distance3d(actor, playerPoint(state)) <= WEAPON_RANGE) enterLine(state, boss);
  else if (boss.phase === 'line' && boss.lineUntil !== null && state.tick >= boss.lineUntil) {
    boss.phase = 'charge';
    boss.phaseStartedAt = state.tick;
    boss.lineUntil = null;
    boss.side = boss.side === 1 ? -1 : 1;
  }
}

const WEAPON_RANGE = 175;

function fireEscortVolley(state: StageState, boss: SortieMiniboss, actor: Enemy, hooks: SortieBossHooks,
  events?: CombatEvents): void {
  const points: 1 | 2 = boss.cue.id === 'armored-transport' ? 2 : 1;
  const escorts = boss.cue.id === 'armored-transport'
    ? boss.escortIds.map(id => state.enemies.find(enemy => enemy.id === id && enemy.hp > 0)).filter((enemy): enemy is Enemy => !!enemy)
    : [];
  const sources = boss.cue.id === 'armored-transport' ? escorts : [actor];
  if (!sources.length || state.shots.filter(shot => shot.kind === 'hostile').length + sources.length > HOSTILE_SHOT_LIMIT) return;
  const bearing = angleTo(state.player.yaw, actor.x - state.player.x, actor.z - state.player.z);
  if (!hooks.trySpendThreat(state, { tick: state.tick, source: boss.cue.threatSource, points, bearing })) return;
  for (const source of sources) {
    fireHostile(state, { x: source.x, z: source.z, alt: source.alt, kind: 'bomber' }, scaleTravel(90), 0, events);
  }
}

export function advanceSortieMiniboss(state: StageState, ground: Ground, hooks: SortieBossHooks,
  events?: CombatEvents): void {
  const boss = state.sortieBoss;
  if (!boss || boss.outcome) return;
  const actor = state.enemies.find(enemy => enemy.id === boss.actorId);
  if (!actor) return;
  advancePhase(state, boss, actor);
  moveActor(state, boss, actor, ground);
  moveEscorts(state, boss, actor, ground);
  const attackDelay = boss.cue.id === 'armored-transport' ? DURATION.transportCross : TICKS_PER_SECOND;
  if (state.tick >= boss.nextThreatAt && state.tick >= boss.cue.startTick + attackDelay) {
    const count = state.shots.filter(shot => shot.kind === 'hostile').length;
    const expectedCount = boss.cue.id === 'armored-transport' ? 2 : 1;
    fireEscortVolley(state, boss, actor, hooks, events);
    boss.nextThreatAt = state.tick + (count + expectedCount <= HOSTILE_SHOT_LIMIT
      ? DURATION.attackCadence : TICKS_PER_SECOND / 2);
  }
}

export function settleSortieMiniboss(state: StageState, actor: Enemy, hooks: SortieBossHooks,
  events?: CombatEvents): void {
  const boss = state.sortieBoss;
  if (!boss || boss.actorId !== actor.id || boss.outcome) return;
  if (actor.shotDown && actor.hp <= 0) {
    boss.outcome = 'defeated';
    boss.endTick = state.tick;
    state.sortieLullUntil = state.tick + SORTIE_REST_TICKS;
    hooks.finishMidbossEncounter(state, {
      id: boss.cue.id, endedAt: state.tick, outcome: 'defeated',
    });
    hooks.dropMagnet(state, {
      sourceEventId: actor.id,
      sourceKind: 'midboss',
      position: { x: actor.x, z: actor.z, alt: actor.alt },
    }, events);
    const escorts = new Set(boss.escortIds);
    state.enemies = state.enemies.filter(enemy => !escorts.has(enemy.id));
  } else if (state.tick >= boss.cue.startTick + boss.cue.maxDurationTicks) {
    boss.outcome = 'retreated';
    boss.endTick = state.tick;
    state.sortieLullUntil = state.tick + SORTIE_REST_TICKS;
    hooks.finishMidbossEncounter(state, {
      id: boss.cue.id, endedAt: state.tick, outcome: 'escaped',
    });
    actor.hp = 0;
    actor.shotDown = false;
    const escorts = new Set(boss.escortIds);
    state.enemies = state.enemies.filter(enemy => !escorts.has(enemy.id));
  }
}
