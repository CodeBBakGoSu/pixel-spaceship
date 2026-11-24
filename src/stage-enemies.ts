import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { SKIM, skimAltitude } from './bands.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { REGULAR_FIRE_INTERVAL_SCALE } from './data/run-balance.ts';
import { GNAT, gnatVariantAt, phaseAt, type GnatVariant } from './data/phases.ts';
import { SPAWN_WORLD } from './data/world.ts';
import { ROSTER } from './data/roster.ts';
import { scaleTravel } from './data/speed.ts';
import { planFlyIn, sampleFlyIn, WAVE_FLY_IN_TICKS } from './fly-in.ts';
import type { CombatEvents } from './hostile-events.ts';
import { nearestBand } from './maneuvers.ts';
import { angleTo, BANDS, clamp, fireHostile, FLAK_LIFE, inBand, MINE_LIMIT, STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import { random } from './stage-random.ts';
import type { Band, Enemy, Ground, Maneuver, Point, Position, StageState } from './stage-types.ts';
import type { SwarmObserver } from './swarm.ts';
import { isWater } from './world.ts';
import { THREAT_BUDGET, trySpendThreat } from './threat-budget.ts';
import { HOSTILE_BOLT_LIFE } from './data/hostile-fire.ts';

const COAST_TURNS = [0.65, -0.65, 1.3, -1.3, 2.05, -2.05, Math.PI];
const MAX_TURN = 3.2 * STEP;
const ENEMY_CLEARANCE = 22;
// Ease most of a speed or bank change over the next 0.18 seconds.
const STEERING_BLEND = 1 - Math.exp(-STEP / 0.06);
const TERRAIN_HOLD_TICKS = 18;
const MANTA_DIVE_OFFSET = scaleTravel(30);
const { span: ESCORT_SPAN, aft: ESCORT_AFT, speedLimit: ESCORT_SPEED } = ROSTER.escort;
const FLYBY = ROSTER.flyby;

function shotInterval(state: StageState, ticks: number): number {
  return state.run ? Math.round(ticks * REGULAR_FIRE_INTERVAL_SCALE * HEAT_TIERS[state.heat].shotIntervalScale) : ticks;
}

function completeIntroAttack(state: StageState, enemies: Enemy[]): void {
  for (const enemy of enemies) {
    if (!enemy.directorIntro || enemy.introAttackDone) continue;
    enemy.introAttackDone = true;
    enemy.leaveAt = state.tick + 15 * TICKS_PER_SECOND;
  }
}

function suppressForIntro(state: StageState, enemy: Enemy, until: number): void {
  const source = enemy.kind === 'aegis' || enemy.carrier ? `escort:${enemy.id}` : `regular:${enemy.id}`;
  if (state.threatBudget) {
    state.threatBudget.spends = state.threatBudget.spends.filter(spend =>
      spend.source !== source || (spend.tick < state.tick && (spend.activeUntilTick ?? spend.tick) > state.tick));
  }
  delete enemy.tell;
  delete enemy.eliteVolley;
  delete enemy.charge;
  delete enemy.manta;
  if (enemy.crosswing) {
    enemy.crosswing.phase = 'cancelled';
    enemy.crosswing.until = until;
    delete enemy.crosswing.pathUntil;
    enemy.crosswing.isolationUntil = until;
    delete enemy.crosswing.start;
    delete enemy.crosswing.crossingPoint;
    delete enemy.crosswing.target;
    delete enemy.crosswing.crossed;
    delete enemy.crosswing.finishedAt;
    delete enemy.crosswing.exitYaw;
  }
  enemy.maneuver = null;
  enemy.shotAt = Math.max(enemy.shotAt, until);
  enemy.maneuverAt = Math.max(enemy.maneuverAt, until);
}

type AttackTell = 'gun' | 'strafe' | 'tail' | 'mine' | 'aegis' | 'carrier';

export function postponeEnemyShot(enemy: Enemy, until: number): void {
  enemy.shotAt = Math.max(enemy.shotAt, until);
  const tell = enemy.tell;
  if (tell && tell.kind !== 'snipe' && tell.kind !== 'flak' && tell.kind !== 'gnat') {
    tell.until = Math.max(tell.until, until);
  }
}

function attackReady(state: StageState, enemy: Enemy, kind: AttackTell, ticks: number, events?: CombatEvents,
  points: 1 | 2 = 1): boolean {
  if (enemy.tell?.kind === kind) {
    if (state.tick < enemy.tell.until) return false;
    delete enemy.tell;
    return true;
  }
  if (state.tick < enemy.shotAt - ticks) return false;
  if (kind !== 'carrier' && !trySpendThreat(state, {
    tick: state.tick + ticks,
    activeFromTick: state.tick,
    activeUntilTick: state.tick + ticks + Math.ceil(HOSTILE_BOLT_LIFE * TICKS_PER_SECOND),
    source: enemy.kind === 'aegis' || enemy.carrier ? `escort:${enemy.id}` : `regular:${enemy.id}`,
    points,
    bearing: Math.atan2(enemy.x - state.player.x, enemy.z - state.player.z),
  })) {
    enemy.shotAt = state.tick + ticks + THREAT_BUDGET.spacingTicks;
    return false;
  }
  enemy.tell = { kind, started: state.tick, until: state.tick + ticks };
  events?.tell?.(kind, enemy.x, enemy.z, enemy.alt);
  return false;
}

export function makeEnemy(state: StageState, x: number, z: number, band: Band, kind: EnemyKind = 'patrol', offset = 0): Enemy {
  const spec = ENEMY_KINDS[kind];
  if (kind === 'skimmer') band = ROSTER.bands.low;
  return {
    id: ++state.nextId, kind, x, z, alt: BANDS[band] + offset, hp: spec.hp,
    ...(kind === 'aegis' && state.run ? { maxHp: spec.hp } : {}),
    yaw: Math.atan2(state.player.x - x, state.player.z - z), vx: 0, vz: 0, bank: 0,
    band, offset, shotAt: state.tick + shotInterval(state, spec.firstShot),
    maneuverAt: state.tick + (kind === 'harrier' ? 0 : 102), maneuver: null, hitUntil: 0, shotDown: false,
  };
}

export function makeGnat(state: StageState, x: number, z: number, band: Band, variant?: GnatVariant): Enemy {
  const enemy = makeEnemy(state, x, z, band, 'gnat');
  if (variant) enemy.gnatVariant = variant;
  if (variant === 'armored') enemy.hp = GNAT.armored.hp;
  return enemy;
}

// --- S7d lane ---
export function placeSkimEnemy(enemy: Enemy, ground: Ground): void {
  if (enemy.kind !== 'skimmer' && enemy.kind !== 'turret') return;
  const point = enemy.entry?.target ?? enemy;
  const floor = ground(point.x, point.z);
  enemy.skim = true;
  const clearance = enemy.kind === 'turret' ? SKIM.turretHeight : SKIM.clearance;
  point.alt = enemy.kind === 'turret' ? floor + clearance : skimAltitude(floor);
  if (enemy.entry) enemy.entry.clearance = clearance;
  if (enemy.kind === 'skimmer' && isWater(floor)) enemy.skimWater = true;
  else delete enemy.skimWater;
}

export function bomberWingPosition(_state: StageState, bomber: Enemy, ground: Ground, side: number): Point {
  const fx = Math.sin(bomber.yaw), fz = Math.cos(bomber.yaw);
  const point = {
    x: bomber.x + fz * ESCORT_SPAN * side - fx * ESCORT_AFT,
    z: bomber.z - fx * ESCORT_SPAN * side - fz * ESCORT_AFT,
  };
  if (ground(point.x, point.z) + 22 <= bomber.alt) return point;
  return bomber;
}

export function addBomberEscort(state: StageState, bomber: Enemy, ground: Ground): void {
  for (const side of [-1, 1]) {
    const { x, z } = bomberWingPosition(state, bomber, ground, side);
    const escort = makeEnemy(state, x, z, 1, 'patrol', bomber.offset);
    escort.yaw = bomber.yaw;
    escort.formation = { leader: bomber.id, side };
    state.enemies.push(escort);
  }
}

export function warnHarrier(state: StageState, enemy: Enemy, maneuver: Maneuver, aft: number, lateral: number, events?: CombatEvents): void {
  if (enemy.kind !== 'harrier' || enemy.maneuver || state.tick < enemy.maneuverAt || aft <= 0 || aft > ROSTER.harrier.bandHopRange
    || Math.abs(lateral) > aft * 0.75 || (maneuver.kind !== 'immelmann' && maneuver.kind !== 'split-s')) return;
  const exitBand = nearestBand(maneuver.exitAltitude);
  if (exitBand !== enemy.band) {
    enemy.maneuver = { phase: 'warning', band: (enemy.band + Math.sign(exitBand - enemy.band)) as Band,
      diveAt: state.tick + ROSTER.harrier.bandHopWarningTicks };
    events?.tell?.('dive', enemy.x, enemy.z, enemy.alt);
  }
}

function moveBetweenBands(state: StageState, e: Enemy, ground: Ground, speed: number): boolean {
  const move = e.maneuver;
  if (!move || state.tick < move.diveAt) return false;
  move.phase = 'diving';
  const floor = ground(e.x, e.z);
  const target = BANDS[move.band] + e.offset;
  const error = Math.max(target, floor + 22) - e.alt;
  e.alt += Math.sign(error) * Math.min(Math.abs(error), speed * STEP);
  if (Math.abs(e.alt - target) > 1e-6) return false;
  e.alt = target;
  e.band = move.band;
  e.maneuver = null;
  postponeEnemyShot(e, state.tick + 24);
  return true;
}

function followPlayerBand(state: StageState, enemy: Enemy, ground: Ground, events?: CombatEvents): void {
  if (enemy.maneuver?.phase !== 'diving' && state.tick >= enemy.maneuverAt) {
    const target = nearestBand(state.player.altitude);
    if (target === enemy.band) enemy.maneuver = null;
    else if (enemy.maneuver?.band !== target) {
      enemy.maneuver = { phase: 'warning', band: target, diveAt: state.tick + ROSTER.hound.bandLagTicks };
      events?.tell?.('dive', enemy.x, enemy.z, enemy.alt);
    }
  }
  moveBetweenBands(state, enemy, ground, ROSTER.hound.bandSpeed);
}

function headingDelta(yaw: number, target: number): number {
  const delta = target - yaw;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function bankToward(enemy: Enemy, yaw: number): void {
  const turn = clamp(headingDelta(enemy.yaw, yaw), -MAX_TURN, MAX_TURN);
  enemy.yaw += turn;
  enemy.bank += (-turn / STEP * 0.16 - enemy.bank) * STEERING_BLEND;
}

export function beginEnemyFlyIn(state: StageState, enemy: Enemy, ground: Ground, anchor: Point, bend: number): void {
  const { x, z, alt, kind } = enemy;
  const path = planFlyIn(state, anchor, { x, z, alt }, {
    ticks: WAVE_FLY_IN_TICKS, bend, exitSpeed: kind === 'turret' ? 0 : ENEMY_KINDS[kind].speed,
    clearance: kind === 'turret' ? SKIM.turretHeight : enemy.skim ? SKIM.clearance : undefined,
  });
  enemy.entry = path;
  Object.assign(enemy, sampleFlyIn(path, state.tick, ground));
}

function rangeMode(active: boolean | undefined, range: number, threshold: number, margin: number): boolean {
  return range < threshold + (active === undefined ? 0 : active ? margin : -margin);
}

function clearAt(enemy: Enemy, floor: number): boolean {
  if (enemy.skim) return !enemy.skimWater || isWater(floor);
  return floor + ENEMY_CLEARANCE <= enemy.alt + 0.01;
}

function steer(state: StageState, enemy: Enemy, ground: Ground, targetYaw: number, targetSpeed: number): void {
  const previousSpeed = enemy.flightSpeed ?? targetSpeed;
  const speed = previousSpeed + (targetSpeed - previousSpeed) * STEERING_BLEND;
  enemy.flightSpeed = speed;

  const lookAhead = enemy.kind === 'skimmer' ? ROSTER.skimmer.lookAhead : Math.max(ROSTER.pursuit.lookAheadMin, speed * 0.38);
  const clearHeading = (yaw: number) => clearAt(enemy, ground(
    enemy.x + Math.sin(yaw) * lookAhead, enemy.z + Math.cos(yaw) * lookAhead));
  const held = enemy.terrainTurn;
  if (held && state.tick < held.until) {
    targetYaw = held.yaw;
  } else if (speed > 0.01 && !clearHeading(targetYaw)) {
    // Keep the last viable escape direction while the requested course is blocked.
    if (held && clearHeading(held.yaw)) {
      targetYaw = held.yaw;
    } else {
      const offset = COAST_TURNS.find(turn => clearHeading(targetYaw + turn));
      if (offset !== undefined) {
        targetYaw += offset;
        enemy.terrainTurn = { yaw: targetYaw, until: state.tick + TERRAIN_HOLD_TICKS };
      }
    }
  } else if (held) {
    delete enemy.terrainTurn;
  }

  bankToward(enemy, targetYaw);
  enemy.vx = Math.sin(enemy.yaw) * speed;
  enemy.vz = Math.cos(enemy.yaw) * speed;
}

function clearFlybyPath(ground: Ground, from: Point, to: Point, altitude: number): boolean {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / 16);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + dx * i / steps, z = from.z + dz * i / steps;
    if (ground(x, z) + ENEMY_CLEARANCE > altitude) return false;
  }
  return true;
}

function planFlyby(state: StageState, enemy: Enemy, ground: Ground, fx: number, fz: number, dx: number, dz: number): Enemy['flyby'] {
  if (state.maneuver || state.boundaryWarning || enemy.maneuver || enemy.formation || state.speed > FLYBY.speed - FLYBY.startSpeedSlack
    || (enemy.flybyAt ?? 0) > state.tick) return;
  const aft = dx * fx + dz * fz, lateral = dz * fx - dx * fz;
  if (aft < FLYBY.aftMin || aft > FLYBY.aftMax || Math.abs(lateral) < FLYBY.wingMin || Math.abs(lateral) > FLYBY.wingMax) return;
  const side = lateral < 0 ? -1 : 1;
  if (state.enemies.some(other => other.hp && other.flyby
    && (other.band === enemy.band || other.flyby.side === side || state.tick - other.flyby.startedAt < TICKS_PER_SECOND))) return;

  const p = state.player;
  const closingTime = (aft + FLYBY.crossAhead) / (FLYBY.speed - state.speed);
  const reach = FLYBY.crossAhead + state.speed * closingTime;
  const wing = { x: p.x + fx * reach + fz * FLYBY.lane * side, z: p.z + fz * reach - fx * FLYBY.lane * side };
  const exit = { x: p.x + fx * (reach + FLYBY.crossTravel) - fz * FLYBY.crossExit * side,
    z: p.z + fz * (reach + FLYBY.crossTravel) + fx * FLYBY.crossExit * side };
  if (!clearFlybyPath(ground, enemy, wing, enemy.alt) || !clearFlybyPath(ground, wing, exit, enemy.alt)) {
    enemy.flybyAt = state.tick + 30;
    return;
  }
  return { phase: 'overtake', startedAt: state.tick, yaw: p.yaw, side, lane: p.x * fz - p.z * fx + FLYBY.lane * side };
}

function finishFlyby(state: StageState, enemy: Enemy): false {
  delete enemy.flyby;
  enemy.flybyAt = state.tick + 7 * TICKS_PER_SECOND;
  return false;
}

function moveFlyby(state: StageState, enemy: Enemy, ground: Ground, fx: number, fz: number, dx: number, dz: number): boolean {
  let pass = enemy.flyby ?? planFlyby(state, enemy, ground, fx, fz, dx, dz);
  if (!pass) return false;
  const p = state.player, forwardX = Math.sin(pass.yaw), forwardZ = Math.cos(pass.yaw);
  const ahead = -dx * forwardX - dz * forwardZ, lateral = dz * forwardX - dx * forwardZ;
  const drift = p.x * forwardZ - p.z * forwardX - pass.lane + FLYBY.lane * pass.side;
  if (state.maneuver || state.speed > FLYBY.speed - FLYBY.passSpeedSlack || state.tick - pass.startedAt >= 8 * TICKS_PER_SECOND
    || Math.abs(angleTo(pass.yaw, fx, fz)) > 0.6 || Math.abs(drift) > FLYBY.laneLeeway + FLYBY.driftSlack) {
    return finishFlyby(state, enemy);
  }

  if (pass.phase === 'overtake' && ahead >= FLYBY.crossAhead && -dx * fx - dz * fz >= FLYBY.aheadMin && pass.side * lateral >= FLYBY.crossWing) {
    const target = { x: p.x + forwardX * (ahead + FLYBY.crossTravel) - forwardZ * FLYBY.crossExit * pass.side,
      z: p.z + forwardZ * (ahead + FLYBY.crossTravel) + forwardX * FLYBY.crossExit * pass.side };
    if (!clearFlybyPath(ground, enemy, target, enemy.alt)) return finishFlyby(state, enemy);
    pass = { ...pass, phase: 'cross', target };
  }

  // Absorb small pilot corrections while keeping the pass on its original heading.
  const lane = pass.lane + clamp(drift, -FLYBY.laneLeeway, FLYBY.laneLeeway);
  const laneError = lane - (enemy.x * forwardZ - enemy.z * forwardX);
  let wantedYaw = pass.yaw + clamp(laneError * FLYBY.correction, -0.48, 0.48);
  if (pass.phase === 'cross') {
    const x = pass.target.x - enemy.x, z = pass.target.z - enemy.z;
    if (ahead < FLYBY.finishAhead || Math.hypot(x, z) < FLYBY.finishRadius) return finishFlyby(state, enemy);
    wantedYaw = Math.atan2(x, z);
  }
  const turn = clamp(headingDelta(enemy.yaw, wantedYaw), -MAX_TURN, MAX_TURN);
  const yaw = enemy.yaw + turn;
  const look = { x: enemy.x + Math.sin(yaw) * FLYBY.lookAhead, z: enemy.z + Math.cos(yaw) * FLYBY.lookAhead };
  if (!clearFlybyPath(ground, enemy, look, enemy.alt)) return finishFlyby(state, enemy);
  if (pass.phase === 'overtake' && Math.abs(ahead) < FLYBY.overtakeAhead && pass.side * lateral < FLYBY.overtakeWing) return finishFlyby(state, enemy);
  enemy.flightSpeed ??= FLYBY.entrySpeed;
  steer(state, enemy, ground, wantedYaw, FLYBY.speed);
  enemy.flyby = pass;
  return true;
}

function pursuitBoost(state: StageState, enemy: Enemy): number {
  for (const spotter of state.enemies) {
    if (spotter.kind === 'spotter' && spotter.hp && !spotter.entry
      && Math.hypot(spotter.x - enemy.x, spotter.z - enemy.z) <= ROSTER.spotter.buffRange) return 1.2;
  }
  return 1;
}

function moveTwinChaser(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number): void {
  const speed = ENEMY_KINDS['twin-chaser'].speed;
  const charge = enemy.charge;
  if (!charge) {
    steer(state, enemy, ground, angle + (enemy.id % 2 ? 0.18 : -0.18), speed);
    if (range <= scaleTravel(112) && state.tick >= enemy.maneuverAt) {
      const director = state.phaseDirector;
      if (director?.six && (director.sixTwinStarted || state.tick < director.sixTellUntil)) {
        enemy.maneuverAt = Math.max(enemy.maneuverAt,
          director.sixTwinStarted ? state.tick + THREAT_BUDGET.spacingTicks : director.sixTellUntil);
        return;
      }
      const yaw = enemy.yaw, length = scaleTravel(170);
      const target = { x: enemy.x + Math.sin(yaw) * length, z: enemy.z + Math.cos(yaw) * length };
      if (!trySpendThreat(state, {
        tick: state.tick + 42, activeFromTick: state.tick, activeUntilTick: state.tick + 234,
        source: `regular:${enemy.id}`, points: 2,
        bearing: Math.atan2(enemy.x - state.player.x, enemy.z - state.player.z),
      })) {
        enemy.maneuverAt = state.tick + THREAT_BUDGET.spacingTicks;
        return;
      }
      if (director?.six) {
        director.sixTwinStarted = true;
        director.sixTellUntil = state.tick + 42;
      }
      enemy.charge = { phase: 'warning', yaw, target, until: state.tick + 42 };
      enemy.tell = { kind: 'charge', started: state.tick, until: state.tick + 42, target: { ...target, alt: enemy.alt } };
      completeIntroAttack(state, [enemy]);
    }
    return;
  }
  if (charge.phase === 'warning') {
    steer(state, enemy, ground, charge.yaw, speed * 0.35);
    if (state.tick >= charge.until) {
      delete enemy.tell;
      charge.phase = 'charging';
      charge.until = state.tick + 132;
    }
    return;
  }
  if (charge.phase === 'charging') {
    steer(state, enemy, ground, charge.yaw, scaleTravel(92));
    const remaining = (charge.target.x - enemy.x) * Math.sin(charge.yaw)
      + (charge.target.z - enemy.z) * Math.cos(charge.yaw);
    if (remaining <= 0 || state.tick >= charge.until) {
      charge.phase = 'recovery';
      charge.until = state.tick + 60;
      enemy.maneuverAt = state.tick + 120;
    }
    return;
  }
  if (state.tick < charge.until) steer(state, enemy, ground, charge.yaw + Math.PI / 2, speed * 0.4);
  else delete enemy.charge;
}

function startCrosswing(state: StageState, first: Enemy, second: Enemy): boolean {
  const director = state.phaseDirector;
  const pathUntil = state.tick + 258;
  if (director?.six && (director.sixCrosswingStarted || state.tick < director.sixTellUntil)) {
    first.maneuverAt = second.maneuverAt = Math.max(first.maneuverAt, second.maneuverAt,
      director.sixCrosswingStarted ? state.tick + THREAT_BUDGET.spacingTicks : director.sixTellUntil);
    return false;
  }
  if (!trySpendThreat(state, {
    tick: state.tick + 48, activeFromTick: state.tick, activeUntilTick: pathUntil,
    source: `regular:${first.id}`, points: 2,
    bearing: Math.atan2(first.x - state.player.x, first.z - state.player.z),
  })) {
    first.maneuverAt = second.maneuverAt = state.tick + THREAT_BUDGET.spacingTicks;
    return false;
  }
  if (director?.six) {
    director.sixCrosswingStarted = true;
    director.sixTellUntil = state.tick + 48;
  }
  const firstStart = { x: first.x, z: first.z };
  const secondStart = { x: second.x, z: second.z };
  const center = { x: (firstStart.x + secondStart.x) / 2, z: (firstStart.z + secondStart.z) / 2 };
  const p = state.player;
  let forwardX = first.vx + second.vx, forwardZ = first.vz + second.vz;
  let forwardLength = Math.hypot(forwardX, forwardZ);
  if (forwardLength <= 0.001) {
    forwardX = p.x - center.x;
    forwardZ = p.z - center.z;
    forwardLength = Math.hypot(forwardX, forwardZ);
  }
  if (forwardLength <= 0.001) {
    forwardX = Math.sin(first.yaw);
    forwardZ = Math.cos(first.yaw);
    forwardLength = 1;
  }
  forwardX /= forwardLength;
  forwardZ /= forwardLength;
  const separation = Math.hypot(firstStart.x - secondStart.x, firstStart.z - secondStart.z);
  const advance = Math.max(scaleTravel(140), separation * 1.5);
  const crossingPoint = { x: center.x + forwardX * advance / 2, z: center.z + forwardZ * advance / 2 };
  const plans = [
    [first, firstStart, { x: secondStart.x + forwardX * advance, z: secondStart.z + forwardZ * advance }],
    [second, secondStart, { x: firstStart.x + forwardX * advance, z: firstStart.z + forwardZ * advance }],
  ] as const;
  for (const [fighter, start, target] of plans) {
    const pair = fighter.crosswing!;
    pair.phase = 'warning';
    pair.until = state.tick + 48;
    pair.pathUntil = pathUntil;
    pair.start = start;
    pair.crossingPoint = crossingPoint;
    pair.target = target;
    pair.crossed = false;
    pair.exitYaw = Math.atan2(target.x - start.x, target.z - start.z);
    fighter.tell = { kind: 'crossing', started: state.tick, until: pair.until, target: { ...target, alt: fighter.alt } };
  }
  completeIntroAttack(state, [first, second]);
  return true;
}

function cancelCrosswingPath(enemy: Enemy, mate?: Enemy): void {
  for (const fighter of mate ? [enemy, mate] : [enemy]) {
    const pair = fighter.crosswing;
    if (!pair) continue;
    pair.phase = 'cancelled';
    delete pair.until;
    delete pair.pathUntil;
    delete pair.start;
    delete pair.crossingPoint;
    delete pair.target;
    delete pair.finishedAt;
    delete pair.exitYaw;
    delete fighter.tell;
  }
}

function moveCrosswing(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number): void {
  const pair = enemy.crosswing;
  if (!pair) return;
  const mate = state.enemies.find(candidate => candidate.id === pair.mate && candidate.hp > 0);
  if (pair.phase === 'cancelled' && pair.isolationUntil !== undefined && state.tick >= pair.isolationUntil) {
    pair.phase = undefined;
    delete pair.isolationUntil;
    delete pair.until;
    delete pair.pathUntil;
    delete pair.start;
    delete pair.crossingPoint;
    delete pair.target;
    delete pair.crossed;
    delete pair.finishedAt;
    delete pair.exitYaw;
  }
  if (pair.phase === 'finished' && !mate) {
    pair.phase = 'recovery';
    pair.until = state.tick + 60;
    delete pair.pathUntil;
  }
  if (pair.pathUntil !== undefined && state.tick >= pair.pathUntil
    && (pair.phase === 'warning' || pair.phase === 'crossing' || pair.phase === 'exit' || pair.phase === 'finished')) {
    cancelCrosswingPath(enemy, mate);
    steer(state, enemy, ground, angle + pair.side * 0.45, ENEMY_KINDS.crosswing.speed);
    return;
  }
  if (!mate && (pair.phase === 'warning' || pair.phase === 'crossing') && !pair.crossed) {
    cancelCrosswingPath(enemy);
  }
  if (!pair.phase && mate && range <= scaleTravel(152) && state.tick >= enemy.maneuverAt) startCrosswing(state, enemy, mate);
  if (pair.phase === 'warning') {
    const target = pair.crossingPoint!;
    steer(state, enemy, ground, Math.atan2(target.x - enemy.x, target.z - enemy.z), scaleTravel(36));
    if (state.tick >= (pair.until ?? 0)) {
      pair.phase = 'crossing';
      delete enemy.tell;
    }
    return;
  }
  if (pair.phase === 'crossing') {
    const target = pair.crossingPoint!;
    if (Math.hypot(target.x - enemy.x, target.z - enemy.z) <= scaleTravel(4)) {
      enemy.x = target.x;
      enemy.z = target.z;
      pair.crossed = true;
      pair.phase = 'exit';
      steer(state, enemy, ground, pair.exitYaw!, scaleTravel(92));
    } else {
      steer(state, enemy, ground, Math.atan2(target.x - enemy.x, target.z - enemy.z), scaleTravel(92));
    }
    return;
  }
  if (pair.phase === 'exit') {
    const target = pair.target!;
    if (Math.hypot(target.x - enemy.x, target.z - enemy.z) <= scaleTravel(4)) {
      enemy.x = target.x;
      enemy.z = target.z;
      pair.phase = 'finished';
      pair.finishedAt = state.tick;
      if (mate?.crosswing?.phase === 'finished') {
        for (const fighter of [enemy, mate]) {
          fighter.crosswing!.phase = 'recovery';
          fighter.crosswing!.until = state.tick + 60;
          delete fighter.crosswing!.pathUntil;
        }
      } else if (!mate) {
        pair.phase = 'recovery';
        pair.until = state.tick + 60;
        delete pair.pathUntil;
      }
      steer(state, enemy, ground, pair.exitYaw!, ENEMY_KINDS.crosswing.speed);
    } else {
      steer(state, enemy, ground, Math.atan2(target.x - enemy.x, target.z - enemy.z), scaleTravel(92));
    }
    return;
  }
  if (pair.phase === 'finished') {
    if (mate?.crosswing?.phase === 'finished') {
      for (const fighter of [enemy, mate]) {
        fighter.crosswing!.phase = 'recovery';
        fighter.crosswing!.until = state.tick + 60;
        delete fighter.crosswing!.pathUntil;
      }
    }
    steer(state, enemy, ground, pair.exitYaw ?? enemy.yaw, ENEMY_KINDS.crosswing.speed);
    return;
  }
  if (pair.phase === 'recovery') {
    if (state.tick >= (pair.until ?? 0)) {
      pair.phase = 'cancelled';
      delete pair.until;
      delete pair.pathUntil;
      delete pair.start;
      delete pair.crossingPoint;
      delete pair.target;
      delete pair.crossed;
      delete pair.finishedAt;
      delete pair.exitYaw;
    } else {
      steer(state, enemy, ground, pair.exitYaw ?? enemy.yaw, ENEMY_KINDS.crosswing.speed);
      return;
    }
  }
  steer(state, enemy, ground, angle + pair.side * 0.45, ENEMY_KINDS.crosswing.speed);
}

function moveMantaAltitude(enemy: Enemy, altitude: number, speed: number): boolean {
  const delta = altitude - enemy.alt;
  const step = speed * STEP;
  if (Math.abs(delta) <= step) enemy.alt = altitude;
  else enemy.alt += Math.sign(delta) * step;
  return enemy.alt === altitude;
}

function moveManta3d(enemy: Enemy, target: Position, speed: number): boolean {
  const dx = target.x - enemy.x, dy = target.alt - enemy.alt, dz = target.z - enemy.z;
  const distance = Math.hypot(dx, dy, dz);
  const step = speed * STEP;
  if (distance <= step) {
    enemy.x = target.x;
    enemy.z = target.z;
    enemy.alt = target.alt;
    enemy.vx = enemy.vz = 0;
    return true;
  }
  const fraction = step / distance;
  enemy.vx = dx / distance * speed;
  enemy.vz = dz / distance * speed;
  enemy.x += dx * fraction;
  enemy.z += dz * fraction;
  enemy.alt += dy * fraction;
  bankToward(enemy, Math.atan2(dx, dz));
  enemy.vx = enemy.vz = 0;
  return false;
}

function startMantaWarning(state: StageState, enemy: Enemy, maneuver: NonNullable<Enemy['manta']>): void {
  const player = state.player;
  const passStart = { x: enemy.x, z: enemy.z, alt: enemy.alt };
  const passEnd = { x: player.x, z: player.z, alt: maneuver.playerHeight };
  const passSpeed = scaleTravel(92);
  const exitDistance = scaleTravel(84);
  const passTicks = Math.ceil(Math.hypot(passEnd.x - passStart.x, passEnd.z - passStart.z,
    passEnd.alt - passStart.alt) / (passSpeed * STEP));
  const passYaw = Math.atan2(passEnd.x - passStart.x, passEnd.z - passStart.z);
  const exitTarget = { x: passEnd.x + Math.sin(passYaw) * exitDistance,
    z: passEnd.z + Math.cos(passYaw) * exitDistance };
  const exitTicks = Math.ceil(exitDistance / (passSpeed * STEP));
  if (!trySpendThreat(state, {
    tick: state.tick + 54, activeFromTick: state.tick,
    activeUntilTick: state.tick + 54 + passTicks + exitTicks,
    source: `regular:${enemy.id}`, points: 2,
    bearing: Math.atan2(enemy.x - player.x, enemy.z - player.z),
  })) {
    enemy.maneuverAt = state.tick + THREAT_BUDGET.spacingTicks;
    return;
  }
  maneuver.phase = 'warning';
  maneuver.passStart = passStart;
  maneuver.passEnd = passEnd;
  maneuver.exitTarget = exitTarget;
  maneuver.until = state.tick + 54;
  enemy.vx = enemy.vz = 0;
  enemy.tell = { kind: 'pass', started: state.tick, until: maneuver.until, target: passEnd };
  completeIntroAttack(state, [enemy]);
}

function moveManta(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number): void {
  let maneuver = enemy.manta;
  if (!maneuver) {
    const side = enemy.id % 2 ? 1 : -1;
    steer(state, enemy, ground, angle + side * 0.72, ENEMY_KINDS.manta.speed);
    if (range <= scaleTravel(152) && state.tick >= enemy.maneuverAt) {
      const player = state.player, fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
      const sx = Math.cos(player.yaw), sz = -Math.sin(player.yaw);
      const playerHeight = player.altitude;
      maneuver = enemy.manta = {
        phase: 'approach', playerHeight,
        passAltitude: Math.max(enemy.alt, playerHeight + MANTA_DIVE_OFFSET, ground(enemy.x, enemy.z) + ENEMY_CLEARANCE),
        approach: { x: player.x - fx * scaleTravel(72) + sx * side * scaleTravel(24),
          z: player.z - fz * scaleTravel(72) + sz * side * scaleTravel(24) },
      };
    }
    return;
  }
  if (maneuver.phase === 'approach') {
    const dx = maneuver.approach.x - enemy.x, dz = maneuver.approach.z - enemy.z;
    if (Math.hypot(dx, dz) > scaleTravel(8)) {
      steer(state, enemy, ground, Math.atan2(dx, dz), ENEMY_KINDS.manta.speed);
    }
    maneuver.passAltitude = Math.max(maneuver.passAltitude,
      ground(enemy.x + enemy.vx * STEP, enemy.z + enemy.vz * STEP) + ENEMY_CLEARANCE);
    moveMantaAltitude(enemy, maneuver.passAltitude, scaleTravel(72));
    if (Math.hypot(maneuver.approach.x - enemy.x, maneuver.approach.z - enemy.z) <= scaleTravel(8)) {
      maneuver.phase = 'climb';
    }
    return;
  }
  if (maneuver.phase === 'climb') {
    enemy.vx = enemy.vz = 0;
    maneuver.passAltitude = Math.max(maneuver.passAltitude, ground(enemy.x, enemy.z) + ENEMY_CLEARANCE);
    const aligned = moveMantaAltitude(enemy, maneuver.passAltitude, scaleTravel(72));
    if (aligned && state.tick >= enemy.maneuverAt) startMantaWarning(state, enemy, maneuver);
    return;
  }
  if (maneuver.phase === 'warning') {
    enemy.vx = enemy.vz = 0;
    if (state.tick >= (maneuver.until ?? 0)) {
      delete enemy.tell;
      maneuver.phase = 'pass';
    }
    return;
  }
  if (maneuver.phase === 'pass') {
    if (maneuver.passEnd && moveManta3d(enemy, maneuver.passEnd, scaleTravel(92))) maneuver.phase = 'exit';
    return;
  }
  if (maneuver.exitTarget && moveManta3d(enemy, { ...maneuver.exitTarget, alt: maneuver.playerHeight }, scaleTravel(92))) {
    delete enemy.manta;
    enemy.maneuverAt = state.tick + 180;
  }
}

function pointSegmentDistanceSquared3d(point: { x: number; z: number; alt: number }, a: Enemy, b: Enemy): number {
  const vx = b.x - a.x, vy = b.alt - a.alt, vz = b.z - a.z;
  const length = vx * vx + vy * vy + vz * vz;
  const t = length ? clamp(((point.x - a.x) * vx + (point.alt - a.alt) * vy + (point.z - a.z) * vz) / length, 0, 1) : 0;
  const dx = point.x - a.x - vx * t, dy = point.alt - a.alt - vy * t, dz = point.z - a.z - vz * t;
  return dx * dx + dy * dy + dz * dz;
}

function distanceSquared3d(a: { x: number; z: number; alt: number }, b: { x: number; z: number; alt: number }): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 + (a.alt - b.alt) ** 2;
}

function moveMender(state: StageState, enemy: Enemy, ground: Ground, angle: number): void {
  const range = scaleTravel(68), rangeSquared = range * range;
  const repairTell = enemy.tell;
  if (repairTell?.kind === 'repair') {
    const target = state.enemies.find(candidate => candidate.id === repairTell.targetId && candidate.hp > 0);
    const player = { x: state.player.x, z: state.player.z, alt: state.player.altitude };
    const crossed = target && pointSegmentDistanceSquared3d(player, enemy, target) <= scaleTravel(7) ** 2;
    if (!target || target.hp >= (target.maxHp ?? ENEMY_KINDS.aegis.hp)
      || distanceSquared3d(enemy, target) > rangeSquared || crossed) {
      delete enemy.tell;
      enemy.shotAt = state.tick + 30;
      return;
    }
    if (state.tick >= repairTell.until) {
      target.hp = Math.min(target.maxHp ?? ENEMY_KINDS.aegis.hp, target.hp + 1);
      delete enemy.tell;
      enemy.shotAt = state.tick + 120;
    }
    return;
  }
  const damaged = state.enemies.filter(candidate => candidate.kind === 'aegis' && candidate.hp > 0
    && candidate.hp < (candidate.maxHp ?? ENEMY_KINDS.aegis.hp))
    .sort((a, b) => distanceSquared3d(enemy, a) - distanceSquared3d(enemy, b))[0];
  if (damaged) {
    const distance = distanceSquared3d(enemy, damaged);
    steer(state, enemy, ground, Math.atan2(damaged.x - enemy.x, damaged.z - enemy.z), ENEMY_KINDS.mender.speed);
    if (distance <= rangeSquared && state.tick >= enemy.shotAt) {
      enemy.tell = { kind: 'repair', started: state.tick, until: state.tick + 75, targetId: damaged.id };
      completeIntroAttack(state, [enemy]);
    }
    return;
  }
  steer(state, enemy, ground, angle + (enemy.id % 2 ? 0.55 : -0.55), ENEMY_KINDS.mender.speed);
}

function moveSkimmer(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.skimmer;
  const { range: maxRange, closeRange, closeMargin, warningTicks, spread, cooldownTicks } = ROSTER.skimmer;
  const direction = enemy.id % 2 ? 1 : -1;
  enemy.closeRange = rangeMode(enemy.closeRange, range, closeRange, closeMargin);
  steer(state, enemy, ground, angle + direction * (enemy.closeRange ? 1.25 : 0.34), speed);
  if (range <= maxRange && attackReady(state, enemy, 'strafe', warningTicks, events, 2)) {
    for (const offset of spread) fireHostile(state, enemy, boltSpeed, offset, events);
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  }
}

function moveSpotter(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.spotter;
  const { range: maxRange, closeRange, longRange, rangeMargin, warningTicks, cooldownTicks, recoveryTicks } = ROSTER.spotter;
  enemy.closeRange = rangeMode(enemy.closeRange, range, closeRange, rangeMargin);
  enemy.longRange = rangeMode(enemy.longRange, -range, -longRange, rangeMargin);
  const bias = enemy.closeRange ? 2.05 : enemy.longRange ? 0.55 : 1.35;
  steer(state, enemy, ground, angle + bias * (enemy.id % 2 ? 1 : -1), speed);
  if (enemy.tell?.kind === 'snipe') {
    if (state.tick < enemy.tell.until) return;
    const target = enemy.tell.target;
    const offset = target ? angleTo(angle, target.x - enemy.x, target.z - enemy.z) : 0;
    fireHostile(state, enemy, boltSpeed, offset, events);
    delete enemy.tell;
    enemy.shotAt = state.tick + recoveryTicks + shotInterval(state, cooldownTicks);
  } else if (state.tick >= enemy.shotAt && range <= maxRange) {
    const p = state.player;
    const vx = p.vx ?? Math.sin(p.yaw) * state.speed, vz = p.vz ?? Math.cos(p.yaw) * state.speed;
    const radial = vx * Math.sin(angle) + vz * Math.cos(angle);
    const lead = warningTicks * STEP + range / Math.max(boltSpeed * 0.5, boltSpeed - radial);
    const target = { x: p.x + vx * lead, z: p.z + vz * lead, alt: enemy.alt };
    if (!trySpendThreat(state, {
      tick: state.tick + warningTicks, activeFromTick: state.tick,
      activeUntilTick: state.tick + warningTicks + Math.ceil(HOSTILE_BOLT_LIFE * TICKS_PER_SECOND),
      source: `regular:${enemy.id}`, points: 1,
      bearing: Math.atan2(enemy.x - p.x, enemy.z - p.z),
    })) {
      enemy.shotAt = state.tick + warningTicks + THREAT_BUDGET.spacingTicks;
      return;
    }
    enemy.tell = { kind: 'snipe', started: state.tick, until: state.tick + warningTicks, target };
    events?.tell?.('snipe', enemy.x, enemy.z, enemy.alt);
  }
}

function moveTail(state: StageState, enemy: Enemy, ground: Ground, kind: 'hound' | 'harrier', fx: number, fz: number, dx: number, dz: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS[kind], harrier = kind === 'harrier';
  const { tailSlot: slot, lateralSlot, attackWidth, warningTicks } = ROSTER[kind];
  const { tailNear, tailFar } = ROSTER.pursuit;
  const aft = dx * fx + dz * fz;
  const side = (enemy.id % 2 ? 1 : -1) * lateralSlot;
  const vx = fx * state.speed + (dx - fx * slot + fz * side) * 1.1;
  const vz = fz * state.speed + (dz - fz * slot - fx * side) * 1.1;
  steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(speed, Math.hypot(vx, vz)) * pursuitBoost(state, enemy));
  if (aft >= slot - tailNear && aft <= slot + tailFar && inBand(enemy.alt, state.player.altitude)
    && Math.abs(dx * fz - dz * fx) < attackWidth && enemy.maneuver?.phase !== 'diving'
    && attackReady(state, enemy, 'tail', warningTicks, events, harrier ? 2 : 1)) {
    fireHostile(state, enemy, boltSpeed, 0, events);
    enemy.shotAt = state.tick + shotInterval(state, harrier ? 240 : 180);
  }
}

function moveFlanker(state: StageState, enemy: Enemy, ground: Ground, fx: number, fz: number, dx: number, dz: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.flanker;
  const { range, lateralSlot, warningTicks, cooldownTicks } = ROSTER.flanker;
  const side = enemy.id % 2 ? 1 : -1;
  const vx = fx * state.speed + (dx + fz * lateralSlot * side) * 1.25;
  const vz = fz * state.speed + (dz - fx * lateralSlot * side) * 1.25;
  steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(speed, Math.hypot(vx, vz)));
  if (Math.hypot(dx, dz) < range && attackReady(state, enemy, 'strafe', warningTicks, events, 2)) {
    fireHostile(state, enemy, boltSpeed, 0, events);
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  }
}

function moveDiver(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed } = ENEMY_KINDS.diver;
  const { warningTicks, range: maxRange, closeRange, closeMargin, plungeSpeed, climbSpeed, spread } = ROSTER.diver;
  const { low, high } = ROSTER.bands;
  enemy.closeRange = rangeMode(enemy.closeRange, range, closeRange, closeMargin);
  steer(state, enemy, ground, angle + (enemy.closeRange ? 1.45 : 0.24) * (enemy.id % 2 ? 1 : -1), speed);
  if (!enemy.maneuver && state.tick >= enemy.maneuverAt && (enemy.band === low || range <= maxRange)) {
    const climbing = enemy.band === low;
    if (!climbing && !trySpendThreat(state, {
      tick: state.tick + warningTicks,
      activeFromTick: state.tick,
      activeUntilTick: state.tick + warningTicks + Math.ceil(HOSTILE_BOLT_LIFE * TICKS_PER_SECOND),
      source: `regular:${enemy.id}`,
      points: 2,
      bearing: Math.atan2(enemy.x - state.player.x, enemy.z - state.player.z),
    })) {
      enemy.maneuverAt = state.tick + warningTicks + THREAT_BUDGET.spacingTicks;
      return;
    }
    enemy.maneuver = { phase: 'warning', band: climbing ? high : low, diveAt: state.tick + (climbing ? 0 : warningTicks) };
    if (!climbing) events?.tell?.('dive', enemy.x, enemy.z, enemy.alt);
    enemy.fanFired = false;
  }
  const plunge = enemy.maneuver?.band === low && state.tick >= enemy.maneuver.diveAt;
  const oldAltitude = enemy.alt;
  const arrived = moveBetweenBands(state, enemy, ground, plunge ? plungeSpeed : climbSpeed);
  const altitude = state.player.altitude;
  if (plunge && enemy.alt < oldAltitude && !enemy.fanFired && range <= maxRange && inBand(enemy.alt, altitude, 4)) {
    for (const offset of spread) fireHostile(state, enemy, boltSpeed, offset, events);
    enemy.fanFired = true;
  }
  if (arrived) enemy.maneuverAt = state.tick + (enemy.band === low ? 105 : 390);
}

function moveBomber(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number,
  events?: CombatEvents, observeSwarm?: SwarmObserver): void {
  const { closeRange, closeMargin } = ROSTER.bomber;
  enemy.closeRange = rangeMode(enemy.closeRange, range, closeRange, closeMargin);
  steer(state, enemy, ground, angle + (enemy.closeRange ? 1.7 : 0.65) * (enemy.id % 2 ? 1 : -1), ENEMY_KINDS.bomber.speed);
  if (enemy.carrier) {
    const { warningTicks, range: maxRange, waveSize, cooldownTicks } = ROSTER.carrier;
    if (range <= maxRange && attackReady(state, enemy, 'carrier', warningTicks, events)) {
      spawnEscortGnats(state, enemy, ground, waveSize, observeSwarm);
      enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
    }
    return;
  }

  const { warningTicks, range: maxRange, tailRange, tailHalfAngle, mineOffset, cooldownTicks } = ROSTER.bomber;
  const tail = range <= tailRange && inBand(enemy.alt, state.player.altitude)
    && Math.abs(headingDelta(enemy.yaw + Math.PI, angle)) <= tailHalfAngle;
  if (tail) {
    if (!attackReady(state, enemy, 'gun', warningTicks, events)) return;
    fireHostile(state, enemy, ENEMY_KINDS.bomber.boltSpeed, 0, events);
  } else {
    if (range > maxRange || state.enemyMines.length >= MINE_LIMIT
      || !attackReady(state, enemy, 'mine', warningTicks, events)) return;
    state.enemyMines.push({ x: enemy.x - Math.sin(enemy.yaw) * mineOffset, z: enemy.z - Math.cos(enemy.yaw) * mineOffset,
      alt: enemy.alt, born: state.tick });
  }
  enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
}

function moveAegis(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { speed, boltSpeed, range: maxRange, orbitRange, orbitMargin, orbitAngle, warningTicks, cooldownTicks } = ROSTER.aegis;
  enemy.closeRange = rangeMode(enemy.closeRange, range, orbitRange, orbitMargin);
  const side = enemy.id % 2 ? 1 : -1;
  steer(state, enemy, ground, angle + (enemy.closeRange ? side * orbitAngle : 0), speed);
  if (enemy.eliteVolley) {
    if (state.tick < enemy.eliteVolley.secondAt) return;
    fireHostile(state, enemy, boltSpeed, 0, events);
    delete enemy.eliteVolley;
    delete enemy.tell;
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
    return;
  }
  if (range <= maxRange && attackReady(state, enemy, 'aegis', warningTicks, events, 2)) {
    fireHostile(state, enemy, boltSpeed, 0, events);
    if (enemy.elite) {
      const started = state.tick - warningTicks;
      enemy.eliteVolley = { started, secondAt: state.tick + 30 };
      enemy.tell = { kind: 'aegis', started, until: state.tick + 30 };
    } else enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  }
}

function moveTurret(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number, events?: CombatEvents): void {
  const { range: maxRange, leadDistance, warningTicks, cooldownTicks } = ROSTER.flak;
  enemy.yaw += clamp(headingDelta(enemy.yaw, angle), -MAX_TURN, MAX_TURN);
  if (enemy.tell?.kind === 'flak') {
    const { x, z, alt, until } = enemy.tell;
    if (state.tick < until) return;
    state.effects.push({ x, z, alt, kind: 'flak', life: FLAK_LIFE });
    delete enemy.tell;
    enemy.shotAt = state.tick + shotInterval(state, cooldownTicks);
  } else if (state.tick >= enemy.shotAt && range <= maxRange) {
    const p = state.player;
    const target = { x: p.x + Math.sin(p.yaw) * leadDistance, z: p.z + Math.cos(p.yaw) * leadDistance };
    const alt = enemy.skim ? skimAltitude(ground(target.x, target.z)) : BANDS[enemy.band];
    if (!trySpendThreat(state, {
      tick: state.tick + warningTicks, source: `regular:${enemy.id}`, points: 1,
      activeFromTick: state.tick,
      activeUntilTick: state.tick + warningTicks + Math.ceil(FLAK_LIFE * TICKS_PER_SECOND),
      bearing: Math.atan2(enemy.x - p.x, enemy.z - p.z),
    })) {
      enemy.shotAt = state.tick + warningTicks + THREAT_BUDGET.spacingTicks;
      return;
    }
    enemy.tell = { ...target, alt, kind: 'flak', started: state.tick, until: state.tick + warningTicks };
    events?.tell?.('flak', target.x, target.z, alt);
  }
}

function stayWithBomber(state: StageState, enemy: Enemy, ground: Ground): boolean {
  const formation = enemy.formation;
  if (!formation) return false;
  let leader: Enemy | undefined;
  for (const candidate of state.enemies) {
    if (candidate.id === formation.leader && candidate.hp) {
      leader = candidate;
      break;
    }
  }
  if (!leader) {
    delete enemy.formation;
    return false;
  }
  const fx = Math.sin(leader.yaw), fz = Math.cos(leader.yaw);
  const vx = leader.vx + (leader.x + fz * formation.side * ESCORT_SPAN - fx * ESCORT_AFT - enemy.x) * 1.15;
  const vz = leader.vz + (leader.z - fx * formation.side * ESCORT_SPAN - fz * ESCORT_AFT - enemy.z) * 1.15;
  steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(ESCORT_SPEED, Math.hypot(vx, vz)));
  return true;
}

function advancePosition(enemy: Enemy, ground: Ground): void {
  const x = enemy.x + enemy.vx * STEP, z = enemy.z + enemy.vz * STEP;
  const floor = ground(x, z);
  if (!clearAt(enemy, floor)) {
    enemy.vx = enemy.vz = 0;
    return;
  }
  enemy.x = x;
  enemy.z = z;
  if (enemy.skim) enemy.alt = skimAltitude(floor);
}

function advanceGnat(state: StageState, enemy: Enemy, ground: Ground): void {
  const pursuing = enemy.gnatVariant === 'sting' && inBand(enemy.alt, state.player.altitude);
  if (pursuing) {
    const dx = state.player.x - enemy.x, dz = state.player.z - enemy.z;
    const scale = GNAT.speed / (Math.hypot(dx, dz) || 1);
    enemy.vx = dx * scale;
    enemy.vz = dz * scale;
    enemy.yaw = Math.atan2(dx, dz);
  } else if (enemy.eventFlight) {
    enemy.vx = (state.player.vx ?? 0) + enemy.eventFlight.x;
    enemy.vz = (state.player.vz ?? 0) + enemy.eventFlight.z;
    enemy.yaw = Math.atan2(enemy.vx, enemy.vz);
  }
  const x = enemy.x + enemy.vx * STEP, z = enemy.z + enemy.vz * STEP;
  if ((enemy.leaveAt !== undefined && state.tick >= enemy.leaveAt)
    || ground(x, z) + GNAT.clearance > enemy.alt) {
    enemy.hp = 0; // The formation left the fight. This is not a kill.
    return;
  }
  enemy.x = x;
  enemy.z = z;
  if (pursuing || enemy.eventFlight) return;
  const dx = state.player.x - x, dz = state.player.z - z;
  const distance = Math.hypot(dx, dz);
  if (distance > GNAT.spacing && (enemy.vx || enemy.vz)) {
    const blend = ROSTER.gnat.driftResponse * STEP;
    const speed = GNAT.speed / distance;
    enemy.vx += (dx * speed - enemy.vx) * blend;
    enemy.vz += (dz * speed - enemy.vz) * blend;
    enemy.yaw = Math.atan2(enemy.vx, enemy.vz);
  }
}

function maintainGnats(state: StageState, ground: Ground): void {
  const p = state.player;
  const yaw = Math.hypot(p.vx ?? 0, p.vz ?? 0) > 1 ? Math.atan2(p.vx!, p.vz!) : p.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let live = 0;
  for (const enemy of state.enemies) if (enemy.kind === 'gnat' && enemy.hp > 0) live++;
  if (live > state.swarmCap) {
    const rank = (enemy: Enemy) => {
      const dx = enemy.x - p.x, dz = enemy.z - p.z;
      return { distance: dx * dx + dz * dz, behind: dx * fx + dz * fz < 0 };
    };
    const ordered = state.enemies.filter(enemy => enemy.kind === 'gnat' && enemy.hp > 0)
      .map(enemy => ({ enemy, ...rank(enemy) }));
    ordered.sort((a, b) => Number(b.distance > GNAT.range ** 2) - Number(a.distance > GNAT.range ** 2)
      || Number(b.behind) - Number(a.behind) || b.distance - a.distance || b.enemy.id - a.enemy.id);
    for (let i = 0; i < live - state.swarmCap; i++) {
      ordered[i].enemy.hp = 0;
      ordered[i].enemy.shotDown = false;
    }
  }
  for (const enemy of state.enemies) {
    if (enemy.kind !== 'gnat' || !enemy.hp || enemy.entry || enemy.leaveAt !== undefined) continue;
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const distance = dx * dx + dz * dz;
    const distant = distance > SPAWN_WORLD.recycleDistance ** 2;
    const aft = dx * fx + dz * fz < 0 && distance > (GNAT.range * 0.6) ** 2;
    if (!distant && !aft) {
      if (enemy.farTicks) enemy.farTicks = 0;
      continue;
    }
    enemy.farTicks = (enemy.farTicks ?? 0) + 1;
    if (!(distant && enemy.farTicks === 1) && enemy.farTicks % TICKS_PER_SECOND !== 0) continue;
    const altitude = BANDS[enemy.band];
    for (let i = 0; i < 12; i++) {
      const spread = ((enemy.id * 0.61803398875 + i / 12) % 1) - 0.5;
      const bearing = yaw + spread * 2.1;
      const range = distant ? SPAWN_WORLD.recycleDistance * (i < 6 ? 0.8 : 0.65)
        : GNAT.range * (i < 6 ? 1.35 : 1.15);
      const x = p.x + Math.sin(bearing) * range, z = p.z + Math.cos(bearing) * range;
      if (ground(x, z) + GNAT.clearance > altitude) continue;
      enemy.x = x;
      enemy.z = z;
      enemy.alt = altitude;
      enemy.vx = -Math.sin(bearing) * GNAT.speed;
      enemy.vz = -Math.cos(bearing) * GNAT.speed;
      enemy.yaw = Math.atan2(enemy.vx, enemy.vz);
      enemy.farTicks = 0;
      delete enemy.tell;
      if (!distant) beginEnemyFlyIn(state, enemy, ground, p, 0.16);
      break;
    }
  }
}

export function spawnEscortGnats(state: StageState, source: Position & { band: Band }, ground: Ground,
  members: number, observeSwarm?: SwarmObserver): void {
  if (state.swarmNotice) return;
  const live = state.enemies.reduce((count, enemy) => count + Number(enemy.kind === 'gnat' && enemy.hp > 0), 0);
  const room = state.swarmCap - live;
  const aim = Math.atan2(state.player.x - source.x, state.player.z - source.z);
  const phase = state.run && phaseAt(state.tick / TICKS_PER_SECOND);
  const escortRng = { rng: state.seed ^ state.nextId };
  let spawned = 0;
  for (let i = 0; i < members && spawned < room; i++) {
    const yaw = aim + (2 * (i + 0.5) / members - 1) * ROSTER.gnat.escortHalfFan;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const radius = GNAT.spacing * ROSTER.gnat.escortSpacing;
    const spot = { x: source.x + fx * radius, z: source.z + fz * radius };
    if (ground(spot.x, spot.z) + GNAT.clearance > source.alt) continue;
    const variant = phase ? gnatVariantAt(phase, random(escortRng)) : undefined;
    const gnat = makeGnat(state, spot.x, spot.z, source.band, variant);
    gnat.alt = source.alt;
    gnat.leaveAt = state.tick + GNAT.lifeSeconds * TICKS_PER_SECOND;
    gnat.vx = fx * GNAT.speed;
    gnat.vz = fz * GNAT.speed;
    gnat.yaw = yaw;
    gnat.tell = { kind: 'gnat', started: state.tick, until: state.tick + ROSTER.gnat.warningTicks };
    state.enemies.push(gnat);
    spawned++;
  }
  observeSwarm?.(live + spawned, state.swarmCap, members > room);
}

export function advanceEnemies(state: StageState, ground: Ground, events?: CombatEvents, observeSwarm?: SwarmObserver): void {
  maintainGnats(state, ground);
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const director = state.phaseDirector;
  const introIds = director && state.tick < director.isolationUntil ? new Set(director.introIds ?? []) : null;
  const count = state.enemies.length;
  let swarmHeard = false;
  for (let i = 0; i < count; i++) {
    const enemy = state.enemies[i];
    if (!enemy.hp) continue;
    const introSuppressed = introIds !== null && !introIds.has(enemy.id);
    if (introSuppressed) suppressForIntro(state, enemy, director!.isolationUntil);
    if (enemy.tell && enemy.tell.kind !== 'snipe' && enemy.tell.kind !== 'flak' && state.tick > enemy.tell.until) delete enemy.tell;
    if (enemy.entry) {
      const { yaw, ...pose } = sampleFlyIn(enemy.entry, state.tick, ground);
      bankToward(enemy, yaw);
      Object.assign(enemy, pose);
      if (state.tick >= enemy.entry.arriveAt) {
        enemy.flightSpeed = enemy.entry.exitSpeed;
        if (enemy.kind === 'turret') enemy.bank = 0;
        if (enemy.kind === 'gnat') {
          const dx = p.x - enemy.x, dz = p.z - enemy.z;
          const speed = GNAT.speed / (Math.hypot(dx, dz) || 1);
          enemy.vx = dx * speed;
          enemy.vz = dz * speed;
          if (!introSuppressed) {
            enemy.tell = { kind: 'gnat', started: state.tick, until: state.tick + ROSTER.gnat.warningTicks };
            if (!swarmHeard) events?.tell?.('gnat', enemy.x, enemy.z, enemy.alt);
            swarmHeard = true;
          }
        }
        delete enemy.entry;
      }
      // Fly-in skips attack AI. Collision checks use the entry flag until arrival.
      continue;
    }
    if (enemy.escortClearYaw !== undefined) {
      const speed = enemy.flightSpeed ?? (ENEMY_KINDS[enemy.kind] as { speed?: number }).speed ?? 1;
      steer(state, enemy, ground, enemy.escortClearYaw, speed);
      advancePosition(enemy, ground);
      continue;
    }
    if (enemy.kind === 'gnat') {
      advanceGnat(state, enemy, ground);
      continue;
    }
    const dx = p.x - enemy.x, dz = p.z - enemy.z, range = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    if (enemy.kind === 'turret') {
      moveTurret(state, enemy, ground, angle, range, events);
      continue;
    }
    if (enemy.course && state.tick >= enemy.course.until) delete enemy.course;
    const course = enemy.course;
    if (course && enemy.flyby) finishFlyby(state, enemy);
    if (!course && (enemy.kind === 'patrol' || enemy.kind === 'interceptor' || enemy.kind === 'flanker')
      && moveFlyby(state, enemy, ground, fx, fz, dx, dz)) {
      advancePosition(enemy, ground);
      const pass = enemy.flyby;
      const tell = enemy.kind === 'flanker' ? 'strafe' : 'gun';
      if (pass?.phase === 'cross' && pass.side * (dz * Math.sin(pass.yaw) - dx * Math.cos(pass.yaw)) <= 0
        && attackReady(state, enemy, tell, ROSTER[enemy.kind].warningTicks, events, enemy.kind === 'flanker' ? 2 : 1)) {
        fireHostile(state, enemy, ENEMY_KINDS[enemy.kind].boltSpeed, 0, events);
        enemy.shotAt = state.tick + shotInterval(state, 255);
      }
      continue;
    }
    if ((enemy.kind === 'hound' || enemy.kind === 'interceptor') && (range <= ROSTER.hound.bandFollowRange || enemy.maneuver)) {
      followPlayerBand(state, enemy, ground, events);
    }
    if (enemy.kind === 'harrier' && moveBetweenBands(state, enemy, ground, ROSTER.harrier.bandSpeed)) enemy.maneuverAt = state.tick + 360;
    const intercept = enemy.kind === 'interceptor' && range < ROSTER.interceptor.tailRange
      && dx * fx + dz * fz >= range * Math.cos(ROSTER.interceptor.tailHalfAngle);
    if (course) {
      const tx = course.target.x - enemy.x, tz = course.target.z - enemy.z;
      const remaining = Math.hypot(tx, tz);
      steer(state, enemy, ground, remaining > 0.001 ? Math.atan2(tx, tz) : enemy.yaw, Math.min(course.speed, remaining / STEP));
    } else if (enemy.kind === 'twin-chaser') {
      moveTwinChaser(state, enemy, ground, angle, range);
    } else if (enemy.kind === 'crosswing') {
      moveCrosswing(state, enemy, ground, angle, range);
    } else if (enemy.kind === 'manta') {
      moveManta(state, enemy, ground, angle, range);
    } else if (enemy.kind === 'mender') {
      moveMender(state, enemy, ground, angle);
    } else if (enemy.kind === 'skimmer') {
      moveSkimmer(state, enemy, ground, angle, range, events);
    } else if (enemy.kind === 'spotter') {
      moveSpotter(state, enemy, ground, angle, range, events);
    } else if (enemy.kind === 'hound' || enemy.kind === 'harrier') {
      moveTail(state, enemy, ground, enemy.kind, fx, fz, dx, dz, events);
    } else if (enemy.kind === 'flanker') {
      moveFlanker(state, enemy, ground, fx, fz, dx, dz, events);
    } else if (enemy.kind === 'diver') {
      moveDiver(state, enemy, ground, angle, range, events);
    } else if (enemy.kind === 'bomber') {
      moveBomber(state, enemy, ground, angle, range, events, observeSwarm);
    } else if (enemy.kind === 'aegis') {
      moveAegis(state, enemy, ground, angle, range, events);
    } else if (intercept) {
      const { tailSlot, tailSpeedScale } = ROSTER.interceptor;
      const speed = state.speed - tailSlot;
      const vx = dx + fx * speed, vz = dz + fz * speed;
      const limit = ENEMY_KINDS.interceptor.pursuit * tailSpeedScale;
      steer(state, enemy, ground, Math.atan2(vx, vz), Math.min(limit, Math.hypot(vx, vz)));
    } else if (range > 0.001 && !stayWithBomber(state, enemy, ground)) {
      const { longRange, longMargin, closeMargin } = ROSTER.pursuit;
      enemy.longRange = rangeMode(enemy.longRange, -range, -longRange, longMargin);
      const trailing = enemy.longRange && dx * fx + dz * fz > 0;
      const weave = Math.sin(state.tick / 91 + enemy.id * 1.79) * (trailing ? 0.112 : 0.32);
      const stats = ENEMY_KINDS[enemy.kind];
      enemy.closeRange = rangeMode(enemy.closeRange, range, ROSTER[enemy.kind].closeRange, closeMargin);
      steer(state, enemy, ground, angle + (enemy.closeRange ? 1.45 : weave),
        trailing ? stats.pursuit * pursuitBoost(state, enemy) : stats.speed);
    }
    advancePosition(enemy, ground);
    if ((enemy.kind === 'patrol' || enemy.kind === 'interceptor') && range < ROSTER.pursuit.fireRange
      && enemy.maneuver?.phase !== 'diving' && attackReady(state, enemy, intercept && inBand(enemy.alt, p.altitude) ? 'tail' : 'gun',
        ROSTER[enemy.kind].warningTicks, events)) {
      fireHostile(state, enemy, ENEMY_KINDS[enemy.kind].boltSpeed, 0, events);
      enemy.shotAt = state.tick + shotInterval(state, 255 + Math.floor(random(state.run ? state.streams.combat : state) * 105));
    }
  }
}
