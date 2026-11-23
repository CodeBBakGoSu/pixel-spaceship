import { canManeuver, exitAltitude, maneuverAllowsControl } from './maneuvers.ts';
import { SKIM, skimAltitude, SKIM_BAND } from './bands.ts';
import { ACE_PILOT, BOT_POLICY, BOT_PROFILES, PILOT_ROUTE, type BotProfile } from './data/bot-profiles.ts';
import { FLIGHT_MODEL } from './data/flight-model.ts';
import { REAR_ORDNANCE, REPLAY_DRAFT_PRIORITY, REPLAY_RISK_HULL } from './data/run-balance.ts';
import { EVOLUTIONS } from './data/items.ts';
import { scaleTravel } from './data/speed.ts';
import { FLY_IN_WORLD, WORLD_TERRAIN } from './data/world.ts';
import { advancePitch, CRUISE_SPEED, pitchLimitScale, pitchSpeedFactor, pitchVerticalSpeed } from './flight.ts';
import { buffTuning } from './loadout.ts';
import { LANDMARKS } from './reach.ts';
import { angleTo, BANDS, BODY_RADIUS, canDropFlare, clamp, FLAK_RADIUS, HIT_WINDOW, HOSTILE_HIT_RADIUS, inBand, MAX_ALTITUDE, MINE_RADIUS,
  MIN_ALTITUDE, STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import { activeAce, beaconTick, chestEvolutions, createStage, stepStage } from './stage.ts';
import type { Enemy, Ground, ManeuverKind, Position, StageInput, StageOptions, StageState } from './stage-types.ts';

type PilotMode = 'full' | 'top';
type Route = Position & { kind: 'ace' | 'enemy' | 'pickup' | 'beacon' | 'home'; flyby?: Enemy['flyby']; skim?: true };
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

function routeFor(state: StageState, mode: PilotMode, tactics: AceTactics, skimUse: boolean): Route {
  const p = state.player, ace = activeAce(state);
  if (ace) {
    const skim = ace.band === SKIM_BAND ? true : undefined;
    if (ace.entry) return { ...ace.entry.target, kind: 'ace', skim };
    const range = Math.hypot(ace.x - p.x, ace.z - p.z);
    const lead = mode === 'full' ? tactics.aceLead * ACE_PILOT.leadSeconds * Math.min(1, range / ACE_PILOT.pursuitRange) : 0;
    return { x: ace.x + ace.vx * lead, z: ace.z + ace.vz * lead, alt: ace.alt, kind: 'ace', skim };
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
  const rally = state.rally ?? LANDMARKS.atoll;
  if (mode === 'full' && !state.boss && state.tick >= beaconTick(state)
    && (state.run || state.level === 3 || state.tick >= 99 * TICKS_PER_SECOND)
    && Math.hypot(rally.x - p.x, rally.z - p.z) > PILOT_ROUTE.rallyRange) {
    return { ...rally, kind: 'beacon' };
  }
  const enemy = nearest(state.enemies.filter(enemy => !enemy.entry && (skimUse || !enemy.skim)), p.x, p.z);
  const pickup = nearest(state.pickups, p.x, p.z);
  if (pickup) {
    const needsXp = mode === 'full' && (!!state.run || state.level < 3);
    const distantEnemy = !enemy || Math.hypot(enemy.x - p.x, enemy.z - p.z) > PILOT_ROUTE.clearLaneRange;
    if (Math.hypot(pickup.x - p.x, pickup.z - p.z) <= (needsXp && distantEnemy ? BOT_POLICY.salvageSightRange : PILOT_ROUTE.pickupRange)) {
      return { ...pickup, kind: 'pickup' };
    }
  }
  if (enemy) return { ...enemy, kind: 'enemy' };
  if (Math.hypot(p.x - state.arena.x, p.z - state.arena.z) > state.arena.radius) {
    return { x: p.x, z: p.z, alt: BANDS[1], kind: 'home' };
  }
  return { x: state.arena.x, z: state.arena.z, alt: BANDS[1], kind: 'home' };
}

function crossesThreatBand(state: StageState, threatAltitude: number, climb: number, seconds: number,
  terrain: number, floor: number, agility: number): boolean {
  const p = state.player;
  let altitude = p.altitude, pitch = p.pitch;
  const side = Math.sign(threatAltitude - altitude);
  const reaches = (height: number) => (threatAltitude - height) * side <= 13;
  if (reaches(altitude)) return true;
  const skim = skimAltitude(terrain);
  if (p.skim && climb <= SKIM.inputThreshold) return reaches(skim);
  // Hold the observed throttle and bank over the short planar intercept. A reversal can
  // carry the ship into a threat band before it comes back to its starting altitude.
  const thrust = (state.speed || CRUISE_SPEED) / pitchSpeedFactor(pitch);
  const ticks = Math.ceil(seconds * TICKS_PER_SECOND);
  for (let tick = 0; tick < ticks; tick++) {
    pitch = advancePitch(pitch, climb * pitchLimitScale(climb, altitude, floor, MAX_ALTITUDE), STEP);
    const speed = thrust * pitchSpeedFactor(pitch);
    const rise = pitchVerticalSpeed(speed, pitch, agility) * pitchLimitScale(pitch, altitude, floor, MAX_ALTITUDE);
    altitude = clamp(altitude + rise * STEP, floor, MAX_ALTITUDE);
    if (climb < -SKIM.inputThreshold && altitude <= skim) return reaches(skim);
    if (reaches(altitude)) return true;
  }
  return false;
}

function dodgeClimb(state: StageState, mode: PilotMode, climb: number, agility: number, ground?: Ground): number | undefined {
  const p = state.player;
  const ownX = Math.sin(p.yaw) * state.speed, ownZ = Math.cos(p.yaw) * state.speed;
  const avoid = (threat: Position & { vx?: number; vz?: number }, radius: number): number | undefined => {
    const x = threat.x - p.x, z = threat.z - p.z;
    const vx = (threat.vx ?? 0) - ownX, vz = (threat.vz ?? 0) - ownZ;
    const vv = vx * vx + vz * vz;
    const closest = vv > 0 ? clamp(-(x * vx + z * vz) / vv, 0, BOT_POLICY.lookaheadMax) : 0;
    if (Math.hypot(x + vx * closest, z + vz * closest) >= radius) return;
    if (mode === 'top') return p.altitude >= BANDS[1] + 10 ? -1 : 1;
    const terrain = ground?.(p.x + ownX * closest, p.z + ownZ * closest) ?? WORLD_TERRAIN.seaLevel;
    const floor = Math.max(MIN_ALTITUDE, terrain + FLY_IN_WORLD.clearance);
    if (!crossesThreatBand(state, threat.alt, climb, Math.max(closest, 0.2), terrain, floor, agility)) return;
    const up = floor > threat.alt - 12 || threat.alt < 86 || (threat.alt <= MAX_ALTITUDE - 15 && p.altitude >= threat.alt);
    const safe = threat.alt + (up ? 12 : -12);
    return up ? clamp((safe - p.altitude) / 2, 0, 1) : clamp((safe - p.altitude) / 2, -1, 0);
  };
  for (const shot of state.shots) {
    if (shot.kind === 'hostile') {
      const dodge = avoid(shot, HOSTILE_HIT_RADIUS + PILOT_ROUTE.bulletMargin[mode]);
      if (dodge !== undefined) return dodge;
    }
  }
  if (mode === 'full') {
    for (const mine of state.enemyMines) {
      const dodge = avoid(mine, MINE_RADIUS + PILOT_ROUTE.mineMargin);
      if (dodge !== undefined) return dodge;
    }
    for (const effect of state.effects) {
      if (effect.kind !== 'flak') continue;
      const dodge = avoid(effect, FLAK_RADIUS + PILOT_ROUTE.flakMargin);
      if (dodge !== undefined) return dodge;
    }
    for (const enemy of state.enemies) {
      if (enemy.tell?.kind === 'flak' && enemy.tell.until - state.tick <= 45) {
        const dodge = avoid(enemy.tell, FLAK_RADIUS + PILOT_ROUTE.mineMargin);
        if (dodge !== undefined) return dodge;
      }
      if (enemy.kind !== 'gnat' && !enemy.entry && state.tick > state.bodyGraceUntil) {
        const dodge = avoid(enemy, BODY_RADIUS + PILOT_ROUTE.bodyMargin);
        if (dodge !== undefined) return dodge;
      }
    }
  }
}

function rearManeuver(state: StageState, target: Route, angle: number, range: number): ManeuverKind | undefined {
  if ((target.kind !== 'enemy' && target.kind !== 'ace') || Math.abs(angle) < Math.PI * 155 / 180) return;
  const { altitude } = state.player;
  if (range < PILOT_ROUTE.reversalMinRange || range > PILOT_ROUTE.reversalMaxRange) return;
  if (inBand(altitude, target.alt)) {
    if (canManeuver(state, 'j-turn')) return 'j-turn';
  }
  const kind = target.alt > altitude ? 'immelmann' : 'split-s';
  if (canManeuver(state, kind) && inBand(exitAltitude(altitude, kind), target.alt)) return kind;
}

function hasRearBombTarget(state: StageState): boolean {
  if (!state.bombs || state.tick < state.bombReadyAt) return false;
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  return state.enemies.some(enemy => {
    if (enemy.entry || !enemy.hp) return false;
    const x = enemy.x - p.x, z = enemy.z - p.z;
    if (x * fx + z * fz >= 0) return false;
    const dx = x + scaleTravel(14) * fx, dz = z + scaleTravel(14) * fz;
    const vv = enemy.vx ** 2 + enemy.vz ** 2;
    const time = vv > 0 ? clamp(-(dx * enemy.vx + dz * enemy.vz) / vv, 0, 2) : 0;
    const altitude = p.altitude - Math.max(0, time - 0.45) * 24;
    return inBand(altitude, enemy.alt) && Math.hypot(dx + time * enemy.vx, dz + time * enemy.vz) <= REAR_ORDNANCE.bomb.proximity;
  });
}

function hasRearFlareTarget(state: StageState): boolean {
  if (!canDropFlare(state, state.tick + 1)) return false;
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  return state.enemies.some(enemy => {
    if (enemy.entry || !enemy.hp || (enemy.burnUntil ?? 0) > state.tick) return false;
    const x = enemy.x - p.x, z = enemy.z - p.z;
    const aft = -x * fx - z * fz, side = x * fz - z * fx;
    const drop = p.altitude - enemy.alt;
    return aft >= scaleTravel(9) && aft <= scaleTravel(48) && Math.abs(side) <= scaleTravel(6) + aft * 0.24 && drop >= -3 && drop <= 16;
  });
}

function dodgeAceWarning(state: StageState, tactics: AceTactics): number | undefined {
  const ace = state.boss, p = state.player, tell = ace?.tell;
  if (!ace?.tail || !tell || tell.kind === 'roll' || tell.until - state.tick > tactics.aceWarningTicks
    || !inBand(p.altitude, tell.alt, ACE_PILOT.warningMargin)) return;
  const up = p.skim || p.altitude > tell.alt;
  const safe = tell.alt + (up ? ACE_PILOT.warningClimb : -ACE_PILOT.warningClimb);
  return clamp((safe - p.altitude) / 2, -1, 1);
}

export function autopilotInput(state: StageState, mode: PilotMode = 'full', ground?: Ground,
  tactics: AceTactics = BOT_PROFILES.skilled, skimUse = mode === 'full'): StageInput {
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
  const p = state.player, target = routeFor(state, mode, tactics, skimUse);
  const dx = target.x - p.x, dz = target.z - p.z;
  const range = Math.hypot(dx, dz), angle = angleTo(p.yaw, dx, dz);
  const delta = target.alt - p.altitude;
  const withinCoarse = Math.abs(delta) <= HIT_WINDOW;
  const localSkim = skimAltitude(ground?.(p.x, p.z));
  const approachSkim = skimUse && target.skim && range < PILOT_ROUTE.skimApproachRange;
  const agility = buffTuning(state, 'vector-thrusters')?.agilityScale ?? 1;
  // Allow one pitch-response time constant of travel while leveling into the target band.
  const levelingTravel = pitchVerticalSpeed(state.speed, p.pitch, agility) / FLIGHT_MODEL.pitchResponse;
  let climb = mode === 'top' ? (withinCoarse ? 0 : Math.sign(delta)) : clamp((delta - levelingTravel) / 5, -1, 1);
  if (approachSkim) climb = p.skim ? 0 : -1;
  else if (p.skim && target.alt > localSkim) climb = Math.max(0.25, climb);
  const extending = target.kind === 'ace' && range < ACE_PILOT.extensionRange && Math.abs(angle) > ACE_PILOT.extensionAngle;
  const acceptingPass = mode === 'full' && !!target.flyby && !state.boundaryWarning && Math.abs(angle) > Math.PI / 6;
  const turn = extending || acceptingPass ? 0
    : target.kind === 'home' && range < PILOT_ROUTE.homeTurnRange ? 0.65 : clamp(angle * BOT_POLICY.turnGain, -1, 1);

  let view: StageState['view'] = 'overhead';
  if (mode === 'full' && target.kind !== 'home') {
    if (Math.abs(delta) > 12 || acceptingPass) view = 'chase';
    else if (target.kind === 'ace' || (target.kind === 'enemy' && Math.abs(angle) < 0.35 && range < PILOT_ROUTE.cockpitRange)) view = 'cockpit';
  }
  const dodge = state.invulnerability === 0
    ? dodgeClimb(state, mode, climb, agility, ground) ?? (mode === 'full' ? dodgeAceWarning(state, tactics) : undefined) : undefined;
  const maneuver = mode === 'full' && !approachSkim && !acceptingPass && dodge === undefined ? rearManeuver(state, target, angle, range) : undefined;
  const extend = mode === 'full' && !acceptingPass && target.kind === 'enemy' && Math.abs(angle) > Math.PI * 0.86
    && range > PILOT_ROUTE.extensionMinRange && range < PILOT_ROUTE.reversalMinRange && !state.boundaryWarning && canManeuver(state, 'immelmann');
  const boost = !acceptingPass && (extend || (range > PILOT_ROUTE.boostRange && Math.abs(angle) < 0.2 && (!!state.run || state.level < 3 || target.kind === 'beacon')));
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
  const turn = Math.hypot(dx, dz) > a.radius - PILOT_ROUTE.patrolMargin ? clamp(angleTo(p.yaw, dx, dz) * BOT_POLICY.turnGain, -1, 1) : 0.58;
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
