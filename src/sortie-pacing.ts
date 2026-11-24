import { phaseAt } from './data/phases.ts';
import { PHASE_CREDIT_BONUS, PHASE_NOTICE_TICKS, PHASE_REPAIR_HULL } from './data/run-balance.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import type { Enemy, StageState } from './stage-types.ts';

export function advancePhasePacing(state: StageState): void {
  const run = state.run;
  if (!run) return;
  if (state.phaseNotice && state.phaseNotice.until <= state.tick) state.phaseNotice = null;
  const phase = phaseAt(state.tick / TICKS_PER_SECOND);
  const start = Math.max(1, phase.starts * TICKS_PER_SECOND);
  if (state.tick === start) {
    if (phase.starts > 0) run.credits += PHASE_CREDIT_BONUS;
    state.phaseNotice = { phase: phase.id, kind: 'start', repaired: 0, until: state.tick + PHASE_NOTICE_TICKS };
  }
  if (phase.lull && state.tick === (phase.ends - phase.lull) * TICKS_PER_SECOND) {
    const repaired = Math.min(PHASE_REPAIR_HULL, state.maxHull - state.hull);
    state.hull += repaired;
    state.phaseNotice = { phase: phase.id, kind: 'lull', repaired, until: state.tick + PHASE_NOTICE_TICKS };
  }
}

export function noteSortieKill(state: StageState, enemy: Enemy): void {
  if (!state.run) return;
  const metrics = state.metrics;
  if (Math.abs(enemy.alt - state.player.altitude) >= 15) metrics.verticalKills++;
  const earliest = state.tick - 5 * TICKS_PER_SECOND;
  state.killAltitudeTicks ??= [];
  state.killAltitudeTicks = state.killAltitudeTicks.filter(kill => kill.tick >= earliest);
  state.killAltitudeTicks.push({ tick: state.tick, alt: enemy.alt });
  if (state.killAltitudeTicks.length >= 2) {
    const altitudes = state.killAltitudeTicks.map(kill => kill.alt);
    if (Math.max(...altitudes) - Math.min(...altitudes) >= 30) {
      metrics.heightSpreadWithinFive = Math.max(metrics.heightSpreadWithinFive, Math.min(3, state.killAltitudeTicks.length));
    }
  }
  if (enemy.killCredit?.locked) metrics.lockedKills++;
  if (enemy.killCredit?.rear && enemy.killCredit.weapon === 'phoenix'
    && enemy.kind !== 'gnat' && enemy.kind !== 'turret' && !enemy.carrier) metrics.rearFlareKills++;
}
