function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
}

function summarizeMetricValues(values) {
  values = values.filter(Number.isFinite);
  return { median: median(values), observedRuns: values.length };
}

function summarizeMetric(runs, key) {
  return summarizeMetricValues(runs.map(run => run[key]));
}

export function createProgressionObservations(ticksPerSecond) {
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) throw new RangeError('ticksPerSecond must be positive');
  const minuteTick = 60 * ticksPerSecond;
  const tenMinuteTick = 600 * ticksPerSecond;
  let firstXpGainSeconds = null, firstDraftSeconds = null, firstLevelUpSeconds = null, levelUpsAt60Seconds = null;
  let levelUpsAt600Seconds = null;
  const levelUpTimes = {};

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
      for (let level = previousLevel + 1; level <= nextLevel; level++) {
        if (levelUpTimes[level] === undefined) levelUpTimes[level] = seconds;
      }
      if (levelUpsAt60Seconds === null) {
        if (nextTick > minuteTick && previousTick <= minuteTick) levelUpsAt60Seconds = Math.max(0, previousLevel - 1);
        else if (terminal && nextTick === minuteTick) levelUpsAt60Seconds = Math.max(0, nextLevel - 1);
      }
      if (levelUpsAt600Seconds === null) {
        if (nextTick > tenMinuteTick && previousTick <= tenMinuteTick) levelUpsAt600Seconds = Math.max(0, previousLevel - 1);
        else if (terminal && nextTick === tenMinuteTick) levelUpsAt600Seconds = Math.max(0, nextLevel - 1);
      }
    },

    finish() {
      return { firstXpGainSeconds, firstDraftSeconds, firstLevelUpSeconds, levelUpsAt60Seconds,
        levelUpsAt600Seconds, levelUpTimes };
    },
  };
}

export function createFullBuildObservation({ weaponSlots, buffSlots, maxWeaponLevel, maxBuffLevel, ticksPerSecond }) {
  if (![weaponSlots, buffSlots, maxWeaponLevel, maxBuffLevel, ticksPerSecond]
    .every(value => Number.isInteger(value) && value > 0)) throw new RangeError('full build limits must be positive integers');
  let fullBuildSeconds = null;

  return {
    record({ tick, weaponLevels, buffLevels }) {
      if (!Number.isFinite(tick) || tick < 0) throw new RangeError('full build tick must be nonnegative');
      if (fullBuildSeconds !== null) return;
      const weapons = Object.values(weaponLevels ?? {}), buffs = Object.values(buffLevels ?? {});
      if (weapons.length === weaponSlots && buffs.length === buffSlots
        && weapons.every(level => level === maxWeaponLevel) && buffs.every(level => level === maxBuffLevel)) {
        fullBuildSeconds = tick / ticksPerSecond;
      }
    },

    finish() {
      return fullBuildSeconds;
    },
  };
}

export function summarizeProgressionObservations(runs) {
  return {
    firstXpGainSeconds: summarizeMetric(runs, 'firstXpGainSeconds'),
    firstDraftSeconds: summarizeMetric(runs, 'firstDraftSeconds'),
    firstLevelUpSeconds: summarizeMetric(runs, 'firstLevelUpSeconds'),
    levelUpsAt60Seconds: summarizeMetric(runs, 'levelUpsAt60Seconds'),
    levelUpsAt600Seconds: summarizeMetric(runs, 'levelUpsAt600Seconds'),
    levelUpTimes: Object.fromEntries([2, 3, 4].map(level => [level,
      summarizeMetricValues(runs.map(run => run.levelUpTimes?.[level]))])),
    fullBuildSeconds: summarizeMetric(runs, 'fullBuildSeconds'),
  };
}
