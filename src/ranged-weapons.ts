import { WEAPONS } from './data/items.ts';
import { hitWindow, weaponCooldown, weaponDamage } from './loadout.ts';
import { nearestBand } from './maneuvers.ts';
import {
  activeWeakPoint, angleTo, BANDS, clamp, groundImpact, HIT_WINDOW, hurtEnemy, hurtWeakPoint, impactTime,
  inBand, projectileRoom, STEP, TICKS_PER_SECOND,
} from './stage-combat.ts';
import type { Band, Enemy, Ground, Position, Shot, StageState, WeakPoint } from './stage-types.ts';

export type RangedShotFields =
  { kind: 'seeker'; weapon: 'seeker'; targetId: number | null; sourceBand: Band; vy: number; radius: number } |
  { kind: 'flak-shell'; weapon: 'flak'; radius: number; fragmentCount: number; fuseAt: number } |
  { kind: 'flak-shard'; weapon: 'flak' };

type RangedShot = Extract<Shot, { kind: RangedShotFields['kind'] }>;
type Target = Enemy | WeakPoint;
const seeker = WEAPONS.seeker.tuning;
const rail = WEAPONS.rail.tuning;
const flak = WEAPONS.flak.tuning;
const arc = WEAPONS.arc.tuning;
const CONTACT_RADIUS = 6;
const MUZZLE_SPAN = 4.2;
const GROUND_STEP = 8;
const BEAM_TICKS = 12;
const LINK_TICKS = 13;
const BLAST_TICKS = 21;

const pose = ({ x, z, alt }: Position): Position => ({ x, z, alt });
const range2 = (a: Position, b: Position): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const engaged = (enemy: Enemy): boolean => enemy.hp > 0 && !enemy.entry;
const weakPoint = (target: Target): target is WeakPoint => target.kind === 'core' || target.kind === 'pod';

function lockedPoint(state: StageState, id = state.lock?.ready ? state.lock.id : null): WeakPoint | null {
  if (id === null) return null;
  const point = activeWeakPoint(state);
  return point?.exposed && point.id === id ? point : null;
}

function hitTarget(state: StageState, target: Target, damage: number): void {
  if (weakPoint(target)) {
    if (state.boss) hurtWeakPoint(state, state.boss, damage);
  } else {
    hurtEnemy(state, target, damage);
  }
}

function targetWindow(state: StageState, target: Target, base?: number, narrow = false): number {
  const window = weakPoint(target) ? Math.min(base ?? target.window, target.window) : base;
  return hitWindow(state, window, narrow);
}

function candidates(state: StageState): Target[] {
  const targets: Target[] = state.enemies.filter(engaged);
  const point = lockedPoint(state);
  if (point) targets.push(point);
  return targets;
}

// Beams and blast checks can span several terrain cells. Use short swept segments.
function visibleFraction(from: Position, to: Position, ground: Ground): number {
  const pieces = Math.max(1, Math.ceil(Math.sqrt(range2(from, to)) / GROUND_STEP));
  const dx = (to.x - from.x) / pieces, dz = (to.z - from.z) / pieces, dy = (to.alt - from.alt) / pieces;
  for (let i = 0; i < pieces; i++) {
    const start = { x: from.x + dx * i, z: from.z + dz * i, alt: from.alt + dy * i };
    const impact = groundImpact(start, dx, dz, ground, dy);
    if (impact !== Infinity) return (i + impact) / pieces;
  }
  return 1;
}

function fireSeekers(state: StageState, source: Position, level: number): boolean {
  const room = Math.min(projectileRoom(state, 'seeker'), seeker.count[level - 1]);
  if (!room) return false;
  const band = nearestBand(source.alt), yaw = state.player.yaw;
  const contacts = candidates(state).filter(target =>
    range2(source, target) <= seeker.range ** 2 && Math.abs(nearestBand(target.alt) - band) <= 1);
  contacts.sort((a, b) => Number(weakPoint(b)) - Number(weakPoint(a)) || range2(source, a) - range2(source, b) || a.id - b.id);
  if (!contacts.length) return false;
  const volley = ++state.nextVolley;
  const damage = weaponDamage(state, 'seeker', seeker.damage);
  for (let i = 0; i < room; i++) {
    const target = weakPoint(contacts[0]) ? contacts[0] : contacts[i % contacts.length];
    const side = (i % 2 ? 1 : -1) * MUZZLE_SPAN;
    const x = source.x + Math.cos(yaw) * side, z = source.z - Math.sin(yaw) * side;
    const aim = Math.atan2(target.x - x, target.z - z) + (i - (room - 1) / 2) * seeker.spread;
    state.shots.push({
      x, z, alt: source.alt, kind: 'seeker', weapon: 'seeker', targetId: target.id, sourceBand: band,
      vx: Math.sin(aim) * seeker.speed, vz: Math.cos(aim) * seeker.speed, vy: 0, radius: seeker.radius[level - 1],
      life: seeker.lifeSeconds, volley, damage, nearMiss: false, lockId: weakPoint(target) ? target.id : null,
    });
  }
  return true;
}

function advanceSeekers(state: StageState, source: Position, level: number): void {
  if (state.tick >= (state.weaponFireAt.seeker ?? 0) && fireSeekers(state, source, level)) {
    state.weaponFireAt.seeker = state.tick + weaponCooldown(state, 'seeker', seeker.cooldownTicks[level - 1]);
  }
  const { reversal, maneuverTrail } = state;
  if (reversal && maneuverTrail && maneuverTrail.kind !== 'j-turn' && state.tick < reversal.until
    && state.seekerEchoAt !== reversal.startTick && fireSeekers(state, source, level)) {
    state.seekerEchoAt = reversal.startTick;
  }
}

function railLines(state: StageState, source: Position, level: number, ground: Ground) {
  const altitudes = [source.alt], low = nearestBand(source.alt) - 1;
  if (level >= rail.lowerBandAt && low >= 0) altitudes.push(BANDS[low]);
  const yaw = state.player.yaw;
  const dx = Math.sin(yaw) * rail.range, dz = Math.cos(yaw) * rail.range;
  return altitudes.map(alt => {
    const from = { x: source.x, z: source.z, alt };
    const fraction = visibleFraction(from, { x: from.x + dx, z: from.z + dz, alt }, ground);
    return { from, to: { x: from.x + dx * fraction, z: from.z + dz * fraction, alt } };
  });
}

function railOverlaps(state: StageState, line: { from: Position; to: Position }, target: Target, width: number): boolean {
  const { from, to } = line;
  if (from.x === to.x && from.z === to.z) return false;
  return inBand(from.alt, target.alt, targetWindow(state, target, rail.window, true))
    && impactTime(from, to.x - from.x, to.z - from.z, target, width) !== Infinity;
}

function advanceRail(state: StageState, source: Position, level: number, ground: Ground): void {
  const charge = state.railChargeAt;
  if (charge === null && state.tick < (state.weaponFireAt.rail ?? 0)) return;
  const width = rail.width[level - 1];
  const lines = railLines(state, source, level, ground);
  if (charge !== null && state.tick >= charge) {
    const damage = weaponDamage(state, 'rail', rail.damage[level - 1]);
    for (const target of candidates(state)) {
      if (lines.some(line => railOverlaps(state, line, target, width))) hitTarget(state, target, damage);
    }
    for (const line of lines) state.weaponFx.push({ kind: 'rail-beam', ...line, radius: width, until: state.tick + BEAM_TICKS });
    state.railChargeAt = null;
    state.weaponFireAt.rail = state.tick + weaponCooldown(state, 'rail', rail.cooldownTicks[level - 1]);
    return;
  }
  if (charge === null && !candidates(state).some(target => lines.some(line => railOverlaps(state, line, target, width)))) return;
  state.railChargeAt ??= state.tick + rail.chargeTicks;
  const preview = state.weaponFx.find(effect => effect.kind === 'rail-charge');
  if (preview) Object.assign(preview, lines[0]);
  else state.weaponFx.push({ kind: 'rail-charge', ...lines[0], radius: width, until: state.railChargeAt });
}

function fireFlak(state: StageState, source: Position, level: number): void {
  if (state.tick < (state.weaponFireAt.flak ?? 0) || !projectileRoom(state, 'flak')) return;
  const seconds = flak.range / flak.speed;
  const vx = Math.sin(state.player.yaw) * flak.speed, vz = Math.cos(state.player.yaw) * flak.speed;
  const centre = { x: source.x + vx * seconds, z: source.z + vz * seconds, alt: source.alt };
  const radius = flak.radius[level - 1];
  const target = candidates(state).find(contact => inBand(centre.alt, contact.alt, targetWindow(state, contact, flak.halfHeight))
    && (range2(centre, contact) <= radius ** 2
      || (contact.x + contact.vx * seconds - centre.x) ** 2 + (contact.z + contact.vz * seconds - centre.z) ** 2 <= radius ** 2));
  if (!target) return;
  const lockId = lockedPoint(state)?.id ?? null;
  state.shots.push({
    ...source, kind: 'flak-shell', weapon: 'flak', vx, vz, life: seconds, radius,
    fuseAt: state.tick + Math.round(seconds * TICKS_PER_SECOND) - 1,
    fragmentCount: level >= flak.fragmentsAt ? flak.fragments : 0, damage: weaponDamage(state, 'flak', flak.damage),
    volley: ++state.nextVolley, nearMiss: false, lockId,
  });
  state.weaponFireAt.flak = state.tick + weaponCooldown(state, 'flak', flak.cooldownTicks[level - 1]);
}

function arcNeighbours(state: StageState, from: Position, to: Target, hopping: boolean): boolean {
  if (weakPoint(to) || !hopping || nearestBand(from.alt) === nearestBand(to.alt)) {
    return inBand(from.alt, to.alt, targetWindow(state, to));
  }
  const step = BANDS[1] - BANDS[0];
  return Math.abs(nearestBand(from.alt) - nearestBand(to.alt)) === 1 && inBand(from.alt, to.alt, hitWindow(state, step + HIT_WINDOW));
}

function fireArc(state: StageState, source: Position, level: number, ground: Ground): void {
  if (state.tick < (state.weaponFireAt.arc ?? 0)) return;
  const contacts = candidates(state);
  const used = new Set<number>();
  const damage = weaponDamage(state, 'arc', arc.damage[level - 1]);
  let from = source;
  for (let i = 0; i <= arc.jumps[level - 1]; i++) {
    let target: Target | null = null, distance = (i ? arc.jumpRange : arc.range) ** 2;
    for (const contact of contacts) {
      if (used.has(contact.id) || !arcNeighbours(state, from, contact, i > 0)) continue;
      const range = range2(from, contact);
      if ((range < distance || (!target && range === distance)) && visibleFraction(from, contact, ground) >= 1) {
        target = contact;
        distance = range;
      }
    }
    if (!target) break;
    const to = pose(target);
    const scale = i > 0 && nearestBand(from.alt) !== nearestBand(to.alt) ? arc.adjacentScale : 1;
    hitTarget(state, target, damage * scale);
    used.add(target.id);
    state.weaponFx.push({ kind: 'arc-link', from, to, until: state.tick + LINK_TICKS });
    from = to;
  }
  if (!used.size) return;
  if (level >= arc.explosionAt && used.size > 1) {
    for (const enemy of state.enemies) {
      if (engaged(enemy) && !used.has(enemy.id) && range2(from, enemy) <= arc.explosionRadius ** 2
        && inBand(from.alt, enemy.alt, hitWindow(state)) && visibleFraction(from, enemy, ground) >= 1) {
        hurtEnemy(state, enemy, damage * arc.explosionScale);
      }
    }
    state.weaponFx.push({ kind: 'arc-blast', from, radius: arc.explosionRadius, until: state.tick + BLAST_TICKS });
  }
  state.weaponFireAt.arc = state.tick + weaponCooldown(state, 'arc', arc.cooldownTicks);
}

export function advanceRangedWeapons(state: StageState, ground: Ground): void {
  if (!state.run) return;
  const { x, z, altitude: alt } = state.player;
  const source = { x, z, alt };
  const levels = state.run.weaponLevels;
  if (levels.seeker) advanceSeekers(state, source, levels.seeker);
  if (levels.rail) advanceRail(state, source, levels.rail, ground);
  if (levels.flak) fireFlak(state, source, levels.flak);
  if (levels.arc) fireArc(state, source, levels.arc, ground);
}

function seekerContact(state: StageState, shot: Extract<RangedShot, { kind: 'seeker' }>): Target | null {
  const weak = lockedPoint(state, shot.lockId);
  if (weak) return weak;
  let next: Enemy | null = null, best = seeker.range ** 2;
  for (const enemy of state.enemies) {
    if (!engaged(enemy) || Math.abs(nearestBand(enemy.alt) - shot.sourceBand) > 1) continue;
    if (enemy.id === shot.targetId) return enemy;
    const range = range2(shot, enemy);
    if (range < best) {
      next = enemy;
      best = range;
    }
  }
  shot.targetId = next?.id ?? null;
  shot.lockId = null;
  return next;
}

function projectileImpact(state: StageState, shot: RangedShot, dx: number, dz: number, dy: number, target: Target): number {
  const radius = target.kind === 'core' ? 4.5 : CONTACT_RADIUS;
  const window = targetWindow(state, target);
  if (!dy) return inBand(shot.alt, target.alt, window) ? impactTime(shot, dx, dz, target, radius) : Infinity;
  const entry = (target.alt - window - shot.alt) / dy;
  const exit = (target.alt + window - shot.alt) / dy;
  const from = Math.max(0, Math.min(entry, exit));
  const to = Math.min(1, Math.max(entry, exit));
  return from <= to ? impactTime(shot, dx, dz, target, radius, from, to) : Infinity;
}

function explode(state: StageState, shot: Extract<RangedShot, { kind: 'seeker' | 'flak-shell' }>, ground: Ground): void {
  const isFlak = shot.kind === 'flak-shell';
  const window = isFlak ? flak.halfHeight : undefined;
  const matches = (target: Target) => inBand(shot.alt, target.alt, targetWindow(state, target, window))
    && range2(shot, target) <= shot.radius ** 2 && visibleFraction(shot, target, ground) >= 1;
  for (const target of state.enemies) {
    if (!engaged(target) || (!isFlak && Math.abs(nearestBand(target.alt) - shot.sourceBand) > 1)) continue;
    if (matches(target)) hurtEnemy(state, target, shot.damage);
  }
  const point = lockedPoint(state, shot.lockId);
  if (point && matches(point)) hitTarget(state, point, shot.damage);
  state.weaponFx.push({ kind: isFlak ? 'flak-blast' : 'seeker-blast', from: pose(shot), radius: shot.radius, until: state.tick + BLAST_TICKS });
  if (!isFlak || !shot.fragmentCount) return;
  const room = Math.min(projectileRoom(state, 'flak'), shot.fragmentCount);
  const damage = weaponDamage(state, 'flak', flak.fragmentDamage);
  for (let i = 0; i < room; i++) {
    const yaw = i * 2 * Math.PI / shot.fragmentCount;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    state.shots.push({
      x: shot.x + fx * CONTACT_RADIUS, z: shot.z + fz * CONTACT_RADIUS, alt: shot.alt,
      kind: 'flak-shard', weapon: 'flak', vx: fx * flak.fragmentSpeed, vz: fz * flak.fragmentSpeed,
      life: flak.fragmentLifeSeconds, volley: shot.volley, damage, nearMiss: false, lockId: null,
    });
  }
}

export function advanceRangedShot(state: StageState, shot: RangedShot, ground: Ground): void {
  if (shot.life <= 0) return;
  let target: Target | null = null, dy = 0;
  if (shot.kind === 'seeker') {
    target = seekerContact(state, shot);
    if (target) {
      const yaw = Math.atan2(shot.vx, shot.vz);
      const turn = angleTo(yaw, target.x - shot.x, target.z - shot.z);
      const aimed = yaw + clamp(turn, -seeker.turnRate * STEP, seeker.turnRate * STEP);
      shot.vx = Math.sin(aimed) * seeker.speed;
      shot.vz = Math.cos(aimed) * seeker.speed;
      const climb = seeker.verticalSpeed * STEP;
      dy = clamp(target.alt - shot.alt, -climb, climb);
    }
    shot.vy = dy / STEP;
  }
  const dx = shot.vx * STEP, dz = shot.vz * STEP;
  const terrain = groundImpact(shot, dx, dz, ground, dy);
  let impact = terrain, victim: Enemy | null = null;
  if (shot.kind === 'flak-shard') {
    for (const enemy of state.enemies) {
      if (!engaged(enemy)) continue;
      const time = projectileImpact(state, shot, dx, dz, 0, enemy);
      if (time < impact) {
        impact = time;
        victim = enemy;
      }
    }
  } else if (target) {
    impact = Math.min(impact, projectileImpact(state, shot, dx, dz, dy, target));
  }
  const travel = Math.min(1, impact);
  shot.x += dx * travel;
  shot.z += dz * travel;
  shot.alt += dy * travel;
  if (victim) hurtEnemy(state, victim, shot.damage);
  if ((shot.kind === 'seeker' && impact < terrain)
    || (shot.kind === 'flak-shell' && terrain === Infinity && state.tick >= shot.fuseAt)) {
    explode(state, shot, ground);
    shot.life = 0;
  } else {
    shot.life = impact === Infinity ? shot.life - STEP : 0;
  }
}
