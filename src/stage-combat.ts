import type { Ace, AceTell, Effect, Enemy, Flare, Ground, KillCredit, Point, Position, RearBomb, RearGlimpse, Shot,
  StageState } from './stage-types.ts';
import { ACE } from './data/ace.ts';
import { reportDamage } from './combat-feedback.ts';
import { aegisBlocks } from './data/roster.ts';
import { scaleClimb } from './data/speed.ts';
import { BOOST_SPEED } from './flight.ts';
import { adjacentBand, bandAltitude, BANDS, canCueAltitude, contactBand, playerBand, SKIM, SKIM_BAND, skimAltitude, type FlightBand } from './bands.ts';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { FLAK_RADIUS, HOSTILE_BOLT_LIFE, HOSTILE_GRAZE_RADIUS, HOSTILE_HIT_RADIUS, HOSTILE_IFRAME_TICKS, hostileShape,
  MINE_RADIUS, type HostileSourceKind } from './data/hostile-fire.ts';
import { ROLLS, ROLL_PARRY_XP } from './data/roll.ts';
import { HOSTILE_SHOT_LIMIT, PLAYER_PROJECTILES, PLAYER_SHOT_LIMIT, REAR_ORDNANCE, SURVIVOR_PLAYER_DAMAGE,
  WEAPON_PROJECTILE_LIMITS } from './data/run-balance.ts';
import { TWIN_VOLLEYS, WEAPONS, type WeaponId } from './data/items.ts';
import type { CombatEvents } from './hostile-events.ts';
import { advanceEchoDeadlines, buffTuning, criticalDamage, familyBonus, hitWindow, weaponCooldown, weaponDamage } from './loadout.ts';
import { nearestBand } from './maneuvers.ts';
import { advanceRangedShot } from './ranged-weapons.ts';
import { rollBoltImmune, rollParryActive } from './roll.ts';

import { TICKS_PER_SECOND } from './simulation-time.ts';

export { TICKS_PER_SECOND };
export const STEP = 1 / TICKS_PER_SECOND;
export { BANDS } from './bands.ts';
export const HIT_WINDOW = 8;
export const MIN_ALTITUDE = skimAltitude();
export const MAX_ALTITUDE = 230;
export const VERTICAL_SPEED = scaleClimb(40);
export const WIPE_DURATION = 0.15;
export const BOLT_SPEED = PLAYER_PROJECTILES.boltSpeed;
export const SHOT_LIMIT = 192;
export const MINE_LIMIT = 16;
export { BODY_RADIUS, FLAK_RADIUS, HOSTILE_HIT_RADIUS, MINE_RADIUS } from './data/hostile-fire.ts';
export const FLAK_LIFE = 0.65;
export const BOMB_BLAST_RADIUS = WEAPONS['bomb-bay'].tuning.radius[0];
export const FLARE_LIFE_TICKS = 120;
export const FLARE_GRAVITY = scaleClimb(14);
export const REAR_GLIMPSE_TICKS = 84;
const REAR_IMPACT_TICKS = 45;
const FLARE_HIT_RADIUS = 4.5;
const FLARE_BURN_TICKS = 88;
const FLARE_BURN_INTERVAL = 27;
const FLARE_CONFIRM_TICKS = 72;
const BOMB_HOLD_TICKS = 27;
const BOMB_FALL_SPEED = scaleClimb(24);
const LOCK_TICKS = 21;
const HIT_RADIUS = 6;
const TWIN_CONE = Math.PI / 6;
const TWIN_MUZZLE = 6;
const LOCK_RANGE = WEAPONS.twin.tuning.range;
const REVERSAL_WINDOW = 120;
const REVERSAL_CADENCE = 4;
const REVERSAL_SPEED = PLAYER_PROJECTILES.reversalSpeed;
const REVERSAL_HITS = 3;
const REVERSAL_STREAK_TICKS = 21;
const REVERSAL_SPREAD = [0, -0.055, 0.055, -0.11, 0.11];
const REVERSAL_MUZZLES = [0, -2.2, 2.2, -4.4, 4.4];
const REVERSAL_CONFIRM = 60;
const STRAFE_CADENCE = 33;
const STRAFE_SPEED = PLAYER_PROJECTILES.strafeSpeed;
const STRAFE_CONE = 38 * Math.PI / 180;
const STRAFE_MIN_RANGE = PLAYER_PROJECTILES.strafeMinRange;
const STRAFE_RANGE = PLAYER_PROJECTILES.strafeRange;
const STRAFE_BAND_WINDOW = 12;
const grazedShots = new WeakSet<Shot>();

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const angleTo = (yaw: number, dx: number, dz: number): number => {
  const difference = Math.atan2(dx, dz) - yaw;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
};
export const inBand = (first: number, second: number, window = HIT_WINDOW): boolean =>
  Math.abs(first - second) <= window;

const isGroundAa = (unit: { kind?: string } | null | undefined): boolean => unit?.kind === 'turret';

export function hostileCanHit(altitude: number, state: Pick<StageState, 'player' | 'invulnerability' | 'hull' | 'roll'>): boolean {
  return state.hull > 0 && state.invulnerability <= 0 && !rollBoltImmune(state.roll) && inBand(altitude, state.player.altitude);
}

export function hurtPlayer(state: StageState, source?: Position, events?: CombatEvents,
  amount = state.run ? SURVIVOR_PLAYER_DAMAGE : 2): void {
  if (state.invulnerability > 0 || !state.hull) return;
  const p = state.player;
  const damage = Math.min(state.hull, amount);
  state.hull -= damage;
  if (!state.hull && state.run && state.hangar.ejector && !state.ejectorUsed) {
    state.ejectorUsed = true;
    state.hull = Math.ceil(state.maxHull / 2);
  }
  state.hitsTaken++;
  state.lastHitTick = state.tick;
  state.invulnerability = HOSTILE_IFRAME_TICKS * STEP;
  state.effects.push({ kind: 'hit', x: p.x, z: p.z, alt: p.altitude, life: 0.36 });
  events?.hit?.(damage, source?.x ?? p.x, source?.z ?? p.z, source?.alt ?? p.altitude);
}

export function hurtEnemy(state: StageState, enemy: Enemy, damage: number, credit?: KillCredit, source?: Point): void {
  if (!enemy.hp || enemy.entry) return;
  if (source && aegisBlocks(enemy, source.x, source.z)) {
    state.effects.push({ kind: 'hit', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.16 });
    return;
  }
  if (state.player.skim && enemy.kind === 'turret') damage *= SKIM.groundDamageScale;
  const dealt = criticalDamage(state, damage);
  enemy.hp = Math.max(0, enemy.hp - dealt);
  reportDamage(state, enemy.id, dealt, dealt > damage, enemy);
  enemy.hitUntil = state.tick + 8;
  enemy.shotDown = enemy.hp === 0;
  if (state.run && enemy.shotDown && credit) enemy.killCredit = credit;
  state.effects.push({ kind: 'hit', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.16 });
}

type RearWeapon = Extract<KillCredit['weapon'], 'pods' | 'phoenix' | 'bomb-bay'>;

export function rearWeaponCredit(state: StageState, enemy: Enemy, weapon: RearWeapon): KillCredit {
  const { x, z, yaw } = state.player, dx = enemy.x - x, dz = enemy.z - z;
  const aft = dx * Math.sin(yaw) + dz * Math.cos(yaw) < 0;
  const pursuing = enemy.kind === 'hound' || enemy.kind === 'harrier' || dx * enemy.vx + dz * enemy.vz < 0;
  return aft && pursuing ? { weapon, rear: true } : { weapon };
}

function friendlyShotCredit(state: StageState, enemy: Enemy, shot: Shot): KillCredit {
  if (shot.kind === 'pods') return rearWeaponCredit(state, enemy, 'pods');
  const weapon = 'weapon' in shot ? shot.weapon : 'twin';
  return shot.lockId === enemy.id ? { weapon, locked: true } : { weapon };
}

// --- S7e lane ---
export function activeAce(state: Pick<StageState, 'boss'>): Ace | null {
  return state.boss?.hp ? state.boss : null;
}

export function aceVulnerable(ace: Ace): boolean {
  return ace.hp > 0 && !ace.entry && (!ace.roll || ace.roll.elapsed >= ROLLS.barrel.iframeTicks);
}

export function hurtAce(state: StageState, ace: Ace, damage: number): void {
  if (!aceVulnerable(ace)) return;
  const dealt = criticalDamage(state, damage);
  ace.hp = Math.max(0, ace.hp - dealt);
  reportDamage(state, ace.id, dealt, dealt > damage, ace);
  ace.hits++;
  ace.hitUntil = state.tick + 8;
  state.effects.push({ kind: 'hit', x: ace.x, z: ace.z, alt: ace.alt, life: 0.16 });
}

export function projectileRoom(state: StageState, kind: WeaponId | 'hostile'): number {
  if (!state.run) return Math.max(0, SHOT_LIMIT - state.shots.length);
  let hostile = 0, weapon = 0;
  for (const shot of state.shots) {
    if (shot.kind === 'hostile') hostile++;
    else if (('weapon' in shot ? shot.weapon : shot.kind === 'strafe' ? 'twin' : shot.kind) === kind) weapon++;
  }
  return kind === 'hostile' ? Math.max(0, HOSTILE_SHOT_LIMIT - hostile) :
    Math.max(0, Math.min(PLAYER_SHOT_LIMIT - (state.shots.length - hostile), WEAPON_PROJECTILE_LIMITS[kind] - weapon));
}

function interceptSeconds(dx: number, dz: number, dy: number, vx: number, vz: number, speed: number): number {
  const speedDifference = speed ** 2 - vx ** 2 - vz ** 2;
  const along = dx * vx + dz * vz;
  const distanceSquared = dx ** 2 + dz ** 2 + dy ** 2;
  const discriminant = along ** 2 + speedDifference * distanceSquared;
  if (discriminant < 0) return Infinity;
  const closing = Math.sqrt(discriminant) - along;
  return closing > 0 ? distanceSquared / closing : Infinity;
}

export function fireHostile(state: StageState, source: Position & { kind?: HostileSourceKind },
  speed: number, spread = 0, events?: CombatEvents): void {
  if (!projectileRoom(state, 'hostile')) return;
  const p = state.player;
  let dx = p.x - source.x, dz = p.z - source.z;
  if (source.kind === 'hound' || source.kind === 'harrier') {
    // These pursuers fire from offset tail slots. Lead the current course with unguided bolts.
    const vx = p.vx ?? Math.sin(p.yaw) * state.speed, vz = p.vz ?? Math.cos(p.yaw) * state.speed;
    const lead = interceptSeconds(dx, dz, 0, vx, vz, speed);
    if (lead <= HOSTILE_BOLT_LIFE) {
      dx += vx * lead;
      dz += vz * lead;
    }
  }
  const yaw = Math.atan2(dx, dz) + spread;
  const shot: Shot = {
    x: source.x, z: source.z, alt: source.alt, kind: 'hostile',
    vx: Math.sin(yaw) * speed, vz: Math.cos(yaw) * speed,
    damage: 2, life: HOSTILE_BOLT_LIFE, volley: 0, nearMiss: false, lockId: null,
  };
  state.shots.push(shot);
  events?.muzzle?.(shot, hostileShape(source.kind), source.x, source.z, source.alt);
}

// --- S7e lane ---
export function fireAceSalvo(state: StageState, ace: Ace, tell: AceTell, pattern: readonly number[], events?: CombatEvents): void {
  const guided = tell.kind === 'missile';
  const speed = BOOST_SPEED * (guided ? ACE.missile.speedScale : ACE.gun.speedScale);
  const yaw = Math.atan2(tell.x - ace.x, tell.z - ace.z);
  let room = projectileRoom(state, 'hostile');
  for (const offset of pattern) {
    if (room-- <= 0) break;
    const shot: Shot = {
      kind: 'hostile', x: ace.x, z: ace.z, alt: ace.alt,
      vx: Math.sin(yaw + offset) * speed, vz: Math.cos(yaw + offset) * speed,
      damage: 2, life: guided ? ACE.missile.life : HOSTILE_BOLT_LIFE, volley: 0, nearMiss: false, lockId: null,
      ...(guided ? { hostileKind: 'ace-missile' } : {}),
    };
    state.shots.push(shot);
    events?.muzzle?.(shot, guided ? 'diamond' : 'needle', ace.x, ace.z, ace.alt);
  }
}

function steerAceMissile(shot: Shot, player: Position): void {
  const yaw = Math.atan2(shot.vx, shot.vz);
  const turn = ACE.missile.turnRate * STEP;
  const steering = yaw + clamp(angleTo(yaw, player.x - shot.x, player.z - shot.z), -turn, turn);
  const speed = Math.hypot(shot.vx, shot.vz);
  shot.vx = Math.sin(steering) * speed;
  shot.vz = Math.cos(steering) * speed;
}

type Aim = Position & { vx?: number; vz?: number; id: number; kind?: string };

function fireFriendly(
  state: StageState, kind: 'twin' | 'pods', offsets: readonly number[], target: Aim | null, lockId: number | null,
): void {
  const p = state.player;
  const forwardX = Math.sin(p.yaw), forwardZ = Math.cos(p.yaw);
  const lead = target ? Math.hypot(target.x - p.x, target.z - p.z) / BOLT_SPEED : 0;
  const vy = target && isGroundAa(target) && lead > 0 ? (target.alt - p.altitude) / lead : 0;
  const volley = ++state.nextVolley;
  const level = state.run?.weaponLevels[kind] ?? 1;
  const pierce = (lockId === null ? WEAPONS[kind].tuning.pierce[level - 1] : 0)
    + (familyBonus(state, kind)?.pierce ?? 0);
  const aurora = kind === 'twin' && !!state.run?.evolutions.twin;
  const fan = kind === 'twin' ? WEAPONS.twin.tuning.fanDegrees[level - 1] * Math.PI / 180 : 0;
  const tracerScale = kind === 'twin' ? WEAPONS.twin.tuning.tracerScale[level - 1] : 1;
  const maxOffset = Math.max(...offsets.map(Math.abs));
  const podLife = kind === 'pods' && state.run
    ? Math.max(0.27, (WEAPONS.pods.tuning.range[level - 1] + HIT_RADIUS) / BOLT_SPEED) : 0.27;
  let room = projectileRoom(state, kind);
  for (let i = 0; i < offsets.length; i++) {
    if (room-- <= 0) break;
    const side = offsets[i];
    const fanned = fan > 0 && Math.abs(i - (offsets.length - 1) / 2) > 0.5;
    const muzzle = kind === 'twin' ? TWIN_MUZZLE : 0;
    const x = p.x + forwardX * muzzle + forwardZ * side;
    const z = p.z + forwardZ * muzzle - forwardX * side;
    const aim = target
      ? Math.atan2(target.x + (target.vx ?? 0) * lead - (fanned ? p.x + forwardX * muzzle : x),
        target.z + (target.vz ?? 0) * lead - (fanned ? p.z + forwardZ * muzzle : z))
      : p.yaw;
    const wingSpread = fanned ? side / maxOffset * fan : 0;
    const yaw = aim + wingSpread + (aurora && (fanned || !fan) ? side * CLOSE_EVOLUTIONS.aurora.fan : 0);
    state.shots.push({
      x, z, alt: p.altitude, kind, vx: Math.sin(yaw) * BOLT_SPEED, vz: Math.cos(yaw) * BOLT_SPEED,
      damage: weaponDamage(state, kind, kind === 'twin' ? state.twinDamage : state.podDamage),
      life: kind === 'twin' ? 0.68 : podLife, volley, nearMiss: false, lockId,
      ...(vy ? { vy } : {}),
      ...(tracerScale !== 1 ? { tracerScale } : {}),
      ...(pierce ? { pierce: { remaining: pierce + 1, hits: [] } } : {}),
      ...(aurora ? { aurora: true } : {}),
    });
  }
}

function podOffsets(count: number, center: number): number[] {
  return Array.from({ length: count }, (_, i) => center + (i - (count - 1) / 2) * 3.5);
}

type RankedTarget = { enemy: Enemy; range: number };

function fireOverdrive(state: StageState, pass: NonNullable<StageState['reversal']>, targets: RankedTarget[]): void {
  const room = projectileRoom(state, 'twin');
  if (!targets.length || !room) return;
  const p = state.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const volley = ++state.nextVolley;
  const aurora = !!state.run?.evolutions.twin;
  const pierce = familyBonus(state, 'twin')?.pierce ?? 0;
  targets.sort((a, b) => a.range - b.range);
  for (let i = 0; i < Math.min(room, REVERSAL_SPREAD.length); i++) {
    const { enemy, range } = targets[i % targets.length];
    const side = REVERSAL_MUZZLES[i];
    const x = p.x + fx * TWIN_MUZZLE + fz * side;
    const z = p.z + fz * TWIN_MUZZLE - fx * side;
    const lead = range / REVERSAL_SPEED;
    const aim = Math.atan2(enemy.x + enemy.vx * lead - x, enemy.z + enemy.vz * lead - z);
    const yaw = aim + (i < targets.length ? 0 : REVERSAL_SPREAD[i]);
    state.shots.push({
      x, z, alt: p.altitude, kind: 'twin',
      vx: Math.sin(yaw) * REVERSAL_SPEED, vz: Math.cos(yaw) * REVERSAL_SPEED,
      damage: weaponDamage(state, 'twin', state.twinDamage), life: 0.44, volley, nearMiss: false, lockId: null,
      reversal: { remaining: REVERSAL_HITS + pierce, hits: [] }, reversalTick: pass.startTick,
      ...(aurora ? { aurora: true } : {}),
    });
  }
  pass.nextShotAt = state.tick + weaponCooldown(state, 'twin', REVERSAL_CADENCE);
}

export function openReversal(state: StageState, pursuers: readonly number[]): void {
  state.reversal = {
    startTick: state.tick, until: state.tick + REVERSAL_WINDOW + (buffTuning(state, 'overdrive-coil')?.bonusTicks ?? 0),
    pursuers: [...pursuers],
    kills: 0, killTicks: [], streak: 0, nextShotAt: state.tick, shownUntil: state.tick,
  };
  advanceEchoDeadlines(state);
}

// --- S7d lane ---
function strafeBandMatches(enemy: Enemy | Ace, band: FlightBand, altitude: number, window: number): boolean {
  if (isGroundAa(enemy)) return inBand(enemy.alt, altitude, window);
  return (band === SKIM_BAND) === (contactBand(enemy) === SKIM_BAND) && inBand(enemy.alt, altitude, window);
}

function fireStrafe(state: StageState, target: Enemy, targetBand: FlightBand, aurora: boolean): void {
  const p = state.player;
  const x = p.x + Math.sin(p.yaw) * TWIN_MUZZLE;
  const z = p.z + Math.cos(p.yaw) * TWIN_MUZZLE;
  const dx = target.x - x, dz = target.z - z, dy = target.alt - p.altitude;
  const lead = interceptSeconds(dx, dz, dy, target.vx, target.vz, STRAFE_SPEED);
  if (lead === Infinity) return;
  const vy = dy / lead;
  if (!vy) return;
  const window = hitWindow(state, STRAFE_BAND_WINDOW);
  const groundAa = isGroundAa(target);
  const targetAltitude = groundAa || targetBand === SKIM_BAND ? target.alt : bandAltitude(targetBand);
  const life = vy < 0 ? (p.altitude - targetAltitude + window) / -vy : (targetAltitude + window - p.altitude) / vy;
  if (life <= 0) return;
  const pierce = familyBonus(state, 'twin')?.pierce ?? 0;
  state.shots.push({
    x, z, alt: p.altitude, kind: 'strafe', targetBand: groundAa ? SKIM_BAND : targetBand,
    ...(groundAa || targetBand === SKIM_BAND ? { targetAltitude } : {}),
    vx: dx / lead + target.vx, vz: dz / lead + target.vz, vy,
    damage: weaponDamage(state, 'twin', 1), life,
    volley: ++state.nextVolley, nearMiss: false, lockId: null,
    ...(pierce ? { pierce: { remaining: pierce + 1, hits: [] } } : {}),
    ...(aurora ? { aurora: true } : {}),
  });
  state.strafeAt = state.tick + weaponCooldown(state, 'twin', aurora ? CLOSE_EVOLUTIONS.aurora.adjacentCadence : STRAFE_CADENCE);
}

export function acquireAndFire(state: StageState): void {
  const p = state.player;
  const twinLevel = state.run?.weaponLevels.twin;
  const podLevel = state.run?.weaponLevels.pods;
  const hasTwin = !state.run || !!twinLevel;
  const aurora = !!state.run?.evolutions.twin;
  const hasPods = !state.run || (!!podLevel && !state.run.evolutions.pods);
  const weaponWindow = hitWindow(state);
  const ace = activeAce(state);
  const aceRange = ace ? Math.hypot(ace.x - p.x, ace.z - p.z) : Infinity;
  const aceAngle = ace ? Math.abs(angleTo(p.yaw, ace.x - p.x, ace.z - p.z)) : Infinity;
  const lockTicks = Math.round(LOCK_TICKS * (buffTuning(state, 'fire-control')?.lockScale ?? 1));
  const aceVisible = ace !== null && !ace.entry && aceRange <= LOCK_RANGE && aceAngle <= TWIN_CONE;
  const aceAligned = aceVisible && inBand(p.altitude, ace.alt, weaponWindow);
  if (aceAligned && aceAngle <= Math.PI / 15) {
    const previous = state.lock?.id === ace.id ? state.lock.progress : 0;
    const ticks = Math.min(lockTicks, Math.round(previous * lockTicks) + 1);
    state.lock = { id: ace.id, progress: ticks / lockTicks, ready: ticks === lockTicks };
  } else {
    state.lock = null;
  }

  const locked = !!state.lock?.ready;
  let twin: Aim | null = aceAligned ? ace : null;
  let wrong: Aim | null = aceVisible && !aceAligned && canCueAltitude(p, ace.alt) ? ace : null;
  const forwardRange = WEAPONS.twin.tuning.range;
  let twinRange: number = twin ? aceRange : forwardRange, wrongRange: number = wrong ? aceRange : forwardRange;
  let left: Enemy | null = null, right: Enemy | null = null, rear: Enemy | null = null;
  let leftRange = WEAPONS.pods.tuning.range[podLevel ? podLevel - 1 : 0];
  let rightRange = leftRange, rearRange = leftRange;
  const reversal = state.reversal;
  const overdrive = reversal && state.tick < reversal.until ? reversal : null;
  const reversalReady = overdrive && state.tick >= overdrive.nextShotAt;
  const overdriveTargets: RankedTarget[] = [];
  const eligibleBand = playerBand(p);
  const strafeReady = hasTwin && state.tick >= state.strafeAt;
  const lowerBand = !strafeReady ? null : p.skim ? SKIM_BAND
    : aurora || inBand(p.altitude, bandAltitude(eligibleBand)) ? adjacentBand(eligibleBand, -1) : null;
  const upperBand = strafeReady && aurora ? adjacentBand(eligibleBand, 1) : null;
  const lowerTargets: RankedTarget[] = [], upperTargets: RankedTarget[] = [];
  const strafeWindow = hitWindow(state, STRAFE_BAND_WINDOW);
  for (const enemy of state.enemies) {
    if (!enemy.hp) continue;
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const bearing = angleTo(p.yaw, dx, dz), range = Math.hypot(dx, dz);
    const sameBand = inBand(p.altitude, enemy.alt, weaponWindow);
    const angle = Math.abs(bearing);
    const groundAa = isGroundAa(enemy);
    const twinIsGround = isGroundAa(twin);
    if (angle <= TWIN_CONE) {
      if (sameBand && !locked && range <= (twinIsGround ? forwardRange : twinRange)) {
        twin = enemy;
        twinRange = range;
      } else if (groundAa && !locked && hasTwin && range <= forwardRange && range <= twinRange && (!twin || twinIsGround)) {
        twin = enemy;
        twinRange = range;
      } else if (!sameBand && range < wrongRange && canCueAltitude(p, enemy.alt)
        && !(groundAa && range <= forwardRange)) {
        wrong = enemy;
        wrongRange = range;
      }
      if (hasTwin && sameBand && reversalReady && range <= forwardRange) overdriveTargets.push({ enemy, range });
    } else if (hasPods && sameBand && angle >= Math.PI * 0.2) {
      if (bearing < 0 && range < leftRange) {
        left = enemy;
        leftRange = range;
      } else if (bearing > 0 && range < rightRange) {
        right = enemy;
        rightRange = range;
      }
      if (podLevel && WEAPONS.pods.tuning.rear[podLevel - 1] && angle >= Math.PI * 0.65 && range < rearRange) {
        rear = enemy;
        rearRange = range;
      }
    }
    if (range < STRAFE_MIN_RANGE || range > STRAFE_RANGE || angle > STRAFE_CONE) continue;
    if (groundAa && strafeReady) lowerTargets.push({ enemy, range });
    else if (lowerBand !== null && strafeBandMatches(enemy, lowerBand, lowerBand === SKIM_BAND ? enemy.alt : BANDS[lowerBand], strafeWindow)
      && !p.skim) lowerTargets.push({ enemy, range });
    if (upperBand !== null && strafeBandMatches(enemy, upperBand, bandAltitude(upperBand), strafeWindow)) upperTargets.push({ enemy, range });
  }

  if (!twin && wrong) {
    if (state.wrongLayer?.id !== wrong.id) state.wrongLayer = { id: wrong.id, since: state.tick };
    state.altitudeHint = state.tick - state.wrongLayer.since >= 14 ? { delta: wrong.alt - p.altitude } : null;
  } else {
    state.wrongLayer = null;
    state.altitudeHint = null;
  }

  const primary = hasTwin && state.tick >= state.twinAt && (!overdrive || locked) ? twin : null;
  if (primary) {
    const barrels = twinLevel ? WEAPONS.twin.tuning.barrels[twinLevel - 1] : state.twinRank === 3 ? 4 : 2;
    fireFriendly(state, 'twin', TWIN_VOLLEYS[barrels], primary, locked && ace ? ace.id : null);
    const cadence = twinLevel ? WEAPONS.twin.tuning.cooldownTicks : state.twinRank === 1 ? 21 : 13;
    state.twinAt = state.tick + weaponCooldown(state, 'twin', cadence);
  }
  if (overdrive && reversalReady) fireOverdrive(state, overdrive, overdriveTargets);
  if (state.tick >= state.podsAt && (left || right || rear)) {
    const flank = WEAPONS.pods.tuning.flank[Math.max(1, podLevel ?? 1) - 1];
    if (left) fireFriendly(state, 'pods', podOffsets(flank, -6), left, null);
    if (right) fireFriendly(state, 'pods', podOffsets(flank, 6), right, null);
    if (rear && podLevel) fireFriendly(state, 'pods', podOffsets(WEAPONS.pods.tuning.rear[podLevel - 1], 0), rear, null);
    const cadence = podLevel ? WEAPONS.pods.tuning.cooldownTicks : state.podRank === 1 ? 43 : 25;
    state.podsAt = state.tick + weaponCooldown(state, 'pods', cadence);
  }
  fireStrafes(state, lowerTargets, lowerBand ?? (lowerTargets.length ? SKIM_BAND : null), aurora);
  fireStrafes(state, upperTargets, upperBand, aurora);
}

function fireStrafes(state: StageState, targets: RankedTarget[], band: FlightBand | null, aurora: boolean): void {
  if (band === null || !targets.length) return;
  targets.sort((a, b) => Number(isGroundAa(b.enemy)) - Number(isGroundAa(a.enemy)) || a.range - b.range);
  const room = projectileRoom(state, 'twin');
  for (let i = 0; i < Math.min(2, targets.length, room); i++) fireStrafe(state, targets[i].enemy, band, aurora);
}

function showRearLaunch(state: StageState, kind: RearGlimpse['kind']): void {
  const glimpse = state.rearGlimpse;
  const until = Math.max(glimpse?.until ?? 0, state.tick + REAR_GLIMPSE_TICKS);
  if (glimpse?.kind === kind) glimpse.until = until;
  else state.rearGlimpse = { kind, since: glimpse?.since ?? state.tick, until };
}

function showRearImpact(state: StageState, kind: RearGlimpse['kind'], { x, z, alt }: Position): void {
  state.rearGlimpse = {
    kind, target: { x, z, alt }, since: state.rearGlimpse?.since ?? state.tick,
    until: Math.max(state.rearGlimpse?.until ?? 0, state.tick + REAR_IMPACT_TICKS),
  };
}

function nearBomb(bomb: RearBomb, target: Position, radius: number): boolean {
  return Math.hypot(target.x - bomb.x, target.z - bomb.z) <= radius;
}

function blast(state: StageState, bomb: RearBomb): void {
  const familyScale = bomb.weapon ? familyBonus(state, bomb.weapon)?.radiusScale ?? 1 : 1;
  const radius = (bomb.radius ?? BOMB_BLAST_RADIUS) * (buffTuning(state, 'ordnance-rack')?.radiusScale ?? 1) * familyScale;
  const damage = bomb.damage ?? 4;
  const clearRadius = Math.max(REAR_ORDNANCE.bomb.clearRadius, radius);
  const belowLaunchBand = (target: Position): boolean => target.alt <= (bomb.ceiling ?? Infinity);
  state.effects.push({ kind: 'bomb-blast', x: bomb.x, z: bomb.z, alt: bomb.alt, life: 0.8, radius });
  showRearImpact(state, 'bomb', bomb);
  state.shots = state.shots.filter(shot => shot.kind !== 'hostile' || !nearBomb(bomb, shot, clearRadius));
  state.enemyMines = state.enemyMines.filter(mine => !nearBomb(bomb, mine, clearRadius));
  const window = hitWindow(state);
  for (const enemy of state.enemies) {
    if (enemy.hp && !enemy.entry && belowLaunchBand(enemy) && nearBomb(bomb, enemy, radius)
      && inBand(enemy.alt, bomb.alt, window)) {
      hurtEnemy(state, enemy, damage, rearWeaponCredit(state, enemy, 'bomb-bay'));
    }
  }
  const ace = activeAce(state);
  if (ace && belowLaunchBand(ace) && nearBomb(bomb, ace, radius) && inBand(ace.alt, bomb.alt, window)) {
    hurtAce(state, ace, damage);
  }
}

function launchFlares(state: StageState, vx: number, vz: number, fan: readonly number[], phoenixLevel: number): void {
  const p = state.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  // Keep boosted flares close enough to catch a tail while still inheriting launch momentum.
  const { aftOffset, kick: minimumKick, fanSpacing, lateralSpeed } = REAR_ORDNANCE.flare;
  const kick = Math.max(minimumKick, (vx * fx + vz * fz) * 0.89);
  const vy = clamp(state.climbRate * 0.2 - scaleClimb(7), -scaleClimb(12), -scaleClimb(6));
  const tuning = WEAPONS.phoenix.tuning;
  const bonus = tuning.lifeBonusTicks[phoenixLevel - 1];
  const firebird = state.run?.evolutions.phoenix;
  const evolution = CLOSE_EVOLUTIONS.phoenix;
  const ordnance = {
    weapon: 'phoenix' as const,
    lifeTicks: firebird ? evolution.lifeTicks : FLARE_LIFE_TICKS + bonus,
    burnTicks: Math.round((FLARE_BURN_TICKS + bonus) * (firebird ? evolution.burnScale : 1)),
    damage: weaponDamage(state, 'phoenix', 1),
    spread: tuning.burnRadius[phoenixLevel - 1] * (familyBonus(state, 'phoenix')?.radiusScale ?? 1) || undefined,
    ...(firebird ? { phoenix: true as const, sourceBand: playerBand(p) } : {}),
  };
  for (const side of fan) {
    state.flares.push({
      x: p.x - fx * aftOffset + fz * side * fanSpacing, z: p.z - fz * aftOffset - fx * side * fanSpacing, alt: p.altitude - 1,
      vx: vx - fx * kick + fz * side * lateralSpeed,
      vz: vz - fz * kick - fx * side * lateralSpeed,
      vy, born: state.tick, ...ordnance,
    });
  }
}

function setBurn(state: StageState, target: Enemy | Ace, interval: number, flare: Flare, credit?: KillCredit): void {
  if (!target.hp) return;
  if (state.tick >= (target.burnUntil ?? 0)) target.burnNextAt = state.tick + interval;
  const bonus = buffTuning(state, 'flare-bay')?.burnBonusTicks ?? 0;
  const until = state.tick + (flare.burnTicks ?? FLARE_BURN_TICKS) + bonus;
  target.burnUntil = Math.max(target.burnUntil ?? 0, until);
  if (state.run && credit && 'shotDown' in target && (flare.damage ?? 1) >= (target.burnDamage ?? 1)) target.burnCredit = credit;
  if (flare.damage !== undefined) target.burnDamage = Math.max(target.burnDamage ?? 1, flare.damage);
}

function ignite(state: StageState, target: Enemy | Ace, interval: number, flare: Flare, credit?: KillCredit): void {
  setBurn(state, target, interval, flare, credit);
  if (flare.spread) {
    state.weaponFx.push({ kind: 'flare-spread', from: { x: target.x, z: target.z, alt: target.alt },
      radius: flare.spread, until: state.tick + 24 });
    const window = hitWindow(state);
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || enemy.id === target.id || !inBand(target.alt, enemy.alt, window)) continue;
      if (Math.hypot(enemy.x - target.x, enemy.z - target.z) <= flare.spread) {
        setBurn(state, enemy, FLARE_BURN_INTERVAL, flare, rearWeaponCredit(state, enemy, 'phoenix'));
      }
    }
  }
  // Keep the camera on the first impact while the rest of the volley arrives.
  const prior = state.rearGlimpse;
  const recent = (state.flareHit?.until ?? 0) > state.tick + FLARE_CONFIRM_TICKS - 12;
  showRearImpact(state, 'flare', prior?.kind === 'flare' && prior.target && recent ? prior.target : target);
  state.flareHit = { until: state.tick + FLARE_CONFIRM_TICKS };
}

function burnTick(target: Enemy | Ace, tick: number, interval: number): boolean {
  if (!target.hp || target.burnNextAt === undefined || target.burnUntil === undefined) return false;
  if (tick >= target.burnUntil) {
    delete target.burnUntil;
    delete target.burnNextAt;
    delete target.burnDamage;
    if ('shotDown' in target) delete target.burnCredit;
    return false;
  }
  if (tick < target.burnNextAt) return false;
  target.burnNextAt += interval;
  return true;
}

function steerFirebird(state: StageState, flare: Flare, ace: Ace | null): boolean {
  const tuning = CLOSE_EVOLUTIONS.phoenix;
  const sourceBand = flare.sourceBand ?? nearestBand(flare.alt);
  const lowerBand = adjacentBand(sourceBand, -1);
  let aim: Enemy | Ace | null = null;
  let best: number = tuning.range ** 2;
  const targetDistance = (candidate: Enemy | Ace): number => {
    const band = contactBand(candidate);
    return candidate.hp && (band === sourceBand || band === lowerBand)
      ? (candidate.x - flare.x) ** 2 + (candidate.z - flare.z) ** 2 : Infinity;
  };
  if (ace && targetDistance(ace) < best) {
    aim = ace;
    best = targetDistance(ace);
  }
  for (const enemy of state.enemies) {
    if (enemy.entry) continue;
    const distance = targetDistance(enemy);
    if (distance < best) {
      best = distance;
      aim = enemy;
    }
  }
  if (!aim) return false;
  const lead = Math.min(0.65, Math.sqrt(best) / tuning.speed);
  const dx = aim.x + aim.vx * lead - flare.x, dz = aim.z + aim.vz * lead - flare.z;
  const heading = Math.atan2(flare.vx, flare.vz);
  const yaw = heading + clamp(angleTo(heading, dx, dz), -tuning.turnRate * STEP, tuning.turnRate * STEP);
  flare.vx = Math.sin(yaw) * tuning.speed;
  flare.vz = Math.cos(yaw) * tuning.speed;
  flare.vy = clamp((aim.alt - flare.alt) * 6, -tuning.verticalSpeed, tuning.verticalSpeed);
  return true;
}

export function advanceFlares(state: StageState, ground: Ground): void {
  if (state.flareHit && state.tick >= state.flareHit.until) state.flareHit = null;
  // Burns already active on a returning craft keep aging during fly-in.
  for (const enemy of state.enemies) {
    if (burnTick(enemy, state.tick, FLARE_BURN_INTERVAL) && !enemy.entry) {
      hurtEnemy(state, enemy, enemy.burnDamage ?? 1, enemy.burnCredit);
    }
  }
  const ace = activeAce(state);
  if (ace && burnTick(ace, state.tick, ACE.burnInterval)) hurtAce(state, ace, ace.burnDamage ?? 1);

  let alive = 0;
  const window = hitWindow(state);
  for (const flare of state.flares) {
    if (state.tick - flare.born >= (flare.lifeTicks ?? FLARE_LIFE_TICKS)) continue;
    if (!flare.phoenix || !steerFirebird(state, flare, ace && !ace.entry ? ace : null)) flare.vy -= FLARE_GRAVITY * STEP;
    const dx = flare.vx * STEP, dz = flare.vz * STEP, dy = flare.vy * STEP;
    const terrain = groundImpact(flare, dx, dz, ground, dy);

    let hit: Enemy | null = null;
    let first = terrain;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry) continue;
      const time = altitudeImpactTime(flare, dx, dz, dy, enemy, FLARE_HIT_RADIUS, window);
      if (time < first) {
        first = time;
        hit = enemy;
      }
    }
    if (ace && aceVulnerable(ace) && altitudeImpactTime(flare, dx, dz, dy, ace, ACE.hitRadius, window) < first) {
      hurtAce(state, ace, flare.damage ?? 1);
      ignite(state, ace, ACE.burnInterval, flare);
    } else if (hit) {
      const credit = rearWeaponCredit(state, hit, 'phoenix');
      hurtEnemy(state, hit, flare.damage ?? 1, credit);
      ignite(state, hit, FLARE_BURN_INTERVAL, flare, credit);
    } else if (terrain === Infinity) {
      flare.x += dx;
      flare.z += dz;
      flare.alt += dy;
      state.flares[alive++] = flare;
    }
  }
  state.flares.length = alive;
}

export function advanceEnemyHazards(state: StageState, ground: Ground, events?: CombatEvents): void {
  const p = state.player;
  let alive = 0;
  for (const mine of state.enemyMines) {
    mine.alt = Math.max(BANDS[0], mine.alt - scaleClimb(14) * STEP);
    if (state.tick - mine.born >= 6 * TICKS_PER_SECOND || mine.alt <= ground(mine.x, mine.z)) continue;
    if (inBand(mine.alt, p.altitude) && Math.hypot(mine.x - p.x, mine.z - p.z) <= MINE_RADIUS) {
      hurtPlayer(state, mine, events);
      state.effects.push({ kind: 'burst', x: mine.x, z: mine.z, alt: mine.alt, life: 0.52 });
    } else state.enemyMines[alive++] = mine;
  }
  state.enemyMines.length = alive;
  for (const puff of state.effects) {
    if (puff.kind === 'flak' && inBand(puff.alt, p.altitude) && Math.hypot(puff.x - p.x, puff.z - p.z) <= FLAK_RADIUS) {
      hurtPlayer(state, puff, events);
    }
  }
}

export function advanceRearBombs(state: StageState, ground: Ground): void {
  for (const fx of state.weaponFx) {
    if (fx.kind !== 'ground-fire' || state.tick >= fx.until || !fx.hits || !fx.damage || !fx.radius) continue;
    const within = (target: Position) => target.alt <= (fx.ceiling ?? Infinity)
      && inBand(target.alt, fx.from.alt, hitWindow(state)) && Math.hypot(target.x - fx.from.x, target.z - fx.from.z) <= fx.radius!;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || fx.hits.includes(enemy.id) || !within(enemy)) continue;
      fx.hits.push(enemy.id);
      hurtEnemy(state, enemy, fx.damage, rearWeaponCredit(state, enemy, 'bomb-bay'));
    }
    const ace = activeAce(state);
    if (ace && aceVulnerable(ace) && !fx.hits.includes(ace.id) && within(ace)) {
      fx.hits.push(ace.id);
      hurtAce(state, ace, fx.damage);
    }
  }
  if (!state.rearBombs.length) return;
  state.rearBombs = state.rearBombs.filter(bomb => {
    const age = state.tick - bomb.born;
    const drift = Math.max(0, 1 - age / BOMB_HOLD_TICKS) * STEP;
    bomb.x += bomb.vx * drift;
    bomb.z += bomb.vz * drift;
    const impactHeight = ground(bomb.x, bomb.z) + 1;
    if (age > BOMB_HOLD_TICKS) bomb.alt = Math.max(impactHeight, bomb.alt - BOMB_FALL_SPEED * STEP);
    const ace = activeAce(state);
    const close = (target: Position): boolean =>
      target.alt <= (bomb.ceiling ?? Infinity) && inBand(target.alt, bomb.alt, hitWindow(state))
      && nearBomb(bomb, target, REAR_ORDNANCE.bomb.proximity);
    if (bomb.alt > impactHeight && !state.enemies.some(enemy => enemy.hp && !enemy.entry && close(enemy))
      && !(ace && aceVulnerable(ace) && close(ace))) return true;
    blast(state, bomb);
    if (bomb.groundFire) {
      const tuning = WEAPONS['bomb-bay'].tuning;
      const radius = bomb.radius! * (familyBonus(state, 'bomb-bay')?.radiusScale ?? 1)
        * (buffTuning(state, 'ordnance-rack')?.radiusScale ?? 1);
      state.weaponFx.push({ kind: 'ground-fire', from: { x: bomb.x, z: bomb.z, alt: impactHeight },
        radius, ceiling: bomb.ceiling, until: state.tick + tuning.fireTicks,
        damage: bomb.damage! * tuning.fireDamageScale, hits: [] });
    }
    return false;
  });
}

export function advanceAutoOrdnance(state: StageState, reversed: boolean): void {
  const run = state.run;
  if (!run) return;
  const phoenix = run.weaponLevels.phoenix ?? 0;
  if (phoenix && (reversed || state.tick >= (state.weaponFireAt.phoenix ?? 0))) {
    const tuning = WEAPONS.phoenix.tuning;
    const count = run.evolutions.phoenix ? 1 : tuning.count[phoenix - 1];
    const fan = Array.from({ length: count }, (_, i) => i - (count - 1) / 2);
    launchFlares(state, state.player.vx ?? 0, state.player.vz ?? 0, fan, phoenix);
    showRearLaunch(state, 'flare');
    state.weaponFireAt.phoenix = state.tick + weaponCooldown(state, 'phoenix', tuning.cooldownTicks);
  }
  const bay = run.weaponLevels['bomb-bay'] ?? 0;
  if (!bay) return;
  const carpet = !!run.evolutions['bomb-bay'];
  if (carpet) state.nextBayDrop = null;
  const followUp = state.nextBayDrop !== null && state.tick >= state.nextBayDrop;
  if (!followUp && state.tick < (state.weaponFireAt['bomb-bay'] ?? 0)) return;
  const tuning = WEAPONS['bomb-bay'].tuning;
  const { count, spacing } = CLOSE_EVOLUTIONS.carpet;
  if (carpet && state.rearBombs.filter(bomb => bomb.weapon === 'bomb-bay').length > count) return;
  const { x, z, altitude: alt, yaw, skim } = state.player;
  // From SKIM the launch band sits only a few metres above ground turrets.
  const ceiling = alt - (skim ? SKIM.minClearance - SKIM.turretHeight : (BANDS[1] - BANDS[0]) / 2);
  const bombs = carpet ? count : 1;
  const dx = carpet ? Math.sin(yaw) * spacing : 0, dz = carpet ? Math.cos(yaw) * spacing : 0;
  const damage = weaponDamage(state, 'bomb-bay', tuning.damage);
  for (let i = 0; i < bombs; i++) {
    state.rearBombs.push({ x: x - dx * i, z: z - dz * i, alt, vx: 0, vz: 0, born: state.tick, weapon: 'bomb-bay',
      radius: tuning.radius[bay - 1], damage, ceiling,
      ...(carpet ? { carpet: true } : bay >= tuning.fireAt ? { groundFire: true } : {}) });
  }
  state.metrics.bombsDropped += bombs;
  showRearLaunch(state, 'bomb');
  if (!followUp) state.weaponFireAt['bomb-bay'] = state.tick + weaponCooldown(state, 'bomb-bay', tuning.cooldownTicks);
  state.bayDropsLeft = carpet ? 0 : Math.max(0, (followUp ? state.bayDropsLeft ?? 1 : tuning.volley[bay - 1]) - 1);
  state.nextBayDrop = state.bayDropsLeft ? state.tick + tuning.followUpTicks : null;
}

// Sweep the thin per-tick segment so fast bolts cannot skip a contact.
export function impactTime(origin: Point, dx: number, dz: number, target: Point, radius: number, from = 0, to = 1): number {
  const reach = radius + 1e-7;
  const startX = origin.x + dx * from, endX = origin.x + dx * to;
  const startZ = origin.z + dz * from, endZ = origin.z + dz * to;
  if (target.x < Math.min(startX, endX) - reach || target.x > Math.max(startX, endX) + reach
    || target.z < Math.min(startZ, endZ) - reach || target.z > Math.max(startZ, endZ) + reach) return Infinity;
  const x = origin.x - target.x + dx * from, z = origin.z - target.z + dz * from;
  const c = x * x + z * z - radius * radius;
  if (c <= 0) return from;
  const a = dx * dx + dz * dz;
  const b = x * dx + z * dz;
  if (!a || b >= 0) return Infinity;
  const squaredApproach = b * b;
  const discriminant = squaredApproach - a * c;
  // A terrain-clipped beam can round slightly below zero when tangent to a target.
  if (discriminant < -4 * Number.EPSILON * squaredApproach) return Infinity;
  const time = (-b - Math.sqrt(Math.max(0, discriminant))) / a;
  return time <= to - from ? from + time : Infinity;
}

function altitudeImpactTime(origin: Position, dx: number, dz: number, dy: number, target: Position, radius: number, window = HIT_WINDOW): number {
  const height = origin.alt - target.alt;
  if (!dy) return Math.abs(height) <= window ? impactTime(origin, dx, dz, target, radius) : Infinity;
  const elevation = dy < 0 ? height : -height;
  const from = Math.max(0, (elevation - window) / Math.abs(dy));
  const to = Math.min(1, (elevation + window) / Math.abs(dy));
  // Use only the part of the segment that passes through the contact's altitude window.
  return from <= to ? impactTime(origin, dx, dz, target, radius, from, to) : Infinity;
}

export function groundImpact(origin: Position, dx: number, dz: number, ground: Ground, dy = 0): number {
  if (ground(origin.x, origin.z) >= origin.alt) return 0;
  let first = ground(origin.x + dx / 2, origin.z + dz / 2) >= origin.alt + dy / 2 ? 0.5 : 1;
  if (first === 1 && ground(origin.x + dx, origin.z + dz) < origin.alt + dy) return Infinity;
  let last = first - 0.5;
  for (let i = 0; i < 5; i++) {
    const middle = (last + first) / 2;
    if (ground(origin.x + dx * middle, origin.z + dz * middle) >= origin.alt + dy * middle) first = middle;
    else last = middle;
  }
  return first;
}

function advanceStrafe(state: StageState, shot: Extract<Shot, { kind: 'strafe' }>, ground: Ground): void {
  const targetAltitude = shot.targetAltitude ?? bandAltitude(shot.targetBand);
  const bandWindow = hitWindow(state, STRAFE_BAND_WINDOW);
  const boundary = targetAltitude + Math.sign(shot.vy) * bandWindow;
  const travel = shot.vy ? Math.min(STEP, (boundary - shot.alt) / shot.vy) : 0;
  if (travel <= 0) {
    shot.life = 0;
    return;
  }
  const dx = shot.vx * travel, dz = shot.vz * travel, dy = shot.vy * travel;
  const obstacle = groundImpact(shot, dx, dz, ground, dy);
  const window = hitWindow(state);
  if (shot.pierce) {
    advancePiercingShot(state, shot, shot.pierce, dx, dz, obstacle, window, dy, bandWindow);
  } else {
    let first = obstacle;
    let hit: Enemy | null = null;
    const ace = activeAce(state);
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || !strafeBandMatches(enemy, shot.targetBand, targetAltitude, bandWindow)) continue;
      const time = altitudeImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS, window);
      if (time < first) {
        first = time;
        hit = enemy;
      }
    }
    if (ace && aceVulnerable(ace) && strafeBandMatches(ace, shot.targetBand, targetAltitude, bandWindow)
      && altitudeImpactTime(shot, dx, dz, dy, ace, ACE.hitRadius, window) < first) {
      hurtAce(state, ace, shot.damage);
      shot.life = 0;
    } else if (hit) {
      hurtEnemy(state, hit, shot.damage, { weapon: 'twin' }, shot);
      shot.life = 0;
    }
  }
  shot.x += dx;
  shot.z += dz;
  shot.alt += dy;
  const crossed = shot.vy < 0 ? shot.alt <= boundary : shot.alt >= boundary;
  shot.life = shot.life <= 0 || obstacle < Infinity || crossed || travel < STEP ? 0 : shot.life - STEP;
}

function advancePiercingShot(
  state: StageState, shot: Shot, bolt: NonNullable<Shot['reversal']>, dx: number, dz: number, terrain: number, window: number,
  dy = 0, strafeWindow = STRAFE_BAND_WINDOW,
): boolean {
  const pass = state.reversal?.startTick === shot.reversalTick ? state.reversal : null;
  const ace = activeAce(state);
  const altitude = shot.kind === 'strafe' ? shot.targetAltitude ?? bandAltitude(shot.targetBand) : shot.alt;
  const bandWindow = shot.kind === 'strafe' ? strafeWindow : window;
  const aceInBand = ace && (shot.kind === 'strafe' ? strafeBandMatches(ace, shot.targetBand, altitude, bandWindow)
    : dy || inBand(altitude, ace.alt, bandWindow));
  let hit = false;
  while (bolt.remaining > 0) {
    let target: Enemy | null = null, first = terrain;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || bolt.hits.includes(enemy.id)) continue;
      if (shot.kind === 'strafe') {
        if (!strafeBandMatches(enemy, shot.targetBand, altitude, bandWindow)) continue;
      } else if (!dy && !inBand(altitude, enemy.alt, isGroundAa(enemy) ? hitWindow(state, STRAFE_BAND_WINDOW) : bandWindow)) {
        continue;
      }
      const time = altitudeImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS,
        isGroundAa(enemy) ? hitWindow(state, STRAFE_BAND_WINDOW) : window);
      if (time < first) {
        target = enemy;
        first = time;
      }
    }
    if (ace && aceInBand && aceVulnerable(ace) && !bolt.hits.includes(ace.id)
      && altitudeImpactTime(shot, dx, dz, dy, ace, ACE.hitRadius, window) < first) {
      bolt.hits.push(ace.id);
      bolt.remaining--;
      hurtAce(state, ace, shot.damage);
      hit = true;
      continue;
    }
    if (!target) break;
    hit = true;
    bolt.hits.push(target.id);
    bolt.remaining--;
    hurtEnemy(state, target, shot.damage * (pass?.pursuers.includes(target.id) ? 2 : 1), friendlyShotCredit(state, target, shot), shot);
    if (target.shotDown && pass) {
      target.reversalKill = true;
      pass.kills++;
      const previous = pass.killTicks.filter(tick => state.tick - tick <= REVERSAL_STREAK_TICKS);
      pass.killTicks = [...previous, state.tick];
      const count = pass.killTicks.length;
      if (count === 3) pass.burstAt = state.tick;
      const visible = state.tick < pass.shownUntil ? pass.streak : 0;
      pass.streak = Math.max(visible, count);
      pass.shownUntil = state.tick + REVERSAL_CONFIRM;
    }
  }
  if (!bolt.remaining) shot.life = 0;
  return hit;
}

function aegisInterceptTime(shot: Position, dx: number, dz: number, player: Position, window: number): number {
  if (!inBand(shot.alt, player.alt, window)) return Infinity;
  const { radius, halfWidth } = CLOSE_EVOLUTIONS.aegis;
  const distance = Math.hypot(shot.x - player.x, shot.z - player.z);
  const inner = radius - halfWidth;
  if (distance >= inner) return impactTime(shot, dx, dz, player, radius + halfWidth);
  // A shot launched inside the halo still has to cross the rim to be absorbed.
  const end = { x: shot.x + dx, z: shot.z + dz };
  if (Math.hypot(end.x - player.x, end.z - player.z) < inner) return Infinity;
  const back = impactTime(end, -dx, -dz, player, inner);
  return back < Infinity ? 1 - back : Infinity;
}

function reportGraze(shot: Shot, player: Position, dx: number, dz: number, terrain: number,
  graze: NonNullable<CombatEvents['graze']>): void {
  if (grazedShots.has(shot)) return;
  const rangeSq = dx * dx + dz * dz;
  if (!rangeSq) return;
  const x = shot.x - player.x, z = shot.z - player.z;
  const closest = Math.max(0, -(x * dx + z * dz) / rangeSq);
  // Wait for the closest point rather than firing when a head-on bullet enters the outer radius.
  if (closest > 1 || closest >= terrain
    || (x + dx * closest) ** 2 + (z + dz * closest) ** 2 > HOSTILE_GRAZE_RADIUS ** 2) return;
  grazedShots.add(shot);
  graze(shot, shot.x + dx * closest, shot.z + dz * closest, shot.alt);
}

export function advanceShots(state: StageState, ground: Ground, events?: CombatEvents): void {
  const p = state.player;
  const player = { x: p.x, z: p.z, alt: p.altitude };
  const reversal = state.reversal;
  const resolved = new Set<number>();
  const misses = new Map<number, Effect>();
  const weaponWindow = hitWindow(state);
  const aegis = !!state.run?.evolutions.pods;
  const parryActive = rollParryActive(state.roll);
  const count = state.shots.length;
  for (let i = 0; i < count; i++) {
    const shot = state.shots[i];
    if (shot.kind === 'strafe') {
      advanceStrafe(state, shot, ground);
      continue;
    }
    if (shot.kind === 'seeker' || shot.kind === 'flak-shell' || shot.kind === 'flak-shard') {
      advanceRangedShot(state, shot, ground);
      continue;
    }
    if (shot.kind === 'hostile' && shot.hostileKind === 'ace-missile') steerAceMissile(shot, player);
    const dx = shot.vx * STEP, dz = shot.vz * STEP;
    const dy = (shot.vy ?? 0) * STEP;
    const terrain = groundImpact(shot, dx, dz, ground, dy);
    if (shot.kind === 'hostile') {
      const parry = parryActive && state.hull > 0 && inBand(shot.alt, player.alt);
      const dangerous = !parry && hostileCanHit(shot.alt, state);
      const playerHit = parry || dangerous ? impactTime(shot, dx, dz, player, HOSTILE_HIT_RADIUS) : Infinity;
      const interception = aegis ? aegisInterceptTime(shot, dx, dz, player, weaponWindow) : Infinity;
      const first = Math.min(terrain, playerHit);
      let stopped = terrain;
      if (interception < first) {
        state.effects.push({ kind: 'hit', x: shot.x + dx * interception, z: shot.z + dz * interception, alt: shot.alt, life: 0.16 });
        shot.life = 0;
        stopped = interception;
      } else {
        let droneHit = first;
        for (const drone of state.orbitDrones) {
          if (inBand(shot.alt, drone.alt, weaponWindow)) {
            droneHit = Math.min(droneHit, impactTime(shot, dx, dz, drone, WEAPONS.drones.tuning.hitRadius));
          }
        }
        if (droneHit < first) {
          shot.life = 0;
          stopped = droneHit;
        } else if (playerHit < terrain) {
          if (parry) {
            const x = shot.x + dx * playerHit, z = shot.z + dz * playerHit;
            // Keep the nearby reward at the front of the salvage pool so it is collected even at the pickup cap.
            state.pickups.unshift({ id: ++state.nextId, x, z, alt: shot.alt, xp: ROLL_PARRY_XP, born: state.tick });
            events?.parry?.(shot, x, z, shot.alt);
          } else {
            // Use a point back along the trajectory even when the previous pose is already inside the hit radius.
            const travel = 12;
            const source = events?.hit ? { x: shot.x - dx * travel, z: shot.z - dz * travel, alt: shot.alt } : undefined;
            hurtPlayer(state, source, events);
          }
          shot.life = 0;
          stopped = playerHit;
        } else if (dangerous && events?.graze) {
          reportGraze(shot, player, dx, dz, terrain, events.graze);
        }
      }
      if (events?.impact && (stopped < Infinity || shot.life <= STEP)) {
        const at = Math.min(1, stopped);
        events.impact(shot, shot.x + dx * at, shot.z + dz * at, shot.alt);
      }
    } else if (shot.reversal || shot.pierce) {
      if (advancePiercingShot(state, shot, (shot.reversal ?? shot.pierce)!, dx, dz, terrain, weaponWindow, dy)) resolved.add(shot.volley);
    } else {
      let enemyHit: Enemy | null = null;
      let bossHit = false;
      let first = terrain;
      let miss = terrain, delta = 0;
      const contactWindow = (target: { kind?: string; alt: number }): number =>
        isGroundAa(target) ? hitWindow(state, STRAFE_BAND_WINDOW) : weaponWindow;
      for (const enemy of state.enemies) {
        if (!enemy.hp || enemy.entry) continue;
        const window = contactWindow(enemy);
        const time = altitudeImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS, window);
        if (time < first) {
          first = time;
          enemyHit = enemy;
        } else if (time === Infinity) {
          const bypass = impactTime(shot, dx, dz, enemy, HIT_RADIUS);
          if (bypass < miss) {
            miss = bypass;
            delta = enemy.alt - shot.alt;
          }
        }
      }
      const ace = activeAce(state);
      if (ace && aceVulnerable(ace)) {
        const time = altitudeImpactTime(shot, dx, dz, dy, ace, ACE.hitRadius, contactWindow(ace));
        if (time < first) {
          bossHit = true;
        } else if (time === Infinity) {
          const bypass = impactTime(shot, dx, dz, ace, ACE.hitRadius);
          if (bypass < miss) {
            miss = bypass;
            delta = ace.alt - shot.alt;
          }
        }
      }
      if (bossHit && ace) {
        hurtAce(state, ace, shot.damage);
        shot.life = 0;
        resolved.add(shot.volley);
      } else if (enemyHit) {
        hurtEnemy(state, enemyHit, shot.damage, friendlyShotCredit(state, enemyHit, shot), shot);
        shot.life = 0;
        resolved.add(shot.volley);
      } else if (miss < terrain && !shot.nearMiss && !misses.has(shot.volley)) {
        misses.set(shot.volley, {
          kind: 'miss', x: shot.x + dx * miss, z: shot.z + dz * miss, alt: shot.alt,
          vx: shot.vx, vz: shot.vz, delta, life: 0.55,
        });
      }
    }
    shot.x += dx;
    shot.z += dz;
    shot.alt += dy;
    shot.life = terrain < Infinity ? 0 : shot.life - STEP;
  }
  // A hit wins when both bolts in a volley cross overlapping contacts on this tick.
  for (const [volley, effect] of misses) {
    if (!resolved.has(volley)) state.effects.push(effect);
    resolved.add(volley);
  }
  state.shots = state.shots.filter(shot => {
    if (resolved.has(shot.volley)) shot.nearMiss = true;
    return shot.life > 0;
  });
  if (reversal && state.tick >= Math.max(reversal.until, reversal.shownUntil)
    && !state.shots.some(shot => shot.reversalTick === reversal.startTick)) state.reversal = null;
}
