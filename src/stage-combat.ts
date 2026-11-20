import type { Ace, AceTell, Band, Effect, Enemy, Flare, Ground, KillCredit, Point, Position, RearBomb, RearGlimpse, Shot,
  StageState } from './stage-types.ts';
import { ACE } from './data/ace.ts';
import { aegisBlocks } from './data/roster.ts';
import { BOOST_SPEED } from './flight.ts';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { HOSTILE_GRAZE_RADIUS, HOSTILE_HIT_RADIUS, HOSTILE_IFRAME_TICKS, hostileShape, type HostileSourceKind } from './data/hostile-fire.ts';
import { ROLLS, ROLL_PARRY_XP } from './data/roll.ts';
import { HOSTILE_SHOT_LIMIT, PLAYER_SHOT_LIMIT, SURVIVOR_PLAYER_DAMAGE, WEAPON_PROJECTILE_LIMITS } from './data/run-balance.ts';
import { WEAPONS, type WeaponId } from './data/items.ts';
import type { CombatEvents } from './hostile-events.ts';
import { advanceEchoDeadlines, buffTuning, criticalDamage, familyBonus, hitWindow, weaponCooldown, weaponDamage } from './loadout.ts';
import { nearestBand } from './maneuvers.ts';
import { advanceRangedShot } from './ranged-weapons.ts';
import { rollBoltImmune, rollParryActive } from './roll.ts';

export const TICKS_PER_SECOND = 60;
export const STEP = 1 / TICKS_PER_SECOND;
export const BANDS = [75, 110, 145] as const;
export const HIT_WINDOW = 8;
export const MIN_ALTITUDE = 55;
export const MAX_ALTITUDE = 165;
export const VERTICAL_SPEED = 40;
export const WIPE_DURATION = 0.15;
export const BOLT_SPEED = 320;
export const SHOT_LIMIT = 192;
export const MINE_LIMIT = 16;
export const MINE_RADIUS = 12;
export const FLAK_RADIUS = 22;
export const FLAK_LIFE = 0.65;
export const MAX_BOMBS = 3;
export const BOMB_RELOAD_TICKS = 450;
export const BOMB_BLAST_RADIUS = 34;
export const MAX_FLARES = 3;
export const FLARE_COOLDOWN_TICKS = 36;
export const FLARE_RELOAD_TICKS = 420;
export const FLARE_LIFE_TICKS = 120;
export const FLARE_GRAVITY = 14;
export const REAR_GLIMPSE_TICKS = 84;
const REAR_IMPACT_TICKS = 45;
const FLARE_KICK = 70;
const FLARE_HIT_RADIUS = 4.5;
const FLARE_BURN_TICKS = 88;
const FLARE_BURN_INTERVAL = 27;
const FLARE_CONFIRM_TICKS = 72;
const FLARE_FAN = [-2, -1, 0, 1, 2];
const BOMB_DROP_TICKS = 24;
const BOMB_HOLD_TICKS = 27;
const BOMB_FALL_SPEED = 24;
const BOMB_PROXIMITY = 16;
const BOMB_CLEAR_RADIUS = 40;
const LOCK_TICKS = 21;
const HIT_RADIUS = 6;
export { HOSTILE_HIT_RADIUS } from './data/hostile-fire.ts';
const TWIN_CONE = Math.PI / 6;
const TWIN_RANGE = 175;
const TWIN_MUZZLE = 6;
const LOCK_RANGE = 175;
const POD_RANGE = 62;
const REVERSAL_WINDOW = 120;
const REVERSAL_CADENCE = 4;
const REVERSAL_SPEED = 485;
const REVERSAL_HITS = 3;
const REVERSAL_STREAK_TICKS = 21;
const REVERSAL_SPREAD = [0, -0.055, 0.055, -0.11, 0.11];
const REVERSAL_MUZZLES = [0, -2.2, 2.2, -4.4, 4.4];
const REVERSAL_CONFIRM = 60;
const STRAFE_CADENCE = 33;
const STRAFE_SPEED = 230;
const STRAFE_CONE = 38 * Math.PI / 180;
const STRAFE_MIN_RANGE = 28;
const STRAFE_RANGE = 135;
const STRAFE_BAND_WINDOW = 12;
const grazedShots = new WeakSet<Shot>();

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const angleTo = (yaw: number, dx: number, dz: number): number => {
  const difference = Math.atan2(dx, dz) - yaw;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
};
export const inBand = (first: number, second: number, window = HIT_WINDOW): boolean =>
  Math.abs(first - second) <= window;

export function hostileCanHit(altitude: number, state: Pick<StageState, 'player' | 'invulnerability' | 'hull' | 'roll'>): boolean {
  return state.hull > 0 && state.invulnerability <= 0 && !rollBoltImmune(state.roll) && inBand(altitude, state.player.altitude);
}

export function hurtPlayer(state: StageState, source?: Position, events?: CombatEvents): void {
  if (state.invulnerability > 0 || !state.hull) return;
  const p = state.player;
  const damage = Math.min(state.hull, state.run ? SURVIVOR_PLAYER_DAMAGE : 2);
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
  enemy.hp = Math.max(0, enemy.hp - criticalDamage(state, damage));
  enemy.hitUntil = state.tick + 8;
  enemy.shotDown = enemy.hp === 0;
  if (state.run && enemy.shotDown && credit) enemy.killCredit = credit;
  state.effects.push({ kind: 'hit', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.16 });
}

type RearWeapon = Extract<KillCredit['weapon'], 'pods' | 'phoenix' | 'bomb-bay' | 'manual-flare' | 'manual-bomb'>;

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
  ace.hp = Math.max(0, ace.hp - criticalDamage(state, damage));
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

export function fireHostile(state: StageState, source: Position & { kind?: HostileSourceKind },
  speed: number, spread = 0, events?: CombatEvents): void {
  if (!projectileRoom(state, 'hostile')) return;
  const p = state.player;
  const yaw = Math.atan2(p.x - source.x, p.z - source.z) + spread;
  const shot: Shot = {
    x: source.x, z: source.z, alt: source.alt, kind: 'hostile',
    vx: Math.sin(yaw) * speed, vz: Math.cos(yaw) * speed,
    damage: 2, life: 3.75, volley: 0, nearMiss: false, lockId: null,
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
      damage: 2, life: guided ? ACE.missile.life : 3.75, volley: 0, nearMiss: false, lockId: null,
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

type Aim = Position & { vx?: number; vz?: number; id: number };

function fireFriendly(
  state: StageState, kind: 'twin' | 'pods', offsets: number[], target: Aim | null, lockId: number | null,
): void {
  const p = state.player;
  const forwardX = Math.sin(p.yaw), forwardZ = Math.cos(p.yaw);
  const lead = target ? Math.hypot(target.x - p.x, target.z - p.z) / BOLT_SPEED : 0;
  const volley = ++state.nextVolley;
  const upgraded = lockId === null && kind === 'twin' && state.run?.weaponLevels.twin === WEAPONS.twin.tuning.pierceAt;
  const pierce = Number(upgraded) + (familyBonus(state, kind)?.pierce ?? 0);
  const aurora = kind === 'twin' && !!state.run?.evolutions.twin;
  let room = projectileRoom(state, kind);
  for (const side of offsets) {
    if (room-- <= 0) break;
    const muzzle = kind === 'twin' ? TWIN_MUZZLE : 0;
    const x = p.x + forwardX * muzzle + forwardZ * side;
    const z = p.z + forwardZ * muzzle - forwardX * side;
    const aim = target
      ? Math.atan2(target.x + (target.vx ?? 0) * lead - x, target.z + (target.vz ?? 0) * lead - z)
      : p.yaw;
    const yaw = aim + (aurora ? side * CLOSE_EVOLUTIONS.aurora.fan : 0);
    state.shots.push({
      x, z, alt: p.altitude, kind, vx: Math.sin(yaw) * BOLT_SPEED, vz: Math.cos(yaw) * BOLT_SPEED,
      damage: weaponDamage(state, kind, kind === 'twin' ? state.twinDamage : state.podDamage),
      life: kind === 'twin' ? 0.68 : 0.27, volley, nearMiss: false, lockId,
      ...(pierce ? { pierce: { remaining: pierce + 1, hits: [] } } : {}),
      ...(aurora ? { aurora: true } : {}),
    });
  }
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

function fireStrafe(state: StageState, target: Enemy, targetBand: Band, aurora: boolean): void {
  const p = state.player;
  const x = p.x + Math.sin(p.yaw) * TWIN_MUZZLE;
  const z = p.z + Math.cos(p.yaw) * TWIN_MUZZLE;
  const dx = target.x - x, dz = target.z - z, dy = target.alt - p.altitude;
  // Solve for where a constant-speed bolt and the moving target will meet in 3D.
  const speedDifference = STRAFE_SPEED ** 2 - target.vx ** 2 - target.vz ** 2;
  const along = dx * target.vx + dz * target.vz;
  const distanceSquared = dx ** 2 + dz ** 2 + dy ** 2;
  const discriminant = along ** 2 + speedDifference * distanceSquared;
  if (discriminant < 0) return;
  const closing = Math.sqrt(discriminant) - along;
  if (closing <= 0) return;
  const lead = distanceSquared / closing;
  const vy = dy / lead;
  if (!vy) return;
  const window = hitWindow(state, STRAFE_BAND_WINDOW);
  const life = vy < 0 ? (p.altitude - BANDS[targetBand] + window) / -vy : (BANDS[targetBand] + window - p.altitude) / vy;
  if (life <= 0) return;
  const pierce = familyBonus(state, 'twin')?.pierce ?? 0;
  state.shots.push({
    x, z, alt: p.altitude, kind: 'strafe', targetBand,
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
  let wrong: Aim | null = aceVisible && !aceAligned ? ace : null;
  const forwardRange = state.run ? WEAPONS.twin.tuning.range : TWIN_RANGE;
  let twinRange: number = twin ? aceRange : forwardRange, wrongRange: number = wrong ? aceRange : forwardRange;
  let left: Enemy | null = null, right: Enemy | null = null, rear: Enemy | null = null;
  let leftRange: number = podLevel ? WEAPONS.pods.tuning.range[podLevel - 1] : POD_RANGE;
  let rightRange = leftRange, rearRange = leftRange;
  const reversal = state.reversal;
  const overdrive = reversal && state.tick < reversal.until ? reversal : null;
  const reversalReady = overdrive && state.tick >= overdrive.nextShotAt;
  const overdriveTargets: RankedTarget[] = [];
  const eligibleBand = nearestBand(p.altitude);
  const strafeReady = hasTwin && state.tick >= state.strafeAt;
  const lowerBand = !strafeReady ? null : aurora
    ? (eligibleBand > 0 ? eligibleBand - 1 as Band : null)
    : inBand(p.altitude, BANDS[2]) ? 1 : inBand(p.altitude, BANDS[1]) ? 0 : null;
  const upperBand = strafeReady && aurora && eligibleBand < 2 ? eligibleBand + 1 as Band : null;
  const lowerTargets: RankedTarget[] = [], upperTargets: RankedTarget[] = [];
  const strafeWindow = hitWindow(state, STRAFE_BAND_WINDOW);
  for (const enemy of state.enemies) {
    if (!enemy.hp) continue;
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const bearing = angleTo(p.yaw, dx, dz), range = Math.hypot(dx, dz);
    const sameBand = inBand(p.altitude, enemy.alt, weaponWindow);
    const angle = Math.abs(bearing);
    if (angle <= TWIN_CONE) {
      if (sameBand && !locked && range <= twinRange) {
        twin = enemy;
        twinRange = range;
      } else if (!sameBand && range < wrongRange) {
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
      if (podLevel === WEAPONS.pods.tuning.rearBonusAt && angle >= Math.PI * 0.65 && range < rearRange) {
        rear = enemy;
        rearRange = range;
      }
    }
    if (range < STRAFE_MIN_RANGE || range > STRAFE_RANGE || angle > STRAFE_CONE) continue;
    if (lowerBand !== null && inBand(enemy.alt, BANDS[lowerBand], strafeWindow)) lowerTargets.push({ enemy, range });
    if (upperBand !== null && inBand(enemy.alt, BANDS[upperBand], strafeWindow)) upperTargets.push({ enemy, range });
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
    const paired = twinLevel ? WEAPONS.twin.tuning.barrels[twinLevel - 1] === 4 : state.twinRank === 3;
    fireFriendly(state, 'twin', paired ? [-4.2, -1.6, 1.6, 4.2] : [-2.2, 2.2], primary, locked && ace ? ace.id : null);
    const cadence = twinLevel ? WEAPONS.twin.tuning.cooldownTicks[twinLevel - 1] : state.twinRank === 1 ? 21 : 13;
    state.twinAt = state.tick + weaponCooldown(state, 'twin', cadence);
  }
  if (overdrive && reversalReady) fireOverdrive(state, overdrive, overdriveTargets);
  if (state.tick >= state.podsAt && (left || right || rear)) {
    if (left) fireFriendly(state, 'pods', [-6], left, null);
    if (right) fireFriendly(state, 'pods', [6], right, null);
    if (rear) fireFriendly(state, 'pods', [0], rear, null);
    const cadence = podLevel ? WEAPONS.pods.tuning.cooldownTicks[podLevel - 1] : state.podRank === 1 ? 43 : 25;
    state.podsAt = state.tick + weaponCooldown(state, 'pods', cadence);
  }
  fireStrafes(state, lowerTargets, lowerBand, aurora);
  fireStrafes(state, upperTargets, upperBand, aurora);
}

function fireStrafes(state: StageState, targets: RankedTarget[], band: Band | null, aurora: boolean): void {
  if (band === null || !targets.length) return;
  targets.sort((a, b) => a.range - b.range);
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

export const bombCapacity = (state: StageState): number => MAX_BOMBS + (buffTuning(state, 'ordnance-rack')?.stock ?? 0);
export const flareCapacity = (state: StageState): number => MAX_FLARES + (buffTuning(state, 'flare-bay')?.stock ?? 0);
export const bombReloadTicks = (state: StageState): number =>
  Math.round(BOMB_RELOAD_TICKS * (buffTuning(state, 'ordnance-rack')?.reloadScale ?? 1));
export const flareReloadTicks = (state: StageState): number =>
  Math.round(FLARE_RELOAD_TICKS * (buffTuning(state, 'flare-bay')?.reloadScale ?? 1));

export function dropRearBomb(state: StageState): void {
  if (!state.bombs || state.tick < state.bombReadyAt) return;
  const p = state.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  state.rearBombs.push({ x: p.x - fx * 12, z: p.z - fz * 12, alt: p.altitude,
    vx: -fx * 8, vz: -fz * 8, born: state.tick });
  state.bombs--;
  state.bombReadyAt = state.tick + BOMB_DROP_TICKS;
  state.bombReloadAt ??= state.tick + bombReloadTicks(state);
  showRearLaunch(state, 'bomb');
}

function nearBomb(bomb: RearBomb, target: Position, radius: number): boolean {
  return Math.hypot(target.x - bomb.x, target.z - bomb.z) <= radius;
}

function blast(state: StageState, bomb: RearBomb): void {
  const familyScale = bomb.weapon ? familyBonus(state, bomb.weapon)?.radiusScale ?? 1 : 1;
  const radius = (bomb.radius ?? BOMB_BLAST_RADIUS) * (buffTuning(state, 'ordnance-rack')?.radiusScale ?? 1) * familyScale;
  const damage = bomb.damage ?? 4;
  const clearRadius = Math.max(BOMB_CLEAR_RADIUS, radius);
  const belowLaunchBand = (target: Position): boolean => target.alt <= (bomb.ceiling ?? Infinity);
  state.effects.push({ kind: 'bomb-blast', x: bomb.x, z: bomb.z, alt: bomb.alt, life: 0.8, radius });
  showRearImpact(state, 'bomb', bomb);
  state.shots = state.shots.filter(shot => shot.kind !== 'hostile' || !nearBomb(bomb, shot, clearRadius));
  state.enemyMines = state.enemyMines.filter(mine => !nearBomb(bomb, mine, clearRadius));
  const window = hitWindow(state);
  for (const enemy of state.enemies) {
    if (enemy.hp && !enemy.entry && belowLaunchBand(enemy) && nearBomb(bomb, enemy, radius)
      && inBand(enemy.alt, bomb.alt, window)) {
      hurtEnemy(state, enemy, damage, rearWeaponCredit(state, enemy, bomb.weapon ?? 'manual-bomb'));
    }
  }
  const ace = activeAce(state);
  if (ace && belowLaunchBand(ace) && nearBomb(bomb, ace, radius) && inBand(ace.alt, bomb.alt, window)) {
    hurtAce(state, ace, damage);
  }
}

export function canDropFlare(state: StageState, tick = state.tick): boolean {
  return state.phase === 'playing' && !state.paused && tick > state.graceUntil
    && state.flareCharges > 0 && tick >= state.flareReadyAt;
}

function launchFlares(state: StageState, vx: number, vz: number, fan: readonly number[], phoenixLevel = 0): void {
  const p = state.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  // Keep boosted flares close enough to catch a tail while still inheriting launch momentum.
  const kick = Math.max(FLARE_KICK, (vx * fx + vz * fz) * 0.89);
  const vy = clamp(state.climbRate * 0.2 - 7, -12, -6);
  const tuning = WEAPONS.phoenix.tuning;
  const bonus = phoenixLevel ? tuning.lifeBonusTicks[phoenixLevel - 1] : 0;
  const firebird = phoenixLevel && state.run?.evolutions.phoenix;
  const evolution = CLOSE_EVOLUTIONS.phoenix;
  const ordnance = phoenixLevel ? {
    weapon: 'phoenix' as const,
    lifeTicks: firebird ? evolution.lifeTicks : FLARE_LIFE_TICKS + bonus,
    burnTicks: Math.round((FLARE_BURN_TICKS + bonus) * (firebird ? evolution.burnScale : 1)),
    damage: weaponDamage(state, 'phoenix', 1),
    spread: phoenixLevel >= tuning.spreadAt ? tuning.burnRadius * (familyBonus(state, 'phoenix')?.radiusScale ?? 1) : undefined,
    ...(firebird ? { phoenix: true as const, sourceBand: nearestBand(p.altitude) } : {}),
  } : {};
  for (const side of fan) {
    state.flares.push({
      x: p.x - fx * 8 + fz * side * 3.4, z: p.z - fz * 8 - fx * side * 3.4, alt: p.altitude - 1,
      vx: vx - fx * kick + fz * side * 10,
      vz: vz - fz * kick - fx * side * 10,
      vy, born: state.tick, ...ordnance,
    });
  }
}

export function dropFlares(state: StageState, vx: number, vz: number): void {
  if (!canDropFlare(state)) return;
  launchFlares(state, vx, vz, FLARE_FAN);
  state.flareCharges--;
  state.flareReadyAt = state.tick + FLARE_COOLDOWN_TICKS;
  state.flareReloadAt ??= state.tick + flareReloadTicks(state);
  showRearLaunch(state, 'flare');
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
    const window = hitWindow(state);
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || enemy.id === target.id || !inBand(target.alt, enemy.alt, window)) continue;
      if (Math.hypot(enemy.x - target.x, enemy.z - target.z) <= flare.spread) {
        setBurn(state, enemy, FLARE_BURN_INTERVAL, flare, rearWeaponCredit(state, enemy, flare.weapon ?? 'manual-flare'));
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
  let aim: Enemy | Ace | null = null;
  let best: number = tuning.range ** 2;
  const targetDistance = (candidate: Enemy | Ace): number => {
    const band = nearestBand(candidate.alt);
    return candidate.hp && band <= sourceBand && band + 1 >= sourceBand
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
  if (state.flareReloadAt !== null && state.tick >= state.flareReloadAt) {
    const capacity = flareCapacity(state);
    state.flareCharges = Math.min(capacity, state.flareCharges + 1);
    state.flareReloadAt = state.flareCharges < capacity ? state.tick + flareReloadTicks(state) : null;
  }
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
      const credit = rearWeaponCredit(state, hit, flare.weapon ?? 'manual-flare');
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
    mine.alt = Math.max(BANDS[0], mine.alt - 14 * STEP);
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
  if (state.bombReloadAt !== null && state.tick >= state.bombReloadAt) {
    const capacity = bombCapacity(state);
    state.bombs = Math.min(capacity, state.bombs + 1);
    state.bombReloadAt = state.bombs < capacity ? state.tick + bombReloadTicks(state) : null;
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
      && nearBomb(bomb, target, BOMB_PROXIMITY);
    if (bomb.alt > impactHeight && !state.enemies.some(enemy => enemy.hp && !enemy.entry && close(enemy))
      && !(ace && aceVulnerable(ace) && close(ace))) return true;
    blast(state, bomb);
    return false;
  });
}

export function advanceAutoOrdnance(state: StageState, reversed: boolean): void {
  const run = state.run;
  if (!run) return;
  const phoenix = run.weaponLevels.phoenix ?? 0;
  if (phoenix && (reversed || state.tick >= (state.weaponFireAt.phoenix ?? 0))) {
    launchFlares(state, state.player.vx ?? 0, state.player.vz ?? 0, [0], phoenix);
    state.weaponFireAt.phoenix = state.tick + weaponCooldown(state, 'phoenix', WEAPONS.phoenix.tuning.cooldownTicks[phoenix - 1]);
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
  const { x, z, altitude: alt, yaw } = state.player;
  const bombs = carpet ? count : 1;
  const dx = carpet ? Math.sin(yaw) * spacing : 0, dz = carpet ? Math.cos(yaw) * spacing : 0;
  const damage = weaponDamage(state, 'bomb-bay', tuning.damage);
  for (let i = 0; i < bombs; i++) {
    state.rearBombs.push({ x: x - dx * i, z: z - dz * i, alt, vx: 0, vz: 0, born: state.tick, weapon: 'bomb-bay',
      radius: tuning.radius[bay - 1], damage, ceiling: alt - (BANDS[1] - BANDS[0]) / 2,
      ...(carpet ? { carpet: true } : {}) });
  }
  if (followUp) {
    state.nextBayDrop = null;
  } else {
    state.weaponFireAt['bomb-bay'] = state.tick + weaponCooldown(state, 'bomb-bay', tuning.cooldownTicks[bay - 1]);
    if (!carpet && tuning.volley[bay - 1] > 1) state.nextBayDrop = state.tick + tuning.followUpTicks;
  }
}

// Sweep the thin per-tick segment so fast bolts cannot skip a contact.
export function impactTime(origin: Point, dx: number, dz: number, target: Point, radius: number, from = 0, to = 1): number {
  const x = origin.x - target.x + dx * from, z = origin.z - target.z + dz * from;
  const c = x * x + z * z - radius * radius;
  if (c <= 0) return from;
  const a = dx * dx + dz * dz;
  const b = x * dx + z * dz;
  const discriminant = b * b - a * c;
  if (!a || b >= 0 || discriminant < 0) return Infinity;
  const time = (-b - Math.sqrt(discriminant)) / a;
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
  const bandAltitude = BANDS[shot.targetBand];
  const bandWindow = hitWindow(state, STRAFE_BAND_WINDOW);
  const boundary = bandAltitude + Math.sign(shot.vy) * bandWindow;
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
      if (!enemy.hp || enemy.entry || !inBand(enemy.alt, bandAltitude, bandWindow)) continue;
      const time = altitudeImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS, window);
      if (time < first) {
        first = time;
        hit = enemy;
      }
    }
    if (ace && aceVulnerable(ace) && inBand(ace.alt, bandAltitude, bandWindow)
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
  const altitude = shot.kind === 'strafe' ? BANDS[shot.targetBand] : shot.alt;
  const bandWindow = shot.kind === 'strafe' ? strafeWindow : window;
  let hit = false;
  while (bolt.remaining > 0) {
    let target: Enemy | null = null, first = terrain;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || bolt.hits.includes(enemy.id) || !inBand(altitude, enemy.alt, bandWindow)) continue;
      const time = altitudeImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS, window);
      if (time < first) {
        target = enemy;
        first = time;
      }
    }
    if (ace && aceVulnerable(ace) && !bolt.hits.includes(ace.id) && inBand(altitude, ace.alt, bandWindow)
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
    const terrain = groundImpact(shot, dx, dz, ground);
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
      if (advancePiercingShot(state, shot, (shot.reversal ?? shot.pierce)!, dx, dz, terrain, weaponWindow)) resolved.add(shot.volley);
    } else {
      let enemyHit: Enemy | null = null;
      let bossHit = false;
      let first = terrain;
      let miss = terrain, delta = 0;
      for (const enemy of state.enemies) {
        if (!enemy.hp || enemy.entry) continue;
        const time = impactTime(shot, dx, dz, enemy, HIT_RADIUS);
        if (inBand(shot.alt, enemy.alt, weaponWindow)) {
          if (time < first) {
            first = time;
            enemyHit = enemy;
          }
        } else if (time < miss) {
          miss = time;
          delta = enemy.alt - shot.alt;
        }
      }
      const ace = activeAce(state);
      if (ace && aceVulnerable(ace)) {
        const time = impactTime(shot, dx, dz, ace, ACE.hitRadius);
        const sameBand = inBand(shot.alt, ace.alt, weaponWindow);
        if (time < first && sameBand) {
          bossHit = true;
        } else if (time < miss && !sameBand) {
          miss = time;
          delta = ace.alt - shot.alt;
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
