import { ACE, ACE_PHASES } from './data/ace.ts';
import { adjacentBand, bandAltitude, bandDistance, fixedBand, playerBand, SKIM, SKIM_BAND, type FlightBand } from './bands.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { ROLLS } from './data/roll.ts';
import { WORLD_SITES, WORLD_TERRAIN } from './data/world.ts';
import { ENEMY_KINDS } from './enemy-kinds.ts';
import { advanceBank, advanceBankDrive, advanceBankDrop, bankThrustFactor, bankYawRate, BOOST_SPEED, CRUISE_SPEED } from './flight.ts';
import { planFlyIn, sampleFlyIn } from './fly-in.ts';
import type { CombatEvents } from './hostile-events.ts';
import { findRally } from './reach.ts';
import { rollAltitude, rollLateralStep } from './roll.ts';
import { enemyLimit } from './spawn-director.ts';
import { angleTo, clamp, fireAceSalvo, HIT_WINDOW, impactTime, inBand, STEP, VERTICAL_SPEED } from './stage-combat.ts';
import { makeEnemy, spawnEscortGnats } from './stage-enemies.ts';
import { random, rngStream } from './stage-random.ts';
import { TICKS_PER_SECOND } from './simulation-time.ts';
import { HOSTILE_BOLT_LIFE } from './data/hostile-fire.ts';
import { THREAT_BUDGET, trySpendThreat } from './threat-budget.ts';
import type { Ace, AceTell, Ground, Position, StageState } from './stage-types.ts';
import type { SwarmObserver } from './swarm.ts';

function flightAltitude(band: FlightBand, floor: number): number {
  return band === SKIM_BAND ? bandAltitude(band, floor) : Math.max(bandAltitude(band, floor), floor + ACE.flight.clearance);
}

export function makeAce(state: StageState, x: number, z: number, ground?: Ground): Ace {
  const rng = rngStream(state.seed, 'ace');
  const side = random(rng) < 0.5 ? -1 : 1;
  const band = playerBand(state.player);
  const alt = flightAltitude(band, ground?.(x, z) ?? WORLD_TERRAIN.seaLevel);
  const armor = state.run && HEAT_TIERS[state.heat].extraAceArmor ? ACE.hull.heatArmorScale : 1;
  const hp = Math.round((state.run ? ACE.hull.survivors : ACE.hull.legacy) * armor);
  return {
    id: ++state.nextId, kind: 'ace', x, z, alt, yaw: Math.atan2(state.player.x - x, state.player.z - z),
    vx: 0, vz: 0, bank: 0, bankDrive: 0, bankDrop: 0, pitch: 0, hp, maxHp: hp, hits: 0, hitUntil: 0,
    phase: 1, band, bandAt: state.tick + ACE_PHASES[1].bandTicks, bandSide: side, side, boosting: false,
    tail: false, tailReadyAt: state.tick, breakUntil: 0, tell: null, attacks: 0,
    attackAt: state.tick + ACE.attack.startDelay, roll: null, rollReadyAt: state.tick + ACE.attack.startDelay,
    defeatedAt: null, crashed: false,
  };
}

export function deployAce(state: StageState, ground: Ground, existing?: Ace): Ace {
  const p = state.player, rally = state.rally;
  state.rally = rally && Math.hypot(rally.x - p.x, rally.z - p.z) <= WORLD_SITES.rallyNear ? rally : findRally(state, ground);
  const { x, z } = state.rally;
  const ace = existing ?? makeAce(state, x, z, ground);
  const alt = flightAltitude(ace.band, ground(x, z));
  ace.entry = planFlyIn(state, p, { x, z, alt }, { ...ACE.entry, exitSpeed: CRUISE_SPEED, clearance: ACE.flight.clearance });
  Object.assign(ace, sampleFlyIn(ace.entry, state.tick, ground));
  return ace;
}

function nextBand(ace: Ace, state: StageState): void {
  const wanted = playerBand(state.player);
  if (wanted !== ace.band) {
    const higher = adjacentBand(ace.band, 1);
    ace.band = higher !== null && bandDistance(higher, wanted) < bandDistance(ace.band, wanted)
      ? higher : adjacentBand(ace.band, -1) ?? ace.band;
  } else if (!ace.tail) {
    const next = adjacentBand(ace.band, ace.bandSide);
    if (next === null) ace.bandSide = ace.bandSide === 1 ? -1 : 1;
    ace.band = next ?? adjacentBand(ace.band, ace.bandSide) ?? ace.band;
  }
  ace.bandAt = state.tick + ACE_PHASES[ace.phase].bandTicks;
}

function callCover(state: StageState, ace: Ace, ground: Ground, events?: CombatEvents, observe?: SwarmObserver): void {
  const fx = Math.sin(ace.yaw), fz = Math.cos(ace.yaw);
  const { distance, side } = ACE.cover;
  const regulars = state.enemies.filter(enemy => enemy.kind !== 'gnat' && enemy.hp > 0);
  const band = fixedBand(ace.alt);
  const escorts = regulars.filter(enemy => enemy.kind === 'interceptor').length;
  for (let i = 0; i < 2 && regulars.length + i < enemyLimit(state) && escorts + i < ENEMY_KINDS.interceptor.cap; i++) {
    const lateral = i === 0 ? -side : side;
    const position = { x: ace.x - fx * distance + fz * lateral, z: ace.z - fz * distance - fx * lateral };
    const enemy = makeEnemy(state, position.x, position.z, band, 'interceptor');
    enemy.alt = Math.max(enemy.alt, ground(enemy.x, enemy.z) + ACE.flight.clearance);
    enemy.yaw = ace.yaw;
    enemy.course = {
      target: { x: state.player.x, z: state.player.z },
      speed: ENEMY_KINDS.interceptor.speed, until: state.tick + ACE.cover.formationTicks,
    };
    state.enemies.push(enemy);
  }
  spawnEscortGnats(state, { x: ace.x, z: ace.z, alt: ace.alt, band }, ground, ACE.cover.gnats, observe);
  events?.tell?.('carrier', ace.x, ace.z, ace.alt);
}

function updatePhase(state: StageState, ace: Ace, ground: Ground, events?: CombatEvents, observe?: SwarmObserver): void {
  const health = ace.hp / ace.maxHp;
  const phase = health <= ACE.phaseHealth.desperate ? 3 : health <= ACE.phaseHealth.cover ? 2 : 1;
  if (phase === ace.phase) return;
  if (ace.phase === 1 && phase >= 2 && state.run) callCover(state, ace, ground, events, observe);
  ace.phase = phase;
  const tuning = ACE_PHASES[phase];
  ace.bandAt = Math.min(ace.bandAt, state.tick + ACE.flight.bandStepDelay);
  ace.attackAt = Math.min(ace.attackAt, state.tick + tuning.fireTicks);
  ace.rollReadyAt = Math.min(ace.rollReadyAt, state.tick + tuning.rollTicks);
}

function markTail(state: StageState, ace: Ace, range: number, forward: number, heading: number, events?: CombatEvents): void {
  const { tailCos, tailRange, warningCooldown } = ACE.flight;
  const tailing = range <= tailRange && -forward >= range * tailCos && Math.abs(heading) < ACE.attack.cone
    && inBand(ace.alt, state.player.altitude, ACE.attack.bandWindow);
  if (tailing && !ace.tail && state.tick >= ace.tailReadyAt) {
    ace.tailReadyAt = state.tick + warningCooldown;
    events?.tell?.('tail', ace.x, ace.z, ace.alt);
  }
  ace.tail = tailing;
}

function updateFlight(state: StageState, ace: Ace, ground: Ground): void {
  const { player: p, tick } = state;
  const tuning = ACE_PHASES[ace.phase], data = ACE.flight;
  const dx = p.x - ace.x, dz = p.z - ace.z, range = Math.hypot(dx, dz);
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const forward = -(dx * fx + dz * fz);
  const targetLead = data.interceptSeconds;
  const targetX = p.x + (p.vx ?? 0) * targetLead, targetZ = p.z + (p.vz ?? 0) * targetLead;

  if (!ace.tell && !ace.roll && range < data.closeRange && tick >= ace.breakUntil) ace.breakUntil = tick + data.breakTicks;
  const extending = tick < ace.breakUntil;
  const towardTail = !ace.tell && forward > 0 && range > data.tailDistance;
  const aft = towardTail ? data.tailDistance : 0;
  const side = towardTail ? ace.side * data.tailDistance * 0.55 : 0;
  const moveX = targetX - fx * aft + fz * side - ace.x, moveZ = targetZ - fz * aft - fx * side - ace.z;
  const course = extending ? data.breakTurn * ace.side : angleTo(ace.yaw, moveX, moveZ);
  const turn = ace.roll ? 0 : clamp(course * data.turnGain, -1, 1);
  ace.boosting = !ace.roll && tuning.afterburner && (extending || range > ACE.attack.range) && Math.abs(course) < ACE.attack.cone;
  ace.bankDrive = advanceBankDrive(ace.bankDrive, turn, STEP);
  ace.bank = advanceBank(ace.bank, turn, STEP, ace.bankDrive);
  ace.yaw += bankYawRate(ace.bank, turn, ace.boosting) * STEP;
  const thrust = (ace.boosting ? BOOST_SPEED : CRUISE_SPEED) * tuning.speedScale;
  const speed = thrust * bankThrustFactor(ace.bank, turn, data.deepTurnDrag);
  const sin = Math.sin(ace.yaw), cos = Math.cos(ace.yaw);
  const lateral = ace.roll ? rollLateralStep(ace.roll) : 0;
  const x = ace.x, z = ace.z;
  ace.x += sin * speed * STEP + cos * lateral;
  ace.z += cos * speed * STEP - sin * lateral;
  ace.vx = (ace.x - x) / STEP;
  ace.vz = (ace.z - z) / STEP;

  const groundHeight = ground(ace.x, ace.z);
  const lockedAltitude = ace.tell && ace.tell.kind !== 'roll' ? ace.tell.alt + ace.bankDrop : null;
  const desired = lockedAltitude ?? flightAltitude(ace.band, groundHeight);
  const rate = VERTICAL_SPEED * data.verticalScale;
  const change = clamp(desired - ace.alt - ace.bankDrop, -rate * STEP, rate * STEP);
  ace.pitch = ace.roll ? 0 : change / (rate * STEP) * data.pitchScale;
  if (ace.band === SKIM_BAND && inBand(ace.alt, bandAltitude(SKIM_BAND, ground(x, z)), SKIM.maxClearance - SKIM.clearance)) {
    const rollLift = ace.roll ? rollAltitude(ace.roll) - ace.roll.altitude : 0;
    ace.alt = clamp(desired + rollLift, groundHeight + SKIM.minClearance, groundHeight + SKIM.maxClearance);
    ace.bankDrop = 0;
    return;
  }
  const floor = groundHeight + (ace.band === SKIM_BAND ? SKIM.minClearance : data.clearance);
  const level = ace.alt + ace.bankDrop + change;
  const drop = ace.roll ? 0 : advanceBankDrop(ace.bankDrop, ace.bank, STEP);
  ace.alt = Math.max(floor, ace.roll ? rollAltitude(ace.roll) : level - drop);
  ace.bankDrop = ace.roll ? 0 : clamp(level - ace.alt, 0, drop);
}

function incomingFire(state: StageState, ace: Ace): boolean {
  const radius = ACE.hitRadius + ACE.roll.threatMargin;
  for (const shot of state.shots) {
    if (shot.kind === 'hostile' || !inBand(shot.alt, ace.alt, HIT_WINDOW)) continue;
    if (impactTime(shot, shot.vx - ace.vx, shot.vz - ace.vz, ace, radius, 0, ACE.roll.threatSeconds) < Infinity) return true;
  }
  return false;
}

export function setAceTell(state: StageState, ace: Ace, kind: AceTell['kind'], target: Position, events?: CombatEvents): void {
  if (kind !== 'roll' && !trySpendThreat(state, {
    tick: state.tick + ACE[kind].warningTicks,
    activeFromTick: state.tick,
    activeUntilTick: state.tick + ACE[kind].warningTicks + Math.ceil(
      (kind === 'gun' ? HOSTILE_BOLT_LIFE : ACE.missile.life) * TICKS_PER_SECOND,
    ),
    source: 'ace',
    points: 2,
    bearing: Math.atan2(ace.x - state.player.x, ace.z - state.player.z),
  })) {
    ace.attackAt = state.tick + THREAT_BUDGET.spacingTicks;
    return;
  }
  ace.tell = { kind, ...target, since: state.tick, until: state.tick + ACE[kind].warningTicks };
  events?.tell?.(kind, ace.x, ace.z, ace.alt);
}

export function aceDodgeWindow(tell: AceTell, tick: number): boolean {
  return tell.kind !== 'roll' && tick >= tell.until - ACE.lock.dodgeTicks && tick <= tell.until;
}

function lostAttackLock(state: StageState, ace: Ace, tell: AceTell): boolean {
  const { player: p, tick } = state;
  const dx = p.x - ace.x, dz = p.z - ace.z;
  if (!inBand(p.altitude, tell.alt, ACE.attack.bandWindow) || Math.hypot(dx, dz) > ACE.attack.range
    || Math.abs(angleTo(ace.yaw, dx, dz)) > ACE.lock.releaseCone) return true;
  // Only an accepted maneuver's first tick counts, not its whole animation or a held input.
  const dodgeWindow = aceDodgeWindow(tell, tick)
    || tell.dodgeGraceUntil !== undefined && tick <= tell.dodgeGraceUntil;
  return dodgeWindow && (state.roll?.elapsed === 0 || state.maneuverTrail?.startTick === tick);
}

function updateTell(state: StageState, ace: Ace, events?: CombatEvents,
  pendingSpace?: { active: boolean; graceTicks: number }): void {
  const { tick, player: p } = state;
  const tuning = ACE_PHASES[ace.phase];
  const tell = ace.tell;
  if (tell) {
    const lost = tell.kind !== 'roll' && lostAttackLock(state, ace, tell);
    if (!lost && tick < tell.until) return;
    if (!lost && tell.kind !== 'roll' && tick === tell.until && aceDodgeWindow(tell, tick)
      && pendingSpace?.graceTicks) {
      tell.dodgeGraceUntil = tick + pendingSpace.graceTicks;
      return;
    }
    if (!lost && tell.kind !== 'roll' && tell.dodgeGraceUntil !== undefined
      && tick < tell.dodgeGraceUntil && pendingSpace?.active) return;
    ace.tell = null;
    if (tell.kind === 'roll') {
      ace.roll = { kind: 'barrel', side: ace.side, elapsed: 0, altitude: ace.alt };
      ace.side = ace.side === 1 ? -1 : 1;
      ace.rollReadyAt = tick + Math.max(tuning.rollTicks, ROLLS.barrel.ticks + ACE.roll.recoverTicks);
      ace.attackAt = Math.max(ace.attackAt, tick + ROLLS.barrel.ticks);
    } else {
      const fireScale = state.run ? HEAT_TIERS[state.heat].shotIntervalScale : 1;
      const fireTicks = Math.round(tuning.fireTicks * fireScale);
      if (!lost) {
        events?.aceTellFired?.(tell);
        fireAceSalvo(state, ace, tell, tuning[tell.kind], events);
        ace.attackAt = Math.max(tell.until, tick) + fireTicks;
      } else ace.attackAt = tell.until + fireTicks;
    }
    return;
  }
  if (ace.roll) return;
  if (tick >= ace.rollReadyAt && incomingFire(state, ace)) {
    setAceTell(state, ace, 'roll', { x: ace.x, z: ace.z, alt: ace.alt }, events);
    return;
  }
  const dx = p.x - ace.x, dz = p.z - ace.z, range = Math.hypot(dx, dz);
  const heading = angleTo(ace.yaw, dx, dz);
  if (tick < ace.attackAt || range > ACE.attack.range || Math.abs(heading) > ACE.attack.cone
    || !inBand(ace.alt, p.altitude, ACE.attack.bandWindow)) return;
  const kind = ++ace.attacks % tuning.missileEvery === 0 ? 'missile' : 'gun';
  const lead = ACE.attack.leadSeconds;
  setAceTell(state, ace, kind, { x: p.x + (p.vx ?? 0) * lead, z: p.z + (p.vz ?? 0) * lead, alt: ace.alt }, events);
}

export function beginAceDefeat(state: StageState, ace: Ace, events?: CombatEvents): void {
  ace.defeatedAt = state.tick;
  delete ace.entry;
  ace.tell = ace.roll = null;
  ace.tail = ace.boosting = false;
  state.lock = null;
  events?.tell?.('ace-down', ace.x, ace.z, ace.alt);
}

function advanceDefeat(state: StageState, ace: Ace, ground: Ground): void {
  const { defeat } = ACE;
  const age = state.tick - (ace.defeatedAt ?? state.tick);
  const speed = CRUISE_SPEED * (1 - 0.6 * clamp(age / defeat.maxTicks, 0, 1));
  ace.yaw += ace.side * defeat.turnRate * STEP;
  ace.vx = Math.sin(ace.yaw) * speed;
  ace.vz = Math.cos(ace.yaw) * speed;
  ace.x += ace.vx * STEP;
  ace.z += ace.vz * STEP;
  ace.bank += ace.side * defeat.bankRate * STEP;
  ace.pitch = -defeat.pitch;
  const floor = ground(ace.x, ace.z);
  ace.alt = Math.max(floor, ace.alt - defeat.fallSpeed * STEP);
  ace.crashed = ace.alt <= floor || age >= defeat.maxTicks;
  if (ace.crashed || age % defeat.trailTicks === 0) {
    state.effects.push({ kind: 'burst', x: ace.x, z: ace.z, alt: ace.alt, life: ace.crashed ? defeat.blastLife : defeat.blastLife / 2 });
  }
}

/** Flight, phase changes, and cue timing all advance once per sortie tick. */
export function advanceAce(state: StageState, ground: Ground, events?: CombatEvents, observe?: SwarmObserver,
  pendingSpace?: { active: boolean; graceTicks: number }): void {
  const ace = state.boss;
  if (!ace || ace.crashed) return;
  if (ace.defeatedAt !== null) {
    advanceDefeat(state, ace, ground);
    return;
  }
  if (!ace.hp) return;
  if (ace.entry) {
    Object.assign(ace, sampleFlyIn(ace.entry, state.tick, ground));
    if (state.tick < ace.entry.arriveAt) return;
    delete ace.entry;
    ace.attackAt = state.tick + ACE.attack.startDelay;
  }
  updatePhase(state, ace, ground, events, observe);
  if (ace.roll && ++ace.roll.elapsed >= ROLLS.barrel.ticks) ace.roll = null;
  if (!ace.tell && !ace.roll && state.tick >= ace.bandAt
    && inBand(ace.alt, flightAltitude(ace.band, ground(ace.x, ace.z)), HIT_WINDOW)) nextBand(ace, state);
  updateTell(state, ace, events, pendingSpace);
  updateFlight(state, ace, ground);
  const p = state.player, dx = p.x - ace.x, dz = p.z - ace.z;
  markTail(state, ace, Math.hypot(dx, dz), -(dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)), angleTo(ace.yaw, dx, dz), events);
}
