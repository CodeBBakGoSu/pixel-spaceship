import { WEAPONS } from './data/items.ts';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { buffTuning, hitWindow, weaponCooldown, weaponDamage } from './loadout.ts';
import { activeWeakPoint, clamp, HIT_WINDOW, hurtEnemy, hurtWeakPoint, inBand, projectileRoom, rearWeaponCredit, STEP,
  TICKS_PER_SECOND } from './stage-combat.ts';
import type { Ground, Position, StageState } from './stage-types.ts';

function crossesWake(trail: StageState['ionWake'], target: Position, width: number, window: number, plasma: boolean): boolean {
  for (let i = trail.length - 1; i >= 0; i--) {
    const tail = trail[i], head = trail[i - 1] ?? tail;
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
    trail.push({
      x: p.x - Math.sin(p.yaw) * tuning.trailOffset,
      z: p.z - Math.cos(p.yaw) * tuning.trailOffset,
      alt: p.altitude,
      until: state.tick + lifeTicks,
    });
  }
  const width = tuning.width[level - 1] * (plasma ? evolved.widthScale : 1), window = hitWindow(state);
  const damage = weaponDamage(state, 'ion', tuning.damage);
  const next = state.tick + weaponCooldown(state, 'ion', plasma ? evolved.hitCooldownTicks : tuning.hitCooldownTicks);
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.entry || state.tick < (enemy.ionReadyAt ?? 0) || !crossesWake(trail, enemy, width, window, plasma)) continue;
    hurtEnemy(state, enemy, damage, { weapon: 'ion' });
    enemy.ionReadyAt = next;
  }
  const boss = state.boss, point = boss?.weakPoints[boss.index];
  if (boss && point?.hp && state.tick >= (point.ionReadyAt ?? 0)
    && crossesWake(trail, point, width, hitWindow(state, point.window), plasma)) {
    if (!boss.entry && state.tick >= boss.exposeTick) {
      hurtWeakPoint(state, boss, damage);
      point.ionReadyAt = next;
    }
  }
  if (level >= tuning.salvageAt) {
    const pickupWindow = HIT_WINDOW + (buffTuning(state, 'magnet-core')?.extraWindow ?? 0);
    for (const pickup of state.pickups) {
      if (inBand(p.altitude, pickup.alt, pickupWindow) && crossesWake(trail, pickup, width, pickupWindow, plasma)) pickup.pulling = true;
    }
  }
}

function advanceDrones(state: StageState, level: number): void {
  const tuning = WEAPONS.drones.tuning, p = state.player;
  const collector = !!state.run?.evolutions.drones;
  const drones = state.orbitDrones, count = collector ? CLOSE_EVOLUTIONS.collector.count : tuning.count[level - 1];
  const radius = tuning.radius[level - 1];
  const window = hitWindow(state), damage = weaponDamage(state, 'drones', tuning.damage);
  const next = state.tick + weaponCooldown(state, 'drones', tuning.hitCooldownTicks);
  const point = activeWeakPoint(state);
  let shotRoom = (collector || level >= tuning.fireAt) && state.tick >= (state.weaponFireAt.drones ?? 0)
    ? projectileRoom(state, 'drones') : 0;
  let fired = false;
  for (let i = 0; i < count; i++) {
    const orbit = 2 * Math.PI * (state.tick / tuning.periodTicks + i / count), yaw = orbit + p.yaw;
    const drone = drones[i] ?? (drones[i] = { x: 0, z: 0, alt: 0, yaw: 0 });
    drone.x = p.x + Math.sin(yaw) * radius;
    drone.z = p.z + Math.cos(yaw) * radius;
    drone.alt = p.altitude + Math.sin(orbit) * tuning.tilt;
    drone.yaw = yaw + Math.PI / 2;
    let target: (Position & { id: number }) | null = null;
    let best: number = tuning.fireRange;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry || !inBand(drone.alt, enemy.alt, window)) continue;
      const range = Math.hypot(drone.x - enemy.x, drone.z - enemy.z);
      if (range <= tuning.hitRadius && state.tick >= (enemy.droneReadyAt ?? 0)) {
        hurtEnemy(state, enemy, damage, { weapon: 'drones' });
        enemy.droneReadyAt = next;
      }
      if (shotRoom && enemy.hp && range < best) {
        best = range;
        target = enemy;
      }
    }
    const boss = state.boss, exposed = point?.exposed && boss?.weakPoints[boss.index];
    if (boss && exposed && exposed.hp && inBand(drone.alt, exposed.alt, hitWindow(state, exposed.window))) {
      const range = Math.hypot(drone.x - exposed.x, drone.z - exposed.z);
      if (range <= tuning.hitRadius && state.tick >= (exposed.droneReadyAt ?? 0)) {
        hurtWeakPoint(state, boss, damage);
        exposed.droneReadyAt = next;
      }
      if (shotRoom && exposed.hp && range < best) target = exposed;
    }
    if (target && shotRoom) {
      const bearing = Math.atan2(target.x - drone.x, target.z - drone.z);
      state.shots.push({
        x: drone.x, z: drone.z, alt: drone.alt, kind: 'drone-bolt', weapon: 'drones',
        vx: Math.sin(bearing) * tuning.fireSpeed, vz: Math.cos(bearing) * tuning.fireSpeed, life: tuning.fireRange / tuning.fireSpeed,
        damage: weaponDamage(state, 'drones', tuning.fireDamage), volley: ++state.nextVolley,
        nearMiss: false, lockId: target.id === point?.id ? target.id : null,
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
  const window = HIT_WINDOW + (buffTuning(state, 'magnet-core')?.extraWindow ?? 0);
  for (const pickup of state.pickups) {
    if (pickup.collected || state.tick - pickup.born >= 60 * TICKS_PER_SECOND) continue;
    let closest: Position | null = null;
    let distance: number = tuning.magnetRange;
    for (const drone of state.orbitDrones) {
      if (!inBand(drone.alt, pickup.alt, window)) continue;
      const range = Math.hypot(drone.x - pickup.x, drone.z - pickup.z);
      if (range < distance) {
        closest = drone;
        distance = range;
      }
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
}

function advanceAegis(state: StageState): void {
  const tuning = CLOSE_EVOLUTIONS.aegis, p = state.player;
  const damage = weaponDamage(state, 'pods', tuning.damage);
  const next = state.tick + weaponCooldown(state, 'pods', tuning.hitCooldownTicks);
  const colliding = (target: Position, window: number): boolean =>
    inBand(p.altitude, target.alt, window)
    && Math.abs(Math.hypot(target.x - p.x, target.z - p.z) - tuning.radius) <= tuning.halfWidth;
  const window = hitWindow(state);
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.entry || state.tick < (enemy.aegisReadyAt ?? 0) || !colliding(enemy, window)) continue;
    hurtEnemy(state, enemy, damage, rearWeaponCredit(state, enemy, 'pods'));
    enemy.aegisReadyAt = next;
  }
  const boss = state.boss;
  if (!boss || boss.entry || state.tick < boss.exposeTick) return;
  const point = boss.weakPoints[boss.index];
  if (!point?.hp || state.tick < (point.aegisReadyAt ?? 0) || !colliding(point, hitWindow(state, point.window))) return;
  hurtWeakPoint(state, boss, damage);
  point.aegisReadyAt = next;
}

export function advanceSupportWeapons(state: StageState, ground?: Ground): void {
  const wake = state.run?.weaponLevels.ion, drones = state.run?.weaponLevels.drones;
  if (wake) advanceWake(state, wake);
  else state.ionWake.length = 0;
  if (drones) {
    advanceDrones(state, drones);
    if (state.run?.evolutions.drones) collectWithDrones(state, ground);
  } else state.orbitDrones.length = 0;
  if (state.run?.evolutions.pods) advanceAegis(state);
}
