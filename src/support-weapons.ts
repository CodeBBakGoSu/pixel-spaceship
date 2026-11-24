import { WEAPONS } from './data/items.ts';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { buffTuning, hitWindow, weaponCooldown, weaponDamage } from './loadout.ts';
import { activeAce, aceVulnerable, clamp, HIT_WINDOW, hurtAce, hurtEnemy, inBand, projectileRoom, rearWeaponCredit, STEP,
  TICKS_PER_SECOND } from './stage-combat.ts';
import type { Ace, Enemy, Ground, Position, StageState } from './stage-types.ts';
import { distanceSquared3d, pointSegmentDistanceSquared3d } from './spatial.ts';

type WakePoint = StageState['ionWake'][number];
type WakeSegment = { tail: WakePoint; head: WakePoint };

function wakeSegments(trail: StageState['ionWake']): WakeSegment[][] {
  const previous: (WakePoint | undefined)[] = [];
  const segments: WakeSegment[][] = [[], [], []];
  for (const tail of trail) {
    const lane = tail.lane ?? 0;
    segments[lane].push({ head: previous[lane] ?? tail, tail });
    previous[lane] = tail;
  }
  return segments;
}

function crossesWake(trail: WakeSegment[], target: Position, width: number, window: number, plasma: boolean, continuous: boolean): boolean {
  for (let i = trail.length - 1; i >= 0; i--) {
    const { tail, head } = trail[i];
    if (continuous) {
      if (pointSegmentDistanceSquared3d(target, tail, head) <= width * width) return true;
      continue;
    }
    if (target.alt < Math.min(tail.alt, head.alt) - window || target.alt > Math.max(tail.alt, head.alt) + window) continue;
    const dx = head.x - tail.x, dz = head.z - tail.z;
    const lengthSquared = dx * dx + dz * dz;
    const along = lengthSquared ? clamp(((target.x - tail.x) * dx + (target.z - tail.z) * dz) / lengthSquared, 0, 1) : 0;
    if (plasma && !inBand(target.alt, tail.alt + (head.alt - tail.alt) * along, window)) continue;
    if ((target.x - tail.x - dx * along) ** 2 + (target.z - tail.z - dz * along) ** 2 <= width * width) return true;
  }
  return false;
}

function advanceWake(state: StageState, level: number): void {
  const tuning = WEAPONS.ion.tuning, trail = state.ionWake, p = state.player;
  const plasma = !!state.run?.evolutions.ion;
  const evolved = CLOSE_EVOLUTIONS.plasma;
  const sampleTicks = plasma ? evolved.sampleTicks : tuning.sampleTicks;
  const lifeTicks = plasma ? evolved.lifeTicks : tuning.lifeTicks[level - 1];
  while (trail.length && state.tick >= trail[0].until) trail.shift();
  if (!trail.length || state.tick % sampleTicks === 0) {
    const lanes = plasma ? [0] : tuning.count[level - 1] === 1 ? [0] : tuning.count[level - 1] === 2 ? [1, 2] : [0, 1, 2];
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    for (const lane of lanes) {
      const side = (lane === 1 ? -1 : lane === 2 ? 1 : 0) * tuning.laneOffset;
      trail.push({
        x: p.x - sin * tuning.trailOffset + cos * side,
        z: p.z - cos * tuning.trailOffset - sin * side,
        alt: p.altitude, until: state.tick + lifeTicks, ...(lane ? { lane } : {}),
      });
    }
  }
  const segments = wakeSegments(trail);
  const width = tuning.width[level - 1] * (plasma ? evolved.widthScale : 1), window = hitWindow(state);
  const damage = weaponDamage(state, 'ion', tuning.damage);
  const next = state.tick + weaponCooldown(state, 'ion', plasma ? evolved.hitCooldownTicks : tuning.hitCooldownTicks);
  const hitLanes = (target: Enemy | Ace) => {
    for (let lane = 0; lane < segments.length && target.hp > 0; lane++) {
      if (state.tick < (target.ionReadyAt?.[lane] ?? 0)
        || !crossesWake(segments[lane], target, width, window, plasma, !!state.run)) continue;
      if (target.kind === 'ace') hurtAce(state, target, damage);
      else hurtEnemy(state, target, damage, { weapon: 'ion' });
      (target.ionReadyAt ??= [0, 0, 0])[lane] = next;
    }
  };
  for (const enemy of state.enemies) {
    if (enemy.hp && !enemy.entry) hitLanes(enemy);
  }
  const ace = activeAce(state);
  if (ace && aceVulnerable(ace)) hitLanes(ace);
  if (level >= tuning.salvageAt) {
    const pickupWindow = HIT_WINDOW + (state.run ? 0 : buffTuning(state, 'magnet-core')?.extraWindow ?? 0);
    for (const pickup of state.pickups) {
      if (pickup.kind !== 'magnet' && inBand(p.altitude, pickup.alt, pickupWindow)
        && segments.some(lane => crossesWake(lane, pickup, width, pickupWindow, plasma, !!state.run))) pickup.pulling = true;
    }
  }
}

function advanceDrones(state: StageState, level: number): void {
  const tuning = WEAPONS.drones.tuning, p = state.player;
  const collector = !!state.run?.evolutions.drones;
  const drones = state.orbitDrones, count = Math.max(collector ? CLOSE_EVOLUTIONS.collector.count : 0, tuning.count[level - 1]);
  const radius = tuning.radius[level - 1];
  const double = level >= tuning.doubleOrbitAt;
  const window = hitWindow(state), damage = weaponDamage(state, 'drones', tuning.damage);
  const next = state.tick + weaponCooldown(state, 'drones', tuning.hitCooldownTicks);
  const ace = activeAce(state);
  let shotRoom = (collector || level >= tuning.fireAt) && state.tick >= (state.weaponFireAt.drones ?? 0)
    ? projectileRoom(state, 'drones') : 0;
  let fired = false;
  for (let i = 0; i < count; i++) {
    const inner = double && i % 2 === 1;
    const orbit = 2 * Math.PI * ((inner ? -1 : 1) * state.tick / tuning.periodTicks + i / count);
    const yaw = orbit + p.yaw, laneRadius = inner ? radius * tuning.innerScale : radius;
    const drone = drones[i] ?? (drones[i] = { x: 0, z: 0, alt: 0, yaw: 0 });
    drone.x = p.x + Math.sin(yaw) * laneRadius;
    drone.z = p.z + Math.cos(yaw) * laneRadius;
    drone.alt = p.altitude + Math.sin(orbit) * tuning.tilt;
    drone.yaw = yaw + (inner ? -1 : 1) * Math.PI / 2;
    let target: (Position & { id: number }) | null = null;
    let best: number = tuning.fireRange;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || (!state.run && !inBand(drone.alt, enemy.alt, window))) continue;
      const range = state.run ? Math.sqrt(distanceSquared3d(drone, enemy)) : Math.hypot(drone.x - enemy.x, drone.z - enemy.z);
      if (range <= tuning.hitRadius && state.tick >= (enemy.droneReadyAt ?? 0)) {
        hurtEnemy(state, enemy, damage, { weapon: 'drones' });
        enemy.droneReadyAt = next;
      }
      if (shotRoom && enemy.hp && range < best) {
        best = range;
        target = enemy;
      }
    }
    if (ace && aceVulnerable(ace) && (state.run || inBand(drone.alt, ace.alt, window))) {
      const range = state.run ? Math.sqrt(distanceSquared3d(drone, ace)) : Math.hypot(drone.x - ace.x, drone.z - ace.z);
      if (range <= tuning.hitRadius && state.tick >= (ace.droneReadyAt ?? 0)) {
        hurtAce(state, ace, damage);
        ace.droneReadyAt = next;
      }
      if (shotRoom && ace.hp && range < best) target = ace;
    }
    if (target && shotRoom) {
      const bearing = Math.atan2(target.x - drone.x, target.z - drone.z);
      const dx = target.x - drone.x, dz = target.z - drone.z, dy = target.alt - drone.alt;
      const distance = Math.hypot(dx, dy, dz);
      const horizontalSpeed = state.run && distance > 0 ? tuning.fireSpeed / distance : tuning.fireSpeed;
      state.shots.push({
        x: drone.x, z: drone.z, alt: drone.alt, kind: 'drone-bolt', weapon: 'drones',
        vx: state.run ? dx * horizontalSpeed : Math.sin(bearing) * tuning.fireSpeed,
        vz: state.run ? dz * horizontalSpeed : Math.cos(bearing) * tuning.fireSpeed,
        ...(state.run && distance > 0 && dy ? { vy: dy * horizontalSpeed } : {}),
        life: tuning.fireRange / tuning.fireSpeed,
        damage: weaponDamage(state, 'drones', tuning.fireDamage), volley: ++state.nextVolley,
        nearMiss: false, lockId: target.id === ace?.id ? target.id : null,
      });
      shotRoom--;
      fired = true;
    }
  }
  drones.length = count;
  if (fired) state.weaponFireAt.drones = state.tick + weaponCooldown(state, 'drones', tuning.fireCooldownTicks);
}

function collectWithDrones(state: StageState, ground?: Ground): void {
  const tuning = CLOSE_EVOLUTIONS.collector;
  if (!state.run) {
    const window = HIT_WINDOW + (buffTuning(state, 'magnet-core')?.extraWindow ?? 0);
    for (const pickup of state.pickups) {
      if (pickup.collected || state.tick - pickup.born >= 60 * TICKS_PER_SECOND) continue;
      let closest: Position | null = null;
      let distance: number = tuning.magnetRange;
      for (const drone of state.orbitDrones) {
        if (!inBand(drone.alt, pickup.alt, window)) continue;
        const range = Math.hypot(drone.x - pickup.x, drone.z - pickup.z);
        if (range < distance) { closest = drone; distance = range; }
      }
      if (!closest) continue;
      const travel = Math.min(tuning.pullSpeed * STEP, distance);
      const amount = distance ? travel / distance : 0;
      const x = pickup.x + (closest.x - pickup.x) * amount;
      const z = pickup.z + (closest.z - pickup.z) * amount;
      if (ground && (Math.max(ground(x, z), ground((x + pickup.x) / 2, (z + pickup.z) / 2)) >= pickup.alt)) continue;
      pickup.x = x;
      pickup.z = z;
      if (distance - travel <= tuning.pickupRange) pickup.collected = true;
    }
    return;
  }
  for (const pickup of state.pickups) {
    if (pickup.kind === 'magnet' || pickup.capture || state.tick - pickup.born >= 60 * TICKS_PER_SECOND) continue;
    let closest: Position | null = null;
    let distance: number = tuning.magnetRange;
    for (const drone of state.orbitDrones) {
      const range = Math.hypot(drone.x - pickup.x, drone.z - pickup.z);
      if (range < distance) {
        closest = drone;
        distance = range;
      }
    }
    if (!closest) continue;
    const contactTicks = Math.max(1, Math.ceil(Math.max(0, distance - tuning.pickupRange) / (tuning.pullSpeed * STEP)));
    pickup.captureRequestTicks ??= contactTicks;
    pickup.pulling = true;
  }
}

function advanceAegis(state: StageState): void {
  const tuning = CLOSE_EVOLUTIONS.aegis, p = state.player;
  const damage = weaponDamage(state, 'pods', tuning.damage);
  const next = state.tick + weaponCooldown(state, 'pods', tuning.hitCooldownTicks);
  const colliding = (target: Position, window: number): boolean => state.run
    ? Math.abs(Math.hypot(target.x - p.x, target.z - p.z) - tuning.radius) <= tuning.halfWidth
      && Math.abs(target.alt - p.altitude) <= tuning.halfWidth
    : inBand(p.altitude, target.alt, window)
      && Math.abs(Math.hypot(target.x - p.x, target.z - p.z) - tuning.radius) <= tuning.halfWidth;
  const window = hitWindow(state);
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.entry || state.tick < (enemy.aegisReadyAt ?? 0) || !colliding(enemy, window)) continue;
    hurtEnemy(state, enemy, damage, rearWeaponCredit(state, enemy, 'pods'));
    enemy.aegisReadyAt = next;
  }
  const ace = activeAce(state);
  if (!ace || !aceVulnerable(ace) || state.tick < (ace.aegisReadyAt ?? 0) || !colliding(ace, window)) return;
  hurtAce(state, ace, damage);
  ace.aegisReadyAt = next;
}

export function advanceSupportWeapons(state: StageState, _ground?: Ground): void {
  const wake = state.run?.weaponLevels.ion, drones = state.run?.weaponLevels.drones;
  if (wake) advanceWake(state, wake);
  else state.ionWake.length = 0;
  if (drones) {
    advanceDrones(state, drones);
    if (state.run?.evolutions.drones) collectWithDrones(state, _ground);
  } else state.orbitDrones.length = 0;
  if (state.run?.evolutions.pods) advanceAegis(state);
}
