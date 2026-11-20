import type { Boss, Effect, Enemy, Flare, Ground, Point, Position, RearBomb, RearGlimpse, Shot, StageState,
  WeakPoint } from './stage-types.ts';
import { HOSTILE_SHOT_LIMIT, PLAYER_SHOT_LIMIT, WEAPON_PROJECTILE_LIMITS } from './data/run-balance.ts';
import { WEAPONS, type WeaponId } from './data/items.ts';
import { advanceEchoDeadlines, buffTuning, criticalDamage, hitWindow, weaponCooldown, weaponDamage } from './loadout.ts';
import { advanceRangedShot } from './ranged-weapons.ts';

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
const WARDEN_BURN_INTERVAL = 54;
const FLARE_CONFIRM_TICKS = 72;
const FLARE_FAN = [-2, -1, 0, 1, 2];
const BOMB_DROP_TICKS = 24;
const BOMB_HOLD_TICKS = 27;
const BOMB_FALL_SPEED = 24;
const BOMB_PROXIMITY = 16;
const BOMB_CLEAR_RADIUS = 40;
const LOCK_TICKS = 21;
const HIT_RADIUS = 6;
export const HOSTILE_HIT_RADIUS = 5.5;
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

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const angleTo = (yaw: number, dx: number, dz: number): number => {
  const difference = Math.atan2(dx, dz) - yaw;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
};
export const inBand = (first: number, second: number, window = HIT_WINDOW): boolean =>
  Math.abs(first - second) <= window;

function weakPointExposed(boss: Boss, tick: number): boolean {
  return !boss.entry && tick >= boss.exposeTick;
}

export function activeWeakPoint(state: StageState): (WeakPoint & { exposed: boolean }) | null {
  const boss = state.boss;
  if (!boss) return null;
  const point = boss.weakPoints[boss.index];
  return point && point.hp > 0 ? { ...point, exposed: weakPointExposed(boss, state.tick) } : null;
}

export function hurtPlayer(state: StageState): void {
  if (state.invulnerability > 0 || !state.hull) return;
  const p = state.player;
  state.hull = Math.max(0, state.hull - 2);
  state.hitsTaken++;
  state.invulnerability = 1;
  state.effects.push({ kind: 'hit', x: p.x, z: p.z, alt: p.altitude, life: 0.36 });
}

export function hurtEnemy(state: StageState, enemy: Enemy, damage: number): void {
  if (!enemy.hp || enemy.entry) return;
  enemy.hp = Math.max(0, enemy.hp - criticalDamage(state, damage));
  enemy.hitUntil = state.tick + 8;
  enemy.shotDown = enemy.hp === 0;
  state.effects.push({ kind: 'hit', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.16 });
}

export function hurtWeakPoint(state: StageState, boss: Boss, damage: number): void {
  const point = boss.weakPoints[boss.index];
  if (!point.hp || !weakPointExposed(boss, state.tick)) return;
  point.hp = Math.max(0, point.hp - criticalDamage(state, damage));
  point.hits++;
  state.effects.push({ kind: point.hp ? 'hit' : 'burst', x: point.x, z: point.z, alt: point.alt, life: point.hp ? 0.16 : 0.52 });
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

export function fireHostile(state: StageState, source: Position, speed: number, spread = 0): void {
  if (!projectileRoom(state, 'hostile')) return;
  const p = state.player;
  const yaw = Math.atan2(p.x - source.x, p.z - source.z) + spread;
  state.shots.push({
    x: source.x, z: source.z, alt: source.alt, kind: 'hostile',
    vx: Math.sin(yaw) * speed, vz: Math.cos(yaw) * speed,
    damage: 2, life: 3.75, volley: 0, nearMiss: false, lockId: null,
  });
}

type Aim = Position & { vx?: number; vz?: number; id: number; window?: number };

function fireFriendly(
  state: StageState, kind: 'twin' | 'pods', offsets: number[], target: Aim | null, lockId: number | null,
): void {
  const p = state.player;
  const forwardX = Math.sin(p.yaw), forwardZ = Math.cos(p.yaw);
  const lead = target ? Math.hypot(target.x - p.x, target.z - p.z) / BOLT_SPEED : 0;
  const volley = ++state.nextVolley;
  let room = projectileRoom(state, kind);
  for (const side of offsets) {
    if (room-- <= 0) break;
    const muzzle = kind === 'twin' ? TWIN_MUZZLE : 0;
    const x = p.x + forwardX * muzzle + forwardZ * side;
    const z = p.z + forwardZ * muzzle - forwardX * side;
    const yaw = target
      ? Math.atan2(target.x + (target.vx ?? 0) * lead - x, target.z + (target.vz ?? 0) * lead - z)
      : p.yaw;
    state.shots.push({
      x, z, alt: p.altitude, kind, vx: Math.sin(yaw) * BOLT_SPEED, vz: Math.cos(yaw) * BOLT_SPEED,
      damage: weaponDamage(state, kind, kind === 'twin' ? state.twinDamage : state.podDamage),
      life: kind === 'twin' ? 0.68 : 0.27, volley, nearMiss: false, lockId,
      ...(kind === 'twin' && !lockId && state.run?.weaponLevels.twin === WEAPONS.twin.tuning.pierceAt
        ? { pierce: { remaining: 2, hits: [] } } : {}),
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
      reversal: { remaining: REVERSAL_HITS, hits: [] }, reversalTick: pass.startTick,
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

function fireStrafe(state: StageState, target: Enemy, targetBand: 0 | 1): void {
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
  state.shots.push({
    x, z, alt: p.altitude, kind: 'strafe', targetBand,
    vx: dx / lead + target.vx, vz: dz / lead + target.vz, vy,
    damage: weaponDamage(state, 'twin', 1), life: (p.altitude - BANDS[targetBand] + hitWindow(state, STRAFE_BAND_WINDOW)) / -vy,
    volley: ++state.nextVolley, nearMiss: false, lockId: null,
  });
  state.strafeAt = state.tick + weaponCooldown(state, 'twin', STRAFE_CADENCE);
}

export function acquireAndFire(state: StageState): void {
  const p = state.player;
  const twinLevel = state.run?.weaponLevels.twin;
  const podLevel = state.run?.weaponLevels.pods;
  const hasTwin = !state.run || !!twinLevel;
  const hasPods = !state.run || !!podLevel;
  const weaponWindow = hitWindow(state);
  const weak = activeWeakPoint(state);
  const weakRange = weak ? Math.hypot(weak.x - p.x, weak.z - p.z) : Infinity;
  const weakAngle = weak ? angleTo(p.yaw, weak.x - p.x, weak.z - p.z) : Infinity;
  const lockTicks = Math.round(LOCK_TICKS * (buffTuning(state, 'fire-control')?.lockScale ?? 1));
  const weakWindow = weak ? hitWindow(state, weak.window) : HIT_WINDOW;
  const aligned = weak?.exposed && weakRange <= LOCK_RANGE && Math.abs(weakAngle) <= Math.PI / 15 && inBand(p.altitude, weak.alt, weakWindow);
  if (weak && aligned) {
    const previous = state.lock?.id === weak.id ? state.lock.progress : 0;
    const ticks = Math.min(lockTicks, Math.round(previous * lockTicks) + 1);
    state.lock = { id: weak.id, progress: ticks / lockTicks, ready: ticks === lockTicks };
  } else {
    state.lock = null;
  }

  const locked = !!(state.lock?.ready && weak);
  let twin: Aim | null = locked ? weak : null;
  let wrong: Aim | null = weak && weak.exposed && weakRange <= LOCK_RANGE && Math.abs(weakAngle) <= TWIN_CONE
    && !inBand(p.altitude, weak.alt, weakWindow) ? weak : null;
  const forwardRange = state.run ? WEAPONS.twin.tuning.range : TWIN_RANGE;
  let twinRange: number = forwardRange, wrongRange: number = wrong ? weakRange : forwardRange;
  let left: Enemy | null = null, right: Enemy | null = null, rear: Enemy | null = null;
  let leftRange: number = podLevel ? WEAPONS.pods.tuning.range[podLevel - 1] : POD_RANGE;
  let rightRange = leftRange, rearRange = leftRange;
  const reversal = state.reversal;
  const overdrive = reversal && state.tick < reversal.until ? reversal : null;
  const reversalReady = overdrive && state.tick >= overdrive.nextShotAt;
  const overdriveTargets: RankedTarget[] = [];
  const lowerBand = !hasTwin || state.tick < state.strafeAt ? null
    : inBand(p.altitude, BANDS[2]) ? 1 : inBand(p.altitude, BANDS[1]) ? 0 : null;
  const strafeTargets: RankedTarget[] = [];
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
    if (lowerBand !== null && range >= STRAFE_MIN_RANGE && range <= STRAFE_RANGE && angle <= STRAFE_CONE
      && inBand(enemy.alt, BANDS[lowerBand], hitWindow(state, STRAFE_BAND_WINDOW))) strafeTargets.push({ enemy, range });
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
    fireFriendly(state, 'twin', paired ? [-4.2, -1.6, 1.6, 4.2] : [-2.2, 2.2], primary, locked && weak ? weak.id : null);
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
  if (lowerBand !== null) {
    strafeTargets.sort((a, b) => a.range - b.range);
    const room = projectileRoom(state, 'twin');
    for (let i = 0; i < Math.min(2, strafeTargets.length, room); i++) {
      fireStrafe(state, strafeTargets[i].enemy, lowerBand);
    }
  }
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
  const radius = (bomb.radius ?? BOMB_BLAST_RADIUS) * (buffTuning(state, 'ordnance-rack')?.radiusScale ?? 1);
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
      && inBand(enemy.alt, bomb.alt, window)) hurtEnemy(state, enemy, damage);
  }
  const point = activeWeakPoint(state);
  if (state.boss && point?.exposed && belowLaunchBand(point) && nearBomb(bomb, point, radius)
    && inBand(point.alt, bomb.alt, hitWindow(state, point.window))) {
    hurtWeakPoint(state, state.boss, damage);
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
  const ordnance = phoenixLevel ? {
    weapon: 'phoenix' as const,
    lifeTicks: FLARE_LIFE_TICKS + bonus,
    burnTicks: FLARE_BURN_TICKS + bonus,
    damage: weaponDamage(state, 'phoenix', 1),
    spread: phoenixLevel >= tuning.spreadAt ? tuning.burnRadius : undefined,
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

function setBurn(state: StageState, target: Enemy | WeakPoint, interval: number, flare: Flare): void {
  if (!target.hp) return;
  if (state.tick >= (target.burnUntil ?? 0)) target.burnNextAt = state.tick + interval;
  const bonus = buffTuning(state, 'flare-bay')?.burnBonusTicks ?? 0;
  const until = state.tick + (flare.burnTicks ?? FLARE_BURN_TICKS) + bonus;
  target.burnUntil = Math.max(target.burnUntil ?? 0, until);
  if (flare.damage !== undefined) target.burnDamage = Math.max(target.burnDamage ?? 1, flare.damage);
}

function ignite(state: StageState, target: Enemy | WeakPoint, interval: number, flare: Flare): void {
  setBurn(state, target, interval, flare);
  if (flare.spread) {
    const window = hitWindow(state);
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || enemy.id === target.id || !inBand(target.alt, enemy.alt, window)) continue;
      if (Math.hypot(enemy.x - target.x, enemy.z - target.z) <= flare.spread) setBurn(state, enemy, FLARE_BURN_INTERVAL, flare);
    }
  }
  // Keep the camera on the first impact while the rest of the volley arrives.
  const prior = state.rearGlimpse;
  const recent = (state.flareHit?.until ?? 0) > state.tick + FLARE_CONFIRM_TICKS - 12;
  showRearImpact(state, 'flare', prior?.kind === 'flare' && prior.target && recent ? prior.target : target);
  state.flareHit = { until: state.tick + FLARE_CONFIRM_TICKS };
}

function burnTick(target: Enemy | WeakPoint, tick: number, interval: number): boolean {
  if (!target.hp || target.burnNextAt === undefined || target.burnUntil === undefined) return false;
  if (tick >= target.burnUntil) {
    delete target.burnUntil;
    delete target.burnNextAt;
    delete target.burnDamage;
    return false;
  }
  if (tick < target.burnNextAt) return false;
  target.burnNextAt += interval;
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
    if (burnTick(enemy, state.tick, FLARE_BURN_INTERVAL) && !enemy.entry) hurtEnemy(state, enemy, enemy.burnDamage ?? 1);
  }
  const boss = state.boss;
  const point = boss && weakPointExposed(boss, state.tick) ? boss.weakPoints[boss.index] : null;
  if (boss && point && burnTick(point, state.tick, WARDEN_BURN_INTERVAL)) hurtWeakPoint(state, boss, point.burnDamage ?? 1);

  let alive = 0;
  const window = hitWindow(state);
  const pointWindow = point ? hitWindow(state, point.window) : HIT_WINDOW;
  for (const flare of state.flares) {
    if (state.tick - flare.born >= (flare.lifeTicks ?? FLARE_LIFE_TICKS)) continue;
    flare.vy -= FLARE_GRAVITY * STEP;
    const dx = flare.vx * STEP, dz = flare.vz * STEP, dy = flare.vy * STEP;
    const terrain = groundImpact(flare, dx, dz, ground, dy);

    let hit: Enemy | null = null;
    let first = terrain;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry) continue;
      const time = descendingImpactTime(flare, dx, dz, dy, enemy, FLARE_HIT_RADIUS, window);
      if (time < first) {
        first = time;
        hit = enemy;
      }
    }
    const pointTime = point?.hp ? descendingImpactTime(flare, dx, dz, dy, point, point.kind === 'core' ? 4.5 : 7, pointWindow) : Infinity;
    if (boss && point && pointTime < first) {
      hurtWeakPoint(state, boss, flare.damage ?? 1);
      ignite(state, point, WARDEN_BURN_INTERVAL, flare);
    } else if (hit) {
      hurtEnemy(state, hit, flare.damage ?? 1);
      ignite(state, hit, FLARE_BURN_INTERVAL, flare);
    } else if (terrain === Infinity) {
      flare.x += dx;
      flare.z += dz;
      flare.alt += dy;
      state.flares[alive++] = flare;
    }
  }
  state.flares.length = alive;
}

export function advanceEnemyHazards(state: StageState, ground: Ground): void {
  const p = state.player;
  let alive = 0;
  for (const mine of state.enemyMines) {
    mine.alt = Math.max(BANDS[0], mine.alt - 14 * STEP);
    if (state.tick - mine.born >= 6 * TICKS_PER_SECOND || mine.alt <= ground(mine.x, mine.z)) continue;
    if (inBand(mine.alt, p.altitude) && Math.hypot(mine.x - p.x, mine.z - p.z) <= MINE_RADIUS) {
      hurtPlayer(state);
      state.effects.push({ kind: 'burst', x: mine.x, z: mine.z, alt: mine.alt, life: 0.52 });
    } else state.enemyMines[alive++] = mine;
  }
  state.enemyMines.length = alive;
  for (const puff of state.effects) {
    if (puff.kind === 'flak' && inBand(puff.alt, p.altitude) && Math.hypot(puff.x - p.x, puff.z - p.z) <= FLAK_RADIUS) hurtPlayer(state);
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
    const point = activeWeakPoint(state);
    const close = (target: Position, window = HIT_WINDOW): boolean =>
      target.alt <= (bomb.ceiling ?? Infinity) && inBand(target.alt, bomb.alt, hitWindow(state, window))
      && nearBomb(bomb, target, BOMB_PROXIMITY);
    if (bomb.alt > impactHeight && !state.enemies.some(enemy => enemy.hp && !enemy.entry && close(enemy))
      && !(point?.exposed && close(point, point.window))) return true;
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
  const followUp = state.nextBayDrop !== null && state.tick >= state.nextBayDrop;
  if (!followUp && state.tick < (state.weaponFireAt['bomb-bay'] ?? 0)) return;
  const tuning = WEAPONS['bomb-bay'].tuning;
  const { x, z, altitude: alt } = state.player;
  state.rearBombs.push({ x, z, alt, vx: 0, vz: 0, born: state.tick, weapon: 'bomb-bay',
    radius: tuning.radius[bay - 1], damage: weaponDamage(state, 'bomb-bay', tuning.damage),
    ceiling: alt - (BANDS[1] - BANDS[0]) / 2 });
  if (followUp) {
    state.nextBayDrop = null;
  } else {
    state.weaponFireAt['bomb-bay'] = state.tick + weaponCooldown(state, 'bomb-bay', tuning.cooldownTicks[bay - 1]);
    if (tuning.volley[bay - 1] > 1) state.nextBayDrop = state.tick + tuning.followUpTicks;
  }
}

// Check the thin per-tick segment so fast bolts cannot skip over small weak points.
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

function descendingImpactTime(origin: Position, dx: number, dz: number, dy: number, target: Position, radius: number, window = HIT_WINDOW): number {
  const height = origin.alt - target.alt;
  const from = Math.max(0, (height - window) / -dy);
  const to = Math.min(1, (height + window) / -dy);
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
  const bandWindow = hitWindow(state, STRAFE_BAND_WINDOW), floor = bandAltitude - bandWindow;
  const travel = Math.min(STEP, (shot.alt - floor) / -shot.vy);
  if (travel <= 0) {
    shot.life = 0;
    return;
  }
  const dx = shot.vx * travel, dz = shot.vz * travel, dy = shot.vy * travel;
  let first = groundImpact(shot, dx, dz, ground, dy);
  let hit: Enemy | null = null;
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.entry || !inBand(enemy.alt, bandAltitude, bandWindow)) continue;
    const time = descendingImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS, hitWindow(state));
    if (time < first) {
      first = time;
      hit = enemy;
    }
  }
  if (hit) hurtEnemy(state, hit, shot.damage);
  shot.x += dx;
  shot.z += dz;
  shot.alt += dy;
  shot.life = first < Infinity || shot.alt <= floor || travel < STEP ? 0 : shot.life - STEP;
}

function advanceOverdrive(
  state: StageState, shot: Shot, bolt: NonNullable<Shot['reversal']>, dx: number, dz: number, terrain: number, window: number,
): boolean {
  const pass = state.reversal?.startTick === shot.reversalTick ? state.reversal : null;
  let hit = false;
  while (bolt.remaining > 0) {
    let target: Enemy | null = null, first = terrain;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || bolt.hits.includes(enemy.id) || !inBand(shot.alt, enemy.alt, window)) continue;
      const time = impactTime(shot, dx, dz, enemy, HIT_RADIUS);
      if (time < first) {
        target = enemy;
        first = time;
      }
    }
    if (!target) break;
    hit = true;
    bolt.hits.push(target.id);
    bolt.remaining--;
    hurtEnemy(state, target, shot.damage * (pass?.pursuers.includes(target.id) ? 2 : 1));
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

export function advanceShots(state: StageState, ground: Ground): void {
  const p = state.player;
  const player = { x: p.x, z: p.z, alt: p.altitude };
  const reversal = state.reversal;
  const resolved = new Set<number>();
  const misses = new Map<number, Effect>();
  const weaponWindow = hitWindow(state);
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
    const dx = shot.vx * STEP, dz = shot.vz * STEP;
    const terrain = groundImpact(shot, dx, dz, ground);
    if (shot.kind === 'hostile') {
      const playerHit = inBand(shot.alt, player.alt) ? impactTime(shot, dx, dz, player, HOSTILE_HIT_RADIUS) : Infinity;
      if (state.orbitDrones.some(drone => inBand(shot.alt, drone.alt, weaponWindow)
        && impactTime(shot, dx, dz, drone, WEAPONS.drones.tuning.hitRadius) < Math.min(terrain, playerHit))) {
        shot.life = 0;
      } else if (playerHit < terrain) {
        hurtPlayer(state);
        shot.life = 0;
      }
    } else if (shot.reversal || ('pierce' in shot && shot.pierce)) {
      if (advanceOverdrive(state, shot, (shot.reversal ?? ('pierce' in shot ? shot.pierce : undefined))!,
        dx, dz, terrain, weaponWindow)) resolved.add(shot.volley);
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
      const boss = state.boss;
      const point = boss?.weakPoints[boss.index];
      if (boss && point?.hp && weakPointExposed(boss, state.tick)) {
        const time = impactTime(shot, dx, dz, point, point.kind === 'core' ? 4.5 : 7);
        const sameBand = inBand(shot.alt, point.alt, hitWindow(state, point.window));
        if (time < first && shot.lockId === point.id && sameBand) {
          first = time;
          bossHit = true;
        } else if (time < miss && !sameBand) {
          miss = time;
          delta = point.alt - shot.alt;
        }
      }
      if (bossHit && boss) {
        hurtWeakPoint(state, boss, shot.damage);
        shot.life = 0;
        resolved.add(shot.volley);
      } else if (enemyHit) {
        hurtEnemy(state, enemyHit, shot.damage);
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
