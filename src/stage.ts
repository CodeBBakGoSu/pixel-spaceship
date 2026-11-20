import { advanceBank, boostAirspeed, BOOST_TURN_RATE, CRUISE_SPEED, TURN_RATE } from './flight.ts';
import { planFlyIn, sampleFlyIn, WAVE_FLY_IN_TICKS } from './fly-in.ts';
import { advanceManeuver, BODY_GRACE_TICKS, canManeuver, exitAltitude, MANEUVERS,
  maneuverAllowsControl, TRAIL_SAMPLE_TICKS, turnExitBurst } from './maneuvers.ts';
import { ENEMY_KINDS, isNewEnemyKind, type NewEnemyKind } from './enemy-kinds.ts';
import { addBomberEscort, advanceEnemies, makeEnemy, warnHarrier } from './stage-enemies.ts';
import { advancePhaseSpawns, relocateStragglers, spawnWave, trimEscorts, WAVES } from './spawn-director.ts';
import { random, rngStream } from './stage-random.ts';
import { RUN_BOSS_SECONDS, RUN_END_SECONDS, SWARM_CAPS } from './data/phases.ts';
import { BILL_CREDIT_BONUS, CARRIER_REPAIR_HULL, LEGACY_BOSS_SECONDS, LEGACY_END_SECONDS, PICKUP_LIMIT,
  REGULAR_SALVAGE_MULTIPLIER, RUN_BEACON_LEAD_SECONDS, SURVIVOR_START_HULL, SURVIVOR_XP_SCALE, WEAPON_FX_LIMIT } from './data/run-balance.ts';
import { HEAT_TIERS } from './data/meta.ts';
import { BUFFS, CHESTS, DRAFT_RULES } from './data/items.ts';
import { billXpScale, createBillState, finishBillTick, noteBillKill, noteBillPickup, startBillTick } from './bills.ts';
import { advanceChestSpawns, collectChest, createChestState, dropCarrierChest, rollChestRewards } from './chests.ts';
import { buffTuning } from './loadout.ts';
import { aceRank, createRunMetrics, draftPool, hangarLoadout, normalizeHeat, normalizeProfile, settleRun } from './meta.ts';
import { applyRunPick, availableEvolutions, banishRunCard, createProgression, evolveWeapon, openRunDraft,
  rerollRunDraft, rollBonusUpgrade, runXpCost, skipRunDraft, updateRunSlots, type DraftCard } from './progression.ts';
import { advanceRangedWeapons } from './ranged-weapons.ts';
import { advanceSupportWeapons } from './support-weapons.ts';
import { advancePhasePacing, noteSortieKill } from './sortie-pacing.ts';
import { firePacedWarden, makePacedWarden, pacedExposureTick, positionPacedWeakPoints } from './warden.ts';
import { ARENA, BEACON_SIGNAL_SECONDS, isLandmarkId, keepInsideArena, LANDMARKS, RIM_PUSH, RIM_WARNING } from './reach.ts';
import {
  acquireAndFire, advanceAutoOrdnance, advanceEnemyHazards, advanceFlares, advanceRearBombs, advanceShots, angleTo, BANDS,
  bombCapacity, clamp, dropFlares, dropRearBomb, fireHostile, flareCapacity, HIT_WINDOW, hurtPlayer, inBand,
  MAX_ALTITUDE, MAX_BOMBS, MAX_FLARES, MIN_ALTITUDE,
  openReversal, REAR_GLIMPSE_TICKS, STEP, TICKS_PER_SECOND, VERTICAL_SPEED, WIPE_DURATION,
} from './stage-combat.ts';
import type { Band, Boss, ChestReward, DraftId, Ground, Maneuver, ManeuverKind, Outcome,
  StageInput, StageOptions, StageState } from './stage-types.ts';

export { activeWeakPoint } from './stage-combat.ts';
export const END_TICK = LEGACY_END_SECONDS * TICKS_PER_SECOND;
export const BOSS_TICK = LEGACY_BOSS_SECONDS * TICKS_PER_SECOND;
export const RUN_BOSS_TICK = RUN_BOSS_SECONDS * TICKS_PER_SECOND;
export const RUN_END_TICK = RUN_END_SECONDS * TICKS_PER_SECOND;
export const bossTick = (state: Pick<StageState, 'run'>): number => state.run ? RUN_BOSS_TICK : BOSS_TICK;
export const endTick = (state: Pick<StageState, 'run'>): number => state.run ? RUN_END_TICK : END_TICK;
export const beaconTick = (state: Pick<StageState, 'run'>): number =>
  state.run ? RUN_BOSS_TICK - RUN_BEACON_LEAD_SECONDS * TICKS_PER_SECOND : BEACON_SIGNAL_SECONDS * TICKS_PER_SECOND;
const BOSS_SIGNAL = 3 * TICKS_PER_SECOND;
const BOSS_FLY_IN_TICKS = 2 * TICKS_PER_SECOND;
const BOSS_ORBIT_PER_TICK = 0.010;
const VIEWS = ['overhead', 'chase', 'cockpit'] as const;
const seaLevel: Ground = () => 35;

export function parseStageOptions(search: string): StageOptions {
  const q = new URLSearchParams(search);
  const v = q.get('view');
  const fixture = q.get('fixture');
  const mode = q.get('mode');
  const seed = q.get('seed') ?? '';
  const time = q.has('t') ? Number(q.get('t')) : NaN;
  return {
    seed: /^-?\d+$/.test(seed) && Number.isSafeInteger(Number(seed)) ? Number(seed) >>> 0 : 1,
    view: v === 'top' ? 'overhead' : v === 'overhead' || v === 'chase' || v === 'cockpit' ? v : null,
    fixture: fixture === 'stack' || fixture === 'draft' || fixture === 'boss' || fixture === 'pursuit' || fixture === 'flare'
      || fixture === 'reversal' || fixture === 'flyby' || fixture === 'rear-threat' || fixture === 'strafe'
      || isLandmarkId(fixture) || isNewEnemyKind(fixture) ? fixture : null,
    time: Number.isFinite(time) ? clamp(time, 0, mode === 'survivors' ? RUN_END_SECONDS : LEGACY_END_SECONDS) : null,
    autoplay: q.get('autoplay') === '1',
    touch: q.get('touch') === '1',
    ...(mode === 'survivors' || mode === 'legacy' ? { mode } : {}),
  };
}

function makeBoss(state: StageState, x: number, z: number): Boss {
  const roll = state.run ? rngStream(state.seed, 'warden') : state;
  const high = BANDS[2] + (random(roll) - 0.5) * 11;
  const low = BANDS[0] + (random(roll) - 0.5) * 11;
  const core = BANDS[1] + (random(roll) < 0.5 ? -1 : 1) * (4.5 + random(roll) * 1.5);
  return {
    x, z, alt: BANDS[1], orbitAngle: state.seed * 1.79, orbitStartTick: state.tick, index: 0, changedTick: state.tick, exposeTick: state.tick + BOSS_SIGNAL,
    shotAt: state.tick + BOSS_SIGNAL + 90,
    weakPoints: [
      { id: ++state.nextId, kind: 'pod', band: 2, x, z, alt: high, hp: 10, maxHp: 10, hits: 0, window: 8, vx: 0, vz: 0 },
      { id: ++state.nextId, kind: 'pod', band: 0, x, z, alt: low, hp: 10, maxHp: 10, hits: 0, window: 8, vx: 0, vz: 0 },
      { id: ++state.nextId, kind: 'core', band: 1, x, z, alt: core, hp: 8, maxHp: 8, hits: 0, window: 3, vx: 0, vz: 0 },
    ],
  };
}

function positionWeakPoints(boss: Boss, tick: number): void {
  const travel = Math.max(0, tick - boss.orbitStartTick) * BOSS_ORBIT_PER_TICK;
  const speed = tick < boss.orbitStartTick ? 0 : BOSS_ORBIT_PER_TICK * TICKS_PER_SECOND;
  for (const [index, point] of boss.weakPoints.entries()) {
    // A rotating gantry carries the exposed hardware, with altitude fixed for each seeded part.
    const radius = point.kind === 'core' ? 17 : 41;
    const angle = boss.orbitAngle + travel + [0, Math.PI, 0.8][index];
    const sin = Math.sin(angle), cos = Math.cos(angle);
    point.x = boss.x + radius * sin;
    point.z = boss.z + radius * cos;
    point.vx = radius * speed * cos;
    point.vz = -radius * speed * sin;
  }
}

function updateBoss(state: StageState, ground: Ground): void {
  const boss = state.boss;
  if (!boss) return;
  if (boss.entry) {
    const { x, z, alt } = sampleFlyIn(boss.entry, state.tick, ground);
    for (const point of boss.weakPoints) point.alt += alt - boss.alt;
    Object.assign(boss, { x, z, alt });
    if (state.tick >= boss.entry.arriveAt) delete boss.entry;
  }
  if (boss.paced) {
    positionPacedWeakPoints(boss, state.heat, state.tick);
    firePacedWarden(state, boss);
    return;
  }
  positionWeakPoints(boss, state.tick);
  const point = boss.weakPoints[boss.index];
  if (!boss.entry && state.tick >= boss.shotAt && point?.hp) {
    for (const spread of [-0.21, 0, 0.21]) fireHostile(state, point, 68, spread);
    boss.shotAt = state.tick + 255;
  }
}

function advanceWeakPoint(state: StageState): boolean {
  const boss = state.boss;
  if (!boss || boss.weakPoints[boss.index].hp > 0) return false;
  const next = boss.weakPoints.findIndex(point => point.hp > 0);
  if (next === -1) return true;
  boss.index = next;
  boss.changedTick = state.tick;
  boss.exposeTick = boss.paced ? pacedExposureTick(boss, state.heat, next, state.tick) : state.tick + BOSS_SIGNAL;
  if (!boss.paced) boss.shotAt = boss.exposeTick + 90;
  state.lock = null;
  return false;
}

export function requiredXp(level: number, survivor = false): number | null {
  return survivor ? runXpCost(level) : level === 1 ? 6 : level === 2 ? 10 : null;
}

function openDraft(state: StageState, pending: Outcome | null): void {
  if (state.run) {
    refreshDraftPool(state);
    state.draft = openRunDraft(state.run, state.hull > DRAFT_RULES.riskHull).map(card => card.id);
  } else {
    const nextTwin: DraftId = state.twinRank === 1 ? 'twin-2' : 'twin-3';
    const choices: DraftId[] = [nextTwin];
    if (state.podRank === 1) choices.push('pods-2');
    if (state.twinDamage === 1) choices.push('twin-damage');
    if (state.podDamage === 1) choices.push('pods-damage');
    state.draft = choices.slice(0, 3);
  }
  state.phase = 'draft';
  state.resultPending = pending;
  state.boostRelease = true;
  state.boosting = false;
}

function finishDraft(state: StageState, id?: DraftId): void {
  const cost = requiredXp(state.level, !!state.run);
  if (cost === null) return;
  // A skip trades the card for keeping the XP toward the next level.
  if (id) state.xp -= cost;
  state.level++;
  if (id) state.picks.push(id);
  state.draft = [];
  state.graceUntil = state.tick + 18;
  resumePlay(state);
}

function resumePlay(state: StageState): void {
  const pending = state.resultPending;
  const nextCost = requiredXp(state.level, !!state.run);
  if (nextCost !== null && state.xp >= nextCost) {
    openDraft(state, pending);
  } else {
    state.resultPending = null;
    if (pending) finish(state, pending);
    else state.phase = 'playing';
  }
}

export function chestEvolutions(state: StageState) {
  return state.run && CHESTS.some(chest => chest.id === state.chests.offer && chest.kind === 'evolution')
    ? availableEvolutions(state.run) : [];
}

export function grantBonusUpgrade(state: StageState, rng: { rng: number }): ChestReward | null {
  if (!state.run) return null;
  refreshDraftPool(state);
  const card = rollBonusUpgrade(state.run, rng);
  applyGearEffects(state, card);
  return { kind: 'upgrade', id: card.id, ...(card.maxLevel && card.nextLevel > card.currentLevel ? { level: card.nextLevel } : {}) };
}

function refreshDraftPool(state: StageState): void {
  if (state.run && !state.daily) Object.assign(state.run, draftPool(state.profile, state.metrics));
}

function resolveChest(state: StageState, choice: NonNullable<StageInput['chestPick']>): void {
  const { offer } = state.chests;
  if (!state.run) return;
  if (state.chestReveal) {
    if (choice === 'continue') {
      if (offer) state.chests.opened++;
      state.chests.offer = null;
      state.chestReveal = null;
      state.graceUntil = state.tick + 18;
      resumePlay(state);
    }
    return;
  }
  if (!offer || choice === 'continue') return;
  const candidates = chestEvolutions(state);
  if (candidates.length ? choice === 'open' || !candidates.includes(choice) : choice !== 'open') return;
  const evolved = choice === 'open' ? null : evolveWeapon(state.run, choice);
  const reward: ChestReward[] = evolved ? [{ kind: 'evolution', id: evolved }] : [];
  const upgrades = rollChestRewards(state, offer, !!evolved);
  for (let i = 0; i < upgrades; i++) {
    const upgrade = grantBonusUpgrade(state, state.streams.chest);
    if (upgrade) reward.push(upgrade);
  }
  state.chestReveal = reward;
}

function selectDraft(state: StageState, id: DraftId): void {
  if (!state.draft.includes(id)) return;
  const run = state.run;
  if (run) {
    const card = run.cards.find(card => card.id === id);
    if (!card || !applyRunPick(run, card.id)) return;
    applyGearEffects(state, card);
  } else {
    if (id === 'twin-2') state.twinRank = 2;
    if (id === 'twin-3') state.twinRank = 3;
    if (id === 'pods-2') state.podRank = 2;
    if (id === 'twin-damage') state.twinDamage = 2;
    if (id === 'pods-damage') state.podDamage = 2;
  }
  finishDraft(state, id);
}

function applyGearEffects(state: StageState, card: DraftCard): void {
  const run = state.run!;
  if (card.id === 'repair') state.hull = Math.min(state.maxHull, state.hull + DRAFT_RULES.repairHull);
  if (card.variant === 'risky') state.hull -= DRAFT_RULES.riskHull;
  adjustBuffStores(state, card);
  state.twinRank = (run.weaponLevels.twin ?? 1) >= 3 ? 3 : run.weaponLevels.twin === 2 ? 2 : 1;
  state.podRank = (run.weaponLevels.pods ?? 0) >= 2 ? 2 : 1;
}

function adjustBuffStores(state: StageState, card: DraftCard): void {
  const added = card.nextLevel - card.currentLevel;
  if (card.id === 'hull-plating') {
    const before = BUFFS['hull-plating'].levels[card.currentLevel - 1]?.maxHull ?? 0;
    const after = BUFFS['hull-plating'].levels[card.nextLevel - 1].maxHull;
    state.maxHull += after - before;
    state.hull = Math.min(state.maxHull, state.hull + added);
  } else if (card.id === 'flare-bay') {
    state.flareCharges = Math.min(flareCapacity(state), state.flareCharges + added);
    if (state.flareReloadAt !== null) {
      const before = BUFFS['flare-bay'].levels[card.currentLevel - 1]?.reloadScale ?? 1;
      const after = BUFFS['flare-bay'].levels[card.nextLevel - 1].reloadScale;
      state.flareReloadAt = state.tick + Math.round((state.flareReloadAt - state.tick) * after / before);
    }
  } else if (card.id === 'ordnance-rack') {
    state.bombs = Math.min(bombCapacity(state), state.bombs + added);
    if (state.bombReloadAt !== null) {
      const before = BUFFS['ordnance-rack'].levels[card.currentLevel - 1]?.reloadScale ?? 1;
      const after = BUFFS['ordnance-rack'].levels[card.nextLevel - 1].reloadScale;
      state.bombReloadAt = state.tick + Math.round((state.bombReloadAt - state.tick) * after / before);
    }
  }
}

const fixtureBands: Record<NewEnemyKind, Band> = {
  skimmer: 0, spotter: 2, hound: 1, flanker: 2, harrier: 1, diver: 2, bomber: 1, turret: 1,
};

function applyFixture(state: StageState, fixture: StageOptions['fixture'], ground: Ground): void {
  if (!fixture) return;
  const landmark = isLandmarkId(fixture) ? LANDMARKS[fixture] : null;
  const seconds = landmark ? BEACON_SIGNAL_SECONDS : fixture === 'draft' ? 45 : fixture === 'boss' ? 108 : 30;
  state.tick = seconds * TICKS_PER_SECOND;
  state.nextWave = WAVES.findIndex(wave => wave.time > seconds);
  if (landmark) {
    Object.assign(state.player, { x: landmark.x, z: landmark.z - 70, altitude: landmark.alt });
  } else if (isNewEnemyKind(fixture)) {
    state.nextWave = WAVES.length;
    const p = state.player;
    if (fixture === 'skimmer') Object.assign(p, { x: LANDMARKS.strait.x, z: LANDMARKS.strait.z - 48 });
    if (fixture === 'turret') Object.assign(p, { x: LANDMARKS.ridge.x - 18, z: LANDMARKS.ridge.z - 65, altitude: 130 });
    const x = fixture === 'turret' ? LANDMARKS.ridge.x : p.x + (fixture === 'hound' ? 0 : 12);
    const z = p.z + (fixture === 'spotter' ? 90 : fixture === 'turret' ? 65 : 62);
    const enemy = makeEnemy(state, x, z, fixtureBands[fixture], fixture);
    if (fixture === 'turret') enemy.alt = ground(x, z) + 5;
    state.enemies.push(enemy);
    if (fixture === 'bomber') addBomberEscort(state, enemy, ground);
  } else if (fixture === 'stack') {
    for (const band of [0, 1, 2] as const) {
      state.enemies.push(makeEnemy(state, state.player.x, state.player.z + 60, band));
    }
  } else if (fixture === 'pursuit') {
    const p = state.player;
    for (const [band, lateral, aft] of [[0, -10, 73], [1, -5, 66], [1, 5, 74], [2, 8, 81]] as const) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, band);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
  } else if (fixture === 'flare') {
    const p = state.player;
    state.nextWave = WAVES.length;
    // Start the review on a reload so both close contacts are available for a manual drop.
    state.podsAt = state.tick + 150;
    for (const [band, lateral, aft, kind] of [
      [1, -6, 22, 'hound'], [1, 7, 29, 'hound'], [0, 52, 80, 'patrol'], [2, 10, 40, 'patrol'],
    ] as const) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, band, kind);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
  } else if (fixture === 'reversal') {
    const p = state.player;
    state.nextWave = WAVES.length;
    for (const [lateral, aft] of [[-18, 72], [-8, 76], [2, 82], [10, 88], [20, 94], [30, 100]]) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, 2);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
    state.enemies.push(makeEnemy(state, p.x - 15, p.z - 101, 0));
  } else if (fixture === 'flyby') {
    const p = state.player;
    p.z -= 48;
    p.altitude = BANDS[2] - 11;
    state.nextWave = WAVES.length;
    for (const [lateral, aft, band, kind] of [[-26, 53, 2, 'interceptor'], [31, 64, 1, 'patrol']] as const) {
      const enemy = makeEnemy(state, p.x + lateral, p.z - aft, band, kind);
      enemy.yaw = p.yaw;
      state.enemies.push(enemy);
    }
  } else if (fixture === 'rear-threat') {
    const p = state.player;
    state.speed = CRUISE_SPEED;
    state.nextWave = WAVES.length;
    state.enemies.push(makeEnemy(state, p.x - 17, p.z - 62, 2), makeEnemy(state, p.x + 16, p.z - 74, 0));
    fireHostile(state, { x: p.x, z: p.z - 48, alt: p.altitude }, 78);
  } else if (fixture === 'strafe') {
    const p = state.player;
    p.altitude = BANDS[2];
    state.nextWave = WAVES.length;
    state.enemies.push(
      makeEnemy(state, p.x + 8, p.z + 89, 1),
      makeEnemy(state, p.x - 60, p.z + 99, 1),
      makeEnemy(state, p.x - 18, p.z + 83, 0),
    );
  } else if (fixture === 'draft') {
    state.xp = state.salvage = requiredXp(1, !!state.run)!;
    state.salvageBands[1] = state.xp;
    openDraft(state, null);
  } else {
    // Keep the fixture clear for a reproducible approach to the first weak point.
    state.boss = makeBoss(state, state.player.x, state.player.z + 109);
    state.boss.orbitAngle = Math.PI;
    state.boss.orbitStartTick = state.tick + 4 * TICKS_PER_SECOND;
    positionWeakPoints(state.boss, state.tick);
    state.boss.changedTick = BOSS_TICK;
    state.boss.exposeTick = state.tick;
    state.boss.shotAt = state.tick + 90;
  }
}

export function createStage(options: StageOptions = parseStageOptions(''), ground: Ground = seaLevel): StageState {
  const x = ARENA.x, z = ARENA.z - 85;
  const survivor = options.mode === 'survivors';
  const profile = normalizeProfile(options.profile), daily = survivor && !!options.daily;
  const hangar = hangarLoadout(profile, daily);
  const rank = options.aceRank ?? aceRank(profile);
  const run = survivor ? createProgression(options.seed, {
    ...draftPool(daily ? normalizeProfile(null) : profile),
    rank, rerolls: hangar.rerolls, banishes: hangar.banishes, skips: hangar.skips,
  }) : null;
  if (daily && run) run.weaponSlots = run.buffSlots = DRAFT_RULES.maxSlots;
  const hull = survivor ? SURVIVOR_START_HULL + hangar.hull : 8;
  const state: StageState = {
    phase: options.fixture || options.autoplay || options.time !== null ? 'playing' : 'title',
    paused: false, resultPending: null, seed: options.seed, rng: options.seed, nextId: 0, nextVolley: 0, tick: 0, nextWave: 0,
    run, profile, daily, hangar, metrics: createRunMetrics(), killBandTicks: [-1, -1, -1],
    ejectorUsed: false, summary: null, phaseNotice: null, bills: createBillState(), lastHitTick: -1,
    chests: createChestState(), chestReveal: null,
    swarmCap: (options.mobile ?? options.touch) ? SWARM_CAPS.mobile : SWARM_CAPS.desktop,
    aceRank: rank,
    heat: daily ? 0 : normalizeHeat(options.heat),
    weaponFireAt: {}, railChargeAt: null, seekerEchoAt: -1, weaponFx: [], ionWake: [], orbitDrones: [], nextBayDrop: null,
    streams: { spawn: rngStream(options.seed, 'spawn'), chest: rngStream(options.seed, 'chest'),
      bills: rngStream(options.seed, 'bills'), combat: rngStream(options.seed, 'combat') },
    view: options.view ?? (options.fixture === 'pursuit' || options.fixture === 'flare' ? 'chase' : 'overhead'), initialView: options.view, wipe: 0, viewTag: 0,
    arena: { ...ARENA }, boundaryWarning: false,
    player: { x, z, altitude: Math.max(BANDS[1], ground(x, z) + 22), yaw: 0, bank: 0 },
    speed: 0, climbRate: 0, hull, maxHull: hull, hitsTaken: 0, rank: null, invulnerability: 0,
    boost: 1, boosting: false, boostTicks: 0, bombs: MAX_BOMBS, bombReadyAt: 0, bombReloadAt: null, rearBombs: [], enemyMines: [],
    flares: [], flareCharges: MAX_FLARES, flareReadyAt: 0, flareReloadAt: null, flareHit: null, rearGlimpse: null,
    maneuver: null, maneuverTrail: null, maneuverReadyAt: 0, bodyGraceUntil: 0, reversal: null,
    xp: 0, xpRemainder: 0, level: 1, kills: 0, salvage: 0, salvageBands: [0, 0, 0],
    draft: [], picks: [], graceUntil: 0, boostRelease: false, twinRank: 1, podRank: 1, twinDamage: 1, podDamage: 1,
    twinAt: 0, strafeAt: 0, podsAt: 0, score: 0, enemies: [], pickups: [], shots: [], effects: [], boss: null, lock: null,
    wrongLayer: null, altitudeHint: null,
  };
  applyFixture(state, options.fixture, ground);
  return state;
}

function finish(state: StageState, outcome: Outcome): void {
  state.phase = outcome;
  state.boosting = false;
  const hits = state.hitsTaken;
  state.rank = hits === 0 ? 'S' : hits <= 2 ? 'A' : hits === 3 ? 'B' : 'C';
  if (outcome === 'clear') state.score += 2500;
  if (state.run && !state.summary) {
    const settlement = settleRun(state.profile, state.metrics, {
      outcome, score: state.score, credits: state.run.credits, heat: state.heat,
    });
    state.summary = { seconds: state.tick / TICKS_PER_SECOND, wardenCache: outcome === 'clear',
      credits: state.daily ? 0 : settlement.credits, unlocked: state.daily ? [] : settlement.unlocked };
    if (!state.daily) state.profile = settlement.profile;
  }
}

function startManeuver(state: StageState, kind: ManeuverKind, turn: number): void {
  if (state.run) state.metrics.maneuvers++;
  const p = state.player, spec = MANEUVERS[kind];
  const maneuver: Maneuver = {
    kind, elapsed: 0, yaw: p.yaw,
    altitude: p.altitude, exitAltitude: exitAltitude(p.altitude, kind), side: turn < 0 ? -1 : 1,
  };
  state.maneuver = maneuver;
  const trail = state.maneuverTrail = {
    kind, startTick: state.tick, yaw: p.yaw, side: maneuver.side, exitAltitude: maneuver.exitAltitude,
    limited: (kind === 'immelmann' || kind === 'split-s') && maneuver.exitAltitude === p.altitude,
    points: [{ x: p.x, z: p.z, alt: p.altitude }], pursuers: [] as number[],
  };
  state.boost -= spec.boost;
  state.boostRelease = true;
  state.lock = state.wrongLayer = state.altitudeHint = null;

  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const until = state.tick + (kind === 'immelmann' || kind === 'split-s' ? spec.flipTick : spec.ticks) + 30;
  for (const enemy of state.enemies) {
    if (enemy.entry || enemy.kind === 'gnat') continue;
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const aft = -dx * fx - dz * fz, lateral = dx * fz - dz * fx;
    if (enemy.hp && enemy.kind !== 'turret' && aft > 3 && Math.hypot(dx, dz) <= 190) trail.pursuers.push(enemy.id);
    warnHarrier(state, enemy, maneuver, aft, lateral);
    if (enemy.kind === 'turret' || enemy.kind === 'skimmer' || enemy.maneuver || !inBand(enemy.alt, maneuver.exitAltitude)) continue;
    if (aft <= 0 || Math.abs(lateral) > aft * Math.tan(25 * Math.PI / 180)) continue;
    if (aft >= 34 && aft <= 140) {
      const lane = clamp(lateral + (enemy.id % 3 - 1) * 3, -28, 28);
      enemy.course = { target: { x: p.x - fx * 64 + fz * lane, z: p.z - fz * 64 - fx * lane },
        speed: enemy.kind === 'interceptor' ? 40 : 32, until };
    }
    if (enemy.course) {
      keepInsideArena(enemy.course.target, state.arena);
      enemy.maneuverAt = Math.max(enemy.maneuverAt, until);
    }
  }
}

function reverseHeading(state: StageState, entryYaw: number): void {
  const p = state.player, fx = Math.sin(entryYaw), fz = Math.cos(entryYaw);
  p.yaw = Math.atan2(-fx, -fz);
  for (const enemy of state.enemies) {
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    if (dx * fx + dz * fz < 0 && Math.hypot(dx, dz) <= 160) enemy.shotAt = Math.max(enemy.shotAt, state.tick + 25);
  }
}

function fly(state: StageState, input: StageInput, ground: Ground, grace: boolean, controlled: boolean): void {
  const p = state.player, a = state.arena, maneuver = state.maneuver;
  if (!input.boost) state.boostRelease = false;
  const boostHeld = controlled && !grace && !!input.boost && !state.boostRelease;
  const priorBoost = state.boosting;
  const agility = buffTuning(state, 'vector-thrusters')?.agilityScale ?? 1;
  state.boosting = boostHeld && state.boost > 0;
  state.boostTicks = state.boosting ? (priorBoost ? state.boostTicks + 1 : 1) : 0;
  if (maneuver?.kind !== 'j-turn') state.boost = clamp(state.boost + (boostHeld ? -0.5 : 0.35 * agility) * STEP, 0, 1);
  let altitude: number;
  if (maneuver && !controlled) {
    const motion = advanceManeuver(maneuver);
    state.speed = motion.speed;
    p.bank = 0;
    const fx = Math.sin(maneuver.yaw), fz = Math.cos(maneuver.yaw);
    p.x += fx * motion.distance + fz * motion.slide;
    p.z += fz * motion.distance - fx * motion.slide;
    altitude = motion.altitude;
    if (motion.reverse) {
      reverseHeading(state, maneuver.yaw);
      state.maneuverReadyAt = state.tick + MANEUVERS[maneuver.kind].cooldown;
      if (maneuver.kind !== 'j-turn' && state.maneuverTrail) openReversal(state, state.maneuverTrail.pursuers);
    }
  } else {
    if (maneuver) maneuver.elapsed++;
    const turn = clamp(input.turn ?? 0, -1, 1);
    p.bank = advanceBank(p.bank, turn, STEP);
    const yaw = p.yaw + turn * (state.boosting ? BOOST_TURN_RATE : TURN_RATE) * agility * STEP;
    p.yaw = angleTo(0, Math.sin(yaw), Math.cos(yaw));
    const thrust = state.boosting ? boostAirspeed(state.boostTicks) : CRUISE_SPEED * (1 + turnExitBurst(state));
    state.speed = thrust * (1 - Math.abs(turn) * 0.25);
    p.x += Math.sin(p.yaw) * state.speed * STEP;
    p.z += Math.cos(p.yaw) * state.speed * STEP;
    altitude = p.altitude + clamp(input.climb ?? 0, -1, 1) * VERTICAL_SPEED * agility * STEP;
  }
  const dx = p.x - a.x, dz = p.z - a.z;
  const distance = Math.hypot(dx, dz);
  state.boundaryWarning = distance > a.radius - RIM_WARNING;
  if (distance > a.radius - RIM_PUSH) {
    const inward = maneuver?.kind === 'j-turn' ? 0 : Math.min(96, (distance - a.radius + RIM_PUSH) * 2.2) * STEP;
    const bound = Math.min(a.radius, distance - inward);
    p.x = a.x + dx * bound / distance;
    p.z = a.z + dz * bound / distance;
  }
  const prior = p.altitude;
  p.altitude = clamp(altitude, Math.max(MIN_ALTITUDE, ground(p.x, p.z) + 22), MAX_ALTITUDE);
  state.climbRate = (p.altitude - prior) / STEP;
}

function mergeSalvage(state: StageState): void {
  const pickups = state.pickups;
  while (pickups.length > PICKUP_LIMIT) {
    const added = pickups.pop()!;
    let closest = pickups[0], distance = Infinity;
    for (const pickup of pickups) {
      const range = (added.x - pickup.x) ** 2 + (added.z - pickup.z) ** 2
        + (added.alt - pickup.alt) ** 2 * 400;
      if (range < distance) {
        closest = pickup;
        distance = range;
      }
    }
    closest.xp += added.xp;
    closest.born = Math.max(closest.born, added.born);
  }
}

function advanceSalvage(state: StageState, ground: Ground): void {
  const p = state.player;
  for (const enemy of state.enemies) {
    if (!enemy.shotDown) continue;
    const chest = enemy.carrier && CHESTS.find(chest => chest.id === enemy.carrier);
    const xp = chest ? chest.carrierXp : ENEMY_KINDS[enemy.kind].xp * (state.run && enemy.kind !== 'gnat' ? REGULAR_SALVAGE_MULTIPLIER : 1);
    if (chest) dropCarrierChest(state, enemy, ground);
    noteSortieKill(state, enemy);
    if (state.run) noteBillKill(state, enemy);
    state.kills++;
    state.score += xp * 100;
    state.pickups.push({ id: ++state.nextId, x: enemy.x, z: enemy.z,
      alt: enemy.kind === 'turret' ? Math.max(BANDS[0], ground(enemy.x, enemy.z) + 22) : enemy.alt,
      xp, born: state.tick, reversal: enemy.reversalKill });
    state.effects.push({ kind: 'burst', x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.42 });
  }
  if (state.run) mergeSalvage(state);
  state.enemies = state.enemies.filter(enemy => enemy.hp > 0);
  const horizontalSpeed = Math.hypot(p.vx ?? 0, p.vz ?? 0);
  const magnet = buffTuning(state, 'magnet-core');
  const beacon = buffTuning(state, 'salvage-beacon');
  const magnetScale = state.run ? state.hangar.magnetScale * HEAT_TIERS[state.heat].magnetScale : 1;
  const xpScale = state.run ? SURVIVOR_XP_SCALE * billXpScale(state) * state.hangar.xpScale : 1;
  state.pickups = state.pickups.filter(pickup => {
    if (state.tick - pickup.born >= 60 * TICKS_PER_SECOND) return false;
    if (!pickup.collected && !inBand(p.altitude, pickup.alt, HIT_WINDOW + (magnet?.extraWindow ?? 0))) {
      pickup.pulling = false;
      return true;
    }
    const dx = p.x - pickup.x, dz = p.z - pickup.z;
    const range = Math.hypot(dx, dz);
    if (!pickup.collected && range > 8 && (pickup.pulling || range <= 42 * (magnet?.radiusScale ?? 1) * magnetScale)) {
      const speed = Math.min(155, horizontalSpeed + (pickup.reversal ? 75 : 45));
      const pull = Math.min(range, speed * STEP) / range;
      const x = pickup.x + dx * pull, z = pickup.z + dz * pull;
      pickup.pulling = true;
      if (ground(x, z) < pickup.alt && ground((pickup.x + x) / 2, (pickup.z + z) / 2) < pickup.alt) {
        pickup.x = x;
        pickup.z = z;
      }
    }
    if (pickup.collected || Math.hypot(p.x - pickup.x, p.z - pickup.z) <= 8) {
      const adjusted = pickup.xp * (beacon?.xpScale ?? 1) * xpScale + state.xpRemainder;
      const whole = Math.floor(adjusted + 1e-9);
      state.xp += whole;
      state.xpRemainder = Math.max(0, adjusted - whole);
      state.salvage += pickup.xp;
      if (state.run) {
        state.run.credits += pickup.xp * (beacon?.creditScale ?? 1);
        state.metrics.orbs++;
        noteBillPickup(state, pickup);
      }
      const band = pickup.alt < 92.5 ? 0 : pickup.alt > 127.5 ? 2 : 1;
      state.salvageBands[band] += pickup.xp;
      return false;
    }
    return true;
  });
}

function applyBillReward(state: StageState): void {
  const event = finishBillTick(state);
  const run = state.run;
  if (!event?.paid || !run) return;
  const { repair, rerolls, upgrades, chestPicks } = event.definition.reward;
  if (repair) state.hull = repair === 'full' ? state.maxHull : Math.min(state.maxHull, state.hull + repair);
  if (rerolls) run.rerolls = Math.min(DRAFT_RULES.maxRerolls, run.rerolls + rerolls);
  run.credits += BILL_CREDIT_BONUS;
  if (upgrades || chestPicks) {
    const cards = Array.from({ length: upgrades ?? chestPicks ?? 0 }, () => grantBonusUpgrade(state, state.streams.bills));
    state.chestReveal = cards.filter((card): card is ChestReward => card !== null);
  }
}

/** Advance exactly one 60 Hz tick. A modal consumes input without ticking the sortie. */
export function stepStage(state: StageState, input: StageInput = {}, ground: Ground = seaLevel): void {
  if (state.phase === 'chest') {
    if (input.chestPick) resolveChest(state, input.chestPick);
    return;
  }
  if (state.phase === 'draft') {
    const run = state.run;
    if (run && input.reroll && rerollRunDraft(run)) state.draft = run.cards.map(card => card.id);
    else if (run && input.banish && banishRunCard(run, input.banish)) state.draft = run.cards.map(card => card.id);
    else if (run && input.skip && skipRunDraft(run)) finishDraft(state);
    else if (input.pick) selectDraft(state, input.pick);
    return;
  }
  if (state.phase !== 'playing') {
    if (input.start) {
      const launch = input.launch;
      Object.assign(state, createStage({ ...parseStageOptions(''), seed: launch?.seed ?? state.seed,
        view: state.initialView, time: 0, mode: state.run ? 'survivors' : 'legacy', mobile: state.swarmCap === SWARM_CAPS.mobile,
        profile: launch?.profile ?? state.profile, daily: launch?.daily ?? state.daily, heat: launch?.heat ?? state.heat,
        aceRank: launch ? undefined : Math.max(aceRank(state.profile), state.aceRank) }, ground));
    }
    return;
  }
  if (input.retreat && state.run) {
    state.paused = false;
    finish(state, 'retreated');
    return;
  }
  if (input.pause) {
    state.paused = !state.paused;
    state.boosting = false;
    return;
  }
  if (state.paused) return;

  state.tick++;
  if (state.run) {
    advancePhasePacing(state);
    startBillTick(state);
  }
  const grace = state.tick <= state.graceUntil;
  const glimpse = state.rearGlimpse;
  if (glimpse) {
    if ((input.bomb || input.flare) && state.tick <= glimpse.until) glimpse.until = Math.max(glimpse.until, state.tick + REAR_GLIMPSE_TICKS);
    else if (state.tick >= glimpse.until) state.rearGlimpse = null;
  }
  if (input.toggleView && !grace) {
    state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length];
    state.wipe = WIPE_DURATION;
    state.viewTag = 1.12;
  } else {
    state.wipe = Math.max(0, state.wipe - STEP);
    state.viewTag = Math.max(0, state.viewTag - STEP);
  }
  state.invulnerability = Math.max(0, state.invulnerability - STEP);
  for (const effect of state.effects) effect.life -= STEP;
  state.effects = state.effects.filter(effect => effect.life > 0);
  if (state.weaponFx.length) state.weaponFx = state.weaponFx.filter(effect => state.tick < effect.until);
  if (input.maneuver && canManeuver(state, input.maneuver)) startManeuver(state, input.maneuver, input.maneuverTurn ?? input.turn ?? 0);
  const maneuver = state.maneuver;
  const { x, z } = state.player;
  const controlled = maneuverAllowsControl(maneuver);
  fly(state, input, ground, grace, controlled);
  if (state.run && state.boosting) state.metrics.boostTicks++;
  const vx = state.player.vx = (state.player.x - x) / STEP;
  const vz = state.player.vz = (state.player.z - z) / STEP;
  if (maneuver && state.maneuverTrail && (maneuver.elapsed % TRAIL_SAMPLE_TICKS === 0 || maneuver.elapsed === MANEUVERS[maneuver.kind].ticks)) {
    const { x, z, altitude } = state.player;
    state.maneuverTrail.points.push({ x, z, alt: altitude });
  }

  if (state.tick === bossTick(state) && !state.boss) {
    const boss = state.boss = (state.run ? makePacedWarden : makeBoss)(state, LANDMARKS.atoll.x, LANDMARKS.atoll.z);
    boss.entry = planFlyIn(state, state.arena, { x: boss.x, z: boss.z, alt: boss.alt },
      { ticks: BOSS_FLY_IN_TICKS, bend: 0.23, exitSpeed: 0 });
    trimEscorts(state);
  }
  if (state.run) {
    updateRunSlots(state.run, state.tick, !!state.boss);
    advanceChestSpawns(state, ground);
    advancePhaseSpawns(state, ground);
  } else {
    const wave = WAVES[state.nextWave];
    if (wave && state.tick >= wave.time * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS) {
      spawnWave(state, wave, ground);
      state.nextWave++;
    }
  }

  relocateStragglers(state, ground);
  advanceEnemies(state, ground);
  updateBoss(state, ground);
  advanceRearBombs(state, ground);
  advanceFlares(state, ground);
  if (controlled) {
    if (input.bomb && !grace) {
      const charges = state.bombs;
      dropRearBomb(state);
      if (state.run && state.bombs < charges) state.metrics.manualBombs++;
    }
    acquireAndFire(state);
    if (state.run) advanceRangedWeapons(state, ground);
  }
  if (input.flare) dropFlares(state, vx, vz);
  const maneuverEnded = maneuver && maneuver.elapsed === MANEUVERS[maneuver.kind].ticks;
  if (maneuverEnded) {
    if (state.maneuverTrail) {
      state.maneuverTrail.actualExit = state.player.altitude;
      if (maneuver.kind === 'j-turn') openReversal(state, state.maneuverTrail.pursuers);
    }
    state.maneuver = null;
    state.bodyGraceUntil = state.tick + BODY_GRACE_TICKS;
  }
  if (state.run) {
    advanceSupportWeapons(state, ground);
    advanceAutoOrdnance(state, !!maneuverEnded && maneuver.kind === 'j-turn');
  }
  advanceShots(state, ground);
  if (state.run) {
    state.metrics.peakAceWipe = Math.max(state.metrics.peakAceWipe, state.reversal?.streak ?? 0);
    if (state.boss) state.metrics.weakPointHits = state.boss.weakPoints.reduce((sum, point) => sum + point.hits, 0);
  }
  if (state.weaponFx.length > WEAPON_FX_LIMIT) state.weaponFx.splice(0, state.weaponFx.length - WEAPON_FX_LIMIT);
  advanceEnemyHazards(state, ground);

  if (state.tick > state.bodyGraceUntil) {
    const p = state.player;
    for (const enemy of state.enemies) {
      if (enemy.hp && !enemy.entry && enemy.kind !== 'gnat' && inBand(enemy.alt, p.altitude) && Math.hypot(enemy.x - p.x, enemy.z - p.z) < 7) {
        hurtPlayer(state);
        if (!enemy.carrier) enemy.hp = 0;
      }
    }
  }
  advanceSalvage(state, ground);
  if (state.run && state.hull) applyBillReward(state);
  const defeated = advanceWeakPoint(state);
  const outcome = defeated ? 'clear' : state.tick >= endTick(state) ? 'timeout' : null;
  const cost = requiredXp(state.level, !!state.run);
  if (!state.hull) finish(state, 'lost');
  else if (state.run && (state.chestReveal || collectChest(state))) {
    if (state.chests.offer) state.hull = Math.min(state.maxHull, state.hull + CARRIER_REPAIR_HULL);
    state.phase = 'chest';
    state.resultPending = outcome;
    state.boosting = false;
    state.boostRelease = true;
  }
  else if (cost !== null && state.xp >= cost) openDraft(state, outcome);
  else if (outcome) finish(state, outcome);
}
