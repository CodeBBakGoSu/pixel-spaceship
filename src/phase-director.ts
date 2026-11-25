import { scaleTravel } from './data/speed.ts';
import { rngStream } from './stage-random.ts';
import { spawnWave } from './spawn-director.ts';
import { TICKS_PER_SECOND } from './simulation-time.ts';
import type { Ground, StageState } from './stage-types.ts';
import { WAVE_FLY_IN_TICKS } from './fly-in.ts';

const S = TICKS_PER_SECOND;
type Member = Parameters<typeof spawnWave>[1]['members'][number];
const intros = [
  { at: 70, kinds: ['twin-chaser'], members: [{ kind: 'twin-chaser', band: 1, bearing: 180, range: scaleTravel(104) }] },
  { at: 140, kinds: ['crosswing'], members: [{ kind: 'crosswing', band: 1, bearing: 0, range: scaleTravel(134) }] },
  { at: 260, kinds: ['manta'], members: [{ kind: 'manta', band: 2, bearing: 28, range: scaleTravel(160) }] },
  { at: 300, kinds: ['mender'], members: [
    { kind: 'aegis', band: 1, bearing: -20, range: scaleTravel(126) },
    { kind: 'mender', band: 1, bearing: 20, range: scaleTravel(126) },
  ] },
] as const;

function spawn(state: StageState, ground: Ground, id: string, members: Member[], leaveAt?: number,
  introKinds: readonly string[] = []): boolean {
  const before = state.nextId;
  spawnWave(state, { time: state.tick / S, members }, ground, rngStream(state.seed, `phase-director:${id}:${state.tick}`));
  const created = state.enemies.filter(enemy => enemy.id > before);
  const expected = members.length + members.filter(member => member.kind === 'crosswing').length;
  if (created.length !== expected) {
    state.enemies = state.enemies.filter(enemy => enemy.id <= before);
    return false;
  }
  for (const enemy of created) {
    enemy.maneuverAt = state.tick + WAVE_FLY_IN_TICKS + 60
      + (members.some(member => member.kind === 'crosswing') && enemy.kind === 'twin-chaser' ? 78 : 0);
    if (leaveAt !== undefined) enemy.leaveAt = leaveAt;
    if (introKinds.includes(enemy.kind)) enemy.directorIntro = true;
    if (enemy.kind === 'aegis') {
      enemy.elite = true;
      if (enemy.maxHp) enemy.hp = Math.max(1, enemy.maxHp - 1);
    }
  }
  return true;
}

function retireIntroEnemies(state: StageState): void {
  state.phaseDirector!.introIds = [];
  const retired = state.enemies.filter(enemy => enemy.directorIntro);
  if (!retired.length) return;
  const sources = new Set(retired.map(enemy => `regular:${enemy.id}`));
  state.enemies = state.enemies.filter(enemy => !enemy.directorIntro);
  if (state.threatBudget) {
    state.threatBudget.spends = state.threatBudget.spends.filter(spend =>
      !sources.has(spend.source) || (spend.tick < state.tick && (spend.activeUntilTick ?? spend.tick) > state.tick));
  }
}

export function advancePhaseDirector(state: StageState, ground: Ground): boolean {
  const director = state.phaseDirector ??= {
    intro: 0, six: false, seven: false, manta: false, isolationUntil: 0, introIds: [],
    sixTellUntil: 0, sixCrosswingStarted: false, sixTwinStarted: false,
  };
  state.enemies = state.enemies.filter(enemy => enemy.leaveAt === undefined || state.tick < enemy.leaveAt);
  if (state.tick >= 540 * S) {
    for (const enemy of state.enemies) enemy.hp = 0;
    return true;
  }
  if (state.tick >= 480 * S) {
    for (const enemy of state.enemies) {
      enemy.leaveAt = 540 * S;
      enemy.escortClearYaw ??= enemy.yaw + (enemy.id % 2 ? 1 : -1) * 0.65;
    }
    return true;
  }
  let spawned = false;
  if (director.intro < intros.length && state.tick >= intros[director.intro].at * S) {
    const event = intros[director.intro];
    retireIntroEnemies(state);
    const before = state.nextId;
    if (spawn(state, ground, `intro-${director.intro}`, [...event.members], undefined, event.kinds)) {
      director.intro++;
      director.isolationUntil = state.tick + WAVE_FLY_IN_TICKS + 15 * S;
      director.introIds = state.enemies.filter(enemy => enemy.id > before && enemy.directorIntro).map(enemy => enemy.id);
      spawned = true;
    }
  }
  if (!director.six && state.tick >= 360 * S) {
    retireIntroEnemies(state);
    director.six = spawn(state, ground, 'minute-six', [
      { kind: 'crosswing', band: 1, bearing: 0, range: scaleTravel(134) },
      { kind: 'twin-chaser', band: 0, bearing: 180, range: scaleTravel(114) },
    ], 400 * S - 1);
    director.sixTellUntil = 0;
    director.sixCrosswingStarted = false;
    director.sixTwinStarted = false;
    spawned ||= director.six;
  }
  if (!director.seven && state.tick >= 420 * S) {
    director.seven = spawn(state, ground, 'minute-seven', [
      { kind: 'aegis', band: 1, bearing: -24, range: scaleTravel(126) },
      { kind: 'mender', band: 1, bearing: 24, range: scaleTravel(126) },
    ], 465 * S);
    spawned ||= director.seven;
  }
  if (director.seven && !director.manta) {
    const aegis = state.enemies.find(enemy => enemy.kind === 'aegis' && enemy.hp > 0 && enemy.leaveAt === 465 * S);
    if (!aegis || state.tick >= 465 * S) {
      if (aegis) aegis.hp = 0;
      director.manta = spawn(state, ground, 'frontline-collapse', [
        { kind: 'manta', band: 2, bearing: 30, range: scaleTravel(160) },
      ], 480 * S - 1);
      spawned ||= director.manta;
    }
  }
  if (spawned) return true;
  return spawned || state.tick < director.isolationUntil;
}

export function createPhaseDirectorAtTick(tick: number): NonNullable<StageState['phaseDirector']> {
  return {
    intro: intros.filter(event => event.at * S <= tick).length,
    six: tick > 360 * S,
    seven: tick >= 420 * S,
    manta: tick >= 465 * S,
    isolationUntil: 0,
    introIds: [],
    sixTellUntil: 0,
    sixCrosswingStarted: false,
    sixTwinStarted: false,
  };
}
