import { GNAT, gnatVariantAt, type RunPhase, type SwarmFormation } from './data/phases.ts';
import { WAVE_FLY_IN_TICKS } from './fly-in.ts';
import { BANDS, TICKS_PER_SECOND } from './stage-combat.ts';
import { beginEnemyFlyIn, makeGnat } from './stage-enemies.ts';
import { random } from './stage-random.ts';
import type { Band, Ground, Point, StageState } from './stage-types.ts';

function offsets(formation: SwarmFormation, members: number, i: number): { side: number; depth: number } {
  const side = (i - (members - 1) / 2) * GNAT.spacing;
  if (formation === 'line') return { side, depth: 0 };
  if (formation === 'vee') return { side, depth: -Math.abs(side) * 0.58 };
  const angle = 2 * Math.PI * i / members;
  const radius = Math.max(GNAT.spacing * 0.56, members * GNAT.spacing / (2 * Math.PI));
  return { side: radius * Math.cos(angle), depth: radius * Math.sin(angle) };
}

// Choose a terrain-safe pack destination before committing any enemies to the wave.
function packSites(ground: Ground, projected: Point, direction: number,
  band: Band, formation: SwarmFormation, members: number) {
  const alt = BANDS[band];
  if (formation === 'encircle') {
    const sites = [];
    for (let i = 0; i < members; i++) {
      const yaw = direction + 2 * Math.PI * i / members;
      const target = { x: projected.x + Math.sin(yaw) * GNAT.range,
        z: projected.z + Math.cos(yaw) * GNAT.range, alt };
      if (ground(target.x, target.z) + GNAT.clearance <= alt) sites.push(target);
    }
    return { sites, fx: 0, fz: 0 };
  }
  for (const turn of [0, 0.54, -0.54, 1, -1, 1.57, -1.57, Math.PI]) {
    const yaw = direction + turn;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const x = projected.x - fx * GNAT.range, z = projected.z - fz * GNAT.range;
    const sites = [];
    for (let i = 0; i < members; i++) {
      const { side, depth } = offsets(formation, members, i);
      const target = { x: x + fz * side + fx * depth, z: z - fx * side + fz * depth, alt };
      if (ground(target.x, target.z) + GNAT.clearance > alt) break;
      sites.push(target);
    }
    if (sites.length === members) return { sites, fx, fz };
  }
}

export type SwarmObserver = (live: number, cap: number, requestedBeyondRoom: boolean) => void;

export function spawnSwarm(state: StageState, phase: RunPhase, members: number, ground: Ground,
  rng: { rng: number }, observe?: SwarmObserver): void {
  const { player } = state;
  let room = state.swarmCap;
  for (const enemy of state.enemies) if (enemy.kind === 'gnat' && enemy.hp > 0) room--;
  const requestedBeyondRoom = members > room;
  if (room <= 0) {
    observe?.(state.swarmCap - room, state.swarmCap, requestedBeyondRoom);
    return;
  }
  const travel = state.speed * WAVE_FLY_IN_TICKS / TICKS_PER_SECOND;
  const projected = { x: player.x + Math.sin(player.yaw) * travel, z: player.z + Math.cos(player.yaw) * travel };
  const direction = player.yaw + (random(rng) - 0.5) * 0.82;
  const band = phase.bands[Math.floor(random(rng) * phase.bands.length)];
  const formation = phase.formations[Math.floor(random(rng) * phase.formations.length)];
  const leadSize = phase.splitBands ? Math.ceil(members / 2) : members;
  const followBand: Band = band === 1 ? (random(rng) < 0.5 ? 0 : 2) : 1;
  const packs = phase.splitBands && formation !== 'encircle'
    ? [{ band, size: leadSize, direction: direction - 0.26 }, { band: followBand, size: members - leadSize, direction: direction + 0.26 }]
    : [{ band, size: members, direction }];
  for (const pack of packs) {
    if (room <= 0 || pack.size <= 0) break;
    const layout = packSites(ground, projected, pack.direction, pack.band, formation, pack.size);
    if (!layout) continue;
    for (const { x, z } of layout.sites) {
      const gnat = makeGnat(state, x, z, pack.band, gnatVariantAt(phase, random(rng)));
      const anchor = formation === 'encircle' ? projected
        : { x: x + layout.fx * GNAT.range, z: z + layout.fz * GNAT.range };
      beginEnemyFlyIn(state, gnat, ground, anchor, 0.16);
      state.enemies.push(gnat);
      if (--room === 0) break;
    }
  }
  // All Gnat births happen here. Sample before combat or departures can remove them on this tick.
  observe?.(state.swarmCap - room, state.swarmCap, requestedBeyondRoom);
}
