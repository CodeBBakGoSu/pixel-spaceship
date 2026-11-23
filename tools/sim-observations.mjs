function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
}

function summarizeMetric(runs, key) {
  const values = runs.map(run => run[key]).filter(Number.isFinite);
  return { median: median(values), observedRuns: values.length };
}

export function createProgressionObservations(ticksPerSecond) {
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) throw new RangeError('ticksPerSecond must be positive');
  const minuteTick = 60 * ticksPerSecond;
  let firstXpGainSeconds = null, firstDraftSeconds = null, firstLevelUpSeconds = null, levelUpsAt60Seconds = null;

  return {
    record({ previousTick, previousLevel, previousXp, previousSalvage, previousPhase,
      nextTick, nextLevel, nextXp, nextSalvage, nextPhase, terminal = false }) {
      if (![previousTick, previousLevel, previousXp, previousSalvage, nextTick, nextLevel, nextXp, nextSalvage]
        .every(Number.isFinite)) throw new TypeError('progression observations require finite stage values');
      if (nextTick < previousTick || nextTick > previousTick + 1) throw new RangeError('invalid simulation tick advance');

      const seconds = nextTick / ticksPerSecond;
      if (firstXpGainSeconds === null && (nextXp > previousXp || nextSalvage > previousSalvage)) {
        firstXpGainSeconds = seconds;
      }
      if (firstDraftSeconds === null && previousPhase !== 'draft' && nextPhase === 'draft') firstDraftSeconds = seconds;
      if (firstLevelUpSeconds === null && previousLevel === 1 && nextLevel > 1) firstLevelUpSeconds = seconds;
      if (levelUpsAt60Seconds === null) {
        if (nextTick > minuteTick && previousTick <= minuteTick) levelUpsAt60Seconds = Math.max(0, previousLevel - 1);
        else if (terminal && nextTick === minuteTick) levelUpsAt60Seconds = Math.max(0, nextLevel - 1);
      }
    },

    finish() {
      return { firstXpGainSeconds, firstDraftSeconds, firstLevelUpSeconds, levelUpsAt60Seconds };
    },
  };
}

export function summarizeProgressionObservations(runs) {
  return {
    firstXpGainSeconds: summarizeMetric(runs, 'firstXpGainSeconds'),
    firstDraftSeconds: summarizeMetric(runs, 'firstDraftSeconds'),
    firstLevelUpSeconds: summarizeMetric(runs, 'firstLevelUpSeconds'),
    levelUpsAt60Seconds: summarizeMetric(runs, 'levelUpsAt60Seconds'),
  };
}
