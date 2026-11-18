import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { nearestBand } from './maneuvers.ts';
import { keepInsideArena } from './reach.ts';
import { BANDS, fireHostile, FLAK_LIFE, inBand, MINE_LIMIT, STEP } from './stage-combat.ts';
import { random } from './stage-random.ts';
import type { Band, Enemy, Ground, Maneuver, Point, StageState } from './stage-types.ts';

export const SKIMMER_WATER = 39;
const COAST_TURNS = [0, 0.65, -0.65, 1.3, -1.3, 2.05, -2.05, Math.PI];
const ESCORT_SPAN = 19, ESCORT_AFT = 13;

export function makeEnemy(state: StageState, x: number, z: number, band: Band, kind: EnemyKind = 'patrol', offset = 0): Enemy {
  const spec = ENEMY_KINDS[kind];
  return {
    id: ++state.nextId, kind, x, z, alt: BANDS[band] + offset, hp: spec.hp,
    yaw: Math.PI, vx: 0, vz: 0, bank: 0, band, offset, shotAt: state.tick + spec.firstShot,
    maneuverAt: state.tick + (kind === 'harrier' ? 0 : 102), maneuver: null, hitUntil: 0, shotDown: false,
  };
}

export function bomberWingPosition(state: StageState, bomber: Enemy, ground: Ground, side: number): Point {
  const fx = Math.sin(bomber.yaw), fz = Math.cos(bomber.yaw);
  const point = {
    x: bomber.x + fz * ESCORT_SPAN * side - fx * ESCORT_AFT,
    z: bomber.z - fx * ESCORT_SPAN * side - fz * ESCORT_AFT,
  };
  keepInsideArena(point, state.arena);
  if (ground(point.x, point.z) + 22 <= bomber.alt) return point;
  return bomber;
}

export function addBomberEscort(state: StageState, bomber: Enemy, ground: Ground): void {
  for (const side of [-1, 1]) {
    const { x, z } = bomberWingPosition(state, bomber, ground, side);
    const escort = makeEnemy(state, x, z, 1, 'patrol', bomber.offset);
    escort.yaw = bomber.yaw;
    escort.formation = { leader: bomber.id, side };
    state.enemies.push(escort);
  }
}

export function warnHarrier(state: StageState, enemy: Enemy, maneuver: Maneuver, aft: number, lateral: number): void {
  if (enemy.kind !== 'harrier' || enemy.maneuver || state.tick < enemy.maneuverAt || aft <= 0 || aft > 115
    || Math.abs(lateral) > aft * 0.75 || (maneuver.kind !== 'immelmann' && maneuver.kind !== 'split-s')) return;
  const exitBand = nearestBand(maneuver.exitAltitude);
  if (exitBand !== enemy.band) {
    enemy.maneuver = { phase: 'warning', band: (enemy.band + Math.sign(exitBand - enemy.band)) as Band, diveAt: state.tick + 75 };
  }
}

function moveBetweenBands(state: StageState, e: Enemy, ground: Ground, speed: number): boolean {
  const move = e.maneuver;
  if (!move || state.tick < move.diveAt) return false;
  move.phase = 'diving';
  const target = BANDS[move.band] + e.offset;
  const error = Math.max(target, ground(e.x, e.z) + 22) - e.alt;
  e.alt += Math.sign(error) * Math.min(Math.abs(error), speed * STEP);
  if (Math.abs(e.alt - target) > 1e-6) return false;
  e.alt = target;
  e.band = move.band;
  e.maneuver = null;
  e.shotAt = Math.max(e.shotAt, state.tick + 24);
  return true;
}

function moveInterceptor(state: StageState, e: Enemy, ground: Ground): void {
  if (!e.maneuver && state.tick >= e.maneuverAt) {
    const bias = nearestBand(state.player.altitude);
    const neighboring = (e.band === bias ? (e.band > 0 ? e.band - 1 : 1) : e.band + Math.sign(bias - e.band)) as Band;
    e.maneuver = { phase: 'warning', band: neighboring, diveAt: state.tick + 75 };
  }
  if (moveBetweenBands(state, e, ground, 29)) e.maneuverAt = state.tick + 540;
}

function setVelocity(enemy: Enemy, yaw: number, speed: number, bank = 0): void {
  enemy.yaw = yaw;
  enemy.vx = Math.sin(yaw) * speed;
  enemy.vz = Math.cos(yaw) * speed;
  enemy.bank = bank;
}

function pursuitBoost(state: StageState, enemy: Enemy): number {
  for (const spotter of state.enemies) {
    if (spotter.kind === 'spotter' && spotter.hp && Math.hypot(spotter.x - enemy.x, spotter.z - enemy.z) <= 125) return 1.2;
  }
  return 1;
}

function moveSkimmer(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number): void {
  const direction = enemy.id % 2 ? 1 : -1;
  const desired = angle + direction * (range < 60 ? 1.25 : 0.34);
  for (const turn of COAST_TURNS) {
    const yaw = desired + turn, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const x = enemy.x + fx * 24 * STEP, z = enemy.z + fz * 24 * STEP;
    if (Math.hypot(x - state.arena.x, z - state.arena.z) > state.arena.radius) continue;
    if (ground(enemy.x + fx * 18, enemy.z + fz * 18) > SKIMMER_WATER
      || ground(x, z) > SKIMMER_WATER) continue;
    setVelocity(enemy, yaw, 24, -0.22 * direction);
    break;
  }
  if (state.tick >= enemy.shotAt && range <= 145) {
    fireHostile(state, enemy, 68, -0.14);
    fireHostile(state, enemy, 68, 0.14);
    enemy.shotAt = state.tick + 240;
  }
}

function moveSpotter(state: StageState, enemy: Enemy, angle: number, range: number): void {
  const bias = range < 88 ? 2.05 : range > 138 ? 0.55 : 1.35;
  setVelocity(enemy, angle + bias * (enemy.id % 2 ? 1 : -1), 12, -0.1);
  if (enemy.tell) {
    if (state.tick < enemy.tell.until) return;
    fireHostile(state, enemy, 82);
    delete enemy.tell;
    enemy.shotAt = state.tick + 150;
  } else if (state.tick >= enemy.shotAt && range <= 165) {
    enemy.tell = { kind: 'snipe', until: state.tick + 90 };
  }
}

function moveHound(state: StageState, enemy: Enemy, fx: number, fz: number, dx: number, dz: number): void {
  const aft = dx * fx + dz * fz;
  const side = enemy.id % 2 ? 6 : -6;
  const vx = fx * state.speed + (dx - fx * 29 + fz * side) * 1.1;
  const vz = fz * state.speed + (dz - fz * 29 - fx * side) * 1.1;
  setVelocity(enemy, Math.atan2(vx, vz), Math.min(40, Math.hypot(vx, vz)) * pursuitBoost(state, enemy));
  if (state.tick >= enemy.shotAt && aft >= 18 && aft <= 55 && Math.abs(dx * fz - dz * fx) < 23) {
    fireHostile(state, enemy, 58);
    enemy.shotAt = state.tick + 180;
  }
}

function moveFlanker(state: StageState, enemy: Enemy, fx: number, fz: number, dx: number, dz: number): void {
  const side = enemy.id % 2 ? 1 : -1;
  const vx = fx * state.speed + (dx + fz * 40 * side) * 1.25;
  const vz = fz * state.speed + (dz - fx * 40 * side) * 1.25;
  setVelocity(enemy, Math.atan2(vx, vz), Math.min(40, Math.hypot(vx, vz)));
  if (state.tick >= enemy.shotAt && Math.hypot(dx, dz) < 84) {
    fireHostile(state, enemy, 55);
    enemy.shotAt = state.tick + 240;
  }
}

function moveDiver(state: StageState, enemy: Enemy, ground: Ground, angle: number, range: number): void {
  setVelocity(enemy, angle + (range < 60 ? 1.45 : 0.24) * (enemy.id % 2 ? 1 : -1), 22, -0.18);
  if (!enemy.maneuver && state.tick >= enemy.maneuverAt && (enemy.band === 0 || range <= 155)) {
    enemy.maneuver = { phase: 'warning', band: enemy.band === 0 ? 2 : 0, diveAt: state.tick + (enemy.band === 0 ? 0 : 72) };
    enemy.fanFired = false;
  }
  const plunge = enemy.maneuver?.band === 0 && state.tick >= enemy.maneuver.diveAt;
  const oldAltitude = enemy.alt;
  const arrived = moveBetweenBands(state, enemy, ground, plunge ? 55 : 30);
  const altitude = state.player.altitude;
  if (plunge && enemy.alt < oldAltitude && !enemy.fanFired && range <= 155 && inBand(enemy.alt, altitude, 4)) {
    for (const spread of [-0.26, 0, 0.26]) fireHostile(state, enemy, 61, spread);
    enemy.fanFired = true;
  }
  if (arrived) enemy.maneuverAt = state.tick + (enemy.band === 0 ? 105 : 390);
}

function moveBomber(state: StageState, enemy: Enemy, angle: number, range: number): void {
  setVelocity(enemy, angle + (range < 80 ? 1.7 : 0.65) * (enemy.id % 2 ? 1 : -1), 11, -0.08);
  if (state.tick < enemy.shotAt || range > 135 || state.enemyMines.length >= MINE_LIMIT) return;
  state.enemyMines.push({ x: enemy.x - Math.sin(enemy.yaw) * 12, z: enemy.z - Math.cos(enemy.yaw) * 12,
    alt: enemy.alt, born: state.tick });
  enemy.shotAt = state.tick + 250;
}

function moveTurret(state: StageState, enemy: Enemy, angle: number, range: number): void {
  enemy.yaw = angle;
  if (enemy.tell?.kind === 'flak') {
    const { x, z, alt, until } = enemy.tell;
    if (state.tick < until) return;
    state.effects.push({ x, z, alt, kind: 'flak', life: FLAK_LIFE });
    delete enemy.tell;
    enemy.shotAt = state.tick + 270;
  } else if (state.tick >= enemy.shotAt && range <= 140) {
    const p = state.player;
    const target = { x: p.x + Math.sin(p.yaw) * 34, z: p.z + Math.cos(p.yaw) * 34 };
    keepInsideArena(target, state.arena);
    enemy.tell = { ...target, alt: BANDS[enemy.band], kind: 'flak', until: state.tick + 84 };
  }
}

function stayWithBomber(state: StageState, enemy: Enemy): boolean {
  const formation = enemy.formation;
  if (!formation) return false;
  let leader: Enemy | undefined;
  for (const candidate of state.enemies) {
    if (candidate.id === formation.leader && candidate.hp) {
      leader = candidate;
      break;
    }
  }
  if (!leader) {
    delete enemy.formation;
    return false;
  }
  const fx = Math.sin(leader.yaw), fz = Math.cos(leader.yaw);
  const vx = leader.vx + (leader.x + fz * formation.side * ESCORT_SPAN - fx * ESCORT_AFT - enemy.x) * 1.15;
  const vz = leader.vz + (leader.z - fx * formation.side * ESCORT_SPAN - fz * ESCORT_AFT - enemy.z) * 1.15;
  setVelocity(enemy, Math.atan2(vx, vz), Math.min(28, Math.hypot(vx, vz)));
  return true;
}

function advancePosition(state: StageState, enemy: Enemy, ground: Ground): void {
  let x = enemy.x + enemy.vx * STEP, z = enemy.z + enemy.vz * STEP;
  if (enemy.kind !== 'skimmer' && ground(x, z) + 22 > enemy.alt + 0.01) {
    const speed = Math.hypot(enemy.vx, enemy.vz), desired = enemy.yaw;
    for (let index = 1; index < COAST_TURNS.length; index++) {
      const yaw = desired + COAST_TURNS[index];
      x = enemy.x + Math.sin(yaw) * speed * STEP;
      z = enemy.z + Math.cos(yaw) * speed * STEP;
      if (ground(x, z) + 22 > enemy.alt + 0.01) continue;
      setVelocity(enemy, yaw, speed);
      enemy.x = x;
      enemy.z = z;
      keepInsideArena(enemy, state.arena);
      return;
    }
    setVelocity(enemy, desired, 0);
    return;
  }
  enemy.x = x;
  enemy.z = z;
  keepInsideArena(enemy, state.arena);
}

export function advanceEnemies(state: StageState, ground: Ground): void {
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  for (const enemy of state.enemies) {
    if (!enemy.hp) continue;
    const dx = p.x - enemy.x, dz = p.z - enemy.z, range = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    if (enemy.kind === 'turret') {
      moveTurret(state, enemy, angle, range);
      continue;
    }
    if (enemy.kind === 'interceptor') moveInterceptor(state, enemy, ground);
    if (enemy.kind === 'harrier' && moveBetweenBands(state, enemy, ground, 29)) enemy.maneuverAt = state.tick + 360;
    if (enemy.course && state.tick >= enemy.course.until) delete enemy.course;
    const course = enemy.course;
    if (course) {
      const tx = course.target.x - enemy.x, tz = course.target.z - enemy.z;
      const remaining = Math.hypot(tx, tz);
      setVelocity(enemy, remaining > 0.001 ? Math.atan2(tx, tz) : enemy.yaw, Math.min(course.speed, remaining / STEP));
      if (remaining <= course.speed * STEP && course.pass) {
        course.target = course.pass;
        delete course.pass;
      }
    } else if (enemy.kind === 'skimmer') {
      setVelocity(enemy, enemy.yaw, 0);
      moveSkimmer(state, enemy, ground, angle, range);
    } else if (enemy.kind === 'spotter') {
      moveSpotter(state, enemy, angle, range);
    } else if (enemy.kind === 'hound') {
      moveHound(state, enemy, fx, fz, dx, dz);
    } else if (enemy.kind === 'flanker') {
      moveFlanker(state, enemy, fx, fz, dx, dz);
    } else if (enemy.kind === 'diver') {
      moveDiver(state, enemy, ground, angle, range);
    } else if (enemy.kind === 'bomber') {
      moveBomber(state, enemy, angle, range);
    } else if (range > 0.001 && !stayWithBomber(state, enemy)) {
      const trailing = range > 50 && dx * fx + dz * fz > 0;
      const weave = Math.sin(state.tick / 91 + enemy.id * 1.79) * (trailing ? 0.112 : 0.32);
      const interceptor = enemy.kind !== 'patrol';
      const speed = interceptor ? (trailing ? 30 : 23) : (trailing ? 23 : 16);
      setVelocity(enemy, angle + (range < (interceptor ? 32 : 14) ? 1.45 : weave),
        speed * (trailing ? pursuitBoost(state, enemy) : 1), -weave);
    }
    advancePosition(state, enemy, ground);
    if ((enemy.kind === 'patrol' || enemy.kind === 'interceptor' || enemy.kind === 'harrier') && range < 155
      && state.tick >= enemy.shotAt && enemy.maneuver?.phase !== 'diving') {
      fireHostile(state, enemy, enemy.kind === 'interceptor' ? 60 : 46);
      enemy.shotAt = state.tick + 255 + Math.floor(random(state) * 105);
    }
  }
}
