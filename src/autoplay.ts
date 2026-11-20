import { canManeuver, exitAltitude, maneuverAllowsControl } from './maneuvers.ts';
import { ACE_PILOT, BOT_PROFILES, type BotProfile } from './data/bot-profiles.ts';
import { REPLAY_DRAFT_PRIORITY, REPLAY_RISK_HULL } from './data/run-balance.ts';
import { EVOLUTIONS } from './data/items.ts';
import { LANDMARKS } from './reach.ts';
import { angleTo, BANDS, canDropFlare, clamp, FLAK_RADIUS, HIT_WINDOW, inBand, MAX_ALTITUDE, MINE_RADIUS,
  TICKS_PER_SECOND, VERTICAL_SPEED } from './stage-combat.ts';
import { activeAce, beaconTick, chestEvolutions, createStage, stepStage } from './stage.ts';
import type { Enemy, Ground, ManeuverKind, Position, StageInput, StageOptions, StageState } from './stage-types.ts';

type PilotMode = 'full' | 'top';
type Route = Position & { kind: 'ace' | 'enemy' | 'pickup' | 'beacon' | 'home'; flyby?: Enemy['flyby'] };
type AceTactics = Pick<BotProfile, 'aceLead' | 'aceWarningTicks'>;

function nearest<T extends Position>(items: T[], x: number, z: number): T | null {
  let best: T | null = null, range = Infinity;
  for (const item of items) {
    const distance = (item.x - x) ** 2 + (item.z - z) ** 2;
    if (distance < range) {
      best = item;
      range = distance;
    }
  }
  return best;
}

function routeFor(state: StageState, mode: PilotMode, tactics: AceTactics): Route {
  const p = state.player, ace = activeAce(state);
  // --- S7e lane ---
  if (ace?.entry) return { ...ace.entry.target, kind: 'ace' };
  if (ace) {
    const range = Math.hypot(ace.x - p.x, ace.z - p.z);
    const lead = mode === 'full' ? tactics.aceLead * ACE_PILOT.leadSeconds * Math.min(1, range / ACE_PILOT.pursuitRange) : 0;
    return { x: ace.x + ace.vx * lead, z: ace.z + ace.vz * lead, alt: ace.alt, kind: 'ace' };
  }
  if (mode === 'full' && state.run) {
    const chest = nearest(state.chests.drops, p.x, p.z);
    if (chest) return { ...chest, kind: 'pickup' };
    const carrier = nearest(state.enemies.filter(enemy => enemy.carrier && !enemy.entry && enemy.hp > 0), p.x, p.z);
    if (carrier) return { ...carrier, kind: 'enemy' };
    if (state.bills.active?.id === 'high-recovery') {
      const salvage = nearest(state.pickups.filter(pickup => pickup.alt >= (BANDS[1] + BANDS[2]) / 2), p.x, p.z);
      if (salvage) return { ...salvage, kind: 'pickup' };
    }
  }
  const pass = state.reversal;
  if (mode === 'full' && pass && state.tick < pass.until) {
    const former = nearest(state.enemies.filter(enemy => enemy.hp && inBand(enemy.alt, p.altitude) && pass.pursuers.includes(enemy.id)
      && Math.abs(angleTo(p.yaw, enemy.x - p.x, enemy.z - p.z)) < Math.PI / 6), p.x, p.z);
    if (former) return { ...former, kind: 'enemy' };
  }
  if (mode === 'full' && !state.boss && state.tick >= beaconTick(state)
    && (state.run || state.level === 3 || state.tick >= 99 * TICKS_PER_SECOND)
    && Math.hypot(LANDMARKS.atoll.x - p.x, LANDMARKS.atoll.z - p.z) > 145) {
    return { ...LANDMARKS.atoll, kind: 'beacon' };
  }
  const enemy = nearest(state.enemies.filter(enemy => !enemy.entry), p.x, p.z);
  const pickup = nearest(state.pickups, p.x, p.z);
  if (pickup) {
    const needsXp = mode === 'full' && (!!state.run || state.level < 3);
    const distantEnemy = !enemy || Math.hypot(enemy.x - p.x, enemy.z - p.z) > 120;
    if (Math.hypot(pickup.x - p.x, pickup.z - p.z) <= (needsXp && distantEnemy ? 260 : 150)) {
      return { ...pickup, kind: 'pickup' };
    }
  }
  if (enemy) return { ...enemy, kind: 'enemy' };
  return { x: state.arena.x, z: state.arena.z, alt: BANDS[1], kind: 'home' };
}

function dodgeClimb(state: StageState, mode: PilotMode, climb: number, ground?: Ground): number | undefined {
  const p = state.player;
  const ownX = Math.sin(p.yaw) * state.speed, ownZ = Math.cos(p.yaw) * state.speed;
  const avoid = (threat: Position & { vx?: number; vz?: number }, radius: number): number | undefined => {
    const x = threat.x - p.x, z = threat.z - p.z;
    const vx = (threat.vx ?? 0) - ownX, vz = (threat.vz ?? 0) - ownZ;
    const vv = vx * vx + vz * vz;
    const closest = vv > 0 ? clamp(-(x * vx + z * vz) / vv, 0, 0.6) : 0;
    if (Math.hypot(x + vx * closest, z + vz * closest) >= radius) return;
    if (mode === 'top') return p.altitude >= 120 ? -1 : 1;
    const floor = ground ? ground(p.x + ownX * closest, p.z + ownZ * closest) + 22 : 55;
    const approach = Math.max(floor, p.altitude + climb * VERTICAL_SPEED * Math.max(closest, 0.2));
    if (Math.min(p.altitude, approach) > threat.alt + 13 || Math.max(p.altitude, approach) < threat.alt - 13) return;
    const up = floor > threat.alt - 12 || threat.alt < 86 || (threat.alt <= 150 && p.altitude >= threat.alt);
    const safe = threat.alt + (up ? 12 : -12);
    return up ? clamp((safe - p.altitude) / 2, 0, 1) : clamp((safe - p.altitude) / 2, -1, 0);
  };
  for (const shot of state.shots) {
    if (shot.kind === 'hostile') {
      const dodge = avoid(shot, mode === 'full' ? 11 : 8);
      if (dodge !== undefined) return dodge;
    }
  }
  if (mode === 'full') {
    for (const mine of state.enemyMines) {
      const dodge = avoid(mine, MINE_RADIUS + 5);
      if (dodge !== undefined) return dodge;
    }
    for (const effect of state.effects) {
      if (effect.kind !== 'flak') continue;
      const dodge = avoid(effect, FLAK_RADIUS + 4);
      if (dodge !== undefined) return dodge;
    }
    for (const enemy of state.enemies) {
      if (enemy.tell?.kind === 'flak' && enemy.tell.until - state.tick <= 45) {
        const dodge = avoid(enemy.tell, FLAK_RADIUS + 5);
        if (dodge !== undefined) return dodge;
      }
      if (enemy.kind !== 'gnat' && !enemy.entry && state.tick > state.bodyGraceUntil) {
        const dodge = avoid(enemy, 15);
        if (dodge !== undefined) return dodge;
      }
    }
  }
}

function rearManeuver(state: StageState, target: Route, angle: number, range: number): ManeuverKind | undefined {
  if ((target.kind !== 'enemy' && target.kind !== 'ace') || Math.abs(angle) < Math.PI * 155 / 180) return;
  const { altitude } = state.player;
  if (inBand(altitude, target.alt)) {
    if (range >= 65 && range <= 115 && canManeuver(state, 'j-turn')) return 'j-turn';
  }
  if (range < 65 || range > 115) return;
  const kind = target.alt > altitude ? 'immelmann' : 'split-s';
  if (canManeuver(state, kind) && inBand(exitAltitude(altitude, kind), target.alt)) return kind;
}

function hasRearBombTarget(state: StageState): boolean {
  if (!state.bombs || state.tick < state.bombReadyAt) return false;
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  return state.enemies.some(enemy => {
    const x = enemy.x - p.x, z = enemy.z - p.z;
    if (x * fx + z * fz >= 0) return false;
    const dx = x + 14 * fx, dz = z + 14 * fz;
    const vv = enemy.vx ** 2 + enemy.vz ** 2;
    const time = vv > 0 ? clamp(-(dx * enemy.vx + dz * enemy.vz) / vv, 0, 2) : 0;
    const altitude = p.altitude - Math.max(0, time - 0.45) * 24;
    return inBand(altitude, enemy.alt) && Math.hypot(dx + time * enemy.vx, dz + time * enemy.vz) <= 16;
  });
}

function hasRearFlareTarget(state: StageState): boolean {
  if (!canDropFlare(state, state.tick + 1)) return false;
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  return state.enemies.some(enemy => {
    if (!enemy.hp || (enemy.burnUntil ?? 0) > state.tick) return false;
    const x = enemy.x - p.x, z = enemy.z - p.z;
    const aft = -x * fx - z * fz, side = x * fz - z * fx;
    const drop = p.altitude - enemy.alt;
    return aft >= 9 && aft <= 48 && Math.abs(side) <= 6 + aft * 0.24 && drop >= -3 && drop <= 16;
  });
}

// --- S7e lane ---
function dodgeAceWarning(state: StageState, tactics: AceTactics): number | undefined {
  const ace = state.boss, p = state.player, tell = ace?.tell;
  if (!ace?.tail || !tell || tell.kind === 'roll' || tell.until - state.tick > tactics.aceWarningTicks
    || !inBand(p.altitude, tell.alt, ACE_PILOT.warningMargin)) return;
  const safe = tell.alt + (p.altitude <= tell.alt ? -ACE_PILOT.warningClimb : ACE_PILOT.warningClimb);
  return clamp((safe - p.altitude) / 2, -1, 1);
}

export function autopilotInput(state: StageState, mode: PilotMode = 'full', ground?: Ground,
  tactics: AceTactics = BOT_PROFILES.skilled): StageInput {
  if (state.phase === 'chest') {
    return { chestPick: state.chestReveal ? 'continue' : chestEvolutions(state)[0] ?? 'open' };
  }
  if (state.phase === 'draft') {
    if (!state.run) return { pick: state.draft[0] };
    const safe = state.run.cards.filter(card => card.variant !== 'risky' || state.hull > REPLAY_RISK_HULL);
    const evolutionGoals = safe.filter(card => card.id === 'twin'
      || card.id === EVOLUTIONS.twin.buff && !state.run!.buffLevels[EVOLUTIONS.twin.buff]);
    const preferred = state.hull > REPLAY_RISK_HULL && !state.run.evolutions.twin && evolutionGoals[0]?.id
      || REPLAY_DRAFT_PRIORITY.find(id => safe.some(card => card.id === id)
      && (id !== 'repair' || state.hull <= state.maxHull - 2));
    return { pick: preferred ?? safe.find(card => card.id !== 'repair' && card.id !== 'credits')?.id
      ?? safe[0]?.id ?? state.draft[0] };
  }
  if (state.phase !== 'playing' || state.paused) return {};
  const flare = mode === 'full' && hasRearFlareTarget(state);
  if (!maneuverAllowsControl(state.maneuver)) return { flare };
  const p = state.player, target = routeFor(state, mode, tactics);
  const dx = target.x - p.x, dz = target.z - p.z;
  const range = Math.hypot(dx, dz), angle = angleTo(p.yaw, dx, dz);
  const delta = target.alt - p.altitude;
  const withinCoarse = Math.abs(delta) <= HIT_WINDOW;
  const climb = mode === 'top' ? (withinCoarse ? 0 : Math.sign(delta)) : clamp(delta / 5, -1, 1);
  const extending = target.kind === 'ace' && range < ACE_PILOT.extensionRange && Math.abs(angle) > ACE_PILOT.extensionAngle;
  const acceptingPass = mode === 'full' && !!target.flyby && !state.boundaryWarning && Math.abs(angle) > Math.PI / 6;
  const turn = extending || acceptingPass ? 0 : target.kind === 'home' && range < 34 ? 0.65 : clamp(angle * 2.35, -1, 1);

  let view: StageState['view'] = 'overhead';
  if (mode === 'full' && target.kind !== 'home') {
    if (Math.abs(delta) > 12 || acceptingPass) view = 'chase';
    else if (target.kind === 'ace' || (target.kind === 'enemy' && Math.abs(angle) < 0.35 && range < 115)) view = 'cockpit';
  }
  const dodge = state.invulnerability === 0
    ? dodgeClimb(state, mode, climb, ground) ?? (mode === 'full' ? dodgeAceWarning(state, tactics) : undefined) : undefined;
  const maneuver = mode === 'full' && !acceptingPass && dodge === undefined ? rearManeuver(state, target, angle, range) : undefined;
  const extend = mode === 'full' && !acceptingPass && target.kind === 'enemy' && Math.abs(angle) > Math.PI * 0.86
    && range > 24 && range < 65 && !state.boundaryWarning && canManeuver(state, 'immelmann');
  const boost = !acceptingPass && (extend || (range > 155 && Math.abs(angle) < 0.2 && (!!state.run || state.level < 3 || target.kind === 'beacon')));
  return {
    turn: extend ? 0 : turn, climb: dodge ?? (extend ? 0 : climb), boost, maneuver,
    toggleView: state.view !== view,
    bomb: mode === 'full' && !acceptingPass && !maneuver && hasRearBombTarget(state),
    flare: flare && !maneuver && !acceptingPass,
  };
}

function holdAboveTraffic(state: StageState): StageInput {
  const p = state.player, a = state.arena;
  const dx = a.x - p.x, dz = a.z - p.z;
  const turn = Math.hypot(dx, dz) > a.radius - 80 ? clamp(angleTo(p.yaw, dx, dz) * 2.35, -1, 1) : 0.58;
  return { turn, climb: clamp((MAX_ALTITUDE - p.altitude) / 4, 0, 1) };
}

export function seekStage(options: StageOptions, ground: Ground): StageState {
  if (options.time === null) return createStage(options, ground);
  const target = Math.round(options.time * TICKS_PER_SECOND);
  const initial = createStage(options, ground);
  const startOptions = target < initial.tick ? { ...options, fixture: null } : options;

  // Preserve late time seeks even when the replay can defeat the Ace early.
  const replay = (flight: StageState, conservative: boolean): StageState => {
    while (flight.tick < target && (flight.phase === 'playing' || flight.phase === 'draft' || flight.phase === 'chest')) {
      const holding = conservative || !!activeAce(flight);
      stepStage(flight, flight.phase === 'playing' && holding ? holdAboveTraffic(flight) : autopilotInput(flight, 'full', ground), ground);
    }
    return flight;
  };
  let flight = replay(startOptions === options ? initial : createStage(startOptions, ground), false);
  if (flight.tick < target) flight = replay(createStage(startOptions, ground), true);
  if (options.view) flight.view = options.view;
  flight.wipe = flight.viewTag = 0;
  return flight;
}
