import { reversalCharge } from './cockpit.ts';
import { HUD_ALTITUDE_BAND_KEYS, HUD_CRITICAL_HULL, HUD_LOW_BOOST, HUD_LOW_HULL } from './data/hud.ts';
import { phaseAt } from './data/phases.ts';
import { ROLL_COOLDOWN_TICKS } from './data/roll.ts';
import type { createTranslator, MessageKey } from './i18n.ts';
import { maneuverAllowsControl, nearestBand } from './maneuvers.ts';
import { canRoll, rollBoltImmune } from './roll.ts';
import { bossTick, endTick, requiredXp } from './stage.ts';
import {
  bombCapacity, bombReloadTicks, canDropFlare, clamp, flareCapacity, MAX_ALTITUDE, MIN_ALTITUDE, TICKS_PER_SECOND,
} from './stage-combat.ts';
import type { StageState } from './stage-types.ts';

type Translate = ReturnType<typeof createTranslator>;

export function hudHullTone(hull: number): 'normal' | 'low' | 'critical' {
  return hull <= HUD_CRITICAL_HULL ? 'critical' : hull < HUD_LOW_HULL ? 'low' : 'normal';
}

export const hudBoostTone = (boost: number) => boost < HUD_LOW_BOOST ? 'low' : 'normal';

export const shieldActive = (state: Pick<StageState, 'invulnerability' | 'roll'>) =>
  state.invulnerability > 0 || rollBoltImmune(state.roll);

export const altitudeBandKey = (altitude: number) => HUD_ALTITUDE_BAND_KEYS[nearestBand(altitude)];

export function clockText(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function hudTimer(state: Pick<StageState, 'tick' | 'run'>): string {
  const total = endTick(state) / TICKS_PER_SECOND;
  const elapsed = clamp(Math.floor(state.tick / TICKS_PER_SECOND), 0, total);
  return `${clockText(elapsed)} / ${clockText(total)}`;
}

export function hudPhaseKey(state: Pick<StageState, 'tick' | 'run'>): MessageKey {
  if (state.run) return `phase.${phaseAt(state.tick / TICKS_PER_SECOND).id}`;
  return state.tick < bossTick(state) ? 'hud.phaseLegacy' : 'phase.warden';
}

function setDisabled(button: HTMLElement, ready: boolean): void {
  const disabled = ready ? 'false' : 'true';
  if (button.getAttribute('aria-disabled') !== disabled) button.setAttribute('aria-disabled', disabled);
}

export class NumericHud {
  private readonly el;
  private readonly fills = new Map<HTMLElement, number>();
  private translate: Translate | null = null;
  private hull = -1;
  private maxHull = -1;
  private speed = -1;
  private boost = -1;
  private altitude = -1;
  private markerAltitude = -1;
  private band: MessageKey | null = null;
  private bombs = -1;
  private maxBombs = -1;
  private flares = -1;
  private maxFlares = -1;
  private level = -1;
  private xp = -1;
  private xpCost: number | null = null;
  private lastSecond = -1;
  private duration = -1;
  private phase: MessageKey | null = null;
  private view: StageState['view'] | null = null;

  constructor(root: HTMLElement) {
    const get = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    this.el = {
      hull: get('hull-value'), hullMeter: get('hull-fill'), hullWarning: get('hull-warning'), shield: get('hull-shield'),
      boost: get('boost-value'), boostMeter: get('boost-bar'), speed: get('speed-value'),
      altitude: get('alt-number'), band: get('alt-band'), altMarker: get('alt-marker'),
      bombs: get('bombs'), bombMeter: get('bomb-reload-bar'), flares: get('flare-stock'),
      level: get('xp-label'), xp: get('xp-value'), xpMeter: get('xp-bar'),
      timer: get('segment-timer'), phase: get('hud-phase'), view: get('view-label'),
      loop: get('loop-status'), roll: get('roll-status'), touchLoop: get('touch-loop'), touchRoll: get('touch-roll'),
      touchBomb: get('touch-bomb'), touchFlare: get('touch-flare'),
    };
  }

  private fill(el: HTMLElement, ratio: number): number {
    const percent = Math.round(clamp(ratio, 0, 1) * 100);
    if (this.fills.get(el) !== percent) {
      this.fills.set(el, percent);
      el.style.setProperty('--hud-fill', `${percent}%`);
    }
    return percent;
  }

  private readiness(el: HTMLElement, button: HTMLElement, ready: boolean, charge: number, controlKey: MessageKey,
    t: Translate, translated: boolean): void {
    this.fill(el, charge);
    this.fill(button, charge);
    setDisabled(button, ready);
    const flag = ready ? 'true' : 'false';
    if (translated || el.dataset.ready !== flag) {
      el.dataset.ready = flag;
      const label = t(ready ? 'hud.controlReady' : 'hud.controlUnavailable', { control: t(controlKey) });
      el.setAttribute('aria-label', `${label} · ${el.textContent}`);
    }
  }

  update(state: StageState, t: Translate, loopReady: boolean): void {
    const el = this.el, translated = this.translate !== t;
    this.translate = t;
    if (state.hull !== this.hull || state.maxHull !== this.maxHull) {
      this.hull = state.hull;
      this.maxHull = state.maxHull;
      const tone = hudHullTone(state.hull);
      el.hull.textContent = `${state.hull}/${state.maxHull}`;
      el.hull.dataset.tone = el.hullMeter.dataset.tone = tone;
      el.hullWarning.hidden = tone === 'normal';
      this.fill(el.hullMeter, state.hull / state.maxHull);
    }
    const shield = shieldActive(state);
    if (el.shield.hidden === shield) el.shield.hidden = !shield;

    const boost = this.fill(el.boostMeter, state.boost), boostTone = hudBoostTone(state.boost);
    if (el.boost.dataset.tone !== boostTone) el.boost.dataset.tone = el.boostMeter.dataset.tone = boostTone;
    if (this.boost !== boost) {
      el.boost.textContent = `${boost}%`;
      this.boost = boost;
    }
    const speed = Math.round(state.speed);
    if (this.speed !== speed) {
      el.speed.textContent = String(speed);
      this.speed = speed;
    }
    const altitude = state.player.altitude, roundedAltitude = Math.round(altitude), band = altitudeBandKey(altitude);
    if (this.altitude !== roundedAltitude) {
      el.altitude.textContent = String(roundedAltitude);
      this.altitude = roundedAltitude;
    }
    if (translated || this.band !== band) {
      el.band.textContent = t(band);
      this.band = band;
    }
    if (this.markerAltitude !== altitude) {
      this.markerAltitude = altitude;
      el.altMarker.style.top = `${(MAX_ALTITUDE - altitude) * 100 / (MAX_ALTITUDE - MIN_ALTITUDE)}%`;
    }

    this.updateStores(state, t, translated);
    this.updateProgress(state, t, translated);
    this.readiness(el.loop, el.touchLoop, loopReady, reversalCharge(state), 'control.loop', t, translated);

    const rollReady = canRoll(state);
    const rollCharge = state.maneuver || state.tick <= state.graceUntil ? 0
      : 1 - Math.max(0, (state.rollReadyAt ?? 0) - state.tick) / ROLL_COOLDOWN_TICKS;
    this.readiness(el.roll, el.touchRoll, rollReady, rollCharge, 'control.roll', t, translated);
  }

  private updateStores(state: StageState, t: Translate, translated: boolean): void {
    const el = this.el;
    const maxBombs = bombCapacity(state), maxFlares = flareCapacity(state);
    if (translated || this.bombs !== state.bombs || this.maxBombs !== maxBombs) {
      this.bombs = state.bombs;
      this.maxBombs = maxBombs;
      el.bombs.textContent = String(this.bombs);
      el.touchBomb.setAttribute('aria-label', `${t('control.bomb')} · ${this.bombs}/${maxBombs}`);
    }
    const refill = state.bombReloadAt === null ? 1 : 1 - (state.bombReloadAt - state.tick) / bombReloadTicks(state);
    this.fill(el.bombMeter, refill);
    setDisabled(el.touchBomb, !!state.bombs && maneuverAllowsControl(state.maneuver)
      && state.tick > state.graceUntil && state.tick >= state.bombReadyAt);

    if (translated || this.flares !== state.flareCharges || this.maxFlares !== maxFlares) {
      this.flares = state.flareCharges;
      this.maxFlares = maxFlares;
      el.flares.textContent = `${this.flares}/${maxFlares}`;
      el.touchFlare.setAttribute('aria-label', `${t('control.flare')} · ${this.flares}/${maxFlares}`);
    }
    const flareReady = canDropFlare(state), ready = flareReady ? 'true' : 'false';
    if (el.flares.dataset.ready !== ready) el.flares.dataset.ready = ready;
    setDisabled(el.touchFlare, flareReady);
  }

  private updateProgress(state: StageState, t: Translate, translated: boolean): void {
    const el = this.el, xpCost = requiredXp(state.level, !!state.run), xp = Math.min(xpCost ?? 0, state.xp);
    if (translated || this.level !== state.level) {
      el.level.textContent = t('hud.level', { level: state.level });
      this.level = state.level;
    }
    if (translated || this.xp !== xp || this.xpCost !== xpCost) {
      el.xp.textContent = xpCost === null ? t('hud.xpFull') : `${xp}/${xpCost}`;
      this.fill(el.xpMeter, xpCost === null ? 1 : xp / xpCost);
      this.xp = xp;
      this.xpCost = xpCost;
    }
    const second = Math.floor(state.tick / TICKS_PER_SECOND), duration = endTick(state);
    if (this.lastSecond !== second || this.duration !== duration) {
      this.lastSecond = second;
      this.duration = duration;
      el.timer.textContent = hudTimer(state);
    }
    const phase = hudPhaseKey(state);
    if (translated || this.phase !== phase) {
      el.phase.textContent = t(phase);
      this.phase = phase;
    }
    if (translated || this.view !== state.view) {
      el.view.textContent = t(`view.${state.view}`);
      this.view = state.view;
    }
  }
}
