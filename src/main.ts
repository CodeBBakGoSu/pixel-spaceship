import './style.css';
import { autopilotInput, seekStage } from './autoplay.ts';
import type { Segment } from './camera.ts';
import { CockpitDisplay } from './cockpit-display.ts';
import { cockpitTarget, cockpitWarnings, type CockpitMotion } from './cockpit.ts';
import { createTranslator, initialLanguage, saveLanguage, type Language, type MessageKey } from './i18n.ts';
import { altitudeDeltaText, buildRadar, RadarDisplay, relativeMark, type RadarReadout } from './instruments.ts';
import { cockpitLayout, desktopLayout, guideLayout, phoneLayout, type CockpitLayout, type HudLayout, type Insets, type PhoneLayout, type Rect } from './layout.ts';
import { canManeuver, chooseManeuver, MANEUVERS, maneuverAttitude } from './maneuvers.ts';
import { FlightScene } from './scene.ts';
import { activeWeakPoint, BOSS_TICK, parseStageOptions, requiredXp, stepStage } from './stage.ts';
import { BOMB_RELOAD_TICKS, clamp, MAX_ALTITUDE, MAX_BOMBS, MIN_ALTITUDE, STEP, TICKS_PER_SECOND, WIPE_DURATION } from './stage-combat.ts';
import type { DraftId, Effect, ManeuverKind, StageInput } from './stage-types.ts';
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
const draftButtons = [...draftCard.querySelectorAll<HTMLButtonElement>('[data-pick]')];
const touchControls = $('#touch-controls');
const touchPause = $<HTMLButtonElement>('#touch-pause');
const touchLoop = $<HTMLButtonElement>('#touch-loop');
const touchBomb = $<HTMLButtonElement>('#touch-bomb');
const stick = $('#stick'), knob = $('#stick-knob');
const languageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-lang]')];
const safeProbe = $('#safe-area-probe');
const wipe = $('#view-wipe');
const rearBombMarker = $('#rear-bomb-marker');
const radar = $<HTMLCanvasElement>('#nav-radar'), radarContext = radar.getContext('2d')!;
const font = getComputedStyle(document.documentElement).getPropertyValue('--game-font').trim();
const navRadar = new RadarDisplay();
const cockpitDisplay = new CockpitDisplay($<HTMLCanvasElement>('#cockpit-overlay'), font);
const world = new World();
const ground = (x: number, z: number) => world.height(x, z);
const options = parseStageOptions(location.search);
const state = seekStage(options, ground);
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
let language = initialLanguage(location.search, navigator.language, storage);
let t = createTranslator(language);
let scene: FlightScene | null = null;
try {
  scene = new FlightScene(canvas, world, state.arena);
} catch (error) {
  console.error(error);
}

const keys = new Set<string>();
const steeringKeys = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const coarse = matchMedia('(pointer: coarse)'), portrait = matchMedia('(orientation: portrait)');
let touch = false, phone: PhoneLayout | null = null, cockpit: CockpitLayout | null = null;
let hud: HudLayout, layoutView: Segment | null = null;
let safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
let guide: 'launch' | 'help' | null = null;
let guideOpener: HTMLElement | null = null;
let menuKey = '';
let draftLevel = 0;
let dirty = true, lastRadarTick: number | null = null, lastFlightKey = '';
let pendingStart = false, pendingPause = false, pendingBomb = false, pendingViews = 0;
let pendingPick: DraftId | undefined;
let pendingManeuver: ManeuverKind | undefined;
let stickId: number | null = null;
let loopPointer: { id: number; x: number; y: number; maneuver: ManeuverKind } | null = null;
let stickX = 0, stickY = 0, mouseX = 0, mouseY = 0, mouseActive = false;
let touchBoost = false;
let previousTime = 0, carry = 0, fps = 60, lastRenderTick = -1, lastRenderPhase = '';
let helpTimer = 0, lastHelp = '';
let motion: CockpitMotion = { speed: 0, climb: 0, turn: 0 };
let cockpitDelta: string | null = null;
const textNodes = new Map<string, HTMLElement>();

function setText(selector: string, copy: string): void {
  let node = textNodes.get(selector);
  if (!node) {
    node = $(selector);
    textNodes.set(selector, node);
  }
  if (node.textContent !== copy) node.textContent = copy;
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
    for (const key of ['playfield', 'controls', 'pause', 'stick', 'loop', 'boost', 'bomb', 'view'] as const) setRect(key, phone[key]);
  }
  cockpit = state.view === 'cockpit' ? phone?.cockpit ?? cockpitLayout(innerWidth, innerHeight, safe, hud.objective) : null;
  if (cockpit) {
    setRect('cockpit-message', cockpit.message);
    if (cockpit.help) setRect('cockpit-help', cockpit.help);
  }
  cockpitDisplay.resize(cockpit, innerWidth, innerHeight, language, t);
  radar.width = Math.max(1, hud.radar.width);
  radar.height = Math.max(1, hud.radar.height);
  navRadar.resize(radar.width, radar.height, font, t('hud.nav'));
  lastRadarTick = null;
  scene?.resize({ width: innerWidth, height: innerHeight, phone, cockpit });
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
  const point = activeWeakPoint(state);
  if (!point || !state.boss) {
    return t(state.tick < 40 * TICKS_PER_SECOND ? 'objective.reach' :
      state.tick < BOSS_TICK ? 'objective.waves' : 'objective.boss');
  }
  const seconds = Math.ceil((state.boss.exposeTick - state.tick) / TICKS_PER_SECOND);
  if (state.view === 'overhead') return point.exposed ? t('objective.boss') : t('objective.bossSignal', { seconds });
  const part = t(point.kind === 'core' ? 'boss.core' : point.band === 2 ? 'boss.high' : 'boss.low');
  return point.exposed ? t('objective.bandOpen', { part }) : t('objective.bandSignal', { part, seconds });
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
  const message = state.phase === 'title' ? null : sec < 5 ? 'dialogue.reachArrival' :
    sec >= 22 && sec < 26 ? 'dialogue.stack' : sec >= 105 && sec < 108 ? 'dialogue.warden' : null;
  $('#radio').hidden = !message;
  if (!message || lastFlightKey === message) return;
  lastFlightKey = message;
  const warden = message === 'dialogue.warden';
  drawPortrait(warden);
  setText('#radio-speaker', t(warden ? 'speaker.warden' : 'speaker.opal'));
  setText('#radio-text', t(message));
}

function updateHud(readout: RadarReadout): void {
  setText('#hull-bars', '▮'.repeat(state.hull) + '▯'.repeat(state.maxHull - state.hull));
  $('#boost-bar').style.width = `${state.boost * 100}%`;
  setText('#bombs', '◆'.repeat(state.bombs) + '◇'.repeat(MAX_BOMBS - state.bombs));
  const refill = state.bombReloadAt === null ? 1 : 1 - (state.bombReloadAt - state.tick) / BOMB_RELOAD_TICKS;
  $('#bomb-reload-bar').style.width = `${Math.round(clamp(refill, 0, 1) * 100)}%`;
  touchBomb.setAttribute('aria-disabled', String(!state.bombs || !!state.maneuver || state.tick < state.bombReadyAt));
  touchBomb.setAttribute('aria-label', `${t('control.bomb')} · ${state.bombs}/${MAX_BOMBS}`);
  const ready = canManeuver(state, 'immelmann');
  const loopSeconds = Math.max(0, Math.ceil((state.maneuverReadyAt - state.tick) / TICKS_PER_SECOND));
  const loopKey: MessageKey = state.maneuver ? `maneuver.${state.maneuver.kind}` : loopSeconds ? 'hud.loopCooldown' : 'hud.loopReady';
  const selected = touch ? chooseManeuver(stickX, stickY, false) : keyboardManeuver();
  const lowBoost = ready && selected === 'j-turn' && state.boost < MANEUVERS['j-turn'].boost;
  setText('#loop-status', t(lowBoost ? 'hud.jTurnLow' : loopKey, { seconds: loopSeconds }));
  $('#loop-status').dataset.ready = String(ready && !lowBoost);
  touchLoop.setAttribute('aria-disabled', String(!ready || lowBoost));
  touchLoop.classList.toggle('rear-ready', ready && !lowBoost && readout.rearClose);
  setText('#view-label', t(`view.${state.view}`));
  const cost = requiredXp(state.level);
  const xp = Math.min(cost ?? 0, state.xp);
  const stats = { level: state.level, xp, cost: cost ?? 0 };
  setText('#xp-label', t(cost === null ? 'hud.xpMax' : 'hud.xp', stats));
  $('#xp-label').style.setProperty('--xp-fill', `${cost === null ? 100 : 100 * xp / cost}%`);
  const time = Math.max(0, Math.ceil(180 - state.tick / TICKS_PER_SECOND));
  setText('#segment-timer', `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`);
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
  let message: MessageKey | null = null;
  if (state.boundaryWarning) message = 'hud.boundary';
  else if (warnings.terrain === 'pullUp') message = 'cockpit.pullUp';
  else if (miss?.kind === 'miss') message = top ? 'hud.checkAlt' : miss.delta > 0 ? 'hud.shotLow' : 'hud.shotHigh';
  else if (warning?.maneuver) message = top ? 'hud.interceptor' :
    warning.maneuver.band < warning.band ? 'hud.interceptorDive' : 'hud.interceptorClimb';
  else if (top && state.altitudeHint) message = 'hud.checkAlt';
  else if (warnings.terrain === 'altLow' && !state.altitudeHint) message = 'cockpit.altLow';
  else if (state.tick < state.bombReadyAt) message = 'hud.bombAway';
  else if (!top && readout.rearClose && !state.maneuver && !state.altitudeHint) message = touch ? 'hud.rearTouch' : 'hud.rearKeys';
  const banner = $('#flight-message');
  banner.hidden = !message;
  if (message) {
    const count = readout.rearCount ? ` · ${readout.rearCount}` : '';
    const layers = readout.rearMarks.length ? ' ' + readout.rearMarks.join('') : '';
    setText('#flight-message', t(message, { warning: `▼ ${t('hud.rear')}${count}${layers}` }));
  }
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
    banner.hidden = false;
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
  if (status === menuKey && (status !== 'draft' || state.level === draftLevel)) return;
  draftLevel = state.level;
  const oldStatus = menuKey;
  menuKey = status;
  const showing = status !== 'playing';
  const drafting = status === 'draft';
  overlay.hidden = !showing;
  root.classList.toggle('menu-open', showing);
  root.classList.toggle('guide-open', status === 'guide');
  guideCard.hidden = status !== 'guide';
  draftCard.hidden = !drafting;
  gameCard.hidden = !showing || drafting || status === 'guide';
  if (showing) {
    resetTouch();
    pendingBomb = false;
    pendingManeuver = undefined;
    pendingViews = 0;
  }
  if (status === 'guide' && guide) {
    guideSkip.hidden = guide !== 'launch';
    setText('#guide-primary', t(guide === 'launch' ? 'guide.launch' : 'guide.back'));
  } else if (drafting) {
    setText('#draft-detail', t('draft.detail', { level: state.level + 1 }));
    for (const [i, button] of draftButtons.entries()) {
      const id = state.draft[i];
      button.querySelector('strong')!.textContent = t(`draft.${id}.title`);
      button.querySelector('small')!.textContent = t(`draft.${id}.copy`);
    }
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
      setText('#card-copy', t(`menu.${status}.copy`));
      setText('#primary-action', t(`menu.${status}.action`));
      setText('#card-hint', t(`menu.${status}.hint`));
      setText('#help-action-label', t(status === 'title' ? 'guide.title' : 'menu.help'));
    } else if (webgl) {
      setText('#card-title', t('menu.webgl.title'));
      setText('#card-copy', t('menu.webgl.copy'));
      setText('#primary-action', t('menu.webgl.action'));
    } else {
      const outcome = state.phase as 'clear' | 'timeout' | 'lost';
      setText('#card-kicker', t('menu.result.kicker'));
      setText('#card-title', t(`menu.${outcome}.title`));
      setText('#card-copy', t('menu.result.copy', { hull: state.hull, maxHull: state.maxHull, hits: state.hitsTaken, salvage: state.salvage, score: state.score }));
      setText('#rank-display', t('menu.result.rank', { rank: state.rank ?? '' }));
      setText('#primary-action', t('menu.result.action'));
      setText('#card-hint', t('menu.result.hint'));
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
  else if (state.paused) pendingPause = true;
  else if (state.phase === 'title') openGuide('launch');
  else if (state.rank) pendingStart = true;
}

function choose(index: number): void {
  if (state.phase === 'draft') pendingPick = state.draft[index];
}

primary.addEventListener('click', action);
guidePrimary.addEventListener('click', () => closeGuide(true));
guideSkip.addEventListener('click', () => closeGuide(true));
$('#help-action').addEventListener('click', () => openGuide('help'));
draftButtons.forEach((button, index) => button.addEventListener('click', () => choose(index)));
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
coarse.addEventListener('change', resize);
portrait.addEventListener('change', resize);
root.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('gesturestart', event => event.preventDefault());
root.addEventListener('touchmove', event => {
  if (event.target instanceof Node && (guideBody.contains(event.target) || gameCard.contains(event.target) || draftCard.contains(event.target))) return;
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
    if (code === 'Space') pendingManeuver = keyboardManeuver();
  }
  if (code === 'KeyR' && state.rank) pendingStart = true;
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
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
  loopPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, maneuver: chooseManeuver(stickX, stickY, false) };
  touchLoop.setPointerCapture(event.pointerId);
  touchLoop.classList.add('held');
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  touchLoop.addEventListener(name, event => {
    if (!loopPointer || event.pointerId !== loopPointer.id) return;
    if (name === 'pointerup' && menuKey === 'playing') {
      const left = loopPointer.x - event.clientX, vertical = Math.abs(event.clientY - loopPointer.y);
      pendingManeuver = left >= 24 && left > vertical ? 'cobra' : loopPointer.maneuver;
    }
    loopPointer = null;
    touchLoop.classList.remove('held');
  });
}
touchLoop.addEventListener('click', event => {
  if (event.detail === 0 && menuKey === 'playing') pendingManeuver = chooseManeuver(stickX, stickY, false);
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
bindPress($<HTMLButtonElement>('#touch-view'), () => { pendingViews++; });

function keyboardAxes() {
  const move = (positive: string, positiveAlt: string, negative: string, negativeAlt: string) =>
    Number(keys.has(positive) || keys.has(positiveAlt)) - Number(keys.has(negative) || keys.has(negativeAlt));
  return { turn: move('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft'), climb: move('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown') };
}

function keyboardManeuver(): ManeuverKind {
  const { turn, climb } = keyboardAxes();
  return chooseManeuver(turn, climb, keys.has('KeyC'));
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
  const wasManeuvering = !!state.maneuver;
  const previousPhase = state.phase, previouslyPaused = state.paused, previousLevel = state.level;
  const control = options.autoplay ? autopilotInput(state) : flightInput();
  stepStage(state, {
    ...control,
    start: pendingStart,
    pause: pendingPause,
    bomb: pendingBomb || control.bomb,
    maneuver: pendingManeuver ?? control.maneuver,
    toggleView: pendingViews > 0 || control.toggleView,
    pick: pendingPick ?? control.pick,
  }, ground);
  pendingStart = pendingPause = pendingBomb = false;
  if (pendingViews) pendingViews--;
  pendingPick = undefined;
  pendingManeuver = undefined;
  if (state.tick < before) motion = { speed: 0, climb: 0, turn: 0 };
  if (state.tick > before) {
    const ease = (from: number, to: number) => from + (to - from) * 0.19;
    const delta = state.player.yaw - yaw;
    const headingDelta = Math.atan2(Math.sin(delta), Math.cos(delta));
    motion = {
      speed: ease(motion.speed, state.speed),
      climb: ease(motion.climb, state.climbRate),
      turn: wasManeuvering || state.maneuver || Math.abs(headingDelta) > Math.PI * 0.9 ? 0 : ease(motion.turn, headingDelta / STEP),
    };
  }
  if (state.phase !== previousPhase || state.paused !== previouslyPaused || state.level !== previousLevel) {
    dirty = true;
    // Open the modal synchronously, even when a slow frame processes several ticks.
    // It clears any pending flight action that arrived with the level-up.
    if (state.phase === 'draft') updateMenu();
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

function render(): void {
  if (layoutView !== state.view) layoutFlight();
  const ladder = scene?.draw(state) ?? [];
  const readout = buildRadar(state);
  updateHud(readout);
  updateRearBombMarker();
  const progress = 1 - state.wipe / WIPE_DURATION;
  wipe.hidden = state.wipe <= 0;
  if (!wipe.hidden) wipe.style.top = `${progress * 100}%`;
  const p = state.player;
  const clearance = p.altitude - Math.max(ground(p.x, p.z), ground(p.x + Math.sin(p.yaw) * 23, p.z + Math.cos(p.yaw) * 23));
  describeFlight(readout, clearance);
  const deltaIndicator = $('#cockpit-delta');
  cockpitDelta = cockpit && !state.maneuver && readout.priority ? altitudeDeltaText(readout.priority.alt - p.altitude, t) : null;
  deltaIndicator.hidden = cockpitDelta === null;
  if (cockpitDelta) {
    setText('#cockpit-delta', cockpitDelta);
    deltaIndicator.setAttribute('aria-label', `${t('hud.altitude')} ${cockpitDelta}`);
  }
  if (cockpit && scene) {
    const aim = scene.project({ x: p.x + Math.sin(p.yaw) * 100, z: p.z + Math.cos(p.yaw) * 100, alt: p.altitude }) ??
      { x: innerWidth / 2, y: cockpit.aiming.y + cockpit.aiming.height / 2 };
    const track = state.maneuver ? null : readout.priority;
    const point = track && scene.project(track);
    const target = track && point ? cockpitTarget(track, point, cockpit.aiming, state.lock) : null;
    const impact = state.invulnerability > 0.72 ? (state.invulnerability - 0.72) * 3.6 : 0;
    cockpitDisplay.draw(state, aim, ladder,
      motion, clearance, impact, readout, target, language, t);
  } else if (lastRadarTick === null || state.tick - lastRadarTick >= 3 || state.tick < lastRadarTick) {
    navRadar.draw(radarContext, 0, 0, readout, p.yaw, state.tick);
    lastRadarTick = state.tick;
  }
  dirty = false;
}

Object.defineProperty(window, '__game', { get: () => Object.freeze({
  tick: state.tick, elapsed: state.tick / TICKS_PER_SECOND, seed: state.seed, phase: state.phase, paused: state.paused,
  view: state.view, airspace: { ...state.arena }, objective: objectiveText(), altitude: state.player.altitude,
  player: { ...state.player }, hull: state.hull, boost: state.boost, boosting: state.boosting, bombs: state.bombs,
  speed: state.speed, rearBombs: state.rearBombs.map(bomb => ({ ...bomb })),
  maneuver: state.maneuver && { ...state.maneuver, ...maneuverAttitude(state.maneuver) },
  maneuverReadyAt: state.maneuverReadyAt,
  rank: state.rank, fps: Math.round(fps), level: state.level, xp: state.xp, score: state.score,
  salvage: state.salvage, salvageBands: [...state.salvageBands], draftIds: [...state.draft], picks: [...state.picks],
  twinRank: state.twinRank, podRank: state.podRank, enemyCount: state.enemies.length, shotCount: state.shots.length,
  weakPointHits: state.boss?.weakPoints.map(point => point.hits) ?? [],
  bossHp: state.boss?.weakPoints.map(point => point.hp) ?? [],
  lock: state.lock && { ...state.lock }, cockpitDelta,
  wipe: state.wipe, missedVolleys: state.effects.filter(effect => effect.kind === 'miss').length,
  layout: phone && { orientation: phone.orientation, buffer: { ...phone.buffer }, playfield: { ...phone.playfield },
    controls: { ...phone.controls }, dashboard: phone.dashboard && { ...phone.dashboard } },
}) });

function animate(now: number): void {
  const elapsed = Math.max(0, (now - previousTime) / 1000);
  previousTime = now;
  if (elapsed > 0 && elapsed < 0.25) fps += (1 / elapsed - fps) * 0.08;
  carry += Math.min(0.2, elapsed);
  while (carry >= STEP) {
    advance();
    carry -= STEP;
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
