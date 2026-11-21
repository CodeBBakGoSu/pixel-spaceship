import { deployAce } from './ace.ts';
import { PHASES, RUN_BOSS_SECONDS } from './data/phases.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';
import { restoreWorldState } from './stage.ts';
import { groundAt } from './world.ts';

export const CHECKPOINT_KEY = 'aster-wing.checkpoint.v1';
const VERSION = 1;
const phaseStarts = new Set(PHASES.slice(1).map(phase => phase.starts * TICKS_PER_SECOND));

export function encodeCheckpoint(state: StageState): string | null {
  const active = state.phase === 'playing' || state.phase === 'draft' || state.phase === 'chest';
  if (!state.run || state.summary || !active || !phaseStarts.has(state.tick)) return null;
  return JSON.stringify({ version: VERSION, state });
}

export function decodeCheckpoint(raw: string | null, ground?: Ground): StageState | null {
  if (!raw) return null;
  try {
    const { version, state } = JSON.parse(raw) as { version: number; state?: StageState };
    if (version !== VERSION || !state || state.summary !== null || !phaseStarts.has(state.tick)) return null;
    if (state.phase !== 'playing' && state.phase !== 'draft' && state.phase !== 'chest') return null;
    if (!state.run?.weaponLevels || !state.run.buffLevels || !state.run.evolutions || !state.run.draftRng
      || !state.streams?.spawn || !state.streams.chest || !state.streams.bills || !state.streams.combat
      || !state.profile || !state.bills || !state.chests || !state.player || !state.arena
      || ![state.enemies, state.shots, state.pickups, state.effects, state.draft, state.picks].every(Array.isArray)
      || ![state.seed, state.rng, state.player.x, state.player.z, state.player.altitude, state.hull, state.level].every(Number.isFinite)) return null;
    if (state.player.pitch === undefined) state.player.pitch = 0;
    else if (!Number.isFinite(state.player.pitch)) return null;
    const oldWorld = !state.worldRegion;
    const terrain: Ground = ground ?? ((x, z) => groundAt(state.seed, x, z));
    restoreWorldState(state, terrain);
    if (state.tick === RUN_BOSS_SECONDS * TICKS_PER_SECOND && state.boss?.kind !== 'ace') {
      state.boss = deployAce(state, terrain);
      state.lock = null;
      if (state.phaseNotice) state.phaseNotice.phase = 'ace';
    } else if (oldWorld && state.boss?.entry) {
      state.boss = deployAce(state, terrain, state.boss);
    }
    return state;
  } catch {
    return null;
  }
}
