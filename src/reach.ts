import { BANDS, skimAltitude } from './bands.ts';
import { scaleTravel } from './data/speed.ts';
import { FLY_IN_WORLD, REACH_LANDMARKS, REACH_STACKS, WORLD_AIRSPACE, WORLD_SITES } from './data/world.ts';
import type { Ground, Point, Position, StageState } from './stage-types.ts';
import { worldHash } from './world.ts';

export const ARENA = WORLD_AIRSPACE;
export const BEACON_SIGNAL_SECONDS = 92;
export const LANDMARKS = REACH_LANDMARKS;
export const BASALT_STACKS = REACH_STACKS;

export type LandmarkId = keyof typeof LANDMARKS;
export type WorldSite = Position & { id: string; kind: 'beacon' | 'supply' | 'xp'; claimed?: true };

export function isLandmarkId(value: string | null): value is LandmarkId {
  return value !== null && Object.prototype.hasOwnProperty.call(LANDMARKS, value);
}

const SITE_KINDS = ['beacon', 'supply', 'xp'] as const;

function worldSite(seed: number, cellX: number, cellZ: number, ground: Ground, claimed?: Record<string, true>): WorldSite {
  const id = `${cellX}:${cellZ}`;
  const hash = worldHash(seed, cellX, cellZ);
  const index = worldHash(seed, 0, 0) % SITE_KINDS.length + cellX + cellZ * 2;
  const kind = SITE_KINDS[(index % SITE_KINDS.length + SITE_KINDS.length) % SITE_KINDS.length];
  const x = (cellX + 0.24 + (hash & 255) / 512) * WORLD_SITES.spacing;
  const z = (cellZ + 0.24 + ((hash >>> 8) & 255) / 512) * WORLD_SITES.spacing;
  const alt = Math.max(kind === 'xp' ? BANDS[0] : BANDS[1], skimAltitude(ground(x, z)));
  return { id, kind, x, z, alt, ...(claimed?.[id] ? { claimed: true as const } : {}) };
}

/** Keep the current and adjacent regions visible while remembering rewards across revisits. */
export function updateWorldSites(state: StageState, ground: Ground): void {
  const { spacing } = WORLD_SITES;
  const x = Math.floor(state.player.x / spacing), z = Math.floor(state.player.z / spacing);
  if (state.worldRegion?.x === x && state.worldRegion.z === z && state.worldRegion.spacing === spacing) return;
  const sites: WorldSite[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    sites.push(worldSite(state.seed, x + dx, z + dz, ground, state.claimedSites));
  }
  state.worldRegion = { x, z, spacing };
  state.worldSites = sites;
}

export function reachedWorldSite(state: StageState): WorldSite | undefined {
  const p = state.player;
  const site = state.worldSites?.find(site => !site.claimed && site.kind !== 'beacon'
    && Math.abs(site.alt - p.altitude) <= WORLD_SITES.claimWindow
    && (site.x - p.x) ** 2 + (site.z - p.z) ** 2 <= WORLD_SITES.claimRadius ** 2);
  if (site) {
    (state.claimedSites ??= {})[site.id] = true;
    site.claimed = true;
  }
  return site;
}

const RALLY_TURNS = [0, 0.8, -0.8, 1.6, -1.6, Math.PI];
const ORBIT_SAMPLE_OFFSETS = [-45, 0, 45].map(scaleTravel);

function hasClearOrbit(point: Point, ground: Ground): boolean {
  for (const x of ORBIT_SAMPLE_OFFSETS) for (const z of ORBIT_SAMPLE_OFFSETS) {
    if (ground(point.x + x, point.z + z) > BANDS[0] - 15) return false;
  }
  return true;
}

export function findRally(state: StageState, ground: Ground): Position {
  const p = state.player, home = LANDMARKS.atoll;
  if (Math.hypot(home.x - p.x, home.z - p.z) <= WORLD_SITES.rallyNear) return home;
  let closest: WorldSite | undefined;
  let best: number = WORLD_SITES.rallyNear;
  for (const site of state.worldSites ?? []) {
    if (site.kind !== 'beacon') continue;
    const range = Math.hypot(site.x - p.x, site.z - p.z);
    if (range < scaleTravel(110) || range >= best || !hasClearOrbit(site, ground)) continue;
    closest = site;
    best = range;
  }
  if (closest) return { x: closest.x, z: closest.z, alt: BANDS[1] };
  for (const turn of RALLY_TURNS) {
    const yaw = p.yaw + turn;
    const x = p.x + Math.sin(yaw) * WORLD_SITES.rallyDistance;
    const z = p.z + Math.cos(yaw) * WORLD_SITES.rallyDistance;
    if (hasClearOrbit({ x, z }, ground)) return { x, z, alt: BANDS[1] };
  }
  const x = p.x + Math.sin(p.yaw) * WORLD_SITES.rallyDistance;
  const z = p.z + Math.cos(p.yaw) * WORLD_SITES.rallyDistance;
  return { x, z, alt: Math.max(BANDS[1], ground(x, z) + FLY_IN_WORLD.clearance) };
}
