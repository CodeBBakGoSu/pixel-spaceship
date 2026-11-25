import { ACE } from './data/ace.ts';
import { WEAPONS, type WeaponId } from './data/items.ts';
import { adjacentBand, bandAltitude, bandDistance, contactBand, playerBand, SKIM_BAND, type FlightBand } from './bands.ts';
import { RANGED_EVOLUTION_TUNING } from './data/ranged-evolutions.ts';
import { familyBonus, hitWindow, railWidthScale, targetCaptureAngleScale, weaponCooldown, weaponDamage } from './loadout.ts';
import {
  activeAce, aceVulnerable, angleTo, BANDS, clamp, groundImpact, HIT_WINDOW, hurtAce, hurtEnemy, impactTime, impactTime3d,
  inBand, projectileRoom, STEP, TICKS_PER_SECOND,
} from './stage-combat.ts';
import type { Ace, Enemy, Ground, Position, Shot, StageState } from './stage-types.ts';
import { distanceSquared3d, dot3d, normalize3d, pointSegmentDistanceSquared3d, subtract3d } from './spatial.ts';

export type RangedShotFields =
  { kind: 'seeker'; weapon: 'seeker'; targetId: number | null; sourceBand: FlightBand; vy: number; radius: number; rack?: true } |
  { kind: 'flak-shell'; weapon: 'flak'; radius: number; fragmentCount: number; fuseAt: number;
    skybreaker?: 'primary' | 'secondary' } |
  { kind: 'flak-shard'; weapon: 'flak'; pierce?: { remaining: number; hits: number[] } };

type RangedShot = Extract<Shot, { kind: RangedShotFields['kind'] }>;
type Target = Enemy | Ace;
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
const range2 = (state: StageState, a: Position, b: Position): number => state.run
  ? distanceSquared3d(a, b) : (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const engaged = (enemy: Enemy): boolean => enemy.hp > 0 && !enemy.entry;

function insideAimCone(from: Position, yaw: number, pitch: number, target: Position, cone: number): boolean {
  const direction = normalize3d(subtract3d(target, from));
  const forward = { x: Math.sin(yaw) * Math.cos(pitch), z: Math.cos(yaw) * Math.cos(pitch), alt: Math.sin(pitch) };
  return dot3d(forward, direction) >= Math.cos(cone);
}

function lockedAce(state: StageState, id = state.lock?.ready ? state.lock.id : null): Ace | null {
  if (id === null) return null;
  const ace = activeAce(state);
  return ace?.id === id && !ace.entry ? ace : null;
}

function hitTarget(state: StageState, target: Target, damage: number, weapon: WeaponId, source?: Position): void {
  if (target.kind === 'ace') hurtAce(state, target, damage, weapon);
  else hurtEnemy(state, target, damage, { weapon }, source);
}

function candidates(state: StageState, accepts?: (target: Target) => boolean): Target[] {
  const targets: Target[] = [];
  for (const enemy of state.enemies) if (engaged(enemy) && (!accepts || accepts(enemy))) targets.push(enemy);
  const ace = lockedAce(state);
  if (ace && (!accepts || accepts(ace))) targets.push(ace);
  return targets;
}

// Beams and blast checks can span several terrain cells. Use short swept segments.
function visibleFraction(state: StageState, from: Position, to: Position, ground: Ground): number {
  const pieces = Math.max(1, Math.ceil(Math.sqrt(range2(state, from, to)) / GROUND_STEP));
  const dx = (to.x - from.x) / pieces, dz = (to.z - from.z) / pieces, dy = (to.alt - from.alt) / pieces;
  for (let i = 0; i < pieces; i++) {
    const start = { x: from.x + dx * i, z: from.z + dz * i, alt: from.alt + dy * i };
    const impact = groundImpact(start, dx, dz, ground, dy);
    if (impact !== Infinity) return (i + impact) / pieces;
  }
  return 1;
}

function fireSeekers(state: StageState, source: Position, level: number): boolean {
  const rack = state.run?.evolutions?.seeker === 'swarm-rack';
  const count = rack ? RANGED_EVOLUTION_TUNING['swarm-rack'].rockets : seeker.count[level - 1];
  const room = Math.min(projectileRoom(state, 'seeker'), count);
  if (!room || (rack && room < count)) return false;
  const band = playerBand(state.player), yaw = state.player.yaw;
  const contacts = candidates(state, target => range2(state, source, target) <= seeker.range ** 2
    && (state.run
      ? insideAimCone(source, yaw, state.player.pitch, target, Math.PI / 3 * targetCaptureAngleScale(state))
      : bandDistance(contactBand(target), band) <= 1));
  if (!contacts.length) return false;
  const priority = (target: Target): number => target.kind === 'ace' ? 2 : rack && target.carrier ? 1 : 0;
  contacts.sort((a, b) => priority(b) - priority(a) || range2(state, source, a) - range2(state, source, b) || a.id - b.id);
  const preferred = priority(contacts[0]) > 0 ? contacts[0] : null;
  const volley = ++state.nextVolley;
  const damage = weaponDamage(state, 'seeker', seeker.damage);
  const radius = seeker.radius[level - 1] * (familyBonus(state, 'seeker')?.radiusScale ?? 1);
  for (let i = 0; i < room; i++) {
    const target = preferred ?? contacts[i % contacts.length];
    const side = (i % 2 ? 1 : -1) * MUZZLE_SPAN;
    const x = source.x + Math.cos(yaw) * side, z = source.z - Math.sin(yaw) * side;
    const aim = Math.atan2(target.x - x, target.z - z) + (i - (room - 1) / 2) * seeker.spread;
    state.shots.push({
      x, z, alt: source.alt, kind: 'seeker', weapon: 'seeker', targetId: target.id, sourceBand: band,
      vx: Math.sin(aim) * seeker.speed, vz: Math.cos(aim) * seeker.speed, vy: 0, radius,
      life: seeker.lifeSeconds, volley, damage, nearMiss: false, lockId: target.kind === 'ace' ? target.id : null,
      ...(rack ? { rack: true } : {}),
    });
  }
  return true;
}

function advanceSeekers(state: StageState, source: Position, level: number): void {
  if (state.tick >= (state.weaponFireAt.seeker ?? 0) && fireSeekers(state, source, level)) {
    state.weaponFireAt.seeker = state.tick + weaponCooldown(state, 'seeker', seeker.cooldownTicks);
  }
  const { reversal, maneuverTrail } = state;
  if (reversal && maneuverTrail && maneuverTrail.kind !== 'j-turn' && state.tick < reversal.until
    && state.seekerEchoAt !== reversal.startTick && fireSeekers(state, source, level)) {
    state.seekerEchoAt = reversal.startTick;
  }
}

function railLines(state: StageState, source: Position, level: number, ground: Ground) {
  const prism = state.run?.evolutions?.rail === 'prism-lance';
  const altitudes: number[] = state.run ? [source.alt]
    : prism ? [...BANDS, bandAltitude(SKIM_BAND, ground(source.x, source.z))] : [source.alt];
  const low = adjacentBand(playerBand(state.player), -1);
  const high = adjacentBand(playerBand(state.player), 1);
  if (!state.run && !prism && level >= rail.lowerBandAt && low !== null) {
    altitudes.push(bandAltitude(low, low === SKIM_BAND ? ground(source.x, source.z) : undefined));
  }
  if (!state.run && !prism && level >= rail.upperBandAt && high !== null) altitudes.push(bandAltitude(high));
  const length = rail.range[level - 1];
  const fan = state.run && prism ? [-1, 0, 1] : [0];
  return altitudes.flatMap(alt => fan.map(side => {
    const yaw = state.player.yaw + (state.run && prism ? side * Math.PI / 9 : 0);
    const pitch = state.run && prism ? side * Math.PI / 18 : 0;
    const horizontal = length * Math.cos(pitch);
    return {
      from: { x: source.x, z: source.z, alt },
      to: {
        x: source.x + Math.sin(yaw) * horizontal,
        z: source.z + Math.cos(yaw) * horizontal,
        alt: alt + Math.sin(pitch) * length,
      },
    };
  }));
}

function railOverlaps(state: StageState, line: { from: Position; to: Position }, target: Target, width: number): boolean {
  const { from, to } = line;
  if (from.x === to.x && from.z === to.z) return false;
  return state.run
    ? pointSegmentDistanceSquared3d(target, from, to) <= (width + CONTACT_RADIUS) ** 2
    : inBand(from.alt, target.alt, hitWindow(state, rail.window, true))
      && impactTime(from, to.x - from.x, to.z - from.z, target, width) !== Infinity;
}

function advanceRail(state: StageState, source: Position, level: number, ground: Ground): void {
  let glowTargets: Target[] | undefined;
  for (const fx of state.weaponFx) {
    if (fx.kind !== 'rail-glow' || state.tick >= fx.until || !fx.to || !fx.hits || !fx.radius || !fx.damage) continue;
    for (const target of glowTargets ??= candidates(state)) {
      if (!target.hp || fx.hits.includes(target.id) || !railOverlaps(state, { from: fx.from, to: fx.to }, target, fx.radius)) continue;
      const hp = target.hp;
      hitTarget(state, target, fx.damage, 'rail', fx.from);
      if (target.hp < hp) fx.hits.push(target.id);
    }
  }
  const charge = state.railChargeAt;
  const repeat = state.railRepeatAt;
  if (repeat !== undefined && state.tick < repeat) return;
  if (repeat === undefined && charge === null && state.tick < (state.weaponFireAt.rail ?? 0)) return;
  const width = rail.width[level - 1] * railWidthScale(state);
  const contacts = candidates(state);
  const lines = railLines(state, source, level, ground);
  const onRail = (target: Target) => lines.some(line => railOverlaps(state, line, target, width));
  // Skip terrain rays while no target is even in the unoccluded firing lane.
  if (repeat === undefined && charge === null && !contacts.some(onRail)) return;
  for (const { from, to } of lines) {
    const fraction = visibleFraction(state, from, to, ground);
    to.x = from.x + (to.x - from.x) * fraction;
    to.z = from.z + (to.z - from.z) * fraction;
    to.alt = from.alt + (to.alt - from.alt) * fraction;
  }
  if (repeat !== undefined || (charge !== null && state.tick >= charge)) {
    const damage = weaponDamage(state, 'rail', rail.damage);
    const sharedAfterglowHits = state.run?.evolutions?.rail === 'prism-lance' ? [] : null;
    for (const target of contacts) {
      if (onRail(target)) hitTarget(state, target, damage, 'rail', source);
    }
    for (const line of lines) {
      state.weaponFx.push({ kind: 'rail-beam', ...line, radius: width, until: state.tick + BEAM_TICKS });
      if (level >= rail.lingerAt) state.weaponFx.push({
        kind: 'rail-glow', ...line, radius: width, until: state.tick + rail.lingerTicks,
        damage: damage * rail.lingerDamageScale, hits: sharedAfterglowHits ?? [],
      });
    }
    state.railChargeAt = null;
    if (repeat === undefined && level >= rail.repeatAt) state.railRepeatAt = state.tick + rail.repeatTicks;
    else {
      delete state.railRepeatAt;
      state.weaponFireAt.rail = state.tick + weaponCooldown(state, 'rail', rail.cooldownTicks);
    }
    return;
  }
  if (charge === null && !contacts.some(onRail)) return;
  state.railChargeAt ??= state.tick + rail.chargeTicks;
  const previews = state.weaponFx.filter(effect => effect.kind === 'rail-charge');
  for (const [index, line] of lines.entries()) {
    const preview = previews[index];
    if (preview) Object.assign(preview, line, { radius: width });
    else state.weaponFx.push({ kind: 'rail-charge', ...line, radius: width, until: state.railChargeAt });
  }
}

const skybreakerHeight = (state: StageState): number => BANDS[2] - BANDS[1] + hitWindow(state);

function flakInBand(state: StageState, origin: Position, target: Target, skybreaker: boolean): boolean {
  if (state.run) return true;
  if (skybreaker) return contactBand(target) === SKIM_BAND || inBand(BANDS[1], target.alt, skybreakerHeight(state));
  return inBand(origin.alt, target.alt, hitWindow(state, flak.halfHeight));
}

function fireFlak(state: StageState, source: Position, level: number): void {
  if (state.tick < (state.weaponFireAt.flak ?? 0)) return;
  const skybreaker = state.run?.evolutions?.flak === 'skybreaker';
  const count = Math.min(projectileRoom(state, 'flak'), skybreaker ? 1 : flak.count[level - 1]);
  if (!count) return;
  const seconds = flak.range / flak.speed;
  const radius = flak.radius[level - 1];
  const lanes = Array.from({ length: count }, (_, i) => {
    const yaw = state.player.yaw + (i - (count - 1) / 2) * flak.spread;
    const vx = Math.sin(yaw) * flak.speed, vz = Math.cos(yaw) * flak.speed;
    return { vx, vz, centre: { x: source.x + vx * seconds, z: source.z + vz * seconds, alt: source.alt } };
  });
  const target = candidates(state).some(contact => lanes.some(({ centre }) => {
    const predicted = { ...contact, x: contact.x + contact.vx * seconds, z: contact.z + contact.vz * seconds,
      alt: contact.alt };
    return flakInBand(state, centre, contact, skybreaker)
      && (range2(state, centre, contact) <= radius ** 2 || range2(state, centre, predicted) <= radius ** 2);
  }));
  if (!target) return;
  const lockId = lockedAce(state)?.id ?? null;
  const volley = ++state.nextVolley;
  for (const { vx, vz } of lanes) state.shots.push({
    ...source, kind: 'flak-shell', weapon: 'flak', vx, vz, life: seconds, radius,
    fuseAt: state.tick + Math.round(seconds * TICKS_PER_SECOND) - 1,
    fragmentCount: skybreaker ? 0 : flak.fragments[level - 1], damage: weaponDamage(state, 'flak', flak.damage),
    volley, nearMiss: false, lockId,
    ...(skybreaker ? { skybreaker: 'primary' } : {}),
  });
  state.weaponFireAt.flak = state.tick + weaponCooldown(state, 'flak', flak.cooldownTicks);
}

function arcNeighbours(state: StageState, from: Position, fromBand: FlightBand, to: Target, hopping: boolean): boolean {
  if (state.run) return true;
  const gap = bandDistance(fromBand, contactBand(to));
  if (to.kind === 'ace' || !hopping || gap === 0) {
    return inBand(from.alt, to.alt, hitWindow(state));
  }
  const step = BANDS[1] - BANDS[0];
  return gap === 1 && inBand(from.alt, to.alt, hitWindow(state, step + HIT_WINDOW));
}

function fireStormCrown(state: StageState, source: Position, contacts: Target[], damage: number, ground: Ground): boolean {
  if (!state.pickups.length || !contacts.length) return false;
  const tuning = RANGED_EVOLUTION_TUNING['storm-crown'];
  const orbs = state.pickups.filter(orb => orb.kind !== 'magnet' && range2(state, source, orb) <= tuning.range ** 2);
  orbs.sort((a, b) => range2(state, source, a) - range2(state, source, b) || a.id - b.id);
  const used = new Set<number>();
  let strikes = 0;
  for (const orb of orbs) {
    let struck = false;
    for (const target of contacts) {
      if (used.has(target.id) || (!state.run && !inBand(orb.alt, target.alt, hitWindow(state)))
        || range2(state, orb, target) > tuning.radius ** 2 || visibleFraction(state, orb, target, ground) < 1) continue;
      hitTarget(state, target, damage * tuning.damageScale, 'arc');
      used.add(target.id);
      struck = true;
    }
    if (!struck) continue;
    const to = pose(orb), from = { ...to, alt: to.alt + tuning.strikeHeight };
    state.weaponFx.push({ kind: 'arc-link', from, to, until: state.tick + LINK_TICKS });
    state.weaponFx.push({ kind: 'arc-blast', from: to, radius: tuning.radius, until: state.tick + BLAST_TICKS });
    if (++strikes === tuning.strikes) break;
  }
  return strikes > 0;
}

function fireArc(state: StageState, source: Position, level: number, ground: Ground): void {
  if (state.tick < (state.weaponFireAt.arc ?? 0)) return;
  const contacts = candidates(state);
  const damage = weaponDamage(state, 'arc', arc.damage);
  if (state.run?.evolutions?.arc === 'storm-crown' && fireStormCrown(state, source, contacts, damage, ground)) {
    state.weaponFireAt.arc = state.tick + weaponCooldown(state, 'arc', arc.cooldownTicks);
    return;
  }
  const used = new Set<number>();
  const chainCount = level >= arc.branchesAt ? 2 : 1;
  const chains = Array.from({ length: chainCount }, () => ({ from: source, band: playerBand(state.player), links: 0, active: true }));
  for (let i = 0; i <= arc.jumps[level - 1]; i++) {
    for (const chain of chains) {
      if (!chain.active) continue;
      const { from, band } = chain;
      let target: Target | null = null, distance = (i ? arc.jumpRange : arc.range) ** 2;
      for (const contact of contacts) {
        if (used.has(contact.id) || !arcNeighbours(state, from, band, contact, i > 0)) continue;
        const range = range2(state, from, contact);
        if ((range < distance || (!target && range === distance)) && visibleFraction(state, from, contact, ground) >= 1) {
          target = contact;
          distance = range;
        }
      }
      if (!target) {
        chain.active = false;
        continue;
      }
      const to = pose(target), nextBand = contactBand(target);
      const scale = i > 0 && (state.run || band !== nextBand) ? arc.adjacentScale : 1;
      hitTarget(state, target, damage * scale, 'arc');
      used.add(target.id);
      state.weaponFx.push({ kind: 'arc-link', from, to, until: state.tick + LINK_TICKS });
      chain.from = to;
      chain.band = nextBand;
      chain.links++;
    }
    if (chains.every(chain => !chain.active)) break;
  }
  if (!used.size) return;
  if (level >= arc.explosionAt) for (const { from, links } of chains) {
    if (!links) continue;
    for (const enemy of state.enemies) {
      if (engaged(enemy) && !used.has(enemy.id) && range2(state, from, enemy) <= arc.explosionRadius ** 2
        && (state.run || inBand(from.alt, enemy.alt, hitWindow(state))) && visibleFraction(state, from, enemy, ground) >= 1) {
        hurtEnemy(state, enemy, damage * arc.explosionScale, { weapon: 'arc' });
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
  const ace = lockedAce(state, shot.lockId);
  const yaw = Math.atan2(shot.vx, shot.vz), pitch = Math.atan2(shot.vy, Math.hypot(shot.vx, shot.vz));
  const captureCone = Math.PI / 3 * targetCaptureAngleScale(state);
  if (ace && (!state.run || (range2(state, shot, ace) < seeker.range ** 2
    && insideAimCone(shot, yaw, pitch, ace, captureCone)))) return ace;
  if (state.run && shot.lockId !== null) shot.lockId = null;
  let next: Enemy | null = null, best = seeker.range ** 2, elite = false;
  for (const enemy of state.enemies) {
    if (!engaged(enemy)) continue;
    if (!state.run && bandDistance(contactBand(enemy), shot.sourceBand) > 1) continue;
    if (!state.run && enemy.id === shot.targetId) return enemy;
    const range = range2(state, shot, enemy);
    if (range >= seeker.range ** 2) continue;
    if (state.run && !insideAimCone(shot, yaw, pitch, enemy, captureCone)) continue;
    if (state.run && enemy.id === shot.targetId) return enemy;
    const priority = !!(shot.rack && enemy.carrier);
    if (priority === elite ? range < best : priority) {
      next = enemy;
      best = range;
      elite = priority;
    }
  }
  shot.targetId = next?.id ?? null;
  shot.lockId = null;
  return next;
}

function seekerDirection(shot: RangedShot, target: Target): { x: number; z: number; alt: number } {
  const speed = seeker.speed;
  const current = normalize3d({ x: shot.vx, z: shot.vz, alt: shot.vy ?? 0 });
  const climbTime = Math.abs(target.alt - shot.alt) / seeker.verticalSpeed;
  const lead = Math.max(Math.sqrt(distanceSquared3d(shot, target)) / speed, climbTime);
  const predicted = { ...target, x: target.x + (target.vx ?? 0) * lead, z: target.z + (target.vz ?? 0) * lead };
  const desired = normalize3d(subtract3d(predicted, shot));
  const maxVertical = Math.min(1, seeker.verticalSpeed / speed);
  const vertical = clamp(desired.alt, -maxVertical, maxVertical);
  const horizontal = Math.hypot(desired.x, desired.z);
  const horizontalScale = Math.sqrt(1 - vertical * vertical);
  const limited = {
    x: horizontal ? desired.x / horizontal * horizontalScale : 0,
    z: horizontal ? desired.z / horizontal * horizontalScale : 0,
    alt: vertical,
  };
  const cosine = clamp(dot3d(current, limited), -1, 1);
  const angle = Math.acos(cosine);
  const turn = seeker.turnRate * STEP;
  if (angle <= turn) return { x: limited.x * speed, z: limited.z * speed, alt: limited.alt * speed };
  const perpendicular = normalize3d({
    x: limited.x - current.x * cosine,
    z: limited.z - current.z * cosine,
    alt: limited.alt - current.alt * cosine,
  });
  const direction = normalize3d({
    x: current.x * Math.cos(turn) + perpendicular.x * Math.sin(turn),
    z: current.z * Math.cos(turn) + perpendicular.z * Math.sin(turn),
    alt: current.alt * Math.cos(turn) + perpendicular.alt * Math.sin(turn),
  });
  const altitudeSpeed = clamp(direction.alt, -maxVertical, maxVertical);
  const timeToAltitude = Math.abs(target.alt - shot.alt) / Math.max(Math.abs(altitudeSpeed * speed), 0.001);
  const horizontalDistance = Math.hypot(predicted.x - shot.x, predicted.z - shot.z);
  const horizontalSpeed = timeToAltitude > 0
    ? Math.min(Math.sqrt(speed * speed - (altitudeSpeed * speed) ** 2), horizontalDistance / timeToAltitude)
    : speed;
  const directionHorizontal = Math.hypot(direction.x, direction.z);
  return {
    x: directionHorizontal ? direction.x / directionHorizontal * horizontalSpeed : 0,
    z: directionHorizontal ? direction.z / directionHorizontal * horizontalSpeed : 0,
    alt: altitudeSpeed * speed,
  };
}

function projectileImpact(state: StageState, shot: RangedShot, dx: number, dz: number, dy: number, target: Target): number {
  const radius = target.kind === 'ace' ? ACE.hitRadius : CONTACT_RADIUS;
  if (state.run) return impactTime3d(shot, dx, dz, dy, target, radius);
  const window = hitWindow(state);
  if (!dy) return inBand(shot.alt, target.alt, window) ? impactTime(shot, dx, dz, target, radius) : Infinity;
  const entry = (target.alt - window - shot.alt) / dy;
  const exit = (target.alt + window - shot.alt) / dy;
  const from = Math.max(0, Math.min(entry, exit));
  const to = Math.min(1, Math.max(entry, exit));
  return from <= to ? impactTime(shot, dx, dz, target, radius, from, to) : Infinity;
}

function fireSecondaries(state: StageState, shot: Extract<RangedShot, { kind: 'flak-shell' }>): void {
  const tuning = RANGED_EVOLUTION_TUNING.skybreaker.secondary;
  const room = Math.min(projectileRoom(state, 'flak'), tuning.headings.length);
  const heading = Math.atan2(shot.vx, shot.vz);
  for (let i = 0; i < room; i++) {
    const yaw = heading + tuning.headings[i];
    state.shots.push({
      ...pose(shot), vx: Math.sin(yaw) * tuning.speed, vz: Math.cos(yaw) * tuning.speed,
      kind: 'flak-shell', weapon: 'flak', skybreaker: 'secondary', radius: tuning.radius,
      fuseAt: state.tick + tuning.travelTicks, life: tuning.travelTicks * STEP,
      fragmentCount: 0, damage: shot.damage * tuning.damageScale,
      volley: shot.volley, nearMiss: false, lockId: shot.lockId,
    });
  }
}

function explode(state: StageState, shot: Extract<RangedShot, { kind: 'seeker' | 'flak-shell' }>, ground: Ground): void {
  const isFlak = shot.kind === 'flak-shell';
  const skybreaker = isFlak && !!shot.skybreaker;
  const matches = (target: Target) => range2(state, shot, target) <= shot.radius ** 2
    && (state.run || (isFlak ? flakInBand(state, shot, target, skybreaker) : inBand(shot.alt, target.alt, hitWindow(state))))
    && (state.run || isFlak || bandDistance(contactBand(target), shot.sourceBand) <= 1)
    && visibleFraction(state, shot, target, ground) >= 1;
  for (const target of state.enemies) {
    if (!engaged(target)) continue;
    if (matches(target)) {
      const credit = !isFlak && shot.targetId === target.id ? { weapon: shot.weapon, locked: true } : { weapon: shot.weapon };
      hurtEnemy(state, target, shot.damage, credit);
    }
  }
  const ace = lockedAce(state, shot.lockId);
  if (ace && matches(ace)) hitTarget(state, ace, shot.damage, shot.weapon);
  state.weaponFx.push({
    kind: isFlak ? 'flak-blast' : 'seeker-blast',
    from: { x: shot.x, z: shot.z, alt: state.run ? shot.alt : skybreaker ? BANDS[1] : shot.alt },
    radius: shot.radius, until: state.tick + BLAST_TICKS,
    ...(skybreaker && !state.run ? { halfHeight: skybreakerHeight(state) } : {}),
  });
  if (isFlak && shot.skybreaker === 'primary') fireSecondaries(state, shot);
  if (!isFlak || !shot.fragmentCount) return;
  const room = Math.min(projectileRoom(state, 'flak'), shot.fragmentCount);
  const damage = weaponDamage(state, 'flak', flak.fragmentDamage);
  const pierce = familyBonus(state, 'flak')?.pierce ?? 0;
  for (let i = 0; i < room; i++) {
    const yaw = i * 2 * Math.PI / room;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    state.shots.push({
      x: shot.x + fx * CONTACT_RADIUS, z: shot.z + fz * CONTACT_RADIUS, alt: shot.alt,
      kind: 'flak-shard', weapon: 'flak', vx: fx * flak.fragmentSpeed, vz: fz * flak.fragmentSpeed,
      life: flak.fragmentLifeSeconds, volley: shot.volley, damage, nearMiss: false, lockId: null,
      ...(pierce ? { pierce: { remaining: 1 + pierce, hits: [] } } : {}),
    });
  }
}

function advanceShards(
  state: StageState, shot: Extract<RangedShot, { kind: 'flak-shard' }>, dx: number, dz: number, terrain: number,
): number {
  const ace = activeAce(state);
  for (;;) {
    let victim: Target | null = null, first = terrain;
    for (const enemy of state.enemies) {
      if (!engaged(enemy) || shot.pierce?.hits.includes(enemy.id)) continue;
      const time = projectileImpact(state, shot, dx, dz, 0, enemy);
      if (time < first) {
        first = time;
        victim = enemy;
      }
    }
    if (ace && aceVulnerable(ace) && !shot.pierce?.hits.includes(ace.id)) {
      const time = projectileImpact(state, shot, dx, dz, 0, ace);
      if (time < first) {
        first = time;
        victim = ace;
      }
    }
    if (!victim) return terrain;
    hitTarget(state, victim, shot.damage, 'flak', shot);
    if (!shot.pierce || --shot.pierce.remaining <= 0) return first;
    shot.pierce.hits.push(victim.id);
  }
}

export function advanceRangedShot(state: StageState, shot: RangedShot, ground: Ground): void {
  if (shot.life <= 0) return;
  let target: Target | null = null, dy = 0;
  if (shot.kind === 'seeker') {
    target = seekerContact(state, shot);
    if (state.run) {
      if (target) {
        const direction = seekerDirection(shot, target);
        shot.vx = direction.x;
        shot.vy = direction.alt;
        shot.vz = direction.z;
      }
      dy = shot.vy * STEP;
    } else {
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
  }
  const dx = shot.vx * STEP, dz = shot.vz * STEP;
  const terrain = groundImpact(shot, dx, dz, ground, dy);
  const impact = shot.kind === 'flak-shard' ? advanceShards(state, shot, dx, dz, terrain)
    : target ? Math.min(terrain, projectileImpact(state, shot, dx, dz, dy, target)) : terrain;
  const travel = Math.min(1, impact);
  shot.x += dx * travel;
  shot.z += dz * travel;
  shot.alt += dy * travel;
  if ((shot.kind === 'seeker' && impact < terrain)
    || (shot.kind === 'flak-shell' && terrain === Infinity && state.tick >= shot.fuseAt)) {
    explode(state, shot, ground);
    shot.life = 0;
  } else {
    shot.life = impact === Infinity ? shot.life - STEP : 0;
  }
}
