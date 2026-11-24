/// <reference types="vite/client" />
import './style.css';
import './numeric-hud.css';
import { drawAceLocks } from './ace-sights.ts';
import { DamageFeedback, observeDamage } from './combat-feedback.ts';
import { COMBAT_FEEDBACK as DAMAGE } from './data/combat-feedback.ts';
import { advanceDamageFixture } from './damage-fixture.ts';
import { autopilotInput, seekStage } from './autoplay.ts';
import { updateBillDisplay } from './bill-display.ts';
import type { Segment } from './camera.ts';
import { CHECKPOINT_KEY, decodeCheckpoint, encodeCheckpoint } from './checkpoint.ts';
import { createChestDisplay } from './chest-display.ts';
import { CockpitDisplay } from './cockpit-display.ts';
import { CockpitMarkers } from './cockpit-markers.ts';
import { cockpitWarnings, type CockpitMotion } from './cockpit.ts';
import { CombatAudio } from './combat-audio.ts';
import { phaseAt, RUN_BOSS_SECONDS, RUN_END_SECONDS } from './data/phases.ts';
import { ROLL_PARRY_XP } from './data/roll.ts';
import type { Heat } from './data/meta.ts';
import { isNewEnemyKind } from './enemy-kinds.ts';
import {
  actionDueAt, barrelRollForKey, consumesSpaceRequest, enqueueTimedAction, FlightChord,
  mapSimulationStepTimesToAudioTicks, simulationStepTimesForFrame, takeDueActionsAtTick,
  type SpaceAction, type TimedAction,
} from './flight-chord.ts';
import { isFlightFixture, primeFlightFixture } from './flight-fixture.ts';
import { createGearIcon } from './gear-icons.ts';
import { GraphicsRecovery } from './graphics-recovery.ts';
import { createTranslator, initialLanguage, saveLanguage, type Language, type MessageKey } from './i18n.ts';
import { createHangarDisplay } from './hangar-display.ts';
import type { CombatEvents } from './hostile-events.ts';
import { HostileFeedback } from './hostile-feedback.ts';
import { createHostileFixture } from './hostile-fixture.ts';
import { altitudeDeltaText, beaconTrack, buildRadar, drawArenaMap, RadarDisplay, RADAR_RANGE, RearMirrorThreat, relativeMark, worldSiteObjective,
  type RadarReadout, type RearDanger } from './instruments.ts';
import { cockpitLayout, desktopLayout, guideLayout, phoneLayout, type CockpitLayout, type HudLayout, type Insets, type PhoneLayout, type Rect } from './layout.ts';
import { renderDraftCard, renderLoadoutHud } from './loadout-display.ts';
import { activeTrail, canManeuver, chooseManeuver, exitAltitude, formerPursuer, MANEUVERS, maneuverAllowsControl, maneuverAttitude,
  maneuverForKey, maneuverViewYaw, trailEnd } from './maneuvers.ts';
import { dailySeed, normalizeHeat, normalizeProfile, purchaseUpgrade, type Profile } from './meta.ts';
import type { DraftCard } from './progression.ts';
import { clockText, hudHullTone, NumericHud } from './numeric-hud.ts';
import { BEACON_SIGNAL_SECONDS, isLandmarkId } from './reach.ts';
import { rosterThreatMessage } from './roster-hud.ts';
import { primeRosterSheet, rosterSubject } from './roster-sheet.ts';
import { renderRunSummary } from './run-summary-display.ts';
import { FlightScene } from './scene.ts';
import { activeAce, bossTick, endTick, parseStageOptions, stepStage } from './stage.ts';
import { clamp, inBand, STEP,
  TICKS_PER_SECOND, WIPE_DURATION } from './stage-combat.ts';
import type { AceTell, ChestReward, DraftId, Effect, ManeuverKind, Outcome, StageInput } from './stage-types.ts';
import { World } from './world.ts';
import { BANDS, canCueAltitude } from './bands.ts';
import { COMPARISON_DIVISOR } from './data/render-quality.ts';
import { primeFidelityFixture } from './fidelity-fixture.ts';
import { initialRenderQuality, parseRenderQuality, saveRenderQuality } from './render-quality.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const root = $('.experience');
const canvas = $<HTMLCanvasElement>('#screen');
const overlay = $('#game-overlay');
const gameCard = $('.game-card');
const primary = $<HTMLButtonElement>('#primary-action');
const guideCard = $('#guide-card');
const guidePrimary = $<HTMLButtonElement>('#guide-primary');
const guideSkip = $<HTMLButtonElement>('#guide-skip');
const guideBody = $('.guide-body');
const draftCard = $('#draft-card');
const chestCard = $('#chest-card');
const chestDisplay = createChestDisplay(chestCard, action => { pendingChest = action; });
const draftButtons = [...draftCard.querySelectorAll<HTMLButtonElement>('[data-pick]')];
const sortieStrip = $('#sortie-strip'), loadoutHud = $('#loadout-hud'), gearToast = $('#gear-toast');
const billCount = $('#bill-count');
const checkpointPrompt = $('#checkpoint-prompt');
const touchControls = $('#touch-controls');
const touchPause = $<HTMLButtonElement>('#touch-pause');
const audioToggle = $<HTMLButtonElement>('#audio-toggle');
const audioVolume = $<HTMLInputElement>('#audio-volume');
const touchLoop = $<HTMLButtonElement>('#touch-loop');
const touchRoll = $<HTMLButtonElement>('#touch-roll');
const stick = $('#stick'), knob = $('#stick-knob');
const languageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-lang]')];
const safeProbe = $('#safe-area-probe');
const wipe = $('#view-wipe');
const rearBombMarker = $('#rear-bomb-marker');
const rearDangerCue = $('#rear-danger-cue');
const rearViewCue = $('#rear-view-cue');
const flightMessage = $('#flight-message');
const maneuverCue = $('#maneuver-cue');
const reversalCue = $('#reversal-cue');
const numericHud = new NumericHud(root);
// --- S7e lane ---
const aceHud = $('#boss-hud'), aceBar = $('#boss-health'), aceMeter = $('#ace-meter');
const mirrorThreat = new RearMirrorThreat();
const radar = $<HTMLCanvasElement>('#nav-radar'), radarContext = radar.getContext('2d')!;
const arenaMap = $<HTMLCanvasElement>('#arena-map'), mapContext = arenaMap.getContext('2d')!;
const font = getComputedStyle(document.documentElement).getPropertyValue('--game-font').trim();
const navRadar = new RadarDisplay();
const cockpitDisplay = new CockpitDisplay($<HTMLCanvasElement>('#cockpit-overlay'), font);
const cockpitMarkers = new CockpitMarkers();
const feedback = new HostileFeedback(root);
const coarse = matchMedia('(pointer: coarse)'), portrait = matchMedia('(orientation: portrait)');
const query = new URLSearchParams(location.search);
const graphics = new GraphicsRecovery();
const graphicsOverlay = $<HTMLElement>('#graphics-recovery');
const glDebug = import.meta.env.DEV || query.get('glDebug') === '1';
const forcedLossSeconds = glDebug && query.has('glloss') ? Number(query.get('glloss')) : NaN;
const forcedLossTick = forcedLossSeconds >= 0 && Number.isFinite(forcedLossSeconds)
  ? Math.round(forcedLossSeconds * TICKS_PER_SECOND) : null;
let forceUsed = false;
let forcedRestore: WEBGL_lose_context | null = null;
const audio = new CombatAudio(query.get('audioDebug') === '1');
const effectsEnabled = query.get('fx') !== '0';
const demoBullets = query.get('fixture') === 'bullets';
const flightFixture = isFlightFixture(query.get('fixture'));
const worldFixture = query.get('fixture') === 'world';
const fidelityFixture = query.get('fixture') === 'fidelity';
const rosterSheet = query.get('fixture') === 'roster-sheet' ? rosterSubject(query.get('kind')) : null;
const comparisonScale = fidelityFixture && query.get('compare') === String(COMPARISON_DIVISOR) ? COMPARISON_DIVISOR : undefined;
if (demoBullets || flightFixture || fidelityFixture || rosterSheet) {
  query.set('mode', 'survivors');
  query.set('t', '0');
}
if (rosterSheet) {
  query.set('view', 'chase');
  root.classList.add('roster-sheet');
}
if (!query.has('mode') && (!query.has('fixture') || worldFixture)) query.set('mode', 'survivors');
const options = parseStageOptions(query.toString());
const freezeRoster = (options.fixture === 'ace' || options.fixture === 'roster') && query.get('live') !== '1';
const staticWorldFixture = worldFixture && !options.autoplay && query.get('live') !== '1';
const world = new World(options.seed);
const ground = (x: number, z: number) => world.height(x, z);
options.mobile = options.touch || coarse.matches;
const PROFILE_KEY = 'aster-wing.pilot.v1';
const persistent = options.mode === 'survivors' && !options.autoplay && !options.fixture && options.time === null;
let profile = persistent ? readPilot() : normalizeProfile(null);
options.profile = profile;
const state = seekStage(options, ground);
const damageFeedback = new DamageFeedback();
const damageCanvas = $<HTMLCanvasElement>('#damage-feedback');
const damageContext = damageCanvas.getContext('2d')!;
const damageOption = $<HTMLInputElement>('#damage-numbers');
let damageNumbers = true;
try { damageNumbers = localStorage.getItem('aster-damage-numbers') !== '0'; } catch { /* In-memory option. */ }
if (query.has('damageNumbers')) damageNumbers = query.get('damageNumbers') !== '0';
damageOption.checked = damageNumbers;
damageOption.addEventListener('change', () => {
  damageNumbers = damageOption.checked;
  damageFeedback.clear();
  try { localStorage.setItem('aster-damage-numbers', damageNumbers ? '1' : '0'); } catch { /* In-memory option. */ }
  const url = new URL(location.href);
  url.searchParams.delete('damageNumbers');
  history.replaceState(history.state, '', url);
});
observeDamage(state, (id, damage, critical, target) => {
  if (damageNumbers && effectsEnabled) damageFeedback.hit(id, damage, critical, target, state.tick / 60);
});
const bulletFixture = demoBullets ? createHostileFixture(state, query, ground) : null;
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
// --- S7f lane ---
const renderQualitySetting = $<HTMLSelectElement>('#render-quality');
const renderQualityStatus = $('#render-quality-status');
let preferredRenderQuality = initialRenderQuality(query, storage);
let checkpointData = persistent ? readCheckpointData() : null;
let interrupted = false, resumeAt = 0;
let language = initialLanguage(location.search, navigator.language, storage);
let t = createTranslator(language);
let launchHeat: Heat = 0, launchDaily = false, pendingRetreat = false;
const hangarDisplay = createHangarDisplay($('#hangar-panel'), {
  onPurchase(id) {
    if (state.phase === 'playing') return;
    const next = purchaseUpgrade(profile, id);
    if (!next) return;
    profile = next;
    persistPilot();
    renderHangar();
  },
  onHeat(heat) {
    launchHeat = normalizeHeat(heat, profile.maxHeat);
    renderHangar();
  },
  onDaily(daily) {
    launchDaily = daily;
    renderHangar();
  },
});
let scene: FlightScene | null = null;
function createFlightScene(): FlightScene {
  return new FlightScene(canvas, world, state.arena, {
    enabled: effectsEnabled, fixture: query.get('fixture'), quality: preferredRenderQuality, comparisonScale,
  });
}
try {
  scene = createFlightScene();
} catch (error) {
  console.error(error);
}

const keys = new Set<string>();
const flightChord = new FlightChord();
const steeringKeys = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
let touch = false, phone: PhoneLayout | null = null, cockpit: CockpitLayout | null = null;
let hud: HudLayout, layoutView: Segment | null = null;
let safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
let guide: 'launch' | 'help' | null = null;
let guideOpener: HTMLElement | null = null;
let menuKey = '';
let renderedDraft: DraftId[] | null = null;
let renderedChest: ChestReward[] | null = null;
let gearNotice: (
  { kind: 'evolution'; item: Extract<ChestReward, { kind: 'evolution' }> } |
  { kind: 'upgrade'; card: DraftCard; level: number }
) & { until: number } | null = null;
let banishing = false;
let dirty = true, lastRadarTick: number | null = null, lastFlightKey = '';
let pendingStart = false, pendingPause = false, pendingViews = 0;
let pendingDraft: Pick<StageInput, 'pick' | 'reroll' | 'banish' | 'skip'> = {};
let pendingChest: StageInput['chestPick'];
type ManeuverPress = { kind: ManeuverKind; turn: number };
type PendingFlightInput =
  | { kind: 'maneuver'; press: ManeuverPress; spaceAt?: number }
  | { kind: 'roll'; turn: number; spaceAt?: number };
let pendingFlightInputs: TimedAction<PendingFlightInput>[] = [];
let requestedSpace: TimedAction<ManeuverPress> | undefined;
let stickId: number | null = null;
let loopPointer: { id: number; press: ManeuverPress } | null = null;
let stickX = 0, stickY = 0, mouseX = 0, mouseY = 0, mouseActive = false;
let touchBoost = false;
let previousTime = 0, carry = 0, fps = 60, lastRenderTick = -1, lastRenderPhase = '';
const REVERSAL_HITSTOP_MS = 60;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const cockpitLayer = $('#cockpit-display');
const reversalFlash = $('#reversal-flash');
let hitstopUntil = -Infinity;
const HIT_FREEZE_MS = 60;
let visualFreezeUntil = -Infinity, frameNow = 0, cueTime = 0, primingBullets = false;
let parryNoticeUntil = 0;
const projectedShip = { x: 0, y: 0, depth: 0 };
const feedbackTarget = { x: 0, z: 0, alt: 0 };
let feedbackAnchor: { x: number; y: number } | null = null;
let aceFireCue: AceTell | null = null;
const aceVisualEvents: CombatEvents = { aceTellFired(tell) {
  audio.finishAceLockFire();
  aceFireCue = tell;
} };
const combatEvents: CombatEvents | undefined = effectsEnabled ? {
  muzzle(shot, shape, x, z, alt) {
    const age = primingBullets ? query.has('shape') ? 3 : 10 : 0;
    scene?.hostileMuzzle(shot, shape, x, z, alt, state.tick - age);
    if (!primingBullets && (x - state.player.x) ** 2 + (z - state.player.z) ** 2 < 180 ** 2) audio.play('muzzle');
  },
  impact(shot, x, z, alt) { scene?.hostileImpact(shot, x, z, alt, state.tick - (primingBullets ? 4 : 0)); },
  graze(shot, x, z, alt) {
    scene?.hostileGraze(shot, x, z, alt, state.tick - (primingBullets ? 3 : 0));
    feedback.graze(state, frameNow);
    audio.play('graze');
  },
  hit(damage, x, z, alt) {
    if (!primingBullets) visualFreezeUntil = frameNow + HIT_FREEZE_MS;
    scene?.shock('hit', state.tick);
    feedback.hit(state, damage, x, z, alt, frameNow);
    audio.play('hit');
    if (state.view === 'cockpit') audio.play('warning');
  },
  roll() { audio.play('roll'); },
  parry(shot, x, z, alt) {
    visualFreezeUntil = frameNow + HIT_FREEZE_MS;
    parryNoticeUntil = state.tick + 44;
    scene?.hostileGraze(shot, x, z, alt, state.tick);
    scene?.shock('parry', state.tick);
    audio.play('parry');
  },
  // --- S7e lane ---
  tell(kind, x, z) {
    if (kind === 'ace-down') audio.play('explosion');
    const aceTell = state.boss?.tell;
    const aceAttack = (kind === 'gun' || kind === 'missile') && aceTell?.kind === kind
      && aceTell.since === state.tick && state.boss?.x === x && state.boss?.z === z;
    if (!aceAttack && (x - state.player.x) ** 2 + (z - state.player.z) ** 2 <= RADAR_RANGE ** 2) {
      audio.play(`tell:${kind}`);
    }
  },
  aceTellFired: aceVisualEvents.aceTellFired,
  destroyed(kind, elite) {
    audio.play('explosion', kind === 'gnat' ? 0.25 : elite ? 1 : 0.66);
  },
  aceArrival() { audio.play('ace_alert'); },
} : undefined;
let helpTimer = 0, lastHelp = '';
let motion: CockpitMotion = { speed: 0, climb: 0, turn: 0 };
let cockpitDelta: string | null = null;
let rearDanger: RearDanger | null = null;
let lastAudioCautions = 0;
const audioCockpitWarnings: ReturnType<typeof cockpitWarnings> = { terrain: null, boost: null };
const textNodes = new Map<string, HTMLElement>();
const sortieTiming = { boss: clockText(RUN_BOSS_SECONDS), limit: clockText(RUN_END_SECONDS) };

function setText(selector: string, copy: string): void {
  let node = textNodes.get(selector);
  if (!node) {
    node = $(selector);
    textNodes.set(selector, node);
  }
  if (node.textContent !== copy) node.textContent = copy;
}

function readPilot(): Profile {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'));
  } catch {
    return normalizeProfile(null);
  }
}

function persistPilot(): void {
  if (!persistent) return;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* Continue with the in-memory pilot. */ }
}

function readCheckpointData(): string | null {
  try { return localStorage.getItem(CHECKPOINT_KEY); } catch { return null; }
}

function writeCheckpointData(next: string | null): boolean {
  if (!persistent) return false;
  try {
    // An older tab must not erase a checkpoint written by another sortie.
    if (localStorage.getItem(CHECKPOINT_KEY) !== checkpointData) return false;
    if (next) localStorage.setItem(CHECKPOINT_KEY, next);
    else localStorage.removeItem(CHECKPOINT_KEY);
    checkpointData = next;
    return true;
  } catch {
    return false;
  }
}

function resumeCheckpoint(): void {
  if (!scene || state.phase !== 'title') return;
  const checkpoint = decodeCheckpoint(checkpointData);
  if (!checkpoint || !writeCheckpointData(null)) return;
  // Preserve purchases made in the hangar. The sortie keeps the saved in-flight upgrade effects.
  world.seed = checkpoint.seed;
  Object.assign(state, checkpoint, { profile });
  feedback.reset();
  parryNoticeUntil = 0;
  carry = 0;
  menuKey = '';
  layoutFlight();
  updateMenu();
}

function renderHangar(): void {
  hangarDisplay.update(profile, state.paused ? normalizeHeat(state.heat) : launchHeat, state.paused ? state.daily : launchDaily,
    t, state.paused ? state.metrics : undefined);
}

function launchSettings(): StageInput['launch'] {
  if (!state.run) return;
  const day = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { seed: launchDaily ? dailySeed(day) ?? options.seed : options.seed, heat: launchHeat, daily: launchDaily, profile };
}

function applyLanguage(): void {
  t = createTranslator(language);
  document.documentElement.lang = language;
  document.title = t('app.title');
  $('meta[name="description"]').setAttribute('content', t('app.description'));
  document.querySelectorAll<HTMLElement>('[data-i18n], [data-label], [data-tooltip]').forEach(el => {
    if (el.dataset.i18n) el.textContent = t(el.dataset.i18n as MessageKey);
    if (el.dataset.label) el.setAttribute('aria-label', t(el.dataset.label as MessageKey));
    if (el.dataset.tooltip) el.title = t(el.dataset.tooltip as MessageKey);
  });
  setText('#guide-boss-copy', state.run ? `${t('guide.sortieTiming', sortieTiming)} ${t('guide.bossHint')}` : t('guide.bossHint'));
  for (const button of languageButtons) button.setAttribute('aria-pressed', String(button.dataset.lang === language));
  refreshAudioControl();
  // --- S7f lane ---
  refreshRenderQuality();
  menuKey = lastHelp = lastFlightKey = '';
  layoutFlight();
  updateMenu();
}

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    language = button.dataset.lang as Language;
    saveLanguage(language, storage);
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      history.replaceState(history.state, '', url);
    }
    applyLanguage();
  });
}

// --- S7f lane ---
function refreshRenderQuality(): void {
  renderQualitySetting.value = preferredRenderQuality;
  const active = scene?.renderQuality;
  renderQualityStatus.hidden = !active || active === preferredRenderQuality;
  renderQualityStatus.textContent = active && active !== preferredRenderQuality
    ? t('quality.active', { tier: t(`quality.${active}`) }) : '';
}

renderQualitySetting.addEventListener('change', () => {
  const tier = parseRenderQuality(renderQualitySetting.value);
  if (!tier) return;
  preferredRenderQuality = tier;
  saveRenderQuality(tier, storage);
  scene?.setRenderQuality(tier);
  const url = new URL(location.href);
  if (url.searchParams.has('quality')) {
    url.searchParams.delete('quality');
    history.replaceState(history.state, '', url);
  }
  refreshRenderQuality();
  dirty = true;
});
document.addEventListener('visibilitychange', () => scene?.observeRenderFrame(null));

function setRect(name: string, box: Rect): void {
  for (const [part, value] of Object.entries({ x: box.x, y: box.y, w: box.width, h: box.height })) {
    root.style.setProperty(`--${name}-${part}`, `${value}px`);
  }
}

function layoutFlight(): void {
  layoutView = state.view;
  phone = touch ? phoneLayout(innerWidth, innerHeight, safe, state.view, !!state.run) : null;
  hud = phone ?? desktopLayout(innerWidth, innerHeight, safe);
  for (const key of ['hud', 'boss', 'radio', 'objective', 'radar', 'alt'] as const) setRect(key, hud[key]);
  if (phone) {
    for (const key of ['playfield', 'controls', 'pause', 'stick', 'loop', 'roll', 'boost', 'view'] as const) setRect(key, phone[key]);
  }
  if (state.run) layoutSortieHud();
  cockpit = state.view === 'cockpit' ? phone?.cockpit ?? cockpitLayout(innerWidth, innerHeight, safe, hud.objective) : null;
  if (cockpit) {
    setRect('cockpit-message', cockpit.message);
    if (cockpit.help) setRect('cockpit-help', cockpit.help);
    root.style.setProperty('--maneuver-center-y', `${Math.round(cockpit.aiming.y + cockpit.aiming.height * 0.42)}px`);
  }
  cockpitDisplay.resize(cockpit, innerWidth, innerHeight, language, t);
  feedback.resize(innerWidth, innerHeight, phone, cockpit);
  radar.width = Math.max(1, hud.radar.width);
  radar.height = Math.max(1, hud.radar.height);
  navRadar.resize(radar.width, radar.height, font, t('hud.nav'));
  const mapSize = Math.min(touch ? 66 : 78, radar.width);
  const mapY = hud.radar.y + hud.radar.height + 5;
  const beside = phone ? mapY + mapSize > phone.controls.y : hud.radar.x - mapSize - 5 > hud.radio.x + hud.radio.width;
  setRect('arena-map', {
    x: beside ? hud.radar.x - mapSize - 5 : phone ? hud.radar.x + radar.width - mapSize : hud.alt.x - mapSize - 5,
    y: beside ? hud.radar.y : Math.max(mapY, hud.alt.y),
    width: mapSize, height: mapSize,
  });
  arenaMap.width = arenaMap.height = mapSize;
  arenaMap.hidden = state.view !== 'overhead';
  lastRadarTick = null;
  scene?.resize({ width: innerWidth, height: innerHeight, phone, cockpit, hud });
  root.dataset.view = state.view;
  root.classList.toggle('cockpit-view', !!cockpit);
  root.classList.toggle('phone-portrait', phone?.orientation === 'portrait');
  root.classList.toggle('phone-landscape', phone?.orientation === 'landscape');
  dirty = true;
}

function layoutSortieHud(): void {
  const left = hud.hud.x;
  let slots: Rect, bill: Rect;
  if (phone?.orientation === 'portrait') {
    const y = hud.radio.y + hud.radio.height + 4, width = 169;
    slots = { x: left, y, width, height: 110 };
    bill = { x: left + width + 6, y, width: hud.hud.width - width - 6, height: 132 };
  } else if (phone) {
    const y = hud.objective.y + hud.objective.height + 6;
    slots = { x: left + (state.view === 'cockpit' ? 58 : 179), y, width: 211, height: 72 };
    const x = hud.objective.x + hud.objective.width + 8;
    bill = { x, y: hud.hud.y, width: phone.playfield.width - (x - left), height: 92 };
  } else {
    const mapReserve = Math.min(78, hud.radar.width) + 5;
    const width = 218, x = Math.max(left, hud.radar.x - mapReserve - width - 8), y = hud.hud.y;
    slots = { x, y, width, height: 126 };
    const billWidth = 235, billX = Math.max(left, x - billWidth - 9);
    bill = { x: billX, y: billX < left + 285 ? hud.objective.y + hud.objective.height + 6 : y,
      width: billWidth, height: 110 };
  }
  setRect('sortie-strip', slots);
  setRect('bill', bill);
}

function resize(): void {
  touch = options.touch || coarse.matches || (navigator.maxTouchPoints > 0 && Math.min(innerWidth, innerHeight) <= 600);
  const css = getComputedStyle(safeProbe);
  const px = (value: string): number => Math.max(0, parseFloat(value) || 0);
  safe = { top: px(css.paddingTop), right: px(css.paddingRight), bottom: px(css.paddingBottom), left: px(css.paddingLeft) };
  root.classList.toggle('phone-layout', touch);
  const layout = guideLayout(innerWidth, innerHeight, safe);
  setRect('guide', layout.card);
  guideCard.style.setProperty('--guide-heading-h', `${layout.heading.height}px`);
  guideCard.style.setProperty('--guide-body-h', `${layout.body.height}px`);
  guideCard.style.setProperty('--guide-actions-h', `${layout.actions.height}px`);
  guideCard.classList.toggle('guide-wide', layout.columns === 2);
  $('#guide-keyboard').hidden = touch;
  $('#guide-touch').hidden = !touch;
  layoutFlight();
  updateMenu();
}

function objectiveText(): string {
  const fixture = options.fixture;
  if (rosterSheet) return t(rosterSheet === 'ace' ? 'speaker.ace' : `enemy.${rosterSheet}`);
  if (fixture === 'flare' && state.tick >= 30 * TICKS_PER_SECOND && state.tick < 40 * TICKS_PER_SECOND) {
    return t('guide.flareHint');
  }
  // --- S7e lane ---
  if (fixture === 'roster') {
    const cue = options.fixtureCue === 'flak' ? 'turret' : options.fixtureCue;
    const focus = state.enemies.find(enemy => cue === 'carrier' ? !!enemy.carrier : enemy.kind === cue);
    return focus ? t(focus.carrier ? 'enemy.carrier' : `enemy.${focus.kind}`) : t('objective.roster');
  }
  if (isNewEnemyKind(fixture) && state.enemies.some(enemy => enemy.kind === fixture)) return t(`enemy.${fixture}`);
  if (isLandmarkId(fixture) && state.tick >= BEACON_SIGNAL_SECONDS * TICKS_PER_SECOND && !state.boss) return t(`landmark.${fixture}`);
  // --- S7d lane ---
  const p = state.player, beacon = beaconTrack(state);
  const dx = beacon ? beacon.x - p.x : 0, dz = beacon ? beacon.z - p.z : 0;
  const range = Math.hypot(dx, dz);
  const bearing = (Math.round(Math.atan2(dx, dz) * 180 / Math.PI) + 360) % 360;
  const navigation = beacon && (range > RADAR_RANGE || !state.boss) ? ` · ${String(bearing).padStart(3, '0')}°` : '';
  const ace = activeAce(state);
  if (!ace) {
    if (state.boss) return t('objective.aceDown');
    if (beacon) return t('objective.beacon', { bearing: navigation });
    const site = worldSiteObjective(state, t);
    if (site) return site;
    if (!state.run && state.tick < 40 * TICKS_PER_SECOND) return t('objective.reach');
    return t('objective.survivors', { time: clockText(bossTick(state) / TICKS_PER_SECOND) });
  }
  return t(ace.entry ? 'objective.aceInbound' : 'objective.aceFight') + navigation;
}

function drawPortrait(hostile: boolean): void {
  const c = $<HTMLCanvasElement>('#portrait').getContext('2d')!;
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  rect(hostile ? '#41262d' : '#163d45', 0, 0, 32, 32);
  rect(hostile ? '#813e3d' : '#3d8974', 2, 3, 8, 2);
  rect(hostile ? '#813e3d' : '#3d8974', 22, 5, 8, 2);
  rect(hostile ? '#606b70' : '#8a745f', 7, 10, 18, 16);
  rect('#222d35', 9, 7, 14, 5);
  rect('#17212b', 8, 26, 16, 6);
  rect(hostile ? '#b25b59' : '#d7c3a0', 11, 13, 11, 8);
  rect('#f0e8d0', 17, 14, 5, 5);
  rect('#161d27', 19, 15, 2, 3);
  rect(hostile ? '#bd5c4b' : '#f4a34d', 20, 19, 10, 4);
}

function updateRadio(): void {
  const sec = state.tick / TICKS_PER_SECOND;
  const sinceAce = (state.tick - bossTick(state)) / TICKS_PER_SECOND;
  const message = state.phase === 'title' ? null : sec < 5 ? 'dialogue.reachArrival' :
    sec >= 22 && sec < 26 ? 'dialogue.stack' : sinceAce >= 0 && sinceAce < 3 ? 'dialogue.ace' : null;
  $('#radio').hidden = !message;
  if (!message || lastFlightKey === message) return;
  lastFlightKey = message;
  const hostile = message === 'dialogue.ace';
  drawPortrait(hostile);
  setText('#radio-speaker', t(hostile ? 'speaker.ace' : 'speaker.opal'));
  setText('#radio-text', t(message));
}

function updateHud(readout: RadarReadout): void {
  updateBillDisplay(state, t);
  sortieStrip.hidden = !state.run;
  billCount.hidden = !state.run;
  if (state.run) {
    renderLoadoutHud(loadoutHud, state.run, language);
    if (!billCount.firstElementChild?.classList.contains('gear-icon')) billCount.prepend(createGearIcon('bill', 14));
    setText('#bill-count b', `${state.bills.paid}/${state.bills.offered}`);
  }
  const notice = state.phaseNotice, swarm = state.swarmNotice, banner = $('#phase-banner');
  banner.hidden = (!notice && !swarm) || state.phase !== 'playing' || state.paused;
  if (swarm && !banner.hidden) {
    setText('#phase-banner', swarm.kind === 'recovery' ? t('phase.recovery') : t(`phase.${swarm.kind}`, { alt: BANDS[swarm.band] }));
  } else if (notice && !banner.hidden) {
    const context = notice.phase === 'storm' && notice.kind === 'lull' ? t('phase.aceInbound') : t(`phase.${notice.phase}`);
    const lull = notice.kind === 'lull'
      ? ' · ' + (notice.repaired ? t('phase.lullRepair', { hull: notice.repaired }) : t('phase.lull')) : '';
    setText('#phase-banner', context + lull);
  }
  gearToast.hidden = !gearNotice || gearNotice.until <= state.tick || state.phase !== 'playing' || state.paused;
  if (gearNotice && !gearToast.hidden) {
    if (gearNotice.kind === 'evolution') {
      setText('#gear-toast-heading', t('chest.evolved'));
      setText('#gear-toast-name', t(`item.${gearNotice.item.id}.title`));
    } else {
      const { card, level } = gearNotice;
      const capped = card.id === 'damage' && card.nextLevel === card.currentLevel;
      const name = t(capped ? 'draft.damageCap.title' : `item.${card.id}.title`);
      setText('#gear-toast-heading', t('draft.applied', { level }));
      setText('#gear-toast-name', card.nextLevel > card.currentLevel ? t('draft.appliedGear', { name, level: card.nextLevel }) : name);
    }
  }
  const ready = canManeuver(state, 'immelmann');
  const keyboard = keyboardAxes();
  const selected = touch ? chooseManeuver(stickX, stickY) : chooseManeuver(keyboard.turn, keyboard.climb);
  const lowBoost = ready && selected === 'j-turn' && state.boost < MANEUVERS['j-turn'].boost;
  numericHud.update(state, t, ready && !lowBoost);
  updateRearDangerCue(readout, ready && !lowBoost);
  const time = Math.max(0, Math.ceil((endTick(state) - state.tick) / TICKS_PER_SECOND));
  if (state.run) {
    const eta = Math.ceil((bossTick(state) - state.tick) / TICKS_PER_SECOND);
    setText('#sortie-phase', t(`phase.${phaseAt(state.tick / TICKS_PER_SECOND).id}`));
    setText('#ace-countdown', eta > 0 ? t('stageHud.aceEta', { time: clockText(eta) }) :
      t('stageHud.timeLeft', { time: clockText(time) }));
  }
  setText('#score', String(state.score).padStart(6, '0'));
  setText('#salvage', `◆ ${state.salvage}`);
  setText('#objective', objectiveText());
  // --- S7e lane ---
  const ace = activeAce(state);
  aceHud.hidden = !ace;
  if (ace) {
    const percent = Math.ceil(100 * ace.hp / ace.maxHp);
    setText('#ace-label', t('ace.label', { phase: ace.phase }));
    const value = String(percent);
    if (aceMeter.getAttribute('aria-valuenow') !== value) {
      aceBar.style.width = `${value}%`;
      aceMeter.setAttribute('aria-valuenow', value);
    }
  }
  updateRadio();
  updateMenu();
  if (!touch && state.phase === 'playing' && !state.paused && lastHelp !== state.view) {
    lastHelp = state.view;
    setText('#help', t('help.keys'));
    $('#help').classList.remove('fade');
    clearTimeout(helpTimer);
    helpTimer = window.setTimeout(() => $('#help').classList.add('fade'), 5000);
  }
}

function updateManeuverCue(): void {
  const rolling = state.phase === 'playing' && !state.paused && state.roll;
  const parry = state.phase === 'playing' && !state.paused && state.tick < parryNoticeUntil;
  if (parry || rolling) {
    reversalCue.hidden = true;
    maneuverCue.hidden = false;
    maneuverCue.dataset.kind = parry ? 'parry' : 'roll';
    maneuverCue.dataset.docked = 'false';
    setText('#maneuver-name', parry ? t('hud.parry') : rolling ? t(`roll.${rolling.kind}`) : '');
    setText('#maneuver-detail', parry ? t('hud.parryXp', { xp: ROLL_PARRY_XP }) : '');
    return;
  }
  const reversal = state.reversal;
  reversalCue.hidden = state.phase !== 'playing' || state.paused || !reversal || !reversal.kills || state.tick >= reversal.shownUntil;
  flightMessage.dataset.reversal = String(!reversalCue.hidden);
  if (!reversalCue.hidden && reversal) {
    const { streak } = reversal;
    const tier = streak >= 10 ? 'dominated' : streak >= 6 ? 'aceWipe' : streak >= 3 ? 'sweep' : '';
    reversalCue.dataset.tier = tier;
    setText('#reversal-cue', tier ? t(`hud.${tier}`, { count: streak }) : t('hud.reversalKills', { count: reversal.kills }));
  }
  const trail = activeTrail(state);
  maneuverCue.hidden = !reversalCue.hidden || !trail || state.phase !== 'playing' || state.tick > trailEnd(trail) + 48;
  if (!trail || maneuverCue.hidden) return;
  const { kind } = trail;
  const name = t(`maneuver.${kind}`);
  const loop = kind === 'immelmann' || kind === 'split-s';
  const title = kind === 'immelmann' ? t('maneuver.up', { name }) : kind === 'split-s' ? t('maneuver.down', { name })
    : t('maneuver.reverse', { name, arrow: trail.side < 0 ? '↶' : '↷' });
  const pendingFlip = state.tick - trail.startTick + 1 < MANEUVERS[kind].flipTick;
  const degrees = Math.round((pendingFlip ? trail.yaw + Math.PI : state.player.yaw) * 180 / Math.PI);
  const heading = String((degrees % 360 + 360) % 360).padStart(3, '0');
  const delta = Math.round((trail.actualExit ?? trail.exitAltitude) - trail.points[0].alt);
  const height = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} m`;
  const limit = trail.limited ? t(kind === 'immelmann' ? 'maneuver.highLimit' : 'maneuver.lowLimit')
    : trail.actualExit !== undefined && Math.abs(trail.actualExit - trail.exitAltitude) >= 1 ? t('maneuver.terrainLimit') : '';
  const ahead = state.enemies.filter(enemy => formerPursuer(state, trail, enemy)).length;
  const details = t(pendingFlip ? 'maneuver.exitHeading' : 'maneuver.heading', { heading }) + (loop ? ` · ${height}` : '')
    + (limit ? ` · ${limit}` : '') + (ahead ? ` · ${t('maneuver.ahead', { count: ahead })}` : '');
  maneuverCue.dataset.kind = kind;
  maneuverCue.dataset.docked = String(state.tick - trail.startTick >= 15);
  setText('#maneuver-name', title);
  setText('#maneuver-detail', details);
}

function describeFlight(readout: RadarReadout, clearance: number): void {
  const p = state.player;
  const top = state.view === 'overhead';
  const warnings = cockpitWarnings(state, clearance, state.climbRate);
  let miss: Effect | undefined;
  for (let i = state.effects.length - 1; i >= 0; i--) {
    if (state.effects[i].kind === 'miss') {
      miss = state.effects[i];
      break;
    }
  }
  const warning = state.enemies.find(enemy => enemy.maneuver?.phase === 'warning'
    && Math.hypot(p.x - enemy.x, p.z - enemy.z) < 125);
  const rosterWarning = rosterThreatMessage(state, RADAR_RANGE);
  const mine = !top && state.enemyMines.some(mine => Math.hypot(p.x - mine.x, p.z - mine.z) < 46);
  let message: MessageKey | null = null;
  let threat = '';
  if (state.boundaryWarning) message = 'hud.boundary';
  else if (warnings.terrain === 'pullUp') message = 'cockpit.pullUp';
  else if (rosterWarning) message = rosterWarning;
  else if (miss?.kind === 'miss') message = top ? 'hud.checkAlt' : miss.delta > 0 ? 'hud.shotLow' : 'hud.shotHigh';
  else if (warning?.maneuver) {
    const down = warning.maneuver.band < warning.band;
    if (isNewEnemyKind(warning.kind)) {
      threat = t(`enemy.${warning.kind}`);
      message = top ? 'hud.enemyManeuver' : down ? 'hud.enemyDive' : 'hud.enemyClimb';
    } else message = top ? 'hud.interceptor' : down ? 'hud.interceptorDive' : 'hud.interceptorClimb';
  } else if (mine) message = 'hud.mineWarning';
  else if (top && state.altitudeHint) message = 'hud.checkAlt';
  else if (warnings.terrain === 'altLow' && !state.altitudeHint) message = 'cockpit.altLow';
  flightMessage.hidden = !message;
  if (message) setText('#flight-message', t(message, { name: threat }));
  const tag = $('#view-tag');
  tag.hidden = state.viewTag <= 0 || !!message;
  if (!tag.hidden) setText('#view-tag', t('view.tag', { view: t(`view.${state.view}`) }));

  const cue = $('#scene-cue');
  cue.hidden = true;
  const priority = readout.priority;
  const contact = !message && !state.maneuver && state.view === 'chase'
    ? priority && priority.ahead > 4 ? priority : readout.salvage : null;
  if (contact) {
    const delta = contact.alt - p.altitude;
    const mark = relativeMark(delta, false);
    const point = mark !== '=' && canCueAltitude(p, contact.alt) && scene?.project(contact);
    const field = phone?.playfield ?? { x: 15, y: hud.objective.y + hud.objective.height + 5, width: innerWidth - 30, height: innerHeight - hud.objective.y - 45 };
    const cueWidth = 90;
    if (point && point.x >= field.x + cueWidth / 2 && point.x + cueWidth / 2 <= field.x + field.width
      && point.y > field.y + 52 && point.y < field.y + field.height - 18 && point.x + cueWidth / 2 < hud.radar.x) {
      cue.hidden = false;
      cue.style.left = `${Math.round(point.x)}px`;
      cue.style.top = `${Math.round(point.y - 13)}px`;
      setText('#scene-cue', t(mark === '^' ? 'hud.climbCue' : 'hud.diveCue'));
    }
  }
  if (state.view !== 'overhead' && state.altitudeHint && !message && (state.view === 'cockpit' || cue.hidden)) {
    flightMessage.hidden = false;
    tag.hidden = true;
    setText('#flight-message', t(state.altitudeHint.delta > 0 ? 'hud.climbCue' : 'hud.diveCue'));
  }
}

function resetTouch(): void {
  stickId = null;
  loopPointer = null;
  stickX = stickY = 0;
  mouseActive = touchBoost = false;
  knob.style.transform = '';
  for (const button of touchControls.querySelectorAll('.held')) button.classList.remove('held');
}

function updateMenu(): void {
  const status = !scene ? 'webgl' : guide ? 'guide' : state.paused ? 'paused' : state.phase;
  touchControls.hidden = touchPause.hidden = !touch || status !== 'playing';
  audioToggle.hidden = status !== 'playing';
  if (status === menuKey && (status !== 'draft' || state.draft === renderedDraft)
    && (status !== 'chest' || state.chestReveal === renderedChest)) return;
  renderedDraft = state.draft;
  renderedChest = state.chestReveal;
  const oldStatus = menuKey;
  menuKey = status;
  const showing = status !== 'playing';
  const drafting = status === 'draft';
  overlay.hidden = !showing;
  root.classList.toggle('menu-open', showing);
  root.classList.toggle('guide-open', status === 'guide');
  guideCard.hidden = status !== 'guide';
  draftCard.hidden = !drafting;
  chestCard.hidden = status !== 'chest';
  gameCard.hidden = !showing || drafting || status === 'guide' || status === 'chest';
  gameCard.classList.toggle('debrief', !!state.summary);
  $('#hangar-panel').hidden = !state.run || !persistent || interrupted || !(status === 'title' || status === 'paused' || state.summary);
  $('#run-summary').hidden = !state.summary;
  $('#retreat-action').hidden = !state.run || status !== 'paused' || interrupted;
  primary.hidden = status === 'paused' && interrupted;
  const checkpoint = status === 'title' ? decodeCheckpoint(checkpointData) : null;
  checkpointPrompt.hidden = !checkpoint;
  if (checkpoint) {
    const seconds = checkpoint.tick / TICKS_PER_SECOND;
    setText('#checkpoint-copy', t('checkpoint.prompt', { phase: t(`phase.${phaseAt(seconds).id}`), time: clockText(seconds) }));
  }
  if (!$('#hangar-panel').hidden) renderHangar();
  if (showing) {
    resetTouch();
    flushSpaceInput();
    pendingViews = 0;
  }
  if (status === 'guide' && guide) {
    guideSkip.hidden = guide !== 'launch';
    setText('#guide-primary', t(guide === 'launch' ? 'guide.launch' : 'guide.back'));
  } else if (status === 'chest') {
    chestDisplay.update(state, t);
  } else if (drafting) {
    banishing = false;
    setText('#draft-detail', t('draft.detail', { level: state.level + 1 }));
    draftButtons.forEach((button, index) => renderDraftCard(button, state.run?.cards[index], state, language, index));
    const run = state.run;
    $('#draft-actions').hidden = !run || !(run.rerolls || run.banishes || run.skips);
    setText('#draft-reroll', t('draft.rerolls', { count: run?.rerolls ?? 0 }));
    $<HTMLButtonElement>('#draft-reroll').disabled = !run?.rerolls;
    $('#draft-banish').hidden = !run?.banishes;
    $('#draft-banish').setAttribute('aria-pressed', 'false');
    $('#draft-skip').hidden = !run?.skips;
    draftButtons[0].focus({ preventScroll: true });
  } else if (showing) {
    const intro = status === 'title' || status === 'paused';
    const webgl = status === 'webgl';
    $('#card-options').hidden = interrupted || !(intro || webgl);
    $('#help-action').hidden = webgl;
    $('#rank-display').hidden = intro || webgl;
    $('#card-kicker').hidden = webgl;
    $('#card-hint').hidden = webgl || interrupted;
    if (intro) {
      setText('#card-kicker', t(`menu.${status}.kicker`));
      setText('#card-title', t(`menu.${status}.title`));
      setText('#card-copy', t(interrupted ? 'checkpoint.interrupted' :
        status === 'title' && state.run ? 'menu.survivors.copy' : `menu.${status}.copy`, sortieTiming));
      setText('#primary-action', t(`menu.${status}.action`));
      setText('#card-hint', t(`menu.${status}.hint`));
      setText('#help-action-label', t(status === 'title' ? 'guide.title' : 'menu.help'));
    } else if (webgl) {
      setText('#card-title', t('menu.webgl.title'));
      setText('#card-copy', t('menu.webgl.copy'));
      setText('#primary-action', t('menu.webgl.action'));
    } else {
      const outcome = state.phase as Outcome;
      setText('#card-kicker', t('menu.result.kicker'));
      setText('#card-title', t(state.run && outcome === 'timeout' ? 'menu.summary.timeout' : `menu.${outcome}.title`));
      setText('#card-copy', t('menu.result.copy', { hull: state.hull, maxHull: state.maxHull, hits: state.hitsTaken, salvage: state.salvage, score: state.score }));
      setText('#rank-display', t('menu.result.rank', { rank: state.rank ?? '' }));
      setText('#primary-action', t('menu.result.action'));
      setText('#card-hint', t('menu.result.hint'));
      if (state.summary) renderRunSummary($('#run-summary'), state, language, clockText(Math.floor(state.summary.seconds)));
    }
    if (oldStatus && oldStatus !== 'guide') primary.focus({ preventScroll: true });
  }
}

function openGuide(mode: 'launch' | 'help'): void {
  guideOpener = document.activeElement instanceof HTMLElement ? document.activeElement : primary;
  guide = mode;
  updateMenu();
  guideBody.scrollTop = 0;
  guidePrimary.focus({ preventScroll: true });
}

function closeGuide(launch: boolean): void {
  if (launch && guide === 'launch') pendingStart = true;
  guide = null;
  updateMenu();
  if (!pendingStart) guideOpener?.focus({ preventScroll: true });
  guideOpener = null;
}

function action(): void {
  if (!scene) location.reload();
  else if (guide) closeGuide(true);
  else if (state.paused && !interrupted) pendingPause = true;
  else if (state.phase === 'title') openGuide('launch');
  else if (state.rank) pendingStart = true;
}

function choose(index: number): void {
  if (state.phase !== 'draft') return;
  const card = state.run?.cards[index];
  if (banishing && card) pendingDraft = { banish: card.id };
  else pendingDraft = { pick: state.draft[index] };
}

primary.addEventListener('click', action);
function refreshAudioControl(): void {
  audioToggle.setAttribute('aria-pressed', String(audio.muted));
  audioToggle.setAttribute('aria-label', t('audio.sound'));
  audioToggle.title = t(audio.muted ? 'audio.unmute' : 'audio.mute');
}
function toggleAudio(): void {
  audio.setMuted(!audio.muted);
  refreshAudioControl();
}
audioToggle.addEventListener('click', toggleAudio);
audioVolume.value = String(Math.round(audio.volume * 100));
audioVolume.addEventListener('input', () => audio.setVolume(audioVolume.valueAsNumber / 100));
for (const type of ['pointerdown', 'pointerup', 'click', 'keydown'] as const) {
  window.addEventListener(type, event => {
    audio.unlock(event);
    if (flightFixture) dirty = true;
  }, { capture: true });
}
$('#checkpoint-resume').addEventListener('click', resumeCheckpoint);
$('#retreat-action').addEventListener('click', () => { pendingRetreat = true; });
guidePrimary.addEventListener('click', () => closeGuide(true));
guideSkip.addEventListener('click', () => closeGuide(true));
$('#help-action').addEventListener('click', () => openGuide('help'));
draftButtons.forEach((button, index) => button.addEventListener('click', () => choose(index)));
$('#draft-reroll').addEventListener('click', () => { pendingDraft = { reroll: true }; });
$('#draft-banish').addEventListener('click', event => {
  banishing = !banishing;
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(banishing));
});
$('#draft-skip').addEventListener('click', () => { pendingDraft = { skip: true }; });
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => {
  if (touch) interruptFlight();
  resize();
});
coarse.addEventListener('change', resize);
portrait.addEventListener('change', () => {
  if (touch) interruptFlight();
  resize();
});
window.addEventListener('storage', event => {
  if (event.key !== CHECKPOINT_KEY || !persistent || state.phase !== 'title') return;
  checkpointData = readCheckpointData();
  menuKey = '';
  updateMenu();
});
root.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('gesturestart', event => event.preventDefault());
root.addEventListener('touchmove', event => {
  if (event.target instanceof Node && (guideBody.contains(event.target) || gameCard.contains(event.target)
    || draftCard.contains(event.target) || chestCard.contains(event.target))) return;
  event.preventDefault();
}, { passive: false });

function queueFlightInput(action: TimedAction<PendingFlightInput>): void {
  pendingFlightInputs = enqueueTimedAction(pendingFlightInputs, action);
}

function resolveSpaceAction(action: TimedAction<SpaceAction> | undefined, turn: number): void {
  if (!action) return;
  if (action.action === 'roll') {
    queueFlightInput({ action: { kind: 'roll', turn, spaceAt: requestedSpace?.at }, at: action.at });
  } else if (requestedSpace) {
    queueFlightInput({ action: { kind: 'maneuver', press: requestedSpace.action, spaceAt: requestedSpace.at }, at: action.at });
  }
}

function flushSpaceInput(): void {
  flightChord.reset();
  requestedSpace = undefined;
  pendingFlightInputs = [];
}

window.addEventListener('keydown', event => {
  if (graphics.recovering) {
    event.preventDefault();
    return;
  }
  // --- S7f lane ---
  const focused = document.activeElement;
  if (focused instanceof HTMLSelectElement || focused instanceof HTMLInputElement) return;
  const { code } = event;
  if (code === 'KeyM' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    toggleAudio();
    return;
  }
  if (interrupted) {
    if (code === 'Enter' || code === 'Space' || code.startsWith('Arrow')) event.preventDefault();
    return;
  }
  keys.add(code);
  if (steeringKeys.has(code)) mouseActive = false;
  if (!event.repeat && event.key === '?' && (guide || state.phase === 'title' || state.paused)) {
    event.preventDefault();
    if (guide) closeGuide(false);
    else if (scene) openGuide('help');
    return;
  }
  if (guide && (code === 'Escape' || code === 'KeyP')) {
    event.preventDefault();
    if (!event.repeat) closeGuide(false);
    return;
  }
  if (guide) {
    if (code === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      if (!event.repeat) closeGuide(true);
    }
    return;
  }
  if (code === 'Enter' || code === 'Space') {
    if (event.target instanceof HTMLButtonElement && menuKey !== 'playing') {
      if (event.repeat) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (code === 'Enter' && !event.repeat) action();
  }
  if (code.startsWith('Arrow')) event.preventDefault();
  if (event.repeat) return;
  if (state.phase === 'draft') {
    if (/^(Digit|Numpad)[123]$/.test(code)) choose(Number(code.slice(-1)) - 1);
    return;
  }
  if (code === 'KeyP' && !interrupted) pendingPause = true;
  if (state.phase === 'playing' && !state.paused) {
    if (code === 'KeyV') pendingViews++;
    const { turn, climb } = keyboardAxes();
    const barrel = code === 'KeyC'
      ? barrelRollForKey(code, flightInput().turn ?? 0, state.player.lastTurn)
      : undefined;
    if (barrel !== undefined) {
      resolveSpaceAction(flightChord.flush(event.timeStamp), turn);
      flightChord.reset();
      queueFlightInput({
        action: { kind: 'roll', turn: barrel, spaceAt: requestedSpace?.at },
        at: event.timeStamp,
      });
      return;
    }
    const kind = maneuverForKey(code, turn, climb);
    if (kind) {
      event.preventDefault();
      requestedSpace = { action: { kind, turn }, at: event.timeStamp };
      resolveSpaceAction(flightChord.pressSpace(event.timeStamp, event.shiftKey), turn);
    } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
      resolveSpaceAction(flightChord.pressShift(event.timeStamp), turn);
    }
  }
  if (code === 'KeyR' && state.rank) pendingStart = true;
});
window.addEventListener('keyup', event => keys.delete(event.code));
function updateAceLockAndRebaseFlightClock(active: boolean): void {
  const performanceTime = performance.now();
  audio.updateAceLock(state, active, performanceTime);
}

function syncAudioPause(): void {
  audio.setSuspended(!graphics.canAdvance || (touch && (document.hidden || interrupted)));
  updateAceLockAndRebaseFlightClock(false);
}

function interruptFlight(reason: 'focus' | 'graphics' = 'focus'): void {
  keys.clear();
  flushSpaceInput();
  resetTouch();
  resumeAt = 0;
  if (!scene || guide) return;
  if (reason === 'graphics') {
    if (!graphics.pauseFlight(state)) return;
  } else if (!persistent || state.phase !== 'playing' || state.paused) return;
  interrupted = true;
  syncAudioPause();
  pendingPause = false;
  carry = 0;
  if (reason === 'focus') stepStage(state, { pause: true }, ground);
  dirty = true;
  updateMenu();
}

function updateAutoResume(now: number): boolean {
  if (!interrupted || graphics.recovering) return false;
  if (document.hidden || !document.hasFocus()) {
    resumeAt = 0;
    setText('#card-copy', t('checkpoint.interrupted'));
    return false;
  }
  if (!resumeAt) resumeAt = now + 3000;
  const seconds = Math.ceil((resumeAt - now) / 1000);
  if (seconds > 0) {
    setText('#card-copy', t('checkpoint.countdown', { seconds }));
    return false;
  }
  interrupted = false;
  resumeAt = 0;
  keys.clear();
  if (!graphics.resumeFlight(state)) stepStage(state, { pause: true }, ground);
  syncAudioPause();
  dirty = true;
  return true;
}

window.addEventListener('blur', () => interruptFlight());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.updateFlight(state, 0, Infinity, scene?.cloudPass ?? 0, false);
    interruptFlight();
  } else {
    dirty = true;
  }
  syncAudioPause();
});

function loseGraphics(): void {
  if (!graphics.lose()) return;
  interruptFlight('graphics');
  carry = 0;
  audio.updateFlight(state, 0, Infinity, scene?.cloudPass ?? 0, false);
  syncAudioPause();
  graphicsOverlay.hidden = false;
  setText('#graphics-status', t('graphics.restoring'));
  const discarded = scene;
  scene = null;
  discarded?.dispose();
}

canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  loseGraphics();
  if (forcedRestore) {
    const extension = forcedRestore;
    forcedRestore = null;
    window.setTimeout(() => extension.restoreContext(), 750);
  }
});

canvas.addEventListener('webglcontextrestored', () => {
  if (!graphics.restore()) return;
  try {
    // The restored canvas retains its context. A new scene drops the old renderer's resource listeners.
    scene = createFlightScene();
    layoutFlight();
    refreshRenderQuality();
  } catch (error) {
    const lost = canvas.getContext('webgl2')?.isContextLost();
    loseGraphics();
    if (!lost) {
      setText('#graphics-status', t('menu.webgl.copy'));
      console.error(error);
    }
  }
});

function steerMouse(event: PointerEvent): void {
  if (event.pointerType === 'touch' || menuKey !== 'playing') return;
  mouseX = clamp(event.clientX * 2 / innerWidth - 1, -1, 1);
  mouseY = clamp(1 - event.clientY * 2 / innerHeight, -1, 1);
  mouseActive = true;
}
canvas.addEventListener('pointermove', steerMouse);
canvas.addEventListener('pointerleave', () => { mouseActive = false; });

function steerStick(event: PointerEvent): void {
  if (event.pointerId !== stickId) return;
  const r = stick.getBoundingClientRect();
  stickX = clamp((event.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
  stickY = clamp(((r.top + r.height / 2) - event.clientY) / (r.height / 2), -1, 1);
  const travel = r.width / 2 - 19;
  knob.style.transform = `translate(${stickX * travel}px, ${-stickY * travel}px)`;
}
stick.addEventListener('pointerdown', event => {
  if (stickId !== null) return;
  event.preventDefault();
  stickId = event.pointerId;
  stick.setPointerCapture(event.pointerId);
  steerStick(event);
});
stick.addEventListener('pointermove', steerStick);
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  stick.addEventListener(name, event => {
    if (event.pointerId !== stickId) return;
    stickId = null;
    stickX = stickY = 0;
    knob.style.transform = '';
  });
}

function bindHold(selector: string, set: (held: boolean) => void): void {
  const button = $<HTMLButtonElement>(selector);
  let id: number | null = null;
  button.addEventListener('pointerdown', event => {
    if (menuKey !== 'playing') return;
    event.preventDefault();
    id = event.pointerId;
    button.setPointerCapture(id);
    button.classList.add('held');
    set(true);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    button.addEventListener(name, event => {
      if (event.pointerId !== id) return;
      id = null;
      button.classList.remove('held');
      set(false);
    });
  }
}
bindHold('#touch-boost', held => { touchBoost = held; });
touchLoop.addEventListener('pointerdown', event => {
  if (event.button !== 0 || menuKey !== 'playing' || loopPointer) return;
  event.preventDefault();
  loopPointer = { id: event.pointerId, press: { kind: chooseManeuver(stickX, stickY), turn: stickX } };
  touchLoop.setPointerCapture(event.pointerId);
  touchLoop.classList.add('held');
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  touchLoop.addEventListener(name, event => {
    if (!loopPointer || event.pointerId !== loopPointer.id) return;
    if (name === 'pointerup' && menuKey === 'playing') {
      queueFlightInput({ action: { kind: 'maneuver', press: loopPointer.press }, at: event.timeStamp });
    }
    loopPointer = null;
    touchLoop.classList.remove('held');
  });
}
touchLoop.addEventListener('click', event => {
  if (event.detail === 0 && menuKey === 'playing') {
    queueFlightInput({ action: { kind: 'maneuver', press: { kind: chooseManeuver(stickX, stickY), turn: stickX } }, at: event.timeStamp });
  }
});
function bindPress(button: HTMLButtonElement, press: (at: number) => void): void {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || menuKey !== 'playing') return;
    event.preventDefault();
    press(event.timeStamp);
  });
  button.addEventListener('click', event => {
    if (event.detail === 0 && menuKey === 'playing') press(event.timeStamp);
  });
}
bindPress(touchPause, () => { pendingPause = true; });
bindPress(touchRoll, at => { queueFlightInput({ action: { kind: 'roll', turn: stickX }, at }); });
bindPress($<HTMLButtonElement>('#touch-view'), () => { pendingViews++; });

function keyboardAxes() {
  const move = (positive: string, positiveAlt: string, negative: string, negativeAlt: string) =>
    Number(keys.has(positive) || keys.has(positiveAlt)) - Number(keys.has(negative) || keys.has(negativeAlt));
  return { turn: move('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft'), climb: move('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown') };
}

function flightInput(): StageInput {
  const pad = navigator.getGamepads?.()[0];
  const axis = (amount = 0) => Math.abs(amount) >= 0.15 ? amount : 0;
  const keyboard = keyboardAxes();
  const turn = keyboard.turn + stickX + (mouseActive ? axis(mouseX) : 0) + axis(pad?.axes[0]);
  const climb = keyboard.climb + stickY + (mouseActive ? axis(mouseY) : 0) - axis(pad?.axes[1]);
  return {
    turn, climb,
    boost: touchBoost || keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

function advance(tickTime: number): void {
  if (!graphics.canAdvance || !scene || guide || (persistent && document.hidden)) return;
  if (query.get('fixture') === 'damage') { advanceDamageFixture(state); return; }
  if (flightFixture || fidelityFixture || freezeRoster || staticWorldFixture || rosterSheet || (bulletFixture && !bulletFixture.stress)) return;
  const before = state.tick, yaw = state.player.yaw;
  const priorSummary = state.summary;
  const wasFlying = maneuverAllowsControl(state.maneuver);
  const previousPhase = state.phase, previouslyPaused = state.paused, previousDraft = state.draft, previousReveal = state.chestReveal;
  const previousCards = previousPhase === 'draft' ? state.run?.cards : undefined;
  const previousPicks = state.picks.length;
  const launching = pendingStart;
  // --- S7d lane ---
  const launch = launching ? launchSettings() : undefined;
  if (launch && state.phase !== 'playing' && state.phase !== 'draft' && state.phase !== 'chest') world.seed = launch.seed;
  const control = options.autoplay ? autopilotInput(state, 'full', ground) : flightInput();
  resolveSpaceAction(flightChord.flush(frameNow), 0);
  const inputAtTick = takeDueActionsAtTick(pendingFlightInputs, tickTime);
  const dueInputs = inputAtTick.actions.map(input => input.action);
  const queuedInput = dueInputs.find(input => input.kind === 'roll') ?? dueInputs[0];
  const consumesRequestedSpace = consumesSpaceRequest(dueInputs, requestedSpace?.at);
  const maneuverInput = queuedInput?.kind === 'maneuver' ? queuedInput.press : undefined;
  const rollInput = queuedInput?.kind === 'roll' ? queuedInput.turn : undefined;
  const spacePending = requestedSpace && actionDueAt(requestedSpace, tickTime)
    && !consumesRequestedSpace
    ? requestedSpace.action.kind : undefined;
  stepStage(state, {
    ...control,
    start: pendingStart,
    launch,
    retreat: pendingRetreat,
    pause: pendingPause,
    maneuver: queuedInput?.kind !== 'roll' ? maneuverInput?.kind ?? control.maneuver : undefined,
    maneuverTurn: maneuverInput?.turn ?? control.maneuverTurn,
    spacePending,
    roll: queuedInput?.kind === 'roll' || control.roll,
    rollTurn: queuedInput?.kind === 'roll' ? rollInput : control.rollTurn,
    toggleView: pendingViews > 0 || control.toggleView,
    chestPick: pendingChest ?? control.chestPick,
    ...pendingDraft,
  }, ground, undefined, combatEvents ?? aceVisualEvents);
  if (bulletFixture?.stress) bulletFixture.fillStress(combatEvents);
  pendingStart = pendingPause = false;
  pendingRetreat = false;
  if (pendingViews) pendingViews--;
  pendingDraft = {};
  pendingChest = undefined;
  pendingFlightInputs = inputAtTick.pending;
  if (consumesRequestedSpace) requestedSpace = undefined;
  if (state.summary && state.summary !== priorSummary) {
    profile = state.profile;
    persistPilot();
    if (checkpointData) writeCheckpointData(null);
  }
  if (launching && state.phase === 'playing' && previousPhase !== 'playing') {
    if (checkpointData) writeCheckpointData(null);
    gearNotice = null;
    feedback.reset();
    parryNoticeUntil = 0;
    visualFreezeUntil = -Infinity;
  }
  if (state.tick < before) motion = { speed: 0, climb: 0, turn: 0 };
  if (state.tick > before) {
    const checkpoint = persistent ? encodeCheckpoint(state) : null;
    if (checkpoint) writeCheckpointData(checkpoint);
    const ease = (from: number, to: number) => from + (to - from) * 0.19;
    const delta = state.player.yaw - yaw;
    const headingDelta = Math.atan2(Math.sin(delta), Math.cos(delta));
    motion = {
      speed: ease(motion.speed, state.speed),
      climb: ease(motion.climb, state.climbRate),
      turn: !wasFlying || !maneuverAllowsControl(state.maneuver) || Math.abs(headingDelta) > Math.PI * 0.9 ? 0 : ease(motion.turn, headingDelta / STEP),
    };
  }
  if (previousCards && state.picks.length > previousPicks) {
    const card = previousCards.find(choice => choice.id === state.picks[previousPicks]);
    if (card) {
      gearNotice = { kind: 'upgrade', card, level: state.level, until: state.tick + 3 * TICKS_PER_SECOND };
      gearToast.dataset.kind = 'upgrade';
      const capped = card.id === 'damage' && card.nextLevel === card.currentLevel;
      $('#gear-toast-icon').replaceChildren(createGearIcon(capped ? 'credits' : card.id, 36));
    }
  }
  if (state.chestReveal !== previousReveal) {
    const item = state.chestReveal?.find(reward => reward.kind === 'evolution');
    if (item) {
      gearNotice = { kind: 'evolution', item, until: state.tick + 3 * TICKS_PER_SECOND };
      gearToast.dataset.kind = 'evolution';
      $('#gear-toast-icon').replaceChildren(createGearIcon(item.id, 44));
    }
  }
  if (state.phase !== previousPhase || state.paused !== previouslyPaused || state.draft !== previousDraft || state.chestReveal !== previousReveal) {
    dirty = true;
    // Open the modal synchronously, even when a slow frame processes several ticks.
    // It clears any pending flight action that arrived with the level-up.
    if (state.phase === 'draft' || state.phase === 'chest') updateMenu();
  }
}

function updateRearBombMarker(): void {
  const field = phone?.playfield;
  const offscreen = state.view === 'chase' && state.rearBombs.some(bomb => {
    const point = scene?.project(bomb);
    return !point || (field && (point.x < field.x || point.x > field.x + field.width
      || point.y < field.y || point.y > field.y + field.height));
  });
  rearBombMarker.hidden = !offscreen;
}

function updateRearDangerCue(readout: RadarReadout, reversalReady: boolean): void {
  const { rearDanger: danger, rearPursuit: pursuit } = readout;
  const running = state.phase === 'playing' && !state.paused;
  if (!running || state.view !== 'cockpit') mirrorThreat.clear();
  const threat = running && state.view === 'cockpit' ? mirrorThreat.update(state) : null;
  const neutral = state.view === 'chase' && readout.rearMarks.length > 0;
  rearDangerCue.hidden = !running || (!danger && !pursuit && !neutral && !threat);
  if (rearDangerCue.hidden) return;

  const mirror = scene?.cockpitMirror;
  const docked = !!mirror && mirror.width >= 94;
  rearDangerCue.dataset.docked = String(docked);
  rearDangerCue.dataset.danger = String(!!danger || !!pursuit);
  if (mirror && docked) {
    rearDangerCue.style.setProperty('--rear-left', `${mirror.x + 3}px`);
    rearDangerCue.style.setProperty('--rear-right', `${innerWidth - mirror.x - mirror.width + 3}px`);
    rearDangerCue.style.setProperty('--rear-bottom', `${innerHeight - mirror.y - mirror.height + 3}px`);
  }
  let position = '▼', description = t('hud.rear');
  let action = danger && reversalReady ? (touch ? t('control.loop') : `SPACE ${t('hud.rearReverse')}`)
    : danger ? t('hud.rearEvade') : readout.rearMarks.join(' ');
  if (danger) description = t('hud.rearDanger');
  // --- S7e lane ---
  else if (pursuit) {
    description = t(pursuit.kind === 'ace' ? 'hud.aceTail' : 'hud.rosterTail');
    const p = state.player;
    const lateral = (pursuit.x - p.x) * Math.cos(p.yaw) - (pursuit.z - p.z) * Math.sin(p.yaw);
    position = lateral < -pursuit.range * 0.25 ? '←' : lateral > pursuit.range * 0.25 ? '→' : '▼';
    action = (scene?.rearView?.width ?? 0) < 74 ? description : t(reversalReady ? 'hud.rearReverse' : 'hud.rearEvade');
  }
  else if (threat) {
    const bearing = { Left: '←', Centre: '•', Right: '→' }[threat.side];
    const altitude = { Above: '↑', Level: '=', Below: '↓' }[threat.height];
    position = bearing + altitude;
    description += ` · ${t(`hud.rear${threat.side}`)} ${t(`hud.rear${threat.height}`)}`;
    const kind = (['j-turn', 'immelmann', 'split-s'] as const)
      .find(kind => canManeuver(state, kind) && inBand(threat.alt,
        exitAltitude(state.player.altitude, kind, ground(state.player.x, state.player.z), !!state.player.skim)));
    const seconds = Math.ceil((state.maneuverReadyAt - state.tick) / TICKS_PER_SECOND);
    if (kind) {
      const direction = kind === 'immelmann' ? '↑' : kind === 'split-s' ? '↓' : threat.lateral < 0 ? '←' : '→';
      action = `${t('hud.reverseShort')} ${direction}`;
    } else {
      action = seconds > 0 ? t('hud.rearCooldown', { seconds }) : t('hud.rearEvade');
    }
  }
  setText('#rear-position', position);
  setText('#rear-danger-action', action);
  rearDangerCue.setAttribute('aria-label', `${description} · ${action}`);
}

function updateRearViewCue(readout: RadarReadout): void {
  const rect = scene?.rearView;
  const pursuit = readout.rearPursuit;
  const hit = state.rearGlimpse?.kind === 'flare' && !!state.flareHit && state.tick < state.flareHit.until;
  const active = !!state.rearGlimpse && state.tick < state.rearGlimpse.until;
  rearViewCue.hidden = !rect || rect.width < 74 || state.phase !== 'playing' || state.paused || (!active && !hit && !pursuit);
  if (rearViewCue.hidden || !rect) return;
  setText('#rear-view-cue', t(hit ? 'hud.flareHit' : pursuit?.kind === 'ace' ? 'hud.aceTail' : pursuit ? 'hud.rosterTail' : 'hud.rearView'));
  rearViewCue.dataset.hit = String(hit);
  rearViewCue.dataset.pursuit = String(!!pursuit);
  rearViewCue.style.left = `${rect.x + 4}px`;
  rearViewCue.style.top = `${rect.y + 4}px`;
  rearViewCue.style.maxWidth = `${rect.width - 8}px`;
}

function render(now: number): boolean {
  if (layoutView !== state.view) layoutFlight();
  // The impact holds the scene and projected canopy instruments. The flight clock keeps ticking.
  const redrawFlight = graphics.recovering || now >= visualFreezeUntil || dirty || lastRenderTick < 0;
  const yaw = maneuverViewYaw(state);
  const readout = buildRadar(state, yaw);
  rearDanger = readout.rearDanger;
  const ladder = redrawFlight ? scene?.draw(state, !!rearDanger || !!readout.rearPursuit, readout.rearPursuit ?? undefined) : undefined;
  if (ladder === null) {
    loseGraphics();
    return false;
  }
  const audioActive = graphics.canAdvance && effectsEnabled && !document.hidden && !guide && state.phase === 'playing' && !state.paused;
  if (scene) audio.updateFlight(state, scene.speedFeel.boost, scene.speedFeel.clearance, scene.cloudPass, audioActive);
  updateAceLockAndRebaseFlightClock(audioActive);
  updateHud(readout);
  updateManeuverCue();
  updateRearBombMarker();
  updateRearViewCue(readout);
  const progress = 1 - state.wipe / WIPE_DURATION;
  wipe.hidden = state.wipe <= 0;
  if (!wipe.hidden) wipe.style.top = `${progress * 100}%`;
  const p = state.player;
  const lookahead = Math.max(27, state.speed * 0.68);
  const clearance = p.altitude - Math.max(ground(p.x, p.z), ground(p.x + Math.sin(p.yaw) * lookahead, p.z + Math.cos(p.yaw) * lookahead));
  let cautions = 0;
  if (audioActive) {
    if (rearDanger) cautions |= 1;
    if (hudHullTone(state.hull) !== 'normal') cautions |= 2;
    if (cockpit) {
      const warnings = cockpitWarnings(state, clearance, motion.climb, audioCockpitWarnings);
      if (warnings.terrain === 'pullUp') cautions |= 4;
      if (warnings.boost === 'low') cautions |= 8;
    }
    if (cautions & ~lastAudioCautions) audio.play('warning');
  }
  lastAudioCautions = cautions;
  describeFlight(readout, clearance);
  const deltaIndicator = $('#cockpit-delta');
  const instrumentTrack = cockpit && maneuverAllowsControl(state.maneuver) ? readout.priority : null;
  cockpitDelta = instrumentTrack ? altitudeDeltaText(instrumentTrack.alt - p.altitude, t) : null;
  deltaIndicator.hidden = cockpitDelta === null;
  if (cockpitDelta) {
    setText('#cockpit-delta', cockpitDelta);
    deltaIndicator.setAttribute('aria-label', `${t('hud.altitude')} ${cockpitDelta}`);
  }
  if (cockpit && scene && redrawFlight) {
    const settling = Math.cos(yaw - p.yaw) < 0.999;
    const aim = scene.project({ x: p.x + Math.sin(p.yaw) * 100, z: p.z + Math.cos(p.yaw) * 100, alt: p.altitude }) ??
      (settling ? null : { x: innerWidth / 2, y: cockpit.aiming.y + cockpit.aiming.height / 2 });
    const mirror = scene.cockpitMirror;
    const markers = cockpitMarkers.update(state, cockpit, scene, mirror, rearDanger, readout.rearPursuit);
    const impact = state.invulnerability > 0.72 ? (state.invulnerability - 0.72) * 3.6 : 0;
    feedbackAnchor = aim;
    cockpitDisplay.draw(state, aim, ladder ?? [],
      motion, clearance, impact, readout, markers, cockpitMarkers.obstructions, mirror, instrumentTrack?.alt, language, t);
  } else if (!cockpit && (lastRadarTick === null || state.tick - lastRadarTick >= 3 || state.tick < lastRadarTick)) {
    navRadar.draw(radarContext, 0, 0, readout, yaw, state.tick);
    if (!arenaMap.hidden) drawArenaMap(mapContext, state, t, font, yaw);
    lastRadarTick = state.tick;
  }
  if (!cockpit) {
    feedbackAnchor = null;
    if (scene && feedback.needsAnchor(state, cueTime || now)) {
      feedbackTarget.x = p.x;
      feedbackTarget.z = p.z;
      feedbackTarget.alt = state.view === 'overhead' ? 155 : p.altitude;
      scene.projectContact(feedbackTarget, projectedShip);
      if (projectedShip.depth > 0.05) feedbackAnchor = projectedShip;
    }
  }
  dirty = false;
  return true;
}

Object.defineProperty(window, '__game', { get: () => Object.freeze({
  tick: state.tick, elapsed: state.tick / TICKS_PER_SECOND, seed: state.seed, phase: state.phase, paused: state.paused,
  view: state.view, airspace: { ...state.arena }, objective: objectiveText(), altitude: state.player.altitude,
  player: { ...state.player }, hull: state.hull, boost: state.boost, boosting: state.boosting,
  speed: state.speed, boostTicks: state.boostTicks, speedFeel: scene && { ...scene.speedFeel },
  rearBombs: state.rearBombs.map(bomb => ({ ...bomb })),
  flares: state.flares.map(flare => ({ ...flare })),
  flareHit: state.flareHit && { ...state.flareHit },
  rearGlimpse: state.rearGlimpse && { ...state.rearGlimpse, target: state.rearGlimpse.target && { ...state.rearGlimpse.target } },
  rearView: scene?.rearView && { ...scene.rearView },
  rearDanger: rearDanger && { ...rearDanger },
  rearDangerCue: rearDangerCue.hidden ? null : rearDangerCue.getAttribute('aria-label'),
  reversal: state.reversal && { ...state.reversal, pursuers: [...state.reversal.pursuers], killTicks: [...state.reversal.killTicks] },
  reversalCue: reversalCue.hidden ? null : reversalCue.textContent,
  maneuver: state.maneuver && { ...state.maneuver, ...maneuverAttitude(state.maneuver, state.player.bank),
    controllable: maneuverAllowsControl(state.maneuver) },
  maneuverTrail: state.maneuverTrail && { ...state.maneuverTrail, points: state.maneuverTrail.points.map(point => ({ ...point })),
    pursuers: [...state.maneuverTrail.pursuers] },
  cameraYaw: maneuverViewYaw(state),
  maneuverReadyAt: state.maneuverReadyAt, bodyGraceUntil: state.bodyGraceUntil,
  roll: state.roll && { ...state.roll }, rollReadyAt: state.rollReadyAt,
  rank: state.rank, fps: Math.round(fps), level: state.level, xp: state.xp, score: state.score,
  salvage: state.salvage, salvageBands: [...state.salvageBands], draftIds: [...state.draft], picks: [...state.picks],
  twinRank: state.twinRank, podRank: state.podRank, enemyCount: state.enemies.length, shotCount: state.shots.length,
  kills: state.kills, fodderCount: state.enemies.filter(enemy => enemy.kind === 'gnat').length,
  swarmEvent: state.swarmNotice && { ...state.swarmNotice },
  formationCount: state.enemies.filter(enemy => enemy.eventFlight).length,
  recoveringOrbs: state.pickups.filter(pickup => pickup.recovery).length,
  hostileCount: state.shots.filter(shot => shot.kind === 'hostile').length, invulnerability: state.invulnerability,
  heat: state.heat, daily: state.daily, maxHull: state.maxHull, billsPaid: state.bills.paid,
  weaponLevels: state.run?.weaponLevels, buffLevels: state.run?.buffLevels, swarmCap: state.swarmCap,
  tracers: state.shots.filter(shot => shot.reversal || shot.kind === 'strafe').map(shot => ({
    kind: shot.reversal ? 'reversal' : shot.kind, x: shot.x, z: shot.z, alt: shot.alt, vx: shot.vx, vz: shot.vz,
    vy: shot.kind === 'strafe' ? shot.vy : 0,
  })),
  enemyContacts: state.enemies.map(({ id, kind, gnatVariant, x, z, alt, hp, burnUntil, flyby }) => (
    { id, kind, gnatVariant, x, z, alt, hp, burnUntil, flyby: flyby?.phase ?? null, flybySide: flyby?.side }
  )),
  mineCount: state.enemyMines.length,
  bossHp: state.boss?.hp ?? null,
  ace: state.boss && { phase: state.boss.phase, tail: state.boss.tail, boosting: state.boss.boosting,
    roll: state.boss.roll && { ...state.boss.roll }, tell: state.boss.tell && { ...state.boss.tell }, defeatedAt: state.boss.defeatedAt },
  lock: state.lock && { ...state.lock }, cockpitDelta, cockpitMarkers: cockpit && scene ? cockpitMarkers.snapshot() : [],
  wipe: state.wipe, missedVolleys: state.effects.filter(effect => effect.kind === 'miss').length,
  // --- S7f lane ---
  renderQuality: { preferred: preferredRenderQuality, active: scene?.renderQuality, width: canvas.width, height: canvas.height },
  ...(glDebug ? { graphics: graphics.status } : {}),
  layout: phone && { orientation: phone.orientation, buffer: { width: canvas.width, height: canvas.height }, playfield: { ...phone.playfield },
    controls: { ...phone.controls }, dashboard: phone.dashboard && { ...phone.dashboard } },
}) });

function showReversalImpact(): void {
  if (reducedMotion.matches) {
    reversalFlash.animate([{ opacity: 0.24 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' });
    return;
  }
  // Move the view and its projected markings together while the rest of the HUD stays still.
  const keyframes = ['-1px 1px', '1px -1px', '-1px 0px', '0px 0px'].map(translate => ({ translate, easing: 'steps(1, end)' }));
  canvas.animate(keyframes, 120);
  if (state.view === 'cockpit') cockpitLayer.animate(keyframes, 120);
}

function animate(now: number): void {
  aceFireCue = null;
  damageFeedback.beginFrame();
  frameNow = now;
  const rafFrameStart = previousTime;
  const elapsed = Math.max(0, (now - rafFrameStart) / 1000);
  previousTime = now;
  if (scene?.contextLost) loseGraphics();
  if (scene && !forceUsed && forcedLossTick !== null && state.tick >= forcedLossTick) {
    forceUsed = true;
    forcedRestore = scene.lossExtension();
    if (forcedRestore) {
      forcedRestore.loseContext();
      loseGraphics();
    }
  }
  if (graphics.recovering) {
    carry = 0;
    if (graphics.status === 'restoring' && scene && render(now) && !scene?.terrainPending && graphics.frameReady()) {
      graphicsOverlay.hidden = true;
      syncAudioPause();
      dirty = true;
    }
    requestAnimationFrame(animate);
    return;
  }
  if (elapsed > 0 && elapsed < 0.25) fps += (1 / elapsed - fps) * 0.08;
  const resumed = updateAutoResume(now);
  const stepStart = Math.max(rafFrameStart, hitstopUntil);
  const acceptedElapsed = resumed ? 0 : Math.min(0.2, elapsed, Math.max(0, (now - hitstopUntil) / 1000));
  const stepTimes = resumed
    ? (carry = 0, { times: [], carry: 0 })
    : simulationStepTimesForFrame(stepStart, acceptedElapsed, carry, STEP);
  carry = stepTimes.carry;
  const audioAnchor = audio.aceLockPerformanceTimeForTick(state.tick);
  const tickTimes = audioAnchor === undefined
    ? stepTimes.times
    : mapSimulationStepTimesToAudioTicks(
      stepTimes.times, state.tick, tick => audio.aceLockPerformanceTimeForTick(tick),
    );
  for (const tickTime of tickTimes) {
    if (scene?.contextLost) {
      loseGraphics();
      break;
    }
    const burst = state.reversal?.burstAt;
    advance(tickTime);
    const nextBurst = state.reversal?.burstAt;
    if (nextBurst !== undefined && nextBurst !== burst) {
      hitstopUntil = now + REVERSAL_HITSTOP_MS;
      carry = 0;
      showReversalImpact();
      break;
    }
  }
  updateAceLockAndRebaseFlightClock(graphics.canAdvance && effectsEnabled && !document.hidden && !guide
    && state.phase === 'playing' && !state.paused);
  if (graphics.recovering) {
    requestAnimationFrame(animate);
    return;
  }
  const timingFlight = state.phase === 'playing' && !state.paused && !document.hidden && !guide
    && !flightFixture && !fidelityFixture && !freezeRoster && !staticWorldFixture && !rosterSheet && (!bulletFixture || bulletFixture.stress);
  if (scene?.observeRenderFrame(timingFlight ? elapsed * 1000 : null)) {
    refreshRenderQuality();
    dirty = true;
  }
  if (dirty || scene?.terrainPending || state.tick !== lastRenderTick || state.phase !== lastRenderPhase) {
    if (render(now)) {
      lastRenderTick = state.tick;
      lastRenderPhase = state.phase;
    }
  }
  if (effectsEnabled) feedback.update(state, t, feedbackAnchor, scene?.cockpitMirror ?? scene?.rearView ?? null, cueTime || now);
  drawDamageFeedback();
  if (scene && !guide && !rosterSheet) drawAceLocks(damageContext, state, scene, cockpit?.aiming ?? phone?.playfield, aceFireCue);
  requestAnimationFrame(animate);
}

function drawDamageFeedback(): void {
  if (damageCanvas.width !== innerWidth || damageCanvas.height !== innerHeight) {
    damageCanvas.width = innerWidth; damageCanvas.height = innerHeight;
  }
  const ctx = damageContext, now = state.tick / 60;
  ctx.clearRect(0, 0, damageCanvas.width, damageCanvas.height);
  const kills = damageFeedback.count(state.kills, now);
  const counter = $('#kill-counter');
  counter.hidden = state.phase !== 'playing' || kills === 0;
  counter.textContent = `×${kills} · 5s`;
  $('#damage-numbers-label').textContent = language === 'ko' ? '피해 숫자' : 'Damage numbers';
  if (!damageNumbers || !effectsEnabled || state.phase !== 'playing' || guide) return;
  ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#10141d';
  for (const slot of damageFeedback.slots) {
    const age = now - slot.born;
    if (age < 0 || age >= DAMAGE.lifetime) continue;
    const point = scene?.project(slot);
    if (!point) continue;
    ctx.globalAlpha = Math.min(1, (DAMAGE.lifetime - age) * 4);
    ctx.font = `bold ${slot.big ? DAMAGE.bigFontSize : DAMAGE.fontSize}px Galmuri11, monospace`;
    ctx.fillStyle = slot.big ? '#ffbf63' : '#fff5c9';
    const text = `${Math.round(slot.damage * 10) / 10}${slot.big ? '!' : ''}`;
    const y = point.y - 24 - age * DAMAGE.riseSpeed;
    ctx.strokeText(text, point.x, y); ctx.fillText(text, point.x, y);
  }
  ctx.globalAlpha = 1;
}

async function start(): Promise<void> {
  try {
    await document.fonts.load('12px "Galmuri11"', '한국어');
  } catch {
    // CSS retains the system font fallback.
  }
  resize();
  applyLanguage();
  previousTime = performance.now();
  // --- S7f lane ---
  if (flightFixture || fidelityFixture || rosterSheet) {
    frameNow = previousTime;
    if (rosterSheet) primeRosterSheet(state, rosterSheet, ground);
    else if (fidelityFixture) primeFidelityFixture(state, query);
    else primeFlightFixture(state, query, ground, combatEvents);
    cueTime = frameNow;
  }
  if (bulletFixture) {
    frameNow = previousTime;
    primingBullets = true;
    bulletFixture.prime(combatEvents);
    primingBullets = false;
    if (!bulletFixture.stress) cueTime = frameNow;
  }
  motion.speed = state.speed;
  motion.climb = state.climbRate;
  requestAnimationFrame(animate);
}

void start();
