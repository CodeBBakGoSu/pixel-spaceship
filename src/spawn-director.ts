import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { BASALT_STACKS, LANDMARKS } from './reach.ts';
import { angleTo, BANDS, TICKS_PER_SECOND } from './stage-combat.ts';
import { addBomberEscort, bomberWingPosition, makeEnemy, SKIMMER_WATER } from './stage-enemies.ts';
import { random } from './stage-random.ts';
import type { Band, Enemy, Ground, Point, StageState } from './stage-types.ts';

type Spawn = { kind: EnemyKind; band: Band | 'flank'; bearing: number; range: number };
type Wave = { time: number; members: Spawn[] };
const contact = (kind: EnemyKind, band: Spawn['band'], degrees: number, range = 141): Spawn =>
  ({ kind, band, bearing: degrees * Math.PI / 180, range });

const patrol = (band: Band, degrees: number, range?: number) => contact('patrol', band, degrees, range);
const turret = contact('turret', 1, 0);
const hound = contact('hound', 1, 180, 92);
const harrier = contact('harrier', 1, -157, 104);
const bomber = contact('bomber', 1, 5, 167);
const skimmer = (degrees: number) => contact('skimmer', 0, degrees, 136);
const spotter = (degrees: number) => contact('spotter', 2, degrees, 170);
const diver = (degrees: number) => contact('diver', 2, degrees, 162);
const flanker = (degrees: number) => contact('flanker', 'flank', degrees, 148);
const interceptor = (degrees: number) => contact('interceptor', 2, degrees, 147);

export const WAVES: readonly Wave[] = [
  { time: 2, members: [patrol(1, 0, 116), patrol(1, -20, 136)] },
  { time: 3, members: [patrol(2, 155, 63)] },
  { time: 9, members: [patrol(1, 10, 117)] },
  { time: 12, members: [skimmer(-18)] },
  { time: 20, members: [turret] },
  { time: 22, members: [patrol(0, 4, 131), patrol(2, 7, 133)] },
  { time: 26, members: [spotter(14)] },
  { time: 34, members: [skimmer(-12), spotter(-8), patrol(1, 32)] },
  { time: 40, members: [interceptor(25), hound, patrol(0, -30)] },
  { time: 48, members: [patrol(1, -12), skimmer(16), turret] },
  { time: 55, members: [diver(-5)] },
  { time: 56, members: [flanker(48), patrol(1, -22)] },
  { time: 64, members: [interceptor(-12), patrol(1, 32), turret] },
  { time: 70, members: [bomber] },
  { time: 72, members: [harrier, skimmer(20), patrol(1, -20)] },
  { time: 80, members: [spotter(8), flanker(-44), patrol(0, 25)] },
  { time: 88, members: [diver(19), hound, turret] },
  { time: 90, members: [bomber] },
  { time: 96, members: [interceptor(16), skimmer(-22), patrol(1, 38)] },
  { time: 100, members: [patrol(2, 12), harrier] },
  { time: 112, members: [patrol(1, 20), hound] },
  { time: 124, members: [skimmer(-16), flanker(52)] },
  { time: 136, members: [patrol(2, -25), harrier] },
  { time: 148, members: [patrol(1, 20), turret] },
  { time: 160, members: [skimmer(30), hound] },
  { time: 172, members: [patrol(0, 22), flanker(-47)] },
];

export function enemyLimit(state: Pick<StageState, 'boss' | 'tick'>): number {
  if (state.boss) return 14;
  if (state.tick < 40 * TICKS_PER_SECOND) return 8;
  return state.tick < 70 * TICKS_PER_SECOND ? 16 : 24;
}

const ESCAPE_HALF = 35 * Math.PI / 180;
const ESCAPE_BEARINGS = [90, -90, 135, -135, 45, -45, 0, 180];
const ENTRY_TURNS = [0, -0.36, 0.36, -0.79, 0.79, -1.33, 1.33, -2.1, 2.1, Math.PI];
const AFT_TURNS = [0, -0.19, 0.19, -0.37, 0.37];
const REENTRY_TURNS = [0, -0.23, 0.23, -0.53, 0.53, -0.85, 0.85];
const REENTRY_RANGES = [216, 196, 176];
const REENTRY_AFT = 190, REENTRY_TICKS = 156;
const SHOALS = [LANDMARKS.strait, LANDMARKS.atoll];
const TURRET_SITES: readonly (Point & { band: Band })[] = [
  { x: -320, z: 96, band: 0 },
  { x: -240, z: 96, band: 1 },
  ...BASALT_STACKS.map(({ x, z }) => ({ x, z, band: 1 as const })),
];

function inside(state: StageState, x: number, z: number, margin: number): boolean {
  return Math.hypot(x - state.arena.x, z - state.arena.z) <= state.arena.radius - margin;
}

function escapeBearing(state: StageState, ground: Ground): number | null {
  const p = state.player;
  for (const degrees of ESCAPE_BEARINGS) {
    const yaw = p.yaw + degrees * Math.PI / 180;
    const x = p.x + Math.sin(yaw) * 90, z = p.z + Math.cos(yaw) * 90;
    if (!inside(state, x, z, 20) || ground(x, z) + 22 > Math.max(110, p.altitude)) continue;
    if (state.enemies.some(enemy => enemy.hp && Math.hypot(enemy.x - p.x, enemy.z - p.z) <= 150
      && Math.abs(angleTo(yaw, enemy.x - p.x, enemy.z - p.z)) < ESCAPE_HALF)) continue;
    return yaw;
  }
  return null;
}

function entry(state: StageState, ground: Ground, kind: EnemyKind, alt: number,
  yaw: number, range: number, escape: number, turns: number[]): Point | null {
  const p = state.player;
  const wedge = kind === 'bomber' ? ESCAPE_HALF + 0.22 : ESCAPE_HALF;
  for (const turn of turns) {
    const bearing = yaw + turn, dx = Math.sin(bearing) * range, dz = Math.cos(bearing) * range;
    const x = p.x + dx, z = p.z + dz;
    if (!inside(state, x, z, 16) || Math.abs(angleTo(escape, dx, dz)) < wedge) continue;
    if (turns === REENTRY_TURNS && state.enemies.some(enemy => enemy.hp && Math.hypot(enemy.x - x, enemy.z - z) < 27)) continue;
    const floor = ground(x, z);
    if (kind === 'skimmer' ? floor <= SKIMMER_WATER : floor + 22 <= alt) return { x, z };
  }
  if (kind === 'skimmer' && turns === ENTRY_TURNS) {
    for (const shore of SHOALS) {
      const dx = shore.x - p.x, dz = shore.z - p.z, distance = Math.hypot(dx, dz);
      if (distance >= 85 && distance <= range + 38 && ground(shore.x, shore.z) <= SKIMMER_WATER
        && Math.abs(angleTo(escape, dx, dz)) >= ESCAPE_HALF) return shore;
    }
  }
  return null;
}

function turretSite(state: StageState, escape: number, reentryBand?: Band) {
  const p = state.player;
  let best: typeof TURRET_SITES[number] | null = null, bestRange = Infinity;
  for (const site of TURRET_SITES) {
    const dx = site.x - p.x, dz = site.z - p.z, range = Math.hypot(dx, dz);
    if (range < 85 || ((range < 150 || reentryBand !== undefined) && Math.abs(angleTo(escape, dx, dz)) < ESCAPE_HALF)
      || state.enemies.some(enemy => enemy.kind === 'turret' && enemy.x === site.x && enemy.z === site.z)) continue;
    if (reentryBand !== undefined && (site.band !== reentryBand || range < 176 || range > 264
      || Math.abs(angleTo(p.yaw, dx, dz)) > Math.PI / 3)) continue;
    if (range < bestRange) {
      best = site;
      bestRange = range;
    }
  }
  return best;
}

export function spawnWave(state: StageState, wave: Wave, ground: Ground): void {
  const { player: p, enemies } = state;
  const escape = escapeBearing(state, ground);
  if (escape === null) return;
  const rotation = (random(state) - 0.5) * 0.24;
  const mirror = random(state) < 0.5 ? -1 : 1;
  const cap = enemyLimit(state);
  for (const member of wave.members) {
    const { kind } = member;
    const slots = kind === 'bomber' ? 3 : 1;
    if (enemies.length + slots > cap || enemies.filter(enemy => enemy.kind === kind).length >= ENEMY_KINDS[kind].cap) continue;
    if (kind === 'turret') {
      const site = turretSite(state, escape);
      if (site) {
        const enemy = makeEnemy(state, site.x, site.z, site.band, kind);
        enemy.alt = ground(site.x, site.z) + 5;
        enemies.push(enemy);
      }
      continue;
    }
    const band = member.band === 'flank' ? random(state) < 0.5 ? 0 : 2 : member.band;
    const offset = (random(state) - 0.5) * (kind === 'patrol' || kind === 'interceptor' ? 12 : 8);
    const yaw = p.yaw + member.bearing * mirror + rotation;
    const turns = Math.abs(member.bearing) > Math.PI * 0.66 ? AFT_TURNS : ENTRY_TURNS;
    const position = entry(state, ground, kind, BANDS[band] + offset, yaw, member.range, escape, turns);
    if (!position) continue;
    const enemy = makeEnemy(state, position.x, position.z, band, kind, offset);
    enemy.yaw = Math.atan2(p.x - position.x, p.z - position.z);
    enemy.shotAt += Math.floor(random(state) * 21);
    enemies.push(enemy);
    if (kind === 'bomber') addBomberEscort(state, enemy, ground);
  }
}

function moveToEntry(state: StageState, enemy: Enemy, point: Point): void {
  enemy.x = point.x;
  enemy.z = point.z;
  enemy.yaw = Math.atan2(state.player.x - point.x, state.player.z - point.z);
  enemy.vx = enemy.vz = enemy.bank = 0;
  enemy.farTicks = 0;
  enemy.shotAt = Math.max(enemy.shotAt, state.tick + 90);
  enemy.maneuverAt = Math.max(enemy.maneuverAt, state.tick + 90);
  enemy.maneuver = null;
  enemy.alt = BANDS[enemy.band] + enemy.offset;
  delete enemy.course;
  delete enemy.flyby;
  delete enemy.tell;
}

export function relocateStragglers(state: StageState, ground: Ground): void {
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  let escape: number | null | undefined;
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.formation || enemy.kind === 'hound' || enemy.kind === 'harrier') continue;
    const dx = p.x - enemy.x, dz = p.z - enemy.z;
    const aft = dx * fx + dz * fz;
    if (aft < REENTRY_AFT || Math.abs(dx * fz - dz * fx) > aft * 0.9) {
      if (enemy.farTicks) enemy.farTicks = 0;
      continue;
    }
    enemy.farTicks = (enemy.farTicks ?? 0) + 1;
    if (enemy.farTicks < REENTRY_TICKS || (enemy.farTicks - REENTRY_TICKS) % 24 !== 0) continue;
    if (escape === undefined) escape = escapeBearing(state, ground);
    if (escape === null) continue;
    if (enemy.kind === 'turret') {
      const site = turretSite(state, escape, enemy.band);
      if (site) {
        moveToEntry(state, enemy, site);
        enemy.alt = ground(site.x, site.z) + 5;
      }
      continue;
    }
    let position: Point | null = null;
    for (const range of REENTRY_RANGES) {
      position = entry(state, ground, enemy.kind, BANDS[enemy.band] + enemy.offset, p.yaw, range, escape, REENTRY_TURNS);
      if (position) break;
    }
    if (!position) continue;
    moveToEntry(state, enemy, position);
    if (enemy.kind !== 'bomber') continue;
    for (const wingmate of state.enemies) {
      if (wingmate.formation?.leader !== enemy.id) continue;
      moveToEntry(state, wingmate, bomberWingPosition(state, enemy, ground, wingmate.formation.side));
    }
  }
}

export function trimEscorts(state: StageState): void {
  const limit = enemyLimit(state), p = state.player;
  const range = (enemy: Enemy) => (p.x - enemy.x) ** 2 + (p.z - enemy.z) ** 2;
  if (state.enemies.length <= limit) return;
  state.enemies.sort((a, b) => range(a) - range(b) || a.id - b.id);
  state.enemies.length = limit;
}
