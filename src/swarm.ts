import { GNAT, type RunPhase, type SwarmFormation } from './data/phases.ts';
import { WAVE_FLY_IN_TICKS } from './fly-in.ts';
import { keepInsideArena } from './reach.ts';
import { BANDS, TICKS_PER_SECOND } from './stage-combat.ts';
import { beginEnemyFlyIn, makeEnemy } from './stage-enemies.ts';
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
function packSites(state: StageState, ground: Ground, projected: Point, direction: number,
  band: Band, formation: SwarmFormation, members: number) {
  const alt = BANDS[band];
  for (const turn of [0, 0.54, -0.54, 1, -1, 1.57, -1.57, Math.PI]) {
    const yaw = direction + turn;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const x = projected.x - fx * GNAT.range, z = projected.z - fz * GNAT.range;
    const sites = [];
    for (let i = 0; i < members; i++) {
      const { side, depth } = offsets(formation, members, i);
      const target = { x: x + fz * side + fx * depth, z: z - fx * side + fz * depth, alt };
      if (Math.hypot(target.x - state.arena.x, target.z - state.arena.z) > state.arena.radius - 12
        || ground(target.x, target.z) + GNAT.clearance > alt) break;
      sites.push(target);
    }
    if (sites.length === members) return { sites, fx, fz };
  }
}

export function spawnSwarm(state: StageState, phase: RunPhase, members: number, ground: Ground, rng: { rng: number }): void {
  const { player, arena } = state;
  let room = state.swarmCap - state.enemies.filter(enemy => enemy.kind === 'gnat' && enemy.hp > 0).length;
  if (room <= 0) return;
  const travel = state.speed * WAVE_FLY_IN_TICKS / TICKS_PER_SECOND;
  const projected = { x: player.x + Math.sin(player.yaw) * travel, z: player.z + Math.cos(player.yaw) * travel };
  keepInsideArena(projected, arena, 20);
  const direction = player.yaw + (random(rng) - 0.5) * 0.82;
  const band = phase.bands[Math.floor(random(rng) * phase.bands.length)];
  const formation = phase.formations[Math.floor(random(rng) * phase.formations.length)];
  const leadSize = phase.splitBands ? Math.ceil(members / 2) : members;
  const followBand: Band = band === 1 ? (random(rng) < 0.5 ? 0 : 2) : 1;
  const packs = phase.splitBands
    ? [{ band, size: leadSize, direction: direction - 0.26 }, { band: followBand, size: members - leadSize, direction: direction + 0.26 }]
    : [{ band, size: leadSize, direction }];
  for (const pack of packs) {
    if (room <= 0 || pack.size <= 0) break;
    const layout = packSites(state, ground, projected, pack.direction, pack.band, formation, pack.size);
    if (!layout) continue;
    for (const { x, z } of layout.sites) {
      const gnat = makeEnemy(state, x, z, pack.band, 'gnat');
      gnat.leaveAt = state.tick + WAVE_FLY_IN_TICKS + GNAT.lifeSeconds * TICKS_PER_SECOND;
      const anchor = { x: x + layout.fx * GNAT.range, z: z + layout.fz * GNAT.range };
      beginEnemyFlyIn(state, gnat, ground, anchor, 0.16);
      state.enemies.push(gnat);
      if (--room === 0) break;
    }
  }
}
