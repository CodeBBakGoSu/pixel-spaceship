import './hostile-feedback.css';
import { CockpitLineRaster, cockpitPixel, cockpitSurface } from './cockpit-pixels.ts';
import { GrazePopup, hitDirection } from './hostile-feedback-state.ts';
import type { createTranslator } from './i18n.ts';
import type { CockpitLayout, PhoneLayout, Rect } from './layout.ts';
import type { StageState } from './stage-types.ts';

type Context = CanvasRenderingContext2D;
type Translate = ReturnType<typeof createTranslator>;
type Anchor = Readonly<{ x: number; y: number }>;
type Label = { text: string; width: number };

const HIT_POPUP_MS = 640;
const CRACK_MS = 1500;
const WARNING_MS = 530;
const CRACK_WIDTH = 96;
const CRACK_HEIGHT = 64;
const CRACK_VARIANTS = [
  [
    [3, 7, 11, 14, 15, 13, 25, 23, 32, 21, 40, 31, 53, 33, 64, 45, 79, 50, 93, 60],
    [25, 23, 19, 31, 20, 39, 8, 50, 6, 60],
    [25, 23, 32, 15, 41, 13, 50, 4],
    [40, 31, 41, 43, 50, 50, 47, 61],
    [53, 33, 61, 28, 74, 31, 90, 27],
    [19, 31, 10, 27, 3, 31],
  ], [
    [92, 8, 82, 18, 73, 18, 65, 27, 58, 28, 46, 40, 36, 44, 27, 43, 17, 54, 3, 57],
    [65, 27, 68, 38, 60, 47, 63, 58],
    [65, 27, 61, 16, 50, 9, 36, 8],
    [46, 40, 39, 31, 38, 22, 29, 20, 22, 12],
    [36, 44, 31, 55, 32, 62],
    [68, 38, 79, 41, 92, 39],
  ], [
    [3, 61, 15, 46, 23, 47, 31, 36, 42, 37, 50, 29, 58, 28, 68, 17, 81, 16, 94, 7],
    [31, 36, 25, 27, 25, 20, 16, 18, 9, 8],
    [31, 36, 37, 49, 48, 52, 53, 61],
    [50, 29, 50, 20, 59, 13, 60, 3],
    [58, 28, 68, 34, 78, 35, 90, 43],
    [25, 27, 16, 32, 3, 27],
  ],
];

const FLASH = [{ opacity: 0.94 }, { opacity: 0.53, offset: 0.32 }, { opacity: 0 }];
const SOFT_FLASH = [{ opacity: 0.48 }, { opacity: 0 }];
const PIP_BLINK = [
  { filter: 'brightness(2.1) drop-shadow(0 0 3px #ff5c53)' },
  { filter: 'brightness(0.56)', offset: 0.28 },
  { filter: 'brightness(1.8) drop-shadow(0 0 2px #ff6356)', offset: 0.53 },
  { filter: 'none' },
];
const PIP_GLOW = [{ filter: 'brightness(1.5) drop-shadow(0 0 2px #ff6356)' }, { filter: 'none' }];
const SHAKE = [
  { translate: '3px -2px', easing: 'steps(1, end)' },
  { translate: '-2px 2px', easing: 'steps(1, end)' },
  { translate: '2px 1px', easing: 'steps(1, end)' },
  { translate: '-1px -1px', easing: 'steps(1, end)' },
  { translate: '0px 0px' },
];
const RGB_SPLIT = 'drop-shadow(-1px 0 #fa5568) drop-shadow(1px 0 #5ee7ec)';
const GLITCH = [
  { translate: '2px 0px', filter: RGB_SPLIT, easing: 'steps(1, end)' },
  { translate: '-1px 1px', filter: RGB_SPLIT, easing: 'steps(1, end)' },
  { translate: '1px 0px', filter: 'none', easing: 'steps(1, end)' },
  { translate: '0px 0px', filter: 'none' },
];
function scaledTranslate(translate: string, scale: number): string {
  return translate.replace(/(-?\d+(?:\.\d+)?)px/g, (_match, px) => `${Number(px) * scale}px`);
}
function scaledShake(scale: number): Keyframe[] {
  return SHAKE.map(frame => ({ ...frame, translate: scaledTranslate(frame.translate, scale) }));
}
function scaledGlitch(scale: number): Keyframe[] {
  const split = `drop-shadow(${-scale}px 0 #fa5568) drop-shadow(${scale}px 0 #5ee7ec)`;
  return GLITCH.map(frame => ({
    ...frame,
    translate: scaledTranslate(frame.translate, scale),
    filter: frame.filter === RGB_SPLIT ? split : frame.filter,
  }));
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const right = (rect: Readonly<Rect>): number => rect.x + rect.width;
const bottom = (rect: Readonly<Rect>): number => rect.y + rect.height;

function crackSprite(lines: readonly number[][]): HTMLCanvasElement {
  const rect = { x: 0, y: 0, width: CRACK_WIDTH, height: CRACK_HEIGHT };
  const { canvas, context } = cockpitSurface(rect.width, rect.height);
  const raster = new CockpitLineRaster(rect);
  for (const line of lines) {
    for (let i = 2; i < line.length; i += 2) {
      raster.line(cockpitPixel(0x1a2636), line[i - 2], line[i - 1], line[i], line[i + 1], 2);
    }
  }
  for (const line of lines) {
    for (let i = 2; i < line.length; i += 2) {
      raster.line(cockpitPixel(0xd8eeeb), line[i - 2], line[i - 1], line[i], line[i + 1], 1);
    }
  }
  raster.draw(context, rect);
  return canvas;
}

function drawChip(c: Context, area: Rect, label: Label, x: number, y: number, color: string, border: string, icon?: Path2D): void {
  const width = label.width + (icon ? 14 : 0);
  const left = Math.round(clamp(x - width / 2, area.x + 2, right(area) - width - 2));
  const centerY = Math.round(clamp(y, area.y + 9, bottom(area) - 9));
  c.fillStyle = '#0d1420';
  c.fillRect(left, centerY - 8, width, 17);
  c.fillStyle = border;
  c.fillRect(left, centerY + 8, width, 1);
  c.fillRect(left, centerY - 8, 2, 17);
  c.fillStyle = color;
  c.fillText(label.text, left + width / 2 + (icon ? 6 : 0), centerY);
  if (icon) {
    c.translate(left + 9, centerY);
    c.fill(icon, 'evenodd');
    c.translate(-left - 9, -centerY);
  }
}

// This layer reads stage snapshots and never feeds values back into the simulation.
export class HostileFeedback {
  private readonly edge: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: Context;
  private readonly screen: HTMLCanvasElement;
  private readonly glass: HTMLCanvasElement;
  private readonly panels: HTMLCanvasElement | null;
  private readonly hull: HTMLElement;
  private readonly reduced: MediaQueryList;
  private readonly font: string;
  private readonly animations: Animation[] = [];
  private readonly field: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly crackSprites = CRACK_VARIANTS.map(crackSprite);
  private readonly crackAt = new Float64Array(CRACK_VARIANTS.length).fill(-Infinity);
  private readonly arrow = new Path2D('M 0 -17 L 10 -7 L 10 -2 L 0 -10 L -10 -2 L -10 -7 Z');
  private readonly arrowCore = new Path2D('M 0 -16 L 5 -11 L 0 -12 L -5 -11 Z');
  private readonly shieldRing = new Path2D('M -8 -22 H -11 L -22 -11 V -6 M 8 -22 H 11 L 22 -11 V -6 M 22 6 V 11 L 11 22 H 8 M -22 6 V 11 L -11 22 H -8');
  private readonly shieldIcon = new Path2D('M -5 -5 H 5 V 1 L 3 4 L 0 6 L -3 4 L -5 1 Z M -3 -3 V 1 L 0 4 L 3 1 V -3 Z');
  private readonly warningLight = new Path2D('M -2 -4 H 2 L 4 -2 V 2 L 2 4 H -2 L -4 2 V -2 Z');
  private readonly grazing = new GrazePopup();
  private readonly damageLabel: Label = { text: '', width: 0 };
  private readonly grazeLabel: Label = { text: '', width: 0 };
  private readonly shieldLabel: Label = { text: '', width: 0 };
  private readonly warningLabel: Label = { text: '', width: 0 };
  private phone: PhoneLayout | null = null;
  private cockpit: CockpitLayout | null = null;
  private translate: Translate | null = null;
  private grazeCount = 0;
  private damage = 0;
  private shakeScale = 1;
  private damageDirty = false;
  private hitAt = -Infinity;
  private hitX = 0;
  private hitZ = 0;
  private hitAltitude = 0;
  private crackIndex = 0;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;
    this.edge = doc.createElement('div');
    this.edge.className = 'hostile-hit-edge';
    this.edge.setAttribute('aria-hidden', 'true');
    root.insertBefore(this.edge, root.querySelector('#cockpit-display'));
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'hostile-feedback';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    root.insertBefore(this.canvas, root.querySelector('.hud'));
    this.context = this.canvas.getContext('2d')!;
    this.screen = root.querySelector('#screen')!;
    this.glass = root.querySelector('#cockpit-overlay')!;
    this.panels = root.querySelector('.cockpit-instruments:last-child');
    this.hull = root.querySelector('.hull-bars')!;
    const window = doc.defaultView!;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.font = '13px ' + window.getComputedStyle(doc.documentElement).getPropertyValue('--game-font').trim();
  }

  setShakeScale(scale: number): void {
    this.shakeScale = clamp(scale, 0, 1);
  }

  resize(width: number, height: number, phone: PhoneLayout | null, cockpit: CockpitLayout | null): void {
    this.phone = phone;
    this.cockpit = cockpit;
    const field = this.field;
    field.x = phone?.playfield.x ?? 0;
    field.y = phone?.playfield.y ?? 0;
    field.width = phone ? Math.max(0, phone.alt.x - field.x - 4) : width;
    field.height = phone?.playfield.height ?? height;
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.imageSmoothingEnabled = false;
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';
    this.context.font = this.font;
  }

  private stopAnimations(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations.length = 0;
  }

  reset(): void {
    this.stopAnimations();
    this.grazing.reset();
    this.grazeCount = this.crackIndex = 0;
    this.hitAt = -Infinity;
    this.crackAt.fill(-Infinity);
    this.canvas.hidden = true;
  }

  hit(state: StageState, damage: number, fromX: number, fromZ: number, fromAlt: number, now = performance.now()): void {
    if (damage <= 0) return;
    this.damage = damage;
    this.damageDirty = true;
    this.hitAt = now;
    this.hitX = fromX - state.player.x;
    this.hitZ = fromZ - state.player.z;
    this.hitAltitude = fromAlt - state.player.altitude;
    this.crackAt[this.crackIndex] = now;
    this.crackIndex = (this.crackIndex + 1) % this.crackAt.length;

    this.stopAnimations();
    const reduced = this.reduced.matches;
    this.animations.push(this.edge.animate(reduced ? SOFT_FLASH : FLASH, 440),
      this.hull.animate(reduced ? PIP_GLOW : PIP_BLINK, 480));
    if (reduced || this.shakeScale <= 0) return;
    this.animations.push(this.screen.animate(scaledShake(this.shakeScale), 175));
    if (state.view === 'cockpit') {
      this.animations.push(this.glass.animate(scaledShake(this.shakeScale), 175));
      if (this.panels) this.animations.push(this.panels.animate(scaledGlitch(this.shakeScale), 160));
    }
  }

  graze(state: StageState, now = performance.now()): void {
    if (state.phase === 'playing' && !state.paused) this.grazing.add(now);
  }

  needsAnchor(state: StageState, now: number): boolean {
    return !state.paused && (now - this.hitAt < HIT_POPUP_MS || this.grazing.active(now)
      || (state.view === 'cockpit' && state.invulnerability > 0));
  }

  private setLabel(label: Label, text: string): void {
    label.text = text;
    label.width = Math.ceil(this.context.measureText(text).width) + 14;
  }

  private updateLabels(t: Translate, count: number): void {
    const changed = this.translate !== t;
    if (changed) {
      this.translate = t;
      this.setLabel(this.shieldLabel, t('cockpit.hitShield'));
      this.setLabel(this.warningLabel, t('cockpit.impactWarning'));
    }
    if (this.damageDirty || changed) {
      this.damageDirty = false;
      this.setLabel(this.damageLabel, t('hud.hitDamage', { damage: this.damage }));
    }
    if (count > 0 || changed) {
      this.grazeCount = count || this.grazeCount;
      this.setLabel(this.grazeLabel,
        this.grazeCount > 1 ? t('hud.grazeStack', { count: this.grazeCount }) : t('hud.graze'));
    }
  }

  private drawCracks(c: Context, area: Rect, now: number): void {
    const center = area.x + area.width / 2, reach = Math.min(area.width / 2 - 6, 226);
    const width = Math.floor(Math.min(194, reach - 8, area.height * 0.61));
    if (width < 18) return;
    const height = Math.round(width * CRACK_HEIGHT / CRACK_WIDTH);
    for (let i = 0; i < this.crackAt.length; i++) {
      const age = now - this.crackAt[i];
      if (age >= CRACK_MS) continue;
      const x = i === 1 ? center + reach - width : center - reach;
      const y = area.y + (area.height - height) * (i === 2 ? 0.83 : i === 1 ? 0.44 : 0.31);
      c.globalAlpha = (1 - age / CRACK_MS) * 0.88;
      c.drawImage(this.crackSprites[i], Math.round(x), Math.round(y), width, height);
    }
    c.globalAlpha = 1;
  }

  private drawHit(c: Context, area: Rect, state: StageState, x: number, y: number, offset: number, age: number): void {
    c.globalAlpha = Math.min(1, (HIT_POPUP_MS - age) / 190);
    const angle = hitDirection(state.view, state.player.yaw, this.hitX, this.hitZ, this.hitAltitude);
    c.save();
    c.translate(x + Math.sin(angle) * offset, y - Math.cos(angle) * offset);
    c.rotate(angle);
    c.strokeStyle = '#391522';
    c.lineWidth = 4;
    c.lineJoin = 'bevel';
    c.stroke(this.arrow);
    c.fillStyle = '#ff6658';
    c.fill(this.arrow);
    c.fillStyle = '#fff2cf';
    c.fill(this.arrowCore);
    c.restore();
    drawChip(c, area, this.damageLabel, x + 57, y - 18, '#fff0d9', '#ff6658');
    c.globalAlpha = 1;
  }

  private drawGraze(c: Context, area: Rect, x: number, y: number, now: number): void {
    const reduced = this.reduced.matches;
    const age = now - this.grazing.shownAt;
    c.globalAlpha = this.grazing.opacity(now);
    if (age < 175) {
      const spread = reduced ? 8 : Math.round(4 + age * 0.07);
      c.fillStyle = '#ffec97';
      c.fillRect(x - spread, y - spread, 3, 2);
      c.fillRect(x + spread, y - spread / 2, 2, 2);
      c.fillRect(x + spread / 2, y + spread, 2, 3);
      c.fillStyle = '#fff8d8';
      c.fillRect(x, y - 4, 2, 10);
      c.fillRect(x - 4, y, 10, 2);
    }
    const drift = reduced ? 0 : Math.round(Math.min(5, age / 90));
    drawChip(c, area, this.grazeLabel, x - 26, y + 14 - drift, '#fff1b6', '#dfbc68');
    c.globalAlpha = 1;
  }

  private drawShield(c: Context, area: Rect, x: number, y: number, labelY: number): void {
    c.save();
    c.translate(x, y);
    c.strokeStyle = '#102833';
    c.lineWidth = 4;
    c.stroke(this.shieldRing);
    c.strokeStyle = '#8df5f2';
    c.lineWidth = 1.6;
    c.stroke(this.shieldRing);
    c.restore();
    drawChip(c, area, this.shieldLabel, x, labelY, '#a9fff1', '#62c3c6', this.shieldIcon);
  }

  update(state: StageState, t: Translate, anchor: Anchor | null, mirror: Readonly<Rect> | null, now: number): void {
    const cockpit = this.cockpit, area = cockpit?.aiming ?? this.field;
    const hitAge = now - this.hitAt;
    const playing = state.phase === 'playing' && !state.paused;
    const shield = !!cockpit && playing && state.invulnerability > 0;
    const active = !state.paused && area.width >= 70 && area.height >= 24
      && (hitAge < HIT_POPUP_MS || (playing && this.grazing.active(now)) || !!cockpit && (shield || hitAge < CRACK_MS));
    if (this.canvas.hidden === active) this.canvas.hidden = !active;
    if (!active) return;

    const c = this.context;
    this.updateLabels(t, this.grazing.take(now));
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.save();
    c.beginPath();
    c.rect(area.x, area.y, area.width, area.height);
    if (mirror) {
      const x = Math.max(area.x, mirror.x - 3), y = Math.max(area.y, mirror.y - 3);
      const w = Math.min(right(area), right(mirror) + 3) - x;
      const h = Math.min(bottom(area), bottom(mirror) + 3) - y;
      if (w > 0 && h > 0) c.rect(x, y, w, h);
    }
    c.clip('evenodd');

    const midX = this.canvas.width / 2;
    const centeredY = cockpit ? area.y + area.height * 0.5
      : this.phone ? this.phone.shipY : this.canvas.height * (state.view === 'overhead' ? 0.57 : 0.53);
    const xPad = Math.min(79, area.width / 2), yPad = Math.min(51, area.height / 2);
    const x = Math.round(clamp(anchor?.x ?? midX, area.x + xPad, right(area) - xPad));
    const y = Math.round(clamp(anchor?.y ?? centeredY, area.y + yPad, bottom(area) - yPad));
    if (cockpit) this.drawCracks(c, area, now);
    if (shield) {
      const aimX = Math.round(clamp(anchor?.x ?? midX, area.x + 10, right(area) - 10));
      const aimY = Math.round(clamp(anchor?.y ?? centeredY, area.y + 10, bottom(area) - 10));
      this.drawShield(c, area, aimX, aimY, y + 53);
    }
    if (hitAge < HIT_POPUP_MS) {
      const offset = this.phone || cockpit?.compact ? 29 : 35;
      const clearance = offset + 22;
      const overMirror = mirror && x + clearance > mirror.x && x - clearance < right(mirror)
        && y + clearance > mirror.y && y - clearance < bottom(mirror);
      const hitY = overMirror ? Math.min(bottom(area) - yPad, bottom(mirror) + clearance) : y;
      this.drawHit(c, area, state, x, hitY, offset, hitAge);
    }
    if (playing && this.grazing.opacity(now) > 0) this.drawGraze(c, area, x - 31, y + 23, now);
    if (cockpit && hitAge < WARNING_MS) {
      const labelHalf = (this.warningLabel.width + 14) / 2;
      const lightX = Math.max(area.x + labelHalf + 8, midX - 139);
      const underMirror = mirror && lightX + labelHalf >= mirror.x && lightX - labelHalf <= right(mirror);
      const lightY = Math.round(Math.min(bottom(area) - 10, underMirror ? bottom(mirror) + 12 : area.y + 12));
      const lit = this.reduced.matches || Math.floor(hitAge / 108) % 2 === 0;
      drawChip(c, area, this.warningLabel, lightX, lightY, lit ? '#ff7964' : '#c27168', '#d65b52', this.warningLight);
    }
    c.restore();
  }
}
