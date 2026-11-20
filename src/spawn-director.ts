import { phaseAt, type RegularSpawn } from './data/phases.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { ENEMY_KINDS, type RegularEnemyKind } from './enemy-kinds.ts';
import { WAVE_FLY_IN_TICKS } from './fly-in.ts';
import { BASALT_STACKS, keepInsideArena, LANDMARKS } from './reach.ts';
import { angleTo, BANDS, TICKS_PER_SECOND } from './stage-combat.ts';
import { addBomberEscort, beginEnemyFlyIn, bomberWingPosition, makeEnemy, SKIMMER_WATER } from './stage-enemies.ts';
import { random } from './stage-random.ts';
import { spawnSwarm, type SwarmObserver } from './swarm.ts';
import type { Band, Enemy, Ground, Point, StageState } from './stage-types.ts';

type Spawn = { kind: RegularEnemyKind; band: Band | 'flank'; bearing: number; range: number };
type Wave = { time: number; members: Spawn[] };
const contact = (kind: RegularEnemyKind, band: Spawn['band'], degrees: number, range = 141): Spawn =>
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

export function enemyLimit(state: Pick<StageState, 'boss' | 'tick'> & Partial<Pick<StageState, 'run'>>): number {
  if (state.run) return phaseAt(state.tick / TICKS_PER_SECOND).regularCap;
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

function escapeBearing(state: StageState, ground: Ground, p = state.player): number | null {
  for (const degrees of ESCAPE_BEARINGS) {
    const yaw = p.yaw + degrees * Math.PI / 180;
    const x = p.x + Math.sin(yaw) * 90, z = p.z + Math.cos(yaw) * 90;
    if (!inside(state, x, z, 20) || ground(x, z) + 22 > Math.max(110, p.altitude)) continue;
    if (state.enemies.some(enemy => enemy.kind !== 'gnat' && enemy.hp && Math.hypot(enemy.x - p.x, enemy.z - p.z) <= 150
      && Math.abs(angleTo(yaw, enemy.x - p.x, enemy.z - p.z)) < ESCAPE_HALF)) continue;
    return yaw;
  }
  return null;
}

function engagementSite(state: StageState, ground: Ground, kind: RegularEnemyKind, alt: number,
  yaw: number, range: number, escape: number, turns: number[], p: Point = state.player): Point | null {
  const wedge = kind === 'bomber' ? ESCAPE_HALF + 0.22 : ESCAPE_HALF;
  for (const turn of turns) {
    const bearing = yaw + turn, dx = Math.sin(bearing) * range, dz = Math.cos(bearing) * range;
    const x = p.x + dx, z = p.z + dz;
    if (!inside(state, x, z, 16) || Math.abs(angleTo(escape, dx, dz)) < wedge) continue;
    if (turns === REENTRY_TURNS && state.enemies.some(enemy => {
      const contact = enemy.entry?.target ?? enemy;
      return enemy.kind !== 'gnat' && enemy.hp && Math.hypot(contact.x - x, contact.z - z) < 27;
    })) continue;
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

function turretSite(state: StageState, escape: number, p: Pick<StageState['player'], 'x' | 'z' | 'yaw'>, reentryBand?: Band) {
  let best: typeof TURRET_SITES[number] | null = null, bestRange = Infinity;
  for (const site of TURRET_SITES) {
    const dx = site.x - p.x, dz = site.z - p.z, range = Math.hypot(dx, dz);
    if (range < 85 || ((range < 150 || reentryBand !== undefined) && Math.abs(angleTo(escape, dx, dz)) < ESCAPE_HALF)
      || state.enemies.some(enemy => {
        const contact = enemy.entry?.target ?? enemy;
        return enemy.kind === 'turret' && contact.x === site.x && contact.z === site.z;
      })) continue;
    if (reentryBand !== undefined && (site.band !== reentryBand || range < 176 || range > 264
      || Math.abs(angleTo(p.yaw, dx, dz)) > Math.PI / 3)) continue;
    if (range < bestRange) {
      best = site;
      bestRange = range;
    }
  }
  return best;
}

export function spawnWave(state: StageState, wave: Wave, ground: Ground, rng: { rng: number } = state, hpScale = 1): void {
  const { player: p, enemies } = state;
  const heatArmor = state.run ? HEAT_TIERS[state.heat].armorScale : 1;
  // Lay out the same combat formation at the pilot's projected position on the original wave beat.
  const travel = state.speed * WAVE_FLY_IN_TICKS / TICKS_PER_SECOND;
  const projected = { ...p, x: p.x + Math.sin(p.yaw) * travel, z: p.z + Math.cos(p.yaw) * travel };
  keepInsideArena(projected, state.arena, 20);
  const escape = escapeBearing(state, ground, projected);
  if (escape === null) return;
  const rotation = (random(rng) - 0.5) * 0.24;
  const mirror = random(rng) < 0.5 ? -1 : 1;
  const cap = enemyLimit(state);
  let occupied = state.run ? enemies.filter(enemy => enemy.kind !== 'gnat').length : enemies.length;
  for (const member of wave.members) {
    const { kind } = member;
    const slots = kind === 'bomber' ? 3 : 1;
    if (occupied + slots > cap || enemies.filter(enemy => enemy.kind === kind).length >= ENEMY_KINDS[kind].cap) continue;
    if (kind === 'turret') {
      const site = turretSite(state, escape, projected);
      if (site) {
        const enemy = makeEnemy(state, site.x, site.z, site.band, kind);
        enemy.alt = ground(site.x, site.z) + 5;
        enemy.hp = Math.round(enemy.hp * hpScale) * heatArmor;
        enemy.shotAt += WAVE_FLY_IN_TICKS;
        beginEnemyFlyIn(state, enemy, ground, projected, mirror * 0.32);
        enemies.push(enemy);
        occupied++;
      }
      continue;
    }
    const band = member.band === 'flank' ? random(rng) < 0.5 ? 0 : 2 : member.band;
    const offset = (random(rng) - 0.5) * (kind === 'patrol' || kind === 'interceptor' ? 12 : 8);
    const yaw = p.yaw + member.bearing * mirror + rotation;
    const turns = Math.abs(member.bearing) > Math.PI * 0.66 ? AFT_TURNS : ENTRY_TURNS;
    const position = engagementSite(state, ground, kind, BANDS[band] + offset, yaw, member.range, escape, turns, projected);
    if (!position) continue;
    const enemy = makeEnemy(state, position.x, position.z, band, kind, offset);
    enemy.yaw = Math.atan2(projected.x - position.x, projected.z - position.z);
    enemy.shotAt += Math.floor(random(rng) * 21);
    const first = enemies.length;
    enemies.push(enemy);
    if (kind === 'bomber') addBomberEscort(state, enemy, ground);
    for (let i = first; i < enemies.length; i++) {
      const incoming = enemies[i];
      incoming.hp = Math.round(incoming.hp * hpScale) * heatArmor;
      incoming.shotAt += WAVE_FLY_IN_TICKS;
      incoming.maneuverAt += WAVE_FLY_IN_TICKS;
      beginEnemyFlyIn(state, incoming, ground, projected, mirror * 0.32);
    }
    occupied += enemies.length - first;
  }
}

const COAST_OPENING = WAVES.filter(wave => wave.time <= 22);
const COAST_OPENING_TOTAL = COAST_OPENING.reduce((count, wave) => count + wave.members.length, 0);
const COAST_OPENING_END = 23 * TICKS_PER_SECOND;

// Place all groups over the active portion of a phase, including a group on its first tick.
function groupAt(tick: number, from: number, to: number, groups: number): number {
  const elapsed = tick - from, length = to - from;
  if (elapsed < 0 || elapsed >= length) return -1;
  const group = Math.floor(elapsed * groups / length);
  return group === Math.floor((elapsed - 1) * groups / length) ? -1 : group;
}

function regularPick(pool: readonly RegularSpawn[], rng: { rng: number }): RegularSpawn {
  let roll = random(rng) * pool.reduce((total, entry) => total + entry.weight, 0);
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return pool[pool.length - 1];
}

function beatStream(spawn: { rng: number }): { rng: number } {
  // Taking one seed per scheduled beat keeps later rolls independent of contact caps, terrain, and combat.
  return { rng: random(spawn) * 0x1_0000_0000 };
}

export function advancePhaseSpawns(state: StageState, ground: Ground, observeSwarm?: SwarmObserver): void {
  const phase = phaseAt(state.tick / TICKS_PER_SECOND);
  const from = phase.starts * TICKS_PER_SECOND;
  const until = (phase.ends - phase.lull) * TICKS_PER_SECOND;
  const minutes = (phase.ends - phase.starts) / 60;
  const isOpening = phase.id === 'coast';
  const regularStart = isOpening ? COAST_OPENING_END : from;
  const regularCount = phase.regularPerMinute * minutes - (isOpening ? COAST_OPENING_TOTAL : 0);
  if (isOpening && state.tick < regularStart) {
    const wave = COAST_OPENING.find(wave => state.tick === wave.time * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS);
    if (wave) spawnWave(state, wave, ground, beatStream(state.streams.spawn));
  } else if (groupAt(state.tick, regularStart, until, regularCount) >= 0) {
    const rng = beatStream(state.streams.spawn);
    const { kind, band, bearing, range } = regularPick(phase.enemies, rng);
    spawnWave(state, { time: state.tick / TICKS_PER_SECOND, members: [contact(kind, band, bearing, range)] }, ground, rng, phase.hpScale);
  }
  const gnatCount = phase.gnatsPerMinute * minutes;
  const packs = Math.ceil(gnatCount / phase.packSize);
  const pack = groupAt(state.tick, from + phase.gnatStart * TICKS_PER_SECOND, until, packs);
  if (pack >= 0) {
    const members = Math.floor(gnatCount * (pack + 1) / packs) - Math.floor(gnatCount * pack / packs);
    spawnSwarm(state, phase, members, ground, beatStream(state.streams.spawn), observeSwarm);
  }
}

function moveToEntry(state: StageState, enemy: Enemy, point: Point, ground: Ground): void {
  enemy.x = point.x;
  enemy.z = point.z;
  enemy.yaw = Math.atan2(state.player.x - point.x, state.player.z - point.z);
  enemy.vx = enemy.vz = enemy.bank = 0;
  enemy.farTicks = 0;
  enemy.shotAt = Math.max(enemy.shotAt, state.tick + 90);
  enemy.maneuverAt = Math.max(enemy.maneuverAt, state.tick + 90);
  enemy.maneuver = null;
  enemy.alt = enemy.kind === 'turret' ? ground(point.x, point.z) + 5 : BANDS[enemy.band] + enemy.offset;
  delete enemy.flightSpeed;
  delete enemy.closeRange;
  delete enemy.longRange;
  delete enemy.terrainTurn;
  delete enemy.course;
  delete enemy.flyby;
  delete enemy.tell;
}

export function relocateStragglers(state: StageState, ground: Ground): void {
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  let escape: number | null | undefined;
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.entry || enemy.formation || enemy.kind === 'gnat' || enemy.kind === 'hound' || enemy.kind === 'harrier') continue;
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
    const bend = enemy.id % 2 ? 0.32 : -0.32;
    if (enemy.kind === 'turret') {
      const site = turretSite(state, escape, p, enemy.band);
      if (site) {
        moveToEntry(state, enemy, site, ground);
        beginEnemyFlyIn(state, enemy, ground, p, bend);
      }
      continue;
    }
    let position: Point | null = null;
    for (const range of REENTRY_RANGES) {
      position = engagementSite(state, ground, enemy.kind, BANDS[enemy.band] + enemy.offset, p.yaw, range, escape, REENTRY_TURNS);
      if (position) break;
    }
    if (!position) continue;
    moveToEntry(state, enemy, position, ground);
    if (enemy.kind === 'bomber') {
      for (const wingmate of state.enemies) {
        if (wingmate.formation?.leader !== enemy.id) continue;
        moveToEntry(state, wingmate, bomberWingPosition(state, enemy, ground, wingmate.formation.side), ground);
        beginEnemyFlyIn(state, wingmate, ground, p, bend);
      }
    }
    beginEnemyFlyIn(state, enemy, ground, p, bend);
  }
}

export function trimEscorts(state: StageState): void {
  const limit = enemyLimit(state), p = state.player;
  const range = (enemy: Enemy) => (p.x - enemy.x) ** 2 + (p.z - enemy.z) ** 2;
  if (state.enemies.length <= limit) return;
  if (state.run) {
    const regular = state.enemies.filter(enemy => enemy.kind !== 'gnat');
    if (regular.length <= limit) return;
    regular.sort((a, b) => Number(!!b.carrier) - Number(!!a.carrier) || range(a) - range(b) || a.id - b.id);
    const survivors = new Set(regular.slice(0, limit));
    state.enemies = state.enemies.filter(enemy => enemy.kind === 'gnat' || survivors.has(enemy));
    return;
  }
  state.enemies.sort((a, b) => range(a) - range(b) || a.id - b.id);
  state.enemies.length = limit;
}
