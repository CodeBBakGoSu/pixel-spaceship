import { PHASE_SECONDS, phaseAt } from './data/phases.ts';
import { PHASE_CREDIT_BONUS, PHASE_NOTICE_TICKS, PHASE_REPAIR_HULL, PHASE_REPAIR_SECONDS } from './data/run-balance.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import type { Enemy, StageState } from './stage-types.ts';

export function advancePhasePacing(state: StageState): void {
  const run = state.run;
  if (!run) return;
  if (state.phaseNotice && state.phaseNotice.until <= state.tick) state.phaseNotice = null;
  const phase = phaseAt(state.tick / TICKS_PER_SECOND);
  const start = Math.max(1, phase.starts * TICKS_PER_SECOND);
  if (state.tick === start && phase.starts % PHASE_SECONDS === 0) {
    if (phase.starts > 0) run.credits += PHASE_CREDIT_BONUS;
    state.phaseNotice = { phase: phase.id, kind: 'start', repaired: 0, until: state.tick + PHASE_NOTICE_TICKS };
  }
  const repairIndex = PHASE_REPAIR_SECONDS.findIndex(seconds => seconds * TICKS_PER_SECOND === state.tick);
  const repairBit = repairIndex < 0 ? 0 : 1 << repairIndex;
  if (repairBit && !((state.phaseRepairMask ?? 0) & repairBit)) {
    state.phaseRepairMask = (state.phaseRepairMask ?? 0) | repairBit;
    state.hull += Math.min(PHASE_REPAIR_HULL, state.maxHull - state.hull);
  }
}

export function noteSortieKill(state: StageState, enemy: Enemy): void {
  if (!state.run) return;
  const metrics = state.metrics;
  metrics.bandsKilled |= 1 << enemy.band;
  state.killBandTicks[enemy.band] = state.tick;
  const window = 5 * TICKS_PER_SECOND;
  const distinct = state.killBandTicks.reduce((count, tick) => count + Number(tick >= 0 && state.tick - tick <= window), 0);
  metrics.multibandWithinFive = Math.max(metrics.multibandWithinFive, distinct);
  if (enemy.killCredit?.locked) metrics.lockedKills++;
  if (enemy.killCredit?.rear && enemy.killCredit.weapon === 'phoenix'
    && enemy.kind !== 'gnat' && enemy.kind !== 'turret' && !enemy.carrier) metrics.rearFlareKills++;
}
