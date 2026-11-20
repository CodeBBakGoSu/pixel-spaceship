import './style.css';
import { autopilotInput, seekStage } from './autoplay.ts';
import { updateBillDisplay } from './bill-display.ts';
import type { Segment } from './camera.ts';
import { CockpitDisplay } from './cockpit-display.ts';
import { CockpitMarkers } from './cockpit-markers.ts';
import { cockpitWarnings, reversalCharge, type CockpitMotion } from './cockpit.ts';
import { BUFF_IDS, CHESTS, DRAFT_RULES, EVOLUTIONS, WEAPON_IDS } from './data/items.ts';
import type { Heat } from './data/meta.ts';
import { isNewEnemyKind } from './enemy-kinds.ts';
import { createTranslator, initialLanguage, saveLanguage, type Language, type MessageKey } from './i18n.ts';
import { createHangarDisplay } from './hangar-display.ts';
import { altitudeDeltaText, beaconTrack, buildRadar, drawArenaMap, RadarDisplay, RADAR_RANGE, RearMirrorThreat, relativeMark,
  type RadarReadout, type RearDanger } from './instruments.ts';
import { cockpitLayout, desktopLayout, guideLayout, phoneLayout, type CockpitLayout, type HudLayout, type Insets, type PhoneLayout, type Rect } from './layout.ts';
import { activeTrail, canManeuver, chooseManeuver, exitAltitude, formerPursuer, MANEUVERS, maneuverAllowsControl, maneuverAttitude,
  maneuverForKey, maneuverViewYaw, trailEnd } from './maneuvers.ts';
import { dailySeed, normalizeHeat, normalizeProfile, purchaseUpgrade, type Profile } from './meta.ts';
import { BEACON_SIGNAL_SECONDS, isLandmarkId } from './reach.ts';
import { FlightScene } from './scene.ts';
import { activeWeakPoint, bossTick, chestEvolutions, endTick, parseStageOptions, requiredXp, stepStage } from './stage.ts';
import { bombCapacity, bombReloadTicks, canDropFlare, clamp, flareCapacity, inBand, MAX_ALTITUDE, MIN_ALTITUDE, STEP,
  TICKS_PER_SECOND, WIPE_DURATION } from './stage-combat.ts';
import type { ChestReward, DraftId, Effect, LegacyDraftId, ManeuverKind, Outcome, StageInput } from './stage-types.ts';
import { World } from './world.ts';

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
const chestAction = $<HTMLButtonElement>('#chest-action');
const draftButtons = [...draftCard.querySelectorAll<HTMLButtonElement>('[data-pick]')];
const touchControls = $('#touch-controls');
const touchPause = $<HTMLButtonElement>('#touch-pause');
const touchLoop = $<HTMLButtonElement>('#touch-loop');
const touchBomb = $<HTMLButtonElement>('#touch-bomb');
const touchFlare = $<HTMLButtonElement>('#touch-flare');
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
const hullBar = $('#hull-bars');
const hullWarning = $('#hull-warning');
const hullSegments = [...hullBar.children];
let paintedHull = -1;
let paintedMaxHull = -1;
const mirrorThreat = new RearMirrorThreat();
const radar = $<HTMLCanvasElement>('#nav-radar'), radarContext = radar.getContext('2d')!;
const arenaMap = $<HTMLCanvasElement>('#arena-map'), mapContext = arenaMap.getContext('2d')!;
const font = getComputedStyle(document.documentElement).getPropertyValue('--game-font').trim();
const navRadar = new RadarDisplay();
const cockpitDisplay = new CockpitDisplay($<HTMLCanvasElement>('#cockpit-overlay'), font);
const cockpitMarkers = new CockpitMarkers();
const world = new World();
const ground = (x: number, z: number) => world.height(x, z);
const coarse = matchMedia('(pointer: coarse)'), portrait = matchMedia('(orientation: portrait)');
const query = new URLSearchParams(location.search);
if (!query.has('mode') && !query.has('fixture')) query.set('mode', 'survivors');
const options = parseStageOptions(query.toString());
options.mobile = options.touch || coarse.matches;
const PROFILE_KEY = 'aster-wing.pilot.v1';
const persistent = options.mode === 'survivors' && !options.autoplay && !options.fixture && options.time === null;
let profile = persistent ? readPilot() : normalizeProfile(null);
options.profile = profile;
const state = seekStage(options, ground);
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
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
try {
  scene = new FlightScene(canvas, world, state.arena);
} catch (error) {
  console.error(error);
}

const keys = new Set<string>();
const steeringKeys = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
let touch = false, phone: PhoneLayout | null = null, cockpit: CockpitLayout | null = null;
let hud: HudLayout, layoutView: Segment | null = null;
let safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
let guide: 'launch' | 'help' | null = null;
let guideOpener: HTMLElement | null = null;
let menuKey = '';
let renderedDraft: DraftId[] | null = null;
let renderedChest: ChestReward[] | null = null;
let banishing = false;
let dirty = true, lastRadarTick: number | null = null, lastFlightKey = '';
let pendingStart = false, pendingPause = false, pendingBomb = false, pendingFlare = false, pendingViews = 0;
let pendingDraft: Pick<StageInput, 'pick' | 'reroll' | 'banish' | 'skip'> = {};
let pendingChest: StageInput['chestPick'];
type ManeuverPress = { kind: ManeuverKind; turn: number };
let pendingManeuver: ManeuverPress | undefined;
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
let helpTimer = 0, lastHelp = '';
let motion: CockpitMotion = { speed: 0, climb: 0, turn: 0 };
let cockpitDelta: string | null = null;
let rearDanger: RearDanger | null = null;
const textNodes = new Map<string, HTMLElement>();

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
  for (const button of languageButtons) button.setAttribute('aria-pressed', String(button.dataset.lang === language));
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

function setRect(name: string, box: Rect): void {
  for (const [part, value] of Object.entries({ x: box.x, y: box.y, w: box.width, h: box.height })) {
    root.style.setProperty(`--${name}-${part}`, `${value}px`);
  }
}

function layoutFlight(): void {
  layoutView = state.view;
  phone = touch ? phoneLayout(innerWidth, innerHeight, safe, state.view) : null;
  hud = phone ?? desktopLayout(innerWidth, innerHeight, safe);
  for (const key of ['hud', 'boss', 'radio', 'objective', 'radar', 'alt'] as const) setRect(key, hud[key]);
  if (phone) {
    for (const key of ['playfield', 'controls', 'pause', 'stick', 'loop', 'boost', 'bomb', 'flare', 'view'] as const) setRect(key, phone[key]);
  }
  cockpit = state.view === 'cockpit' ? phone?.cockpit ?? cockpitLayout(innerWidth, innerHeight, safe, hud.objective) : null;
  if (cockpit) {
    setRect('cockpit-message', cockpit.message);
    if (cockpit.help) setRect('cockpit-help', cockpit.help);
    root.style.setProperty('--maneuver-center-y', `${Math.round(cockpit.aiming.y + cockpit.aiming.height * 0.42)}px`);
  }
  cockpitDisplay.resize(cockpit, innerWidth, innerHeight, language, t);
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
  if (fixture === 'flare' && state.tick >= 30 * TICKS_PER_SECOND && state.tick < 40 * TICKS_PER_SECOND) {
    return t('hud.flareDemo', { control: touch ? t('control.flareShort') : 'C' });
  }
  if (isNewEnemyKind(fixture) && state.enemies.some(enemy => enemy.kind === fixture)) return t(`enemy.${fixture}`);
  if (isLandmarkId(fixture) && state.tick >= BEACON_SIGNAL_SECONDS * TICKS_PER_SECOND && !state.boss) return t(`landmark.${fixture}`);
  const p = state.player, beacon = state.view !== 'overhead' ? beaconTrack(state) : null;
  const dx = beacon ? beacon.x - p.x : 0, dz = beacon ? beacon.z - p.z : 0;
  const range = Math.hypot(dx, dz);
  const bearing = (Math.round(Math.atan2(dx, dz) * 180 / Math.PI) + 360) % 360;
  const navigation = beacon && (range > RADAR_RANGE || !state.boss) ? ` · ${String(bearing).padStart(3, '0')}°` : '';
  const point = activeWeakPoint(state);
  if (!point || !state.boss) {
    if (beaconTrack(state)) return t('objective.beacon', { bearing: navigation });
    if (state.run) return t('objective.survivors', { time: clockText(bossTick(state) / TICKS_PER_SECOND) });
    return t(state.tick < 40 * TICKS_PER_SECOND ? 'objective.reach' :
      state.tick < bossTick(state) ? 'objective.waves' : 'objective.boss');
  }
  const seconds = Math.ceil((state.boss.exposeTick - state.tick) / TICKS_PER_SECOND);
  if (state.view === 'overhead') return point.exposed ? t('objective.boss') : t('objective.bossSignal', { seconds });
  const part = t(point.kind === 'core' ? 'boss.core' : point.band === 2 ? 'boss.high' : point.band === 1 ? 'boss.mid' : 'boss.low');
  return (point.exposed ? t('objective.bandOpen', { part }) : t('objective.bandSignal', { part, seconds })) + navigation;
}

function clockText(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function drawPortrait(warden: boolean): void {
  const c = $<HTMLCanvasElement>('#portrait').getContext('2d')!;
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  rect(warden ? '#41262d' : '#163d45', 0, 0, 32, 32);
  rect(warden ? '#813e3d' : '#3d8974', 2, 3, 8, 2);
  rect(warden ? '#813e3d' : '#3d8974', 22, 5, 8, 2);
  rect(warden ? '#606b70' : '#8a745f', 7, 10, 18, 16);
  rect('#222d35', 9, 7, 14, 5);
  rect('#17212b', 8, 26, 16, 6);
  rect(warden ? '#b25b59' : '#d7c3a0', 11, 13, 11, 8);
  rect('#f0e8d0', 17, 14, 5, 5);
  rect('#161d27', 19, 15, 2, 3);
  rect(warden ? '#bd5c4b' : '#f4a34d', 20, 19, 10, 4);
}

function updateRadio(): void {
  const sec = state.tick / TICKS_PER_SECOND;
  const wardenIn = (state.tick - bossTick(state)) / TICKS_PER_SECOND;
  const message = state.phase === 'title' ? null : sec < 5 ? 'dialogue.reachArrival' :
    sec >= 22 && sec < 26 ? 'dialogue.stack' : wardenIn >= 0 && wardenIn < 3 ? 'dialogue.warden' : null;
  $('#radio').hidden = !message;
  if (!message || lastFlightKey === message) return;
  lastFlightKey = message;
  const warden = message === 'dialogue.warden';
  drawPortrait(warden);
  setText('#radio-speaker', t(warden ? 'speaker.warden' : 'speaker.opal'));
  setText('#radio-text', t(message));
}

function updateHud(readout: RadarReadout): void {
  updateBillDisplay(state, t);
  const notice = state.phaseNotice, banner = $('#phase-banner');
  banner.hidden = !notice || state.phase !== 'playing' || state.paused;
  if (notice && !banner.hidden) {
    const context = notice.phase === 'storm' && notice.kind === 'lull' ? t('phase.wardenInbound') : t(`phase.${notice.phase}`);
    const lull = notice.kind === 'lull'
      ? ' · ' + (notice.repaired ? t('phase.lullRepair', { hull: notice.repaired }) : t('phase.lull')) : '';
    setText('#phase-banner', context + lull);
  }
  if (paintedMaxHull !== state.maxHull) {
    while (hullSegments.length > state.maxHull) hullSegments.pop()?.remove();
    while (hullSegments.length < state.maxHull) {
      const segment = document.createElement('i');
      hullSegments.push(segment);
      hullBar.append(segment);
    }
    hullBar.style.setProperty('--hull-slots', String(state.maxHull));
    paintedMaxHull = state.maxHull;
    paintedHull = -1;
  }
  if (state.hull !== paintedHull) {
    hullSegments.forEach((segment, index) => segment.classList.toggle('filled', index < state.hull));
    paintedHull = state.hull;
  }
  setText('#hull-value', `${state.hull}/${state.maxHull}`);
  hullWarning.hidden = state.hull > state.maxHull / 4;
  hullBar.classList.toggle('critical', !hullWarning.hidden);
  $('#boost-bar').style.width = `${state.boost * 100}%`;
  const maxBombs = bombCapacity(state), maxFlares = flareCapacity(state);
  setText('#bombs', '◆'.repeat(state.bombs) + '◇'.repeat(Math.max(0, maxBombs - state.bombs)));
  const refill = state.bombReloadAt === null ? 1 : 1 - (state.bombReloadAt - state.tick) / bombReloadTicks(state);
  $('#bomb-reload-bar').style.width = `${Math.round(clamp(refill, 0, 1) * 100)}%`;
  touchBomb.setAttribute('aria-disabled', String(!state.bombs || !maneuverAllowsControl(state.maneuver)
    || state.tick <= state.graceUntil || state.tick < state.bombReadyAt));
  touchBomb.setAttribute('aria-label', `${t('control.bomb')} · ${state.bombs}/${maxBombs}`);
  const flareReady = canDropFlare(state);
  setText('#flare-stock', t('cockpit.flares', { count: state.flareCharges, max: maxFlares }));
  $('#flare-stock').dataset.ready = String(flareReady);
  touchFlare.setAttribute('aria-disabled', String(!flareReady));
  touchFlare.setAttribute('aria-label', `${t('control.flare')} · ${state.flareCharges}/${maxFlares}`);
  const ready = canManeuver(state, 'immelmann');
  const loopSeconds = Math.max(0, Math.ceil((state.maneuverReadyAt - state.tick) / TICKS_PER_SECOND));
  const loopKey: MessageKey = state.maneuver ? `maneuver.${state.maneuver.kind}` : loopSeconds ? 'hud.loopCooldown' : 'hud.loopReady';
  const keyboard = keyboardAxes();
  const selected = touch ? chooseManeuver(stickX, stickY) : chooseManeuver(keyboard.turn, keyboard.climb);
  const lowBoost = ready && selected === 'j-turn' && state.boost < MANEUVERS['j-turn'].boost;
  setText('#loop-status', t(lowBoost ? 'hud.jTurnLow' : loopKey, { seconds: loopSeconds }));
  const loopStatus = $('#loop-status');
  loopStatus.dataset.ready = String(ready && !lowBoost);
  const charge = reversalCharge(state);
  loopStatus.style.setProperty('--loop-charge', `${Math.round(clamp(charge, 0, 1) * 100)}%`);
  touchLoop.setAttribute('aria-disabled', String(!ready || lowBoost));
  updateRearDangerCue(readout, ready && !lowBoost, flareReady);
  setText('#view-label', t(`view.${state.view}`));
  const cost = requiredXp(state.level, !!state.run);
  const xp = Math.min(cost ?? 0, state.xp);
  const stats = { level: state.level, xp, cost: cost ?? 0 };
  setText('#xp-label', t(cost === null ? 'hud.xpMax' : 'hud.xp', stats));
  $('#xp-label').style.setProperty('--xp-fill', `${cost === null ? 100 : 100 * xp / cost}%`);
  const time = Math.max(0, Math.ceil((endTick(state) - state.tick) / TICKS_PER_SECOND));
  setText('#segment-timer', clockText(time));
  setText('#score', String(state.score).padStart(6, '0'));
  setText('#salvage', `◆ ${state.salvage}`);
  setText('#objective', objectiveText());
  setText('#alt-number', String(Math.round(state.player.altitude)));
  $('#alt-marker').style.top = `${(MAX_ALTITUDE - state.player.altitude) * 100 / (MAX_ALTITUDE - MIN_ALTITUDE)}%`;
  const boss = state.boss;
  const hp = boss?.weakPoints.reduce((sum, point) => sum + point.hp, 0) ?? 0;
  $('#boss-hud').hidden = !hp;
  if (boss && hp) $('#boss-health').style.width = `${100 * hp / boss.weakPoints.reduce((sum, point) => sum + point.maxHp, 0)}%`;
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
  const flak = state.enemies.some(enemy => enemy.tell?.kind === 'flak'
    && Math.hypot(p.x - enemy.tell.x, p.z - enemy.tell.z) < 85);
  const spotter = state.enemies.some(enemy => enemy.tell?.kind === 'snipe' && Math.hypot(p.x - enemy.x, p.z - enemy.z) < 165);
  const mine = !top && state.enemyMines.some(mine => Math.hypot(p.x - mine.x, p.z - mine.z) < 46);
  let message: MessageKey | null = null;
  let threat = '';
  if (state.boundaryWarning) message = 'hud.boundary';
  else if (warnings.terrain === 'pullUp') message = 'cockpit.pullUp';
  else if (flak) message = 'hud.flakWarning';
  else if (spotter) message = 'hud.spotterWarning';
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
  else if (state.tick < state.bombReadyAt) message = 'hud.bombAway';
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
    const point = mark !== '=' && scene?.project(contact);
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

function updateChestMenu(): void {
  const chest = CHESTS.find(chest => chest.id === state.chests.offer);
  const evolving = chest?.kind === 'evolution';
  const reward = state.chestReveal;
  const choices = $('#chest-choices'), reels = $('#chest-reels');
  const candidates = reward ? [] : chestEvolutions(state);
  setText('#chest-kicker', t(!chest ? 'bill.cache' : evolving ? 'chest.evolution' : 'chest.supply'));
  setText('#chest-heading', t(reward ? 'chest.rewards' : evolving ? 'chest.evolution' : 'chest.supply'));
  setText('#chest-detail', reward ? '' : t(candidates.length ? 'chest.pick' : evolving ? 'chest.fallback' : 'chest.supplyCopy'));
  $('#chest-kicker').hidden = !reward;
  $('#chest-detail').hidden = !!reward;
  choices.replaceChildren(...candidates.map(weapon => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(`item.${EVOLUTIONS[weapon].id}.title`);
    button.addEventListener('click', () => { pendingChest = weapon; });
    return button;
  }));
  reels.hidden = !reward;
  reels.replaceChildren(...(reward ?? []).map((item, i) => {
    const reel = document.createElement('li'), strip = document.createElement('div');
    reel.className = item.kind === 'evolution' ? 'chest-reel evolution' : 'chest-reel';
    strip.className = 'chest-reel-strip';
    strip.style.setProperty('--reel-order', String(i));
    for (const glyph of ['◇', '▣', '◆']) {
      const face = document.createElement('span');
      face.textContent = glyph;
      face.setAttribute('aria-hidden', 'true');
      strip.append(face);
    }
    const label = document.createElement('div');
    label.className = 'chest-reel-label';
    const title = document.createElement('strong'), level = document.createElement('small');
    title.textContent = t(`item.${item.id}.title`);
    level.textContent = item.kind === 'evolution' ? t('chest.evolved') : item.level ? t('chest.level', { level: item.level }) : '';
    label.append(title, level);
    strip.append(label);
    reel.append(strip);
    return reel;
  }));
  chestAction.hidden = candidates.length > 0;
  chestAction.textContent = t(reward ? 'chest.continue' : 'chest.open');
  (choices.querySelector('button') ?? chestAction).focus({ preventScroll: true });
}

function updateMenu(): void {
  const status = !scene ? 'webgl' : guide ? 'guide' : state.paused ? 'paused' : state.phase;
  touchControls.hidden = touchPause.hidden = !touch || status !== 'playing';
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
  $('#hangar-panel').hidden = !state.run || !persistent || !(status === 'title' || status === 'paused' || state.summary);
  $('#run-summary').hidden = !state.summary;
  $('#retreat-action').hidden = !state.run || status !== 'paused';
  if (!$('#hangar-panel').hidden) renderHangar();
  if (showing) {
    resetTouch();
    pendingBomb = pendingFlare = false;
    pendingManeuver = undefined;
    pendingViews = 0;
  }
  if (status === 'guide' && guide) {
    guideSkip.hidden = guide !== 'launch';
    setText('#guide-primary', t(guide === 'launch' ? 'guide.launch' : 'guide.back'));
  } else if (status === 'chest') {
    updateChestMenu();
  } else if (drafting) {
    banishing = false;
    setText('#draft-detail', t('draft.detail', { level: state.level + 1 }));
    for (const [i, button] of draftButtons.entries()) {
      const id = state.draft[i];
      const card = state.run?.cards[i];
      button.hidden = id === undefined;
      if (!id) continue;
      button.dataset.variant = card?.variant ?? 'normal';
      if (card) {
        const capped = card.id === 'damage' && card.currentLevel === card.maxLevel;
        const key = capped ? 'draft.damageCap' : `item.${card.id}` as const;
        const level = !card.maxLevel ? '' : card.currentLevel === 0
          ? t('draft.new')
          : t('draft.levels', { from: card.currentLevel, to: card.nextLevel });
        const suffix = card.variant === 'normal' ? '' : t(`draft.${card.variant}`);
        const downside = card.variant === 'risky' ? t('draft.riskCost', { hull: DRAFT_RULES.riskHull }) : '';
        const title = [card.pairHint ? '★' : '', t(`${key}.title`), level].filter(Boolean).join(' ');
        const copy = [t(`${key}.copy`), suffix, downside].filter(Boolean).join(' · ');
        button.querySelector('strong')!.textContent = title;
        button.querySelector('small')!.textContent = copy;
      } else {
        const legacy = id as LegacyDraftId;
        button.querySelector('strong')!.textContent = t(`draft.${legacy}.title`);
        button.querySelector('small')!.textContent = t(`draft.${legacy}.copy`);
      }
    }
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
    $('#card-options').hidden = !(intro || webgl);
    $('#help-action').hidden = webgl;
    $('#rank-display').hidden = intro || webgl;
    $('#card-kicker').hidden = webgl;
    $('#card-hint').hidden = webgl;
    if (intro) {
      setText('#card-kicker', t(`menu.${status}.kicker`));
      setText('#card-title', t(`menu.${status}.title`));
      setText('#card-copy', t(status === 'title' && state.run ? 'menu.survivors.copy' : `menu.${status}.copy`));
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
      setText('#card-title', t(`menu.${outcome}.title`));
      setText('#card-copy', t('menu.result.copy', { hull: state.hull, maxHull: state.maxHull, hits: state.hitsTaken, salvage: state.salvage, score: state.score }));
      setText('#rank-display', t('menu.result.rank', { rank: state.rank ?? '' }));
      setText('#primary-action', t('menu.result.action'));
      setText('#card-hint', t('menu.result.hint'));
      renderSummary();
    }
    if (oldStatus && oldStatus !== 'guide') primary.focus({ preventScroll: true });
  }
}

function renderSummary(): void {
  const run = state.run, summary = state.summary;
  const panel = $('#run-summary');
  if (!run || !summary) return;
  const gear = WEAPON_IDS.filter(id => run.weaponLevels[id]).map(id => t(`item.${run.evolutions[id] ?? id}.title`))
    .concat(BUFF_IDS.filter(id => run.buffLevels[id]).map(id => t(`item.${id}.title`)));
  const copy = [
    t('menu.summary.stats', { time: clockText(Math.floor(summary.seconds)), kills: state.kills, levels: state.level - 1,
      paid: state.bills.paid, offered: state.bills.offered }),
    t('menu.summary.loadout', { gear: gear.join(' · ') }),
    state.daily ? t('menu.summary.daily', { seed: state.seed }) : t('menu.summary.credits', { credits: summary.credits }),
  ];
  if (summary.wardenCache) copy.push(t('menu.summary.warden'));
  if (summary.unlocked.length) copy.push(t('menu.summary.unlocked', {
    gear: summary.unlocked.map(id => t(`item.${id}.title`)).join(' · '),
  }));
  panel.replaceChildren(...copy.map(line => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    return paragraph;
  }));
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
  else if (state.paused) pendingPause = true;
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
$('#retreat-action').addEventListener('click', () => { pendingRetreat = true; });
chestAction.addEventListener('click', () => { pendingChest = state.chestReveal ? 'continue' : 'open'; });
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
window.addEventListener('orientationchange', resize);
coarse.addEventListener('change', resize);
portrait.addEventListener('change', resize);
root.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('gesturestart', event => event.preventDefault());
root.addEventListener('touchmove', event => {
  if (event.target instanceof Node && (guideBody.contains(event.target) || gameCard.contains(event.target)
    || draftCard.contains(event.target) || chestCard.contains(event.target))) return;
  event.preventDefault();
}, { passive: false });

window.addEventListener('keydown', event => {
  const { code } = event;
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
  if (code === 'KeyP') pendingPause = true;
  if (state.phase === 'playing' && !state.paused) {
    if (code === 'KeyV') pendingViews++;
    if (code === 'KeyX' || code === 'KeyK') pendingBomb = true;
    if (code === 'KeyC') pendingFlare = true;
    const { turn, climb } = keyboardAxes();
    const kind = maneuverForKey(code, turn, climb);
    if (kind) {
      event.preventDefault();
      pendingManeuver = { kind, turn };
    }
  }
  if (code === 'KeyR' && state.rank) pendingStart = true;
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  pendingFlare = false;
  pendingManeuver = undefined;
  resetTouch();
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
    if (name === 'pointerup' && menuKey === 'playing') pendingManeuver = loopPointer.press;
    loopPointer = null;
    touchLoop.classList.remove('held');
  });
}
touchLoop.addEventListener('click', event => {
  if (event.detail === 0 && menuKey === 'playing') pendingManeuver = { kind: chooseManeuver(stickX, stickY), turn: stickX };
});
function bindPress(button: HTMLButtonElement, press: () => void): void {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || menuKey !== 'playing') return;
    event.preventDefault();
    press();
  });
  button.addEventListener('click', event => {
    if (event.detail === 0 && menuKey === 'playing') press();
  });
}
bindPress(touchPause, () => { pendingPause = true; });
bindPress(touchBomb, () => { pendingBomb = true; });
bindPress(touchFlare, () => { pendingFlare = true; });
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

function advance(): void {
  if (!scene || guide) return;
  const before = state.tick, yaw = state.player.yaw;
  const priorSummary = state.summary;
  const wasFlying = maneuverAllowsControl(state.maneuver);
  const previousPhase = state.phase, previouslyPaused = state.paused, previousDraft = state.draft, previousReveal = state.chestReveal;
  const control = options.autoplay ? autopilotInput(state, 'full', ground) : flightInput();
  stepStage(state, {
    ...control,
    start: pendingStart,
    launch: pendingStart ? launchSettings() : undefined,
    retreat: pendingRetreat,
    pause: pendingPause,
    bomb: pendingBomb || control.bomb,
    flare: pendingFlare || control.flare,
    maneuver: pendingManeuver?.kind ?? control.maneuver,
    maneuverTurn: pendingManeuver?.turn ?? control.maneuverTurn,
    toggleView: pendingViews > 0 || control.toggleView,
    chestPick: pendingChest ?? control.chestPick,
    ...pendingDraft,
  }, ground);
  pendingStart = pendingPause = pendingBomb = pendingFlare = false;
  pendingRetreat = false;
  if (pendingViews) pendingViews--;
  pendingDraft = {};
  pendingChest = undefined;
  pendingManeuver = undefined;
  if (state.summary && state.summary !== priorSummary) {
    profile = state.profile;
    persistPilot();
  }
  if (state.tick < before) motion = { speed: 0, climb: 0, turn: 0 };
  if (state.tick > before) {
    const ease = (from: number, to: number) => from + (to - from) * 0.19;
    const delta = state.player.yaw - yaw;
    const headingDelta = Math.atan2(Math.sin(delta), Math.cos(delta));
    motion = {
      speed: ease(motion.speed, state.speed),
      climb: ease(motion.climb, state.climbRate),
      turn: !wasFlying || !maneuverAllowsControl(state.maneuver) || Math.abs(headingDelta) > Math.PI * 0.9 ? 0 : ease(motion.turn, headingDelta / STEP),
    };
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

function updateRearDangerCue(readout: RadarReadout, reversalReady: boolean, flareReady: boolean): void {
  const danger = readout.rearDanger;
  const running = state.phase === 'playing' && !state.paused;
  if (!running || state.view !== 'cockpit') mirrorThreat.clear();
  const threat = running && state.view === 'cockpit' ? mirrorThreat.update(state) : null;
  const neutral = state.view === 'chase' && readout.rearMarks.length > 0;
  rearDangerCue.hidden = !running || (!danger && !neutral && !threat);
  if (rearDangerCue.hidden) return;

  const mirror = scene?.cockpitMirror;
  const docked = !!mirror && mirror.width >= 94;
  rearDangerCue.dataset.docked = String(docked);
  rearDangerCue.dataset.danger = String(!!danger);
  if (mirror && docked) {
    rearDangerCue.style.setProperty('--rear-left', `${mirror.x + 3}px`);
    rearDangerCue.style.setProperty('--rear-right', `${innerWidth - mirror.x - mirror.width + 3}px`);
    rearDangerCue.style.setProperty('--rear-bottom', `${innerHeight - mirror.y - mirror.height + 3}px`);
  }
  let position = '▼', description = t('hud.rear');
  let action = danger?.kind === 'contact' && flareReady ? (touch ? t('control.flareShort') : `C ${t('control.flare')}`)
    : danger && reversalReady ? (touch ? t('control.loop') : `SPACE ${t('hud.rearReverse')}`)
    : danger ? t('hud.rearEvade') : readout.rearMarks.join(' ');
  if (danger) description = t('hud.rearDanger');
  else if (threat) {
    const bearing = { Left: '←', Centre: '•', Right: '→' }[threat.side];
    const altitude = { Above: '↑', Level: '=', Below: '↓' }[threat.height];
    position = bearing + altitude;
    description += ` · ${t(`hud.rear${threat.side}`)} ${t(`hud.rear${threat.height}`)}`;
    const kind = (['j-turn', 'immelmann', 'split-s'] as const)
      .find(kind => canManeuver(state, kind) && inBand(threat.alt, exitAltitude(state.player.altitude, kind)));
    const seconds = Math.ceil((state.maneuverReadyAt - state.tick) / TICKS_PER_SECOND);
    if (kind) {
      const direction = kind === 'immelmann' ? '↑' : kind === 'split-s' ? '↓' : threat.lateral < 0 ? '←' : '→';
      action = `${t('hud.reverseShort')} ${direction}`;
    } else if (flareReady && threat.height !== 'Above' && Math.abs(threat.lateral) <= 22 && threat.distance <= 80) {
      action = t('hud.rearFlare', { count: state.flareCharges });
    } else {
      action = seconds > 0 ? t('hud.rearCooldown', { seconds }) : t('hud.rearEvade');
    }
  }
  setText('#rear-position', position);
  setText('#rear-danger-action', action);
  rearDangerCue.setAttribute('aria-label', `${description} · ${action}`);
}

function updateRearViewCue(): void {
  const rect = scene?.rearView;
  const hit = state.rearGlimpse?.kind === 'flare' && !!state.flareHit && state.tick < state.flareHit.until;
  const active = !!state.rearGlimpse && state.tick < state.rearGlimpse.until;
  rearViewCue.hidden = !rect || rect.width < 74 || state.phase !== 'playing' || state.paused || (!active && !hit);
  if (rearViewCue.hidden || !rect) return;
  setText('#rear-view-cue', t(hit ? 'hud.flareHit' : 'hud.rearView'));
  rearViewCue.dataset.hit = String(hit);
  rearViewCue.style.left = `${rect.x + 4}px`;
  rearViewCue.style.top = `${rect.y + 4}px`;
  rearViewCue.style.maxWidth = `${rect.width - 8}px`;
}

function render(): void {
  if (layoutView !== state.view) layoutFlight();
  const yaw = maneuverViewYaw(state);
  const readout = buildRadar(state, yaw);
  rearDanger = readout.rearDanger;
  const ladder = scene?.draw(state, !!rearDanger) ?? [];
  updateHud(readout);
  updateManeuverCue();
  updateRearBombMarker();
  updateRearViewCue();
  const progress = 1 - state.wipe / WIPE_DURATION;
  wipe.hidden = state.wipe <= 0;
  if (!wipe.hidden) wipe.style.top = `${progress * 100}%`;
  const p = state.player;
  const lookahead = Math.max(27, state.speed * 0.68);
  const clearance = p.altitude - Math.max(ground(p.x, p.z), ground(p.x + Math.sin(p.yaw) * lookahead, p.z + Math.cos(p.yaw) * lookahead));
  describeFlight(readout, clearance);
  const deltaIndicator = $('#cockpit-delta');
  const instrumentTrack = cockpit && maneuverAllowsControl(state.maneuver) ? readout.priority : null;
  cockpitDelta = instrumentTrack ? altitudeDeltaText(instrumentTrack.alt - p.altitude, t) : null;
  deltaIndicator.hidden = cockpitDelta === null;
  if (cockpitDelta) {
    setText('#cockpit-delta', cockpitDelta);
    deltaIndicator.setAttribute('aria-label', `${t('hud.altitude')} ${cockpitDelta}`);
  }
  if (cockpit && scene) {
    const settling = Math.cos(yaw - p.yaw) < 0.999;
    const aim = scene.project({ x: p.x + Math.sin(p.yaw) * 100, z: p.z + Math.cos(p.yaw) * 100, alt: p.altitude }) ??
      (settling ? null : { x: innerWidth / 2, y: cockpit.aiming.y + cockpit.aiming.height / 2 });
    const mirror = scene.cockpitMirror;
    const markers = cockpitMarkers.update(state, cockpit, scene, mirror, rearDanger);
    const impact = state.invulnerability > 0.72 ? (state.invulnerability - 0.72) * 3.6 : 0;
    cockpitDisplay.draw(state, aim, ladder,
      motion, clearance, impact, readout, markers, cockpitMarkers.obstructions, mirror, instrumentTrack?.alt, language, t);
  } else if (lastRadarTick === null || state.tick - lastRadarTick >= 3 || state.tick < lastRadarTick) {
    navRadar.draw(radarContext, 0, 0, readout, yaw, state.tick);
    if (!arenaMap.hidden) drawArenaMap(mapContext, state, t('cockpit.north'), font, yaw);
    lastRadarTick = state.tick;
  }
  dirty = false;
}

Object.defineProperty(window, '__game', { get: () => Object.freeze({
  tick: state.tick, elapsed: state.tick / TICKS_PER_SECOND, seed: state.seed, phase: state.phase, paused: state.paused,
  view: state.view, airspace: { ...state.arena }, objective: objectiveText(), altitude: state.player.altitude,
  player: { ...state.player }, hull: state.hull, boost: state.boost, boosting: state.boosting, bombs: state.bombs,
  speed: state.speed, boostTicks: state.boostTicks, speedFeel: scene && { ...scene.speedFeel },
  rearBombs: state.rearBombs.map(bomb => ({ ...bomb })),
  flares: state.flares.map(flare => ({ ...flare })), flareCharges: state.flareCharges,
  flareReadyAt: state.flareReadyAt, flareReloadAt: state.flareReloadAt,
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
  rank: state.rank, fps: Math.round(fps), level: state.level, xp: state.xp, score: state.score,
  salvage: state.salvage, salvageBands: [...state.salvageBands], draftIds: [...state.draft], picks: [...state.picks],
  twinRank: state.twinRank, podRank: state.podRank, enemyCount: state.enemies.length, shotCount: state.shots.length,
  kills: state.kills, fodderCount: state.enemies.filter(enemy => enemy.kind === 'gnat').length,
  heat: state.heat, daily: state.daily, maxHull: state.maxHull, billsPaid: state.bills.paid,
  weaponLevels: state.run?.weaponLevels, buffLevels: state.run?.buffLevels, swarmCap: state.swarmCap,
  tracers: state.shots.filter(shot => shot.reversal || shot.kind === 'strafe').map(shot => ({
    kind: shot.reversal ? 'reversal' : shot.kind, x: shot.x, z: shot.z, alt: shot.alt, vx: shot.vx, vz: shot.vz,
    vy: shot.kind === 'strafe' ? shot.vy : 0,
  })),
  enemyContacts: state.enemies.map(({ id, kind, x, z, alt, hp, burnUntil, flyby }) => (
    { id, kind, x, z, alt, hp, burnUntil, flyby: flyby?.phase ?? null, flybySide: flyby?.side }
  )),
  mineCount: state.enemyMines.length,
  weakPointHits: state.boss?.weakPoints.map(point => point.hits) ?? [],
  bossHp: state.boss?.weakPoints.map(point => point.hp) ?? [],
  lock: state.lock && { ...state.lock }, cockpitDelta, cockpitMarkers: cockpit && scene ? cockpitMarkers.snapshot() : [],
  wipe: state.wipe, missedVolleys: state.effects.filter(effect => effect.kind === 'miss').length,
  layout: phone && { orientation: phone.orientation, buffer: { ...phone.buffer }, playfield: { ...phone.playfield },
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
  const elapsed = Math.max(0, (now - previousTime) / 1000);
  previousTime = now;
  if (elapsed > 0 && elapsed < 0.25) fps += (1 / elapsed - fps) * 0.08;
  carry += Math.min(0.2, elapsed, Math.max(0, (now - hitstopUntil) / 1000));
  while (carry >= STEP) {
    const burst = state.reversal?.burstAt;
    advance();
    carry -= STEP;
    const nextBurst = state.reversal?.burstAt;
    if (nextBurst !== undefined && nextBurst !== burst) {
      hitstopUntil = now + REVERSAL_HITSTOP_MS;
      carry = 0;
      showReversalImpact();
      break;
    }
  }
  if (dirty || state.tick !== lastRenderTick || state.phase !== lastRenderPhase) {
    render();
    lastRenderTick = state.tick;
    lastRenderPhase = state.phase;
  }
  requestAnimationFrame(animate);
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
  requestAnimationFrame(animate);
}

void start();
