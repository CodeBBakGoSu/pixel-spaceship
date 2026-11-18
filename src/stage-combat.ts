import type { Boss, Effect, Enemy, Position, Shot, StageState, WeakPoint } from './stage-types.ts';

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

export function acquireAndFire(state: StageState, manualFire: boolean): void {
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

  if (state.tick >= state.twinAt && (twin || manualFire)) {
    fireFriendly(state, 'twin', state.twinRank === 3 ? [-4.2, -1.6, 1.6, 4.2] : [-2.2, 2.2], twin, locked && weak ? weak.id : null);
    state.twinAt = state.tick + (state.twinRank === 1 ? 21 : 13);
  }
  if (state.tick >= state.podsAt && (left || right)) {
    if (left) fireFriendly(state, 'pods', [-6], left, null);
    if (right) fireFriendly(state, 'pods', [6], right, null);
    state.podsAt = state.tick + (state.podRank === 1 ? 43 : 25);
  }
}

export function detonate(state: StageState): void {
  const p = state.player;
  const nearby = (x: number, z: number, radius: number) => Math.hypot(x - p.x, z - p.z) <= radius;
  state.bombs--;
  state.roll = 1;
  state.effects.push({ kind: 'nova', x: p.x, z: p.z, alt: p.altitude, life: 0.8 });
  state.shots = state.shots.filter(shot => shot.kind !== 'hostile' || !nearby(shot.x, shot.z, 104));
  for (const enemy of state.enemies) {
    if (enemy.hp && nearby(enemy.x, enemy.z, 104) && inBand(enemy.alt, p.altitude)) hurtEnemy(state, enemy, 2);
  }
  const point = activeWeakPoint(state);
  if (state.boss && point?.exposed && nearby(point.x, point.z, 104) && inBand(point.alt, p.altitude, point.window)) {
    hurtWeakPoint(state, state.boss, 2);
  }
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

export function advanceShots(state: StageState): void {
  const p = state.player;
  const player = { x: p.x, z: p.z, alt: p.altitude };
  const resolved = new Set<number>();
  const misses = new Map<number, Effect>();
  for (const shot of state.shots) {
    const dx = shot.vx * STEP, dz = shot.vz * STEP;
    if (shot.kind === 'hostile') {
      if (inBand(shot.alt, player.alt) && impactTime(shot, dx, dz, player, 5.5) !== Infinity) {
        hurtPlayer(state);
        shot.life = 0;
      }
    } else {
      let enemyHit: Enemy | null = null;
      let bossHit = false;
      let first = Infinity;
      let miss = Infinity, delta = 0;
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
      } else if (miss < Infinity && !shot.nearMiss && !misses.has(shot.volley)) {
        misses.set(shot.volley, {
          kind: 'miss', x: shot.x + dx * miss, z: shot.z + dz * miss, alt: shot.alt,
          vx: shot.vx, vz: shot.vz, delta, life: 0.55,
        });
      }
    }
    shot.x += dx;
    shot.z += dz;
    shot.life -= STEP;
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
