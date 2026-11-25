import { normalizeMetrics } from './meta.ts';
import { deployAce } from './ace.ts';
import { PHASES, RUN_BOSS_SECONDS } from './data/phases.ts';
import { PHASE_REPAIR_SECONDS } from './data/run-balance.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import { BANDS } from './bands.ts';
import { BILLS } from './data/items.ts';
import { rngStream } from './stage-random.ts';
import type { Ground, StageState } from './stage-types.ts';
import { restoreWorldState } from './stage.ts';
import { groundAt } from './world.ts';
import { createMidbossScheduleAtTick } from './midboss-schedule.ts';
import { createPhaseDirectorAtTick } from './phase-director.ts';
import { createThreatBudget } from './threat-budget.ts';

export const CHECKPOINT_KEY = 'aster-wing.checkpoint.v1';
const VERSION = 2;
const phaseStarts = new Set(PHASES.slice(1).map(phase => phase.starts * TICKS_PER_SECOND));

function migrateIonCooldown(target: { ionReadyAt?: number | [number, number, number] }): void {
  const readyAt = target.ionReadyAt;
  if (typeof readyAt === 'number') target.ionReadyAt = [readyAt, readyAt, readyAt];
}

export function encodeCheckpoint(state: StageState): string | null {
  const active = state.phase === 'playing' || state.phase === 'draft' || state.phase === 'chest';
  if (!state.run || state.summary || !active || !phaseStarts.has(state.tick)) return null;
  return JSON.stringify({ version: VERSION, state });
}

export function decodeCheckpoint(raw: string | null, ground?: Ground): StageState | null {
  if (!raw) return null;
  try {
    const { version, state } = JSON.parse(raw) as { version: number; state?: StageState };
    if ((version !== 1 && version !== VERSION) || !state || state.summary !== null || !phaseStarts.has(state.tick)) return null;
    if (state.phase !== 'playing' && state.phase !== 'draft' && state.phase !== 'chest') return null;
    if (state.run && state.streams && !state.streams.magnetDrop) state.streams.magnetDrop = rngStream(state.seed, 'magnet-drop');
    if (!state.run?.weaponLevels || !state.run.buffLevels || !state.run.evolutions || !state.run.draftRng
      || !state.streams?.spawn || !state.streams.chest || !state.streams.bills || !state.streams.combat || !state.streams.magnetDrop
      || !state.profile || !state.bills || !state.chests || !state.player || !state.arena
      || ![state.enemies, state.shots, state.pickups, state.effects, state.draft, state.picks].every(Array.isArray)
      || ![state.seed, state.rng, state.player.x, state.player.z, state.player.altitude, state.hull, state.level].every(Number.isFinite)) return null;
    if (state.player.pitch === undefined) state.player.pitch = 0;
    else if (!Number.isFinite(state.player.pitch)) return null;
    state.profile.metrics = normalizeMetrics(state.profile.metrics);
    state.metrics = normalizeMetrics(state.metrics);
    if (!Array.isArray(state.killAltitudeTicks)) {
      state.killAltitudeTicks = (state.killBandTicks ?? [-1, -1, -1]).flatMap((tick, band) =>
        tick >= state.tick - 5 * TICKS_PER_SECOND ? [{ tick, alt: BANDS[band] }] : []);
    }
    if (version === 1 && state.bills.active) {
      const legacyTarget = state.bills.active.id === 'first-levy' ? 3
        : state.bills.active.id === 'high-recovery' ? 10 : null;
      const target = BILLS.find(bill => bill.id === state.bills.active!.id)?.demand;
      if (legacyTarget !== null && target && 'count' in target) {
        state.bills.active.progress = Math.round(state.bills.active.progress * target.count / legacyTarget);
      }
    }
    for (const enemy of state.enemies) migrateIonCooldown(enemy);
    if (state.boss?.kind === 'ace') migrateIonCooldown(state.boss);
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
    if (state.run) {
      state.threatBudget ??= createThreatBudget();
      state.midbossSchedule ??= createMidbossScheduleAtTick(state.tick);
      state.phaseDirector ??= createPhaseDirectorAtTick(state.tick);
      state.phaseRepairMask ??= PHASE_REPAIR_SECONDS.reduce((mask, seconds, index) =>
        seconds * TICKS_PER_SECOND <= state.tick ? mask | (1 << index) : mask, 0);
    }
    return state;
  } catch {
    return null;
  }
}
