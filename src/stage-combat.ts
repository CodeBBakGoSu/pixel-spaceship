import type { Boss, Effect, Enemy, Ground, Position, RearBomb, Shot, StageState, WeakPoint } from './stage-types.ts';

export const TICKS_PER_SECOND = 60;
export const STEP = 1 / TICKS_PER_SECOND;
export const BANDS = [75, 110, 145] as const;
export const HIT_WINDOW = 8;
export const MIN_ALTITUDE = 55;
export const MAX_ALTITUDE = 165;
export const VERTICAL_SPEED = 40;
export const WIPE_DURATION = 0.15;
export const BOLT_SPEED = 230;
export const SHOT_LIMIT = 192;
export const MINE_LIMIT = 16;
export const MINE_RADIUS = 12;
export const FLAK_RADIUS = 22;
export const FLAK_LIFE = 0.65;
export const MAX_BOMBS = 3;
export const BOMB_RELOAD_TICKS = 450;
export const BOMB_BLAST_RADIUS = 34;
const BOMB_DROP_TICKS = 24;
const BOMB_HOLD_TICKS = 27;
const BOMB_FALL_SPEED = 24;
const BOMB_PROXIMITY = 16;
const BOMB_CLEAR_RADIUS = 40;
const LOCK_TICKS = 21;
const HIT_RADIUS = 6;
const TWIN_CONE = Math.PI / 6;
const TWIN_RANGE = 135;
const POD_RANGE = 46;

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
): void {
  const p = state.player;
  const forwardX = Math.sin(p.yaw), forwardZ = Math.cos(p.yaw);
  const lead = target ? Math.hypot(target.x - p.x, target.z - p.z) / BOLT_SPEED : 0;
  const volley = ++state.nextVolley;
  for (const side of offsets) {
    if (state.shots.length >= SHOT_LIMIT) break;
    const muzzle = kind === 'twin' ? 6 : 0;
    const x = p.x + forwardX * muzzle + forwardZ * side;
    const z = p.z + forwardZ * muzzle - forwardX * side;
    const yaw = target
      ? Math.atan2(target.x + (target.vx ?? 0) * lead - x, target.z + (target.vz ?? 0) * lead - z)
      : p.yaw;
    state.shots.push({
      x, z, alt: p.altitude, kind, vx: Math.sin(yaw) * BOLT_SPEED, vz: Math.cos(yaw) * BOLT_SPEED,
      damage: kind === 'twin' ? state.twinDamage : state.podDamage,
      life: kind === 'twin' ? 0.68 : 0.27, volley, nearMiss: false, lockId,
    });
  }
}

export function acquireAndFire(state: StageState): void {
  const p = state.player;
  const weak = activeWeakPoint(state);
  const weakRange = weak ? Math.hypot(weak.x - p.x, weak.z - p.z) : Infinity;
  const weakAngle = weak ? angleTo(p.yaw, weak.x - p.x, weak.z - p.z) : Infinity;
  const aligned = weak?.exposed && weakRange <= 140 && Math.abs(weakAngle) <= Math.PI / 15 && inBand(p.altitude, weak.alt, weak.window);
  if (weak && aligned) {
    const previous = state.lock?.id === weak.id ? state.lock.progress : 0;
    const ticks = Math.min(LOCK_TICKS, Math.round(previous * LOCK_TICKS) + 1);
    state.lock = { id: weak.id, progress: ticks / LOCK_TICKS, ready: ticks === LOCK_TICKS };
  } else {
    state.lock = null;
  }

  const locked = !!(state.lock?.ready && weak);
  let twin: Aim | null = locked ? weak : null;
  let wrong: Aim | null = weak && weak.exposed && weakRange <= 140 && Math.abs(weakAngle) <= TWIN_CONE
    && !inBand(p.altitude, weak.alt, weak.window) ? weak : null;
  let twinRange = TWIN_RANGE, wrongRange = wrong ? weakRange : TWIN_RANGE;
  let left: Enemy | null = null, right: Enemy | null = null;
  let leftRange = POD_RANGE, rightRange = POD_RANGE;
  for (const enemy of state.enemies) {
    if (!enemy.hp) continue;
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const bearing = angleTo(p.yaw, dx, dz), range = Math.hypot(dx, dz);
    const sameBand = inBand(p.altitude, enemy.alt);
    if (Math.abs(bearing) <= TWIN_CONE) {
      if (sameBand && !locked && range <= twinRange) {
        twin = enemy;
        twinRange = range;
      } else if (!sameBand && range < wrongRange) {
        wrong = enemy;
        wrongRange = range;
      }
    } else if (sameBand && Math.abs(bearing) >= Math.PI * 0.2) {
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

  if (state.tick >= state.twinAt && twin) {
    fireFriendly(state, 'twin', state.twinRank === 3 ? [-4.2, -1.6, 1.6, 4.2] : [-2.2, 2.2], twin, locked && weak ? weak.id : null);
    state.twinAt = state.tick + (state.twinRank === 1 ? 21 : 13);
  }
  if (state.tick >= state.podsAt && (left || right)) {
    if (left) fireFriendly(state, 'pods', [-6], left, null);
    if (right) fireFriendly(state, 'pods', [6], right, null);
    state.podsAt = state.tick + (state.podRank === 1 ? 43 : 25);
  }
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
}

function nearBomb(bomb: RearBomb, target: Position, radius: number): boolean {
  return Math.hypot(target.x - bomb.x, target.z - bomb.z) <= radius;
}

function blast(state: StageState, bomb: RearBomb): void {
  state.effects.push({ kind: 'bomb-blast', x: bomb.x, z: bomb.z, alt: bomb.alt, life: 0.8 });
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
function impactTime(shot: Shot, dx: number, dz: number, target: Position, radius: number): number {
  const x = shot.x - target.x, z = shot.z - target.z;
  const c = x * x + z * z - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  const b = x * dx + z * dz;
  const discriminant = b * b - a * c;
  if (!a || b >= 0 || discriminant < 0) return Infinity;
  const time = (-b - Math.sqrt(discriminant)) / a;
  return time <= 1 ? time : Infinity;
}

function groundImpact(shot: Shot, dx: number, dz: number, ground: Ground): number {
  if (ground(shot.x, shot.z) >= shot.alt) return 0;
  let first = ground(shot.x + dx / 2, shot.z + dz / 2) >= shot.alt ? 0.5 : 1;
  if (first === 1 && ground(shot.x + dx, shot.z + dz) < shot.alt) return Infinity;
  let last = first - 0.5;
  for (let i = 0; i < 5; i++) {
    const middle = (last + first) / 2;
    if (ground(shot.x + dx * middle, shot.z + dz * middle) >= shot.alt) first = middle;
    else last = middle;
  }
  return first;
}

export function advanceShots(state: StageState, ground: Ground): void {
  const p = state.player;
  const player = { x: p.x, z: p.z, alt: p.altitude };
  const resolved = new Set<number>();
  const misses = new Map<number, Effect>();
  for (const shot of state.shots) {
    const dx = shot.vx * STEP, dz = shot.vz * STEP;
    const terrain = groundImpact(shot, dx, dz, ground);
    if (shot.kind === 'hostile') {
      if (inBand(shot.alt, player.alt) && impactTime(shot, dx, dz, player, 5.5) < terrain) {
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
}
