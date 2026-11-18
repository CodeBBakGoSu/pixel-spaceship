import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { nearestBand } from './maneuvers.ts';
import { BANDS, fireHostile, STEP } from './stage-combat.ts';
import { random } from './stage-random.ts';
import type { Band, Enemy, Ground, StageState } from './stage-types.ts';

export const SKIMMER_WATER = 39;
const COAST_TURNS = [0, 0.65, -0.65, 1.3, -1.3, 2.05, -2.05, Math.PI];

export function makeEnemy(state: StageState, x: number, z: number, band: Band, kind: EnemyKind = 'patrol', offset = 0): Enemy {
  const spec = ENEMY_KINDS[kind];
  return {
    id: ++state.nextId, kind, x, z, alt: BANDS[band] + offset, hp: spec.hp,
    yaw: Math.PI, vx: 0, vz: 0, bank: 0, band, offset, shotAt: state.tick + spec.firstShot,
    maneuverAt: state.tick + 102, maneuver: null, hitUntil: 0, shotDown: false,
  };
}

function moveInterceptor(state: StageState, e: Enemy): void {
  if (!e.maneuver && state.tick >= e.maneuverAt) {
    const bias = nearestBand(state.player.altitude);
    const neighboring = (e.band === bias ? (e.band > 0 ? e.band - 1 : 1) : e.band + Math.sign(bias - e.band)) as Band;
    e.maneuver = { phase: 'warning', band: neighboring, diveAt: state.tick + 75 };
  }
  const move = e.maneuver;
  if (!move || state.tick < move.diveAt) return;
  move.phase = 'diving';
  const target = BANDS[move.band] + e.offset;
  const maxMove = 29 * STEP;
  const error = target - e.alt;
  if (Math.abs(error) > maxMove) {
    e.alt += Math.sign(error) * maxMove;
    return;
  }
  e.alt = target;
  e.band = move.band;
  e.maneuver = null;
  e.maneuverAt = state.tick + 540;
  e.shotAt = Math.max(e.shotAt, state.tick + 24);
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
    if (ground(enemy.x + fx * 18, enemy.z + fz * 18) > SKIMMER_WATER
      || ground(enemy.x + fx * 24 * STEP, enemy.z + fz * 24 * STEP) > SKIMMER_WATER) continue;
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

export function advanceEnemies(state: StageState, ground: Ground): void {
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  for (const enemy of state.enemies) {
    if (enemy.kind === 'interceptor') moveInterceptor(state, enemy);
    const dx = p.x - enemy.x, dz = p.z - enemy.z, range = Math.hypot(dx, dz);
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
      moveSkimmer(state, enemy, ground, Math.atan2(dx, dz), range);
    } else if (enemy.kind === 'spotter') {
      moveSpotter(state, enemy, Math.atan2(dx, dz), range);
    } else if (enemy.kind === 'hound') {
      moveHound(state, enemy, fx, fz, dx, dz);
    } else if (range > 0.001) {
      const trailing = range > 50 && dx * fx + dz * fz > 0;
      const weave = Math.sin(state.tick / 91 + enemy.id * 1.79) * (trailing ? 0.112 : 0.32);
      const interceptor = enemy.kind === 'interceptor';
      const speed = interceptor ? (trailing ? 30 : 23) : (trailing ? 23 : 16);
      setVelocity(enemy, Math.atan2(dx, dz) + (range < (interceptor ? 32 : 14) ? 1.45 : weave),
        speed * (trailing ? pursuitBoost(state, enemy) : 1), -weave);
    }
    enemy.x += enemy.vx * STEP;
    enemy.z += enemy.vz * STEP;
    if ((enemy.kind === 'patrol' || enemy.kind === 'interceptor') && range < 155
      && state.tick >= enemy.shotAt && enemy.maneuver?.phase !== 'diving') {
      fireHostile(state, enemy, enemy.kind === 'interceptor' ? 60 : 46);
      enemy.shotAt = state.tick + 255 + Math.floor(random(state) * 105);
    }
  }
}
