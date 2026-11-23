function histogramMedian(histogram, samples) {
  if (!samples) return null;
  const values = [...histogram.keys()].sort((a, b) => a - b);
  const at = index => {
    let total = 0;
    for (const value of values) {
      total += histogram.get(value);
      if (total > index) return value;
    }
    throw new Error('Invalid phase telemetry histogram');
  };
  const lower = at(Math.floor((samples - 1) / 2));
  const upper = at(Math.ceil((samples - 1) / 2));
  return (lower + upper) / 2;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
}

function phaseResult(counts, ticksPerSecond) {
  const hasFullSamples = counts.fullSamples > 0;
  const hasActiveSamples = counts.activeSamples > 0;
  const observedSeconds = hasFullSamples ? counts.fullSamples / ticksPerSecond : null;
  return {
    observedSeconds,
    activeObservedSeconds: hasActiveSamples ? counts.activeSamples / ticksPerSecond : null,
    liveMedian: histogramMedian(counts.fullHistogram, counts.fullSamples),
    liveMax: hasFullSamples ? Math.max(...counts.fullHistogram.keys()) : null,
    activeLiveMedian: histogramMedian(counts.activeHistogram, counts.activeSamples),
    kills: hasFullSamples ? counts.kills : null,
    killsPerMinute: hasFullSamples ? counts.kills * 60 / observedSeconds : null,
    completed: counts.completed,
  };
}

export function createPhaseTelemetry(phases, phaseAt, ticksPerSecond) {
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) throw new RangeError('ticksPerSecond must be positive');
  const counts = new Map(phases.map(phase => [phase.id, {
    fullSamples: 0, activeSamples: 0, fullHistogram: new Map(), activeHistogram: new Map(),
    kills: 0, completed: false,
  }]));

  return {
    record({ previousTick, previousKills, nextTick, nextKills, enemies }) {
      if (![previousTick, previousKills, nextTick, nextKills].every(Number.isFinite)) {
        throw new TypeError('phase telemetry requires finite ticks and kills');
      }
      if (nextTick === previousTick) return;
      if (nextTick < previousTick) throw new RangeError('simulation tick moved backwards');
      if (nextTick !== previousTick + 1) throw new RangeError('phase telemetry requires one simulation tick');
      if (nextKills < previousKills) throw new RangeError('kill counter moved backwards');

      const phase = phaseAt(previousTick / ticksPerSecond);
      const phaseCounts = counts.get(phase.id);
      if (!phaseCounts) throw new RangeError(`unknown simulation phase: ${phase.id}`);
      const live = enemies.reduce((total, enemy) => total + (enemy.hp > 0 && enemy.kind !== 'ace' ? 1 : 0), 0);
      phaseCounts.fullSamples++;
      phaseCounts.fullHistogram.set(live, (phaseCounts.fullHistogram.get(live) ?? 0) + 1);
      phaseCounts.kills += nextKills - previousKills;

      const activeStart = phase.starts + phase.gnatStart;
      const activeEnd = phase.ends - phase.lull;
      const previousSeconds = previousTick / ticksPerSecond;
      if (previousSeconds >= activeStart && previousSeconds < activeEnd) {
        phaseCounts.activeSamples++;
        phaseCounts.activeHistogram.set(live, (phaseCounts.activeHistogram.get(live) ?? 0) + 1);
      }
      if (nextTick >= phase.ends * ticksPerSecond) phaseCounts.completed = true;
    },

    finish() {
      return Object.fromEntries(phases.map(phase => [phase.id,
        phaseResult(counts.get(phase.id), ticksPerSecond)]));
    },
  };
}

export function summarizePhaseTelemetry(runs, phases) {
  return Object.fromEntries(phases.map(phase => {
    const reached = runs.map(run => run.phaseMetrics[phase.id]).filter(metrics => metrics.observedSeconds !== null);
    const active = runs.map(run => run.phaseMetrics[phase.id]).filter(metrics => metrics.activeObservedSeconds !== null);
    const full = values => median(reached.map(metrics => metrics[values]));
    return [phase.id, {
      medianObservedSeconds: full('observedSeconds'),
      medianActiveObservedSeconds: median(active.map(metrics => metrics.activeObservedSeconds)),
      medianFullLiveContacts: full('liveMedian'),
      maxFullLiveContacts: reached.length ? Math.max(...reached.map(metrics => metrics.liveMax)) : null,
      medianActiveLiveContacts: median(active.map(metrics => metrics.activeLiveMedian)),
      medianKills: full('kills'),
      medianKillsPerMinute: full('killsPerMinute'),
      reachedRuns: reached.length,
      activeRuns: active.length,
      completedRuns: reached.filter(metrics => metrics.completed).length,
    }];
  }));
}
