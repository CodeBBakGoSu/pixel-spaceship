import type { Boss, Effect, Enemy, Ground, Point, Position, RearBomb, RearGlimpse, Shot, StageState, WeakPoint } from './stage-types.ts';

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
const REVERSAL_WINDOW = 90;
const REVERSAL_CADENCE = 7;
const REVERSAL_CONFIRM = 60;
const STRAFE_CADENCE = 42;
const STRAFE_SPEED = 230;
const STRAFE_CONE = Math.PI / 9;
const STRAFE_MIN_RANGE = 45;
const STRAFE_RANGE = 100;

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const angleTo = (yaw: number, dx: number, dz: number): number => {
  const difference = Math.atan2(dx, dz) - yaw;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
};
export const inBand = (first: number, second: number, window = HIT_WINDOW): boolean =>
  Math.abs(first - second) <= window;

export function activeWeakPoint(state: StageState): (WeakPoint & { exposed: boolean }) | null {
  const boss = state.boss;
  if (!boss) return null;
  const point = boss.weakPoints[boss.index];
  return point && point.hp > 0 ? { ...point, exposed: state.tick >= boss.exposeTick } : null;
}

export function hurtPlayer(state: StageState): void {
  if (state.invulnerability > 0 || !state.hull) return;
  const p = state.player;
  state.hull = Math.max(0, state.hull - 2);
  state.hitsTaken++;
  state.invulnerability = 1;
  state.effects.push({ kind: 'hit', x: p.x, z: p.z, alt: p.altitude, life: 0.36 });
}

function hurtEnemy(state: StageState, enemy: Enemy, damage: number): void {
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.hitUntil = state.tick + 8;
  enemy.shotDown = enemy.hp === 0;
  state.effects.push({ kind: 'hit', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.16 });
}

function hurtWeakPoint(state: StageState, boss: Boss, damage: number): void {
  const point = boss.weakPoints[boss.index];
  point.hp = Math.max(0, point.hp - damage);
  point.hits++;
  state.effects.push({ kind: point.hp ? 'hit' : 'burst', x: point.x, z: point.z, alt: point.alt, life: point.hp ? 0.16 : 0.52 });
}

export function fireHostile(state: StageState, source: Position, speed: number, spread = 0): void {
  if (state.shots.length >= SHOT_LIMIT) return;
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
  reversal?: Shot['reversal'],
): void {
  const p = state.player;
  const forwardX = Math.sin(p.yaw), forwardZ = Math.cos(p.yaw);
  const lead = target ? Math.hypot(target.x - p.x, target.z - p.z) / BOLT_SPEED : 0;
  const volley = ++state.nextVolley;
  const pass = state.reversal;
  const reversalTick = kind === 'twin' && pass && state.tick < pass.until ? pass.startTick : undefined;
  for (const side of offsets) {
    if (state.shots.length >= SHOT_LIMIT) break;
    const muzzle = kind === 'twin' ? TWIN_MUZZLE : 0;
    const x = p.x + forwardX * muzzle + forwardZ * side;
    const z = p.z + forwardZ * muzzle - forwardX * side;
    const yaw = target
      ? Math.atan2(target.x + (target.vx ?? 0) * lead - x, target.z + (target.vz ?? 0) * lead - z)
      : p.yaw;
    state.shots.push({
      x, z, alt: p.altitude, kind, vx: Math.sin(yaw) * BOLT_SPEED, vz: Math.cos(yaw) * BOLT_SPEED,
      damage: kind === 'twin' ? state.twinDamage : state.podDamage,
      life: kind === 'twin' ? 0.68 : 0.27, volley, nearMiss: false, lockId, reversal, reversalTick,
    });
  }
}

export function openReversal(state: StageState, pursuers: readonly number[]): void {
  state.reversal = {
    startTick: state.tick, until: state.tick + REVERSAL_WINDOW, pursuers: [...pursuers],
    kills: 0, nextShotAt: state.tick, shownUntil: state.tick,
  };
}

function fireStrafe(state: StageState, target: Enemy, targetBand: 0 | 1): void {
  const p = state.player;
  const x = p.x + Math.sin(p.yaw) * TWIN_MUZZLE;
  const z = p.z + Math.cos(p.yaw) * TWIN_MUZZLE;
  const dx = target.x - x, dz = target.z - z, dy = target.alt - p.altitude;
  // Solve for where a constant-speed bolt and the moving target will meet in 3D.
  const speedDifference = STRAFE_SPEED ** 2 - target.vx ** 2 - target.vz ** 2;
  const along = dx * target.vx + dz * target.vz;
  const lead = (along + Math.sqrt(along ** 2 + speedDifference * (dx ** 2 + dz ** 2 + dy ** 2))) / speedDifference;
  const vy = dy / lead;
  state.shots.push({
    x, z, alt: p.altitude, kind: 'strafe', targetBand,
    vx: dx / lead + target.vx, vz: dz / lead + target.vz, vy,
    damage: 1, life: (p.altitude - BANDS[targetBand] + HIT_WINDOW) / -vy,
    volley: ++state.nextVolley, nearMiss: false, lockId: null,
  });
  state.strafeAt = state.tick + STRAFE_CADENCE;
}

export function acquireAndFire(state: StageState): void {
  const p = state.player;
  const weak = activeWeakPoint(state);
  const weakRange = weak ? Math.hypot(weak.x - p.x, weak.z - p.z) : Infinity;
  const weakAngle = weak ? angleTo(p.yaw, weak.x - p.x, weak.z - p.z) : Infinity;
  const aligned = weak?.exposed && weakRange <= LOCK_RANGE && Math.abs(weakAngle) <= Math.PI / 15 && inBand(p.altitude, weak.alt, weak.window);
  if (weak && aligned) {
    const previous = state.lock?.id === weak.id ? state.lock.progress : 0;
    const ticks = Math.min(LOCK_TICKS, Math.round(previous * LOCK_TICKS) + 1);
    state.lock = { id: weak.id, progress: ticks / LOCK_TICKS, ready: ticks === LOCK_TICKS };
  } else {
    state.lock = null;
  }

  const locked = !!(state.lock?.ready && weak);
  let twin: Aim | null = locked ? weak : null;
  let wrong: Aim | null = weak && weak.exposed && weakRange <= LOCK_RANGE && Math.abs(weakAngle) <= TWIN_CONE
    && !inBand(p.altitude, weak.alt, weak.window) ? weak : null;
  let twinRange = TWIN_RANGE, wrongRange = wrong ? weakRange : TWIN_RANGE;
  let left: Enemy | null = null, right: Enemy | null = null;
  let leftRange = POD_RANGE, rightRange = POD_RANGE;
  const reversal = state.reversal;
  const reversalReady = reversal && state.tick < reversal.until && state.tick >= reversal.nextShotAt;
  let pursuer: Enemy | null = null, secondPursuer: Enemy | null = null;
  let pursuerRange = TWIN_RANGE, secondPursuerRange = TWIN_RANGE;
  const lowerBand = state.tick < state.strafeAt ? null
    : inBand(p.altitude, BANDS[2]) ? 1 : inBand(p.altitude, BANDS[1]) ? 0 : null;
  let strafe: Enemy | null = null, strafeRange = STRAFE_RANGE;
  for (const enemy of state.enemies) {
    if (!enemy.hp) continue;
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const bearing = angleTo(p.yaw, dx, dz), range = Math.hypot(dx, dz);
    const sameBand = inBand(p.altitude, enemy.alt);
    const angle = Math.abs(bearing);
    if (angle <= TWIN_CONE) {
      if (sameBand && !locked && range <= twinRange) {
        twin = enemy;
        twinRange = range;
      } else if (!sameBand && range < wrongRange) {
        wrong = enemy;
        wrongRange = range;
      }
      if (sameBand && reversalReady && reversal.pursuers.includes(enemy.id)) {
        if (range <= pursuerRange) {
          secondPursuer = pursuer;
          secondPursuerRange = pursuerRange;
          pursuer = enemy;
          pursuerRange = range;
        } else if (range <= secondPursuerRange) {
          secondPursuer = enemy;
          secondPursuerRange = range;
        }
      }
      if (lowerBand !== null && range >= STRAFE_MIN_RANGE && range <= strafeRange && angle <= STRAFE_CONE
        && inBand(enemy.alt, BANDS[lowerBand])) {
        strafe = enemy;
        strafeRange = range;
      }
    } else if (sameBand && angle >= Math.PI * 0.2) {
      if (bearing < 0 && range < leftRange) {
        left = enemy;
        leftRange = range;
      } else if (bearing > 0 && range < rightRange) {
        right = enemy;
        rightRange = range;
      }
    }
  }

  if (!twin && wrong) {
    if (state.wrongLayer?.id !== wrong.id) state.wrongLayer = { id: wrong.id, since: state.tick };
    state.altitudeHint = state.tick - state.wrongLayer.since >= 14 ? { delta: wrong.alt - p.altitude } : null;
  } else {
    state.wrongLayer = null;
    state.altitudeHint = null;
  }

  const primary = state.tick >= state.twinAt ? twin : null;
  if (primary) {
    fireFriendly(state, 'twin', state.twinRank === 3 ? [-4.2, -1.6, 1.6, 4.2] : [-2.2, 2.2], primary, locked && weak ? weak.id : null);
    state.twinAt = state.tick + (state.twinRank === 1 ? 21 : 13);
  }
  if (reversal && pursuer && state.shots.length < SHOT_LIMIT) {
    const target = primary?.id === pursuer.id && secondPursuer ? secondPursuer : pursuer;
    fireFriendly(state, 'twin', [0], target, null, { targetId: target.id });
    reversal.nextShotAt = state.tick + REVERSAL_CADENCE;
  }
  if (state.tick >= state.podsAt && (left || right)) {
    if (left) fireFriendly(state, 'pods', [-6], left, null);
    if (right) fireFriendly(state, 'pods', [6], right, null);
    state.podsAt = state.tick + (state.podRank === 1 ? 43 : 25);
  }
  if (strafe && lowerBand !== null && state.shots.length < SHOT_LIMIT) fireStrafe(state, strafe, lowerBand);
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

export function dropRearBomb(state: StageState): void {
  if (!state.bombs || state.tick < state.bombReadyAt) return;
  const p = state.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  state.rearBombs.push({ x: p.x - fx * 12, z: p.z - fz * 12, alt: p.altitude,
    vx: -fx * 8, vz: -fz * 8, born: state.tick });
  state.bombs--;
  state.bombReadyAt = state.tick + BOMB_DROP_TICKS;
  state.bombReloadAt ??= state.tick + BOMB_RELOAD_TICKS;
  showRearLaunch(state, 'bomb');
}

function nearBomb(bomb: RearBomb, target: Position, radius: number): boolean {
  return Math.hypot(target.x - bomb.x, target.z - bomb.z) <= radius;
}

function blast(state: StageState, bomb: RearBomb): void {
  state.effects.push({ kind: 'bomb-blast', x: bomb.x, z: bomb.z, alt: bomb.alt, life: 0.8 });
  showRearImpact(state, 'bomb', bomb);
  state.shots = state.shots.filter(shot => shot.kind !== 'hostile' || !nearBomb(bomb, shot, BOMB_CLEAR_RADIUS));
  state.enemyMines = state.enemyMines.filter(mine => !nearBomb(bomb, mine, BOMB_CLEAR_RADIUS));
  for (const enemy of state.enemies) {
    if (enemy.hp && nearBomb(bomb, enemy, BOMB_BLAST_RADIUS) && inBand(enemy.alt, bomb.alt)) hurtEnemy(state, enemy, 4);
  }
  const point = activeWeakPoint(state);
  if (state.boss && point?.exposed && nearBomb(bomb, point, BOMB_BLAST_RADIUS) && inBand(point.alt, bomb.alt, point.window)) {
    hurtWeakPoint(state, state.boss, 4);
  }
}

export function canDropFlare(state: StageState, tick = state.tick): boolean {
  return state.phase === 'playing' && !state.paused && tick > state.graceUntil
    && state.flareCharges > 0 && tick >= state.flareReadyAt;
}

export function dropFlares(state: StageState, vx: number, vz: number): void {
  if (!canDropFlare(state)) return;
  const p = state.player;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  // Keep boosted flares close enough to catch a tail while still inheriting launch momentum.
  const kick = Math.max(FLARE_KICK, (vx * fx + vz * fz) * 0.89);
  const vy = clamp(state.climbRate * 0.2 - 7, -12, -6);
  for (const side of FLARE_FAN) {
    state.flares.push({
      x: p.x - fx * 8 + fz * side * 3.4, z: p.z - fz * 8 - fx * side * 3.4, alt: p.altitude - 1,
      vx: vx - fx * kick + fz * side * 10,
      vz: vz - fz * kick - fx * side * 10,
      vy, born: state.tick,
    });
  }
  state.flareCharges--;
  state.flareReadyAt = state.tick + FLARE_COOLDOWN_TICKS;
  state.flareReloadAt ??= state.tick + FLARE_RELOAD_TICKS;
  showRearLaunch(state, 'flare');
}

function ignite(state: StageState, target: Enemy | WeakPoint, interval: number): void {
  if (state.tick >= (target.burnUntil ?? 0)) target.burnNextAt = state.tick + interval;
  target.burnUntil = state.tick + FLARE_BURN_TICKS;

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
    return false;
  }
  if (tick < target.burnNextAt) return false;
  target.burnNextAt += interval;
  return true;
}

export function advanceFlares(state: StageState, ground: Ground): void {
  if (state.flareReloadAt !== null && state.tick >= state.flareReloadAt) {
    state.flareCharges = Math.min(MAX_FLARES, state.flareCharges + 1);
    state.flareReloadAt = state.flareCharges < MAX_FLARES ? state.tick + FLARE_RELOAD_TICKS : null;
  }
  if (state.flareHit && state.tick >= state.flareHit.until) state.flareHit = null;
  for (const enemy of state.enemies) {
    if (burnTick(enemy, state.tick, FLARE_BURN_INTERVAL)) hurtEnemy(state, enemy, 1);
  }
  const boss = state.boss;
  const point = boss && state.tick >= boss.exposeTick ? boss.weakPoints[boss.index] : null;
  if (boss && point && burnTick(point, state.tick, WARDEN_BURN_INTERVAL)) hurtWeakPoint(state, boss, 1);

  let alive = 0;
  for (const flare of state.flares) {
    if (state.tick - flare.born >= FLARE_LIFE_TICKS) continue;
    flare.vy -= FLARE_GRAVITY * STEP;
    const dx = flare.vx * STEP, dz = flare.vz * STEP, dy = flare.vy * STEP;
    const terrain = groundImpact(flare, dx, dz, ground, dy);

    let hit: Enemy | null = null;
    let first = terrain;
    for (const enemy of state.enemies) {
      if (!enemy.hp) continue;
      const time = descendingImpactTime(flare, dx, dz, dy, enemy, FLARE_HIT_RADIUS);
      if (time < first) {
        first = time;
        hit = enemy;
      }
    }
    const pointTime = point?.hp ? descendingImpactTime(flare, dx, dz, dy, point, point.kind === 'core' ? 4.5 : 7, point.window) : Infinity;
    if (boss && point && pointTime < first) {
      hurtWeakPoint(state, boss, 1);
      ignite(state, point, WARDEN_BURN_INTERVAL);
    } else if (hit) {
      hurtEnemy(state, hit, 1);
      ignite(state, hit, FLARE_BURN_INTERVAL);
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
    state.bombs = Math.min(MAX_BOMBS, state.bombs + 1);
    state.bombReloadAt = state.bombs < MAX_BOMBS ? state.tick + BOMB_RELOAD_TICKS : null;
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
      inBand(target.alt, bomb.alt, window) && nearBomb(bomb, target, BOMB_PROXIMITY);
    if (bomb.alt > impactHeight && !state.enemies.some(enemy => enemy.hp && close(enemy))
      && !(point?.exposed && close(point, point.window))) return true;
    blast(state, bomb);
    return false;
  });
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

function groundImpact(origin: Position, dx: number, dz: number, ground: Ground, dy = 0): number {
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
  const bandAltitude = BANDS[shot.targetBand], floor = bandAltitude - HIT_WINDOW;
  const travel = Math.min(STEP, (shot.alt - floor) / -shot.vy);
  if (travel <= 0) {
    shot.life = 0;
    return;
  }
  const dx = shot.vx * travel, dz = shot.vz * travel, dy = shot.vy * travel;
  let first = groundImpact(shot, dx, dz, ground, dy);
  let hit: Enemy | null = null;
  for (const enemy of state.enemies) {
    if (!enemy.hp || !inBand(enemy.alt, bandAltitude)) continue;
    const time = descendingImpactTime(shot, dx, dz, dy, enemy, HIT_RADIUS);
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

export function advanceShots(state: StageState, ground: Ground): void {
  const p = state.player;
  const player = { x: p.x, z: p.z, alt: p.altitude };
  const reversal = state.reversal;
  const resolved = new Set<number>();
  const misses = new Map<number, Effect>();
  for (const shot of state.shots) {
    if (shot.kind === 'strafe') {
      advanceStrafe(state, shot, ground);
      continue;
    }
    const dx = shot.vx * STEP, dz = shot.vz * STEP;
    const terrain = groundImpact(shot, dx, dz, ground);
    if (shot.kind === 'hostile') {
      if (inBand(shot.alt, player.alt) && impactTime(shot, dx, dz, player, HOSTILE_HIT_RADIUS) < terrain) {
        hurtPlayer(state);
        shot.life = 0;
      }
    } else {
      let enemyHit: Enemy | null = null;
      let bossHit = false;
      let first = terrain;
      let miss = terrain, delta = 0;
      for (const enemy of state.enemies) {
        if (!enemy.hp) continue;
        const time = impactTime(shot, dx, dz, enemy, HIT_RADIUS);
        if (inBand(shot.alt, enemy.alt)) {
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
      if (boss && point?.hp && state.tick >= boss.exposeTick) {
        const time = impactTime(shot, dx, dz, point, point.kind === 'core' ? 4.5 : 7);
        if (time < first && shot.lockId === point.id && inBand(shot.alt, point.alt, point.window)) {
          first = time;
          bossHit = true;
        } else if (time < miss && !inBand(shot.alt, point.alt, point.window)) {
          miss = time;
          delta = point.alt - shot.alt;
        }
      }
      if (bossHit && boss) {
        hurtWeakPoint(state, boss, shot.damage);
        shot.life = 0;
        resolved.add(shot.volley);
      } else if (enemyHit) {
        if (!shot.reversal || shot.reversal.targetId === enemyHit.id) {
          hurtEnemy(state, enemyHit, shot.damage);
          if (!enemyHit.hp && reversal && shot.reversalTick === reversal.startTick && reversal.pursuers.includes(enemyHit.id)) {
            reversal.kills++;
            reversal.shownUntil = state.tick + REVERSAL_CONFIRM;
          }
        }
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
