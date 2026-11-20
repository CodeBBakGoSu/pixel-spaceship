import { WARDEN_PACING } from './data/warden.ts';
import { HEAT_TIERS } from './data/meta.ts';
import type { CombatEvents } from './hostile-events.ts';
import { BANDS, fireHostile, TICKS_PER_SECOND } from './stage-combat.ts';
import { random, rngStream } from './stage-random.ts';
import type { Boss, StageState } from './stage-types.ts';

function wardenParts(heat: number) {
  return HEAT_TIERS[heat].extraWeakPoint ? WARDEN_PACING.heatParts : WARDEN_PACING.parts;
}

export function makePacedWarden(state: StageState, x: number, z: number): Boss {
  const stream = rngStream(state.seed, 'warden');
  const parts = wardenParts(state.heat);
  const weakPoints = parts.map(part => {
    const jitter = part.kind === 'core'
      ? (random(stream) < 0.5 ? -1 : 1) * (WARDEN_PACING.coreOffset + random(stream) * WARDEN_PACING.coreJitter)
      : (random(stream) - 0.5) * WARDEN_PACING.altitudeJitter;
    return {
      id: ++state.nextId,
      kind: part.kind, band: part.band, x, z, alt: BANDS[part.band] + jitter,
      hp: part.armor, maxHp: part.armor, hits: 0, window: part.hitWindow, vx: 0, vz: 0,
    };
  });
  return {
    paced: true, x, z, alt: BANDS[1], weakPoints, orbitAngle: state.seed * 1.79,
    orbitStartTick: state.tick, index: 0, changedTick: state.tick,
    exposeTick: state.tick + parts[0].opensAfterSeconds * TICKS_PER_SECOND,
    shotAt: state.tick + WARDEN_PACING.firstSalvoSeconds * TICKS_PER_SECOND,
  };
}

export function pacedExposureTick(boss: Boss, heat: number, next: number, tick: number): number {
  const planned = boss.orbitStartTick + wardenParts(heat)[next].opensAfterSeconds * TICKS_PER_SECOND;
  const warned = tick + WARDEN_PACING.partWarningSeconds * TICKS_PER_SECOND;
  return Math.max(planned, warned);
}

export function positionPacedWeakPoints(boss: Boss, heat: number, tick: number): void {
  const parts = wardenParts(heat);
  const travel = Math.max(0, tick - boss.orbitStartTick) * WARDEN_PACING.orbitSpeed;
  const speed = tick < boss.orbitStartTick ? 0 : WARDEN_PACING.orbitSpeed * TICKS_PER_SECOND;
  for (const [index, point] of boss.weakPoints.entries()) {
    const part = parts[index];
    const radius = part.orbitRadius, angle = boss.orbitAngle + travel + part.orbitOffset;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    point.x = boss.x + radius * sin;
    point.z = boss.z + radius * cos;
    point.vx = radius * speed * cos;
    point.vz = -radius * speed * sin;
  }
}

export function firePacedWarden(state: StageState, boss: Boss, events?: CombatEvents): void {
  const point = boss.weakPoints[boss.index];
  if (boss.entry || !point?.hp || state.tick < boss.shotAt) return;
  const { spread, speed, periodTicks } = wardenParts(state.heat)[boss.index].salvo;
  for (const bearing of spread) fireHostile(state, point, speed, bearing, events);
  boss.shotAt = state.tick + Math.round(periodTicks * HEAT_TIERS[state.heat].shotIntervalScale);
}
