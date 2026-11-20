import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBot } from '../src/bot.ts';
import { BOT_PROFILE_IDS } from '../src/data/bot-profiles.ts';
import { BUFF_IDS, WEAPON_IDS } from '../src/data/items.ts';
import { PHASES, phaseAt, SWARM_CAPS } from '../src/data/phases.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { World } from '../src/world.ts';

const MAX_SEED = 0xffffffff;
const USAGE = 'npm run sim -- --profile skilled|average|weak|all --seeds N [--from S] [--heat H] [--mobile]';

export function parseSimArgs(values) {
  const args = { profile: 'all', seeds: 3, from: 1, heat: 0, mobile: false };
  const seen = new Set();
  for (let i = 0; i < values.length; i++) {
    const flag = values[i];
    if (seen.has(flag)) throw new Error(`Flag repeated: ${flag}`);
    seen.add(flag);
    if (flag === '--mobile') {
      args.mobile = true;
    } else if (flag === '--profile') {
      const value = values[++i];
      if (value !== 'all' && !BOT_PROFILE_IDS.includes(value)) throw new Error(`Invalid profile: ${value ?? '(missing)'}`);
      args.profile = value;
    } else if (flag === '--seeds' || flag === '--from' || flag === '--heat') {
      const value = values[++i];
      const number = Number(value);
      if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(number)) throw new Error(`Invalid integer for ${flag}`);
      args[flag.slice(2)] = number;
    } else {
      throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (args.seeds < 1) throw new Error('--seeds must be at least 1');
  if (args.from + args.seeds - 1 > MAX_SEED) throw new Error('Seed range exceeds 32 bits');
  if (args.heat > 5) throw new Error('--heat must be between 0 and 5');
  return args;
}

function runSortie(args, profile, seed, ground) {
  const stage = createStage({ ...parseStageOptions('?autoplay=1&mode=survivors'), seed, mobile: args.mobile, heat: args.heat }, ground);
  const pilot = createBot(profile, seed);
  let inputs = 0;
  while (stage.phase === 'playing' || stage.phase === 'draft' || stage.phase === 'chest') {
    if (++inputs > RUN_END_TICK * 2) throw new Error(`Replay did not finish for ${profile}, seed ${seed}`);
    stepStage(stage, pilot(stage, ground), ground);
  }
  const clear = stage.phase === 'clear' || stage.phase === 'timeout';
  const seconds = stage.tick / TICKS_PER_SECOND;
  return {
    profile, seed, outcome: stage.phase, clear, ticks: stage.tick, seconds,
    // Boss victories have no observed death. Count survival through the common time horizon.
    survivalSeconds: clear ? RUN_END_TICK / TICKS_PER_SECOND : seconds,
    deathPhase: stage.phase === 'lost' ? phaseAt(seconds).id : null,
    hull: stage.hull, maxHull: stage.maxHull, hitsTaken: stage.hitsTaken, kills: stage.kills, levelUps: stage.level - 1,
    weapons: Object.fromEntries(WEAPON_IDS.filter(id => stage.run.weaponLevels[id]).map(id => [id, stage.run.weaponLevels[id]])),
    buffs: Object.fromEntries(BUFF_IDS.filter(id => stage.run.buffLevels[id]).map(id => [id, stage.run.buffLevels[id]])),
    evolutions: WEAPON_IDS.flatMap(id => stage.run.evolutions[id] ? [stage.run.evolutions[id]] : []),
    chests: stage.chests.opened, billsOffered: stage.bills.offered, billsPaid: stage.bills.paid,
    stateHash: createHash('sha256').update(JSON.stringify(stage)).digest('hex'),
  };
}

function percentile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function distribution(runs, key) {
  const sorted = runs.map(run => run[key]).sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p10: percentile(sorted, 0.1), p90: percentile(sorted, 0.9) };
}

function breakdown(runs, field, labels) {
  const counts = Object.fromEntries(labels.map(label => [label, 0]));
  for (const run of runs) {
    const label = run[field];
    if (label !== null) counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function summarize(profile, runs) {
  const samples = runs.length;
  const bossClears = runs.filter(run => run.outcome === 'clear').length;
  const timeouts = runs.filter(run => run.outcome === 'timeout').length;
  const billsOffered = runs.reduce((sum, run) => sum + run.billsOffered, 0);
  const billsPaid = runs.reduce((sum, run) => sum + run.billsPaid, 0);
  const weapons = {};
  const evolutions = {};
  for (const run of runs) for (const id of run.evolutions) evolutions[id] = (evolutions[id] ?? 0) + 1;
  for (const id of WEAPON_IDS) {
    let equippedRuns = 0, maxLevel = 0;
    for (const run of runs) {
      const level = run.weapons[id];
      if (!level) continue;
      equippedRuns++;
      maxLevel = Math.max(maxLevel, level);
    }
    if (equippedRuns) weapons[id] = { runs: equippedRuns, maxLevel };
  }
  return {
    profile, samples, clearRate: (bossClears + timeouts) / samples, bossClearRate: bossClears / samples,
    timeoutRate: timeouts / samples, deathRate: (samples - bossClears - timeouts) / samples,
    survival: distribution(runs, 'survivalSeconds'), duration: distribution(runs, 'seconds'),
    deathPhases: breakdown(runs, 'deathPhase', PHASES.map(phase => phase.id)),
    endHull: breakdown(runs, 'hull', []), medianEndHull: distribution(runs, 'hull').median,
    medianKills: distribution(runs, 'kills').median, medianLevelUps: distribution(runs, 'levelUps').median,
    weapons, evolutions, medianChests: distribution(runs, 'chests').median,
    billsPaidPct: billsOffered ? 100 * billsPaid / billsOffered : null,
  };
}

export function runBatch(args) {
  const world = new World();
  const ground = (x, z) => world.height(x, z);
  const profiles = args.profile === 'all' ? BOT_PROFILE_IDS : [args.profile];
  const runs = [];
  const summary = [];
  for (const profile of profiles) {
    const profileRuns = Array.from({ length: args.seeds }, (_, index) => runSortie(args, profile, args.from + index, ground));
    summary.push(summarize(profile, profileRuns));
    for (const run of profileRuns) runs.push(run);
  }
  return { ...args, swarmCap: args.mobile ? SWARM_CAPS.mobile : SWARM_CAPS.desktop,
    survivalHorizon: RUN_END_TICK / TICKS_PER_SECOND, profiles: summary, runs };
}

function csvCell(value) {
  const formatted = value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[,"\r\n]/.test(formatted) ? `"${formatted.replaceAll('"', '""')}"` : formatted;
}

export function serializeSummaryCsv(report) {
  const rows = report.profiles.map(({ survival, duration, ...row }) => ({
    ...row, swarmCap: report.swarmCap, heat: report.heat,
    medianSurvival: survival.median, p10Survival: survival.p10, p90Survival: survival.p90,
    medianDuration: duration.median, p10Duration: duration.p10, p90Duration: duration.p90,
  }));
  const keys = Object.keys(rows[0]);
  return [keys.join(','), ...rows.map(row => keys.map(key => csvCell(row[key])).join(',')), ''].join('\n');
}

function main(values) {
  if (values.length === 1 && (values[0] === '--help' || values[0] === '-h')) {
    console.log(USAGE);
    return;
  }
  const args = parseSimArgs(values);
  const report = runBatch(args);
  const percent = fraction => `${(fraction * 100).toFixed(1)}%`;
  console.table(report.profiles.map(row => ({
    profile: row.profile, seeds: row.samples, clear: percent(row.clearRate), boss: percent(row.bossClearRate),
    timeout: percent(row.timeoutRate), 'survival p10/50/90 s':
      [row.survival.p10, row.survival.median, row.survival.p90].map(value => value.toFixed(1)).join('/'),
    'run median s': row.duration.median.toFixed(1), 'end HP median': row.medianEndHull,
    'kills median': row.medianKills, 'level-ups median': row.medianLevelUps, 'Bills %': row.billsPaidPct ?? '–',
  })));
  const output = fileURLToPath(new URL('../sim-out', import.meta.url));
  mkdirSync(output, { recursive: true });
  const name = `${args.profile}-${args.seeds}-from-${args.from}-heat-${args.heat}-${args.mobile ? 'mobile' : 'desktop'}`;
  writeFileSync(resolve(output, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(output, `${name}.csv`), serializeSummaryCsv(report));
  console.log(`Reports: sim-out/${name}.{json,csv}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 1;
  }
}
