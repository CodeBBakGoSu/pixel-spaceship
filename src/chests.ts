import { CARRIER_TUNING, CHEST_PICKUP_RADIUS } from './data/chest-tuning.ts';
import { CHESTS, type ChestId } from './data/items.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { WAVE_FLY_IN_TICKS } from './fly-in.ts';
import { buffTuning } from './loadout.ts';
import { enemyLimit } from './spawn-director.ts';
import { BANDS, inBand, STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import { addBomberEscort, beginEnemyFlyIn, makeEnemy } from './stage-enemies.ts';
import { ENEMY_KINDS } from './enemy-kinds.ts';
import { random, rngStream } from './stage-random.ts';
import type { Band, Enemy, Ground, Point, Position, StageState } from './stage-types.ts';

export type ChestDrop = Position & { id: ChestId };
export type ChestState = { next: number; drops: ChestDrop[]; offer: ChestId | null; opened: number; dropped: ChestId[] };

const APPROACH_TURNS = [0, -0.6, 0.6, -1.25, 1.25, -2.1, 2.1, Math.PI];

export function createChestState(): ChestState {
  return { next: 0, drops: [], offer: null, opened: 0, dropped: [] };
}

export const chestDefinition = (id: ChestId): typeof CHESTS[number] => CHESTS.find(chest => chest.id === id)!;

function carrierSite(ground: Ground, origin: Point, yaw: number, range: number, preferred: Band) {
  const bands = [preferred, 2, 1, 0] as const;
  for (const band of bands) {
    for (const bend of APPROACH_TURNS) {
      const x = origin.x + Math.sin(yaw + bend) * range;
      const z = origin.z + Math.cos(yaw + bend) * range;
      if (ground(x, z) + 22 <= BANDS[band]) return { x, z, band };
    }
  }
  return null;
}

/** The documented chest beat is the carrier's arrival, after its normal fly-in. */
export function advanceChestSpawns(state: StageState, ground: Ground, replaced: readonly ChestId[] = []): void {
  if (!state.run) return;
  const chest = CHESTS[state.chests.next];
  if (chest && replaced.includes(chest.id)
    && state.tick >= chest.second * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS) {
    state.chests.next++;
    return;
  }
  if (!chest || state.tick < chest.second * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS) return;
  const regular = state.enemies.filter(enemy => enemy.hp > 0 && enemy.kind !== 'gnat');
  const heat = HEAT_TIERS[state.heat];
  const escort = heat.carrierEscort || ('escort' in chest && chest.escort);
  // A saturated wave leaves the event pending until its slots are available.
  if (regular.length + (escort ? 3 : 1) > enemyLimit(state)
    || regular.filter(enemy => enemy.kind === 'bomber').length >= ENEMY_KINDS.bomber.cap) return;

  const p = state.player, travel = state.speed * WAVE_FLY_IN_TICKS * STEP;
  const anchor = { x: p.x + Math.sin(p.yaw) * travel, z: p.z + Math.cos(p.yaw) * travel };
  const tuning = CARRIER_TUNING[chest.id];
  const rng = rngStream(state.seed, `carrier:${chest.id}`);
  const yaw = p.yaw + (random(rng) - 0.5) * 0.66;
  const position = carrierSite(ground, anchor, yaw, tuning.range, tuning.band);
  if (!position) return;

  const carrier = makeEnemy(state, position.x, position.z, position.band, 'bomber');
  carrier.carrier = chest.id;
  carrier.hp = Math.round(tuning.hp * heat.armorScale);
  carrier.yaw = Math.atan2(anchor.x - carrier.x, anchor.z - carrier.z);

  const first = state.enemies.length;
  state.enemies.push(carrier);
  if (escort) {
    addBomberEscort(state, carrier, ground);
    for (let index = first + 1; index < state.enemies.length; index++) {
      const wingman = state.enemies[index];
      wingman.band = carrier.band;
      wingman.alt = carrier.alt;
    }
  }
  for (let index = first; index < state.enemies.length; index++) {
    const inbound = state.enemies[index];
    inbound.shotAt += WAVE_FLY_IN_TICKS;
    const bend = (random(rng) - 0.5) * 0.74;
    beginEnemyFlyIn(state, inbound, ground, anchor, bend);
  }
  state.chests.next++;
}

export function dropCarrierChest(state: StageState, enemy: Enemy, ground: Ground): ChestDrop | null {
  const id = enemy.carrier;
  if (!state.run || !id || !enemy.shotDown || enemy.hp > 0 || enemy.entry || state.chests.dropped.includes(id)) return null;
  // Safety only for a contact already pressed against terrain at the moment it breaks up.
  const alt = Math.max(enemy.alt, ground(enemy.x, enemy.z) + 22);
  const drop = { x: enemy.x, z: enemy.z, alt, id };
  state.chests.drops.push(drop);
  state.chests.dropped.push(id);
  return drop;
}

export function collectChest(state: StageState): boolean {
  const chests = state.chests;
  if (!state.run || chests.offer !== null || state.hull <= 0) return false;
  const p = state.player;
  const index = chests.drops.findIndex(drop => inBand(p.altitude, drop.alt)
    && Math.hypot(p.x - drop.x, p.z - drop.z) <= CHEST_PICKUP_RADIUS);
  if (index === -1) return false;
  chests.offer = chests.drops[index].id;
  chests.drops.splice(index, 1);
  return true;
}

/** Returns the number of upgrades. An evolution, if selected, gets its own reel. */
export function rollChestRewards(state: StageState, id: ChestId, evolved: boolean): number {
  const chest = chestDefinition(id);
  if (chest.kind === 'evolution') {
    if (!evolved) return chest.fallback;
    const [min, max] = chest.bonus;
    return min + Math.floor(random(state.streams.chest) * (max - min + 1));
  }

  const roll = random(state.streams.chest);
  const luck = buffTuning(state, 'salvage-beacon')?.luck ?? 0;
  const adjusted = roll + (1 - roll) * luck;
  const rewards = chest.rewards;
  let remaining = adjusted * rewards.reduce((sum, reward) => sum + reward.weight, 0);
  for (const reward of rewards) {
    remaining -= reward.weight;
    if (remaining < 0) return reward.count;
  }
  return rewards[rewards.length - 1].count;
}
