import type { Point } from './camera';
import {
  cockpitAim, cockpitCacheKey, cockpitHeadingDegrees, cockpitMfdDue, cockpitWarnings, headingTickLabel, pitchLadder, selectCockpitTarget,
  type CockpitMotion, type CockpitTarget, type CockpitView, type CockpitWarnings,
} from './cockpit';
import {
  CockpitLabelAtlas, CockpitLineRaster, cockpitPixel, cockpitSurface, drawCockpitLabel, type CockpitLabel,
} from './cockpit-pixels';
import type { GameState } from './game';
import type { createTranslator, Language } from './i18n';
import type { CockpitLayout, Rect } from './layout';

type Context = CanvasRenderingContext2D;
type Translate = ReturnType<typeof createTranslator>;
type WeaponReadout = { gun: string; ammo: string; bombs: string; missiles: string };
const green = '#a3ffc0', dimGreen = '#65927a', amber = '#ffce7e', ink = '#0d1d20';
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const middle = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

function fill(c: Context, color: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function pixelLine(c: Context, color: string, x: number, y: number, endX: number, endY: number, weight = 1): void {
  const dx = endX - x, dy = endY - y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i <= steps; i++) {
    c.rect(Math.round(x + dx * i / steps), Math.round(y + dy * i / steps), weight, weight);
  }
  c.fill();
}

function outline(c: Context, color: string, r: Rect): void {
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);
}

function stroke(c: Context, points: Point[], color: string, weight: number): void {
  c.strokeStyle = color;
  c.lineWidth = weight;
  c.lineJoin = 'bevel';
  c.beginPath();
  c.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) c.lineTo(p.x, p.y);
  c.stroke();
}

function text(c: Context, label: string, x: number, y: number, color = green, align: CanvasTextAlign = 'left'): void {
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(label, Math.round(x), Math.round(y));
}

function fittedText(c: Context, label: string, x: number, y: number, color: string, width: number, fontFamily: string, size: number): void {
  c.font = `${size}px ${fontFamily}`;
  if (c.measureText(label).width > width) c.font = `${size - 1}px ${fontFamily}`;
  text(c, label, x, y, color, 'center');
}

function drawCombiner(c: Context, layout: CockpitLayout): void {
  const { compact, heading, aiming } = layout;
  const center = middle(heading).x;
  const half = Math.min(aiming.width / 2, compact ? 124 : 265);
  const y = heading.y + 8, end = bottom(aiming) - 4;
  if (end <= y) return;
  const corners = [
    { x: center - half + 12, y: end }, { x: center - half + 18, y: y + 15 },
    { x: center - half + 27, y }, { x: center + half - 27, y },
    { x: center + half - 18, y: y + 15 }, { x: center + half - 12, y: end },
  ];
  c.fillStyle = 'rgba(30,108,81,.065)';
  c.beginPath(); c.moveTo(corners[0].x, corners[0].y);
  for (const p of corners.slice(1)) c.lineTo(p.x, p.y);
  c.closePath(); c.fill();
  stroke(c, corners, 'rgba(149,216,194,.16)', 1);
  for (const side of [-1, 1]) {
    fill(c, '#496465', center + side * (half - 12) - 2, end - 9, 4, 12);
  }
}

function drawChrome(c: Context, layout: CockpitLayout): void {
  const d = layout.dashboard, compact = layout.compact, center = middle(d).x;
  const start = d.x + (compact ? 4 : 10), reach = d.width * (compact ? 0.16 : 0.22);
  const leftRail = [
    { x: start, y: d.y + 7 },
    { x: start + (compact ? 8 : 22), y: Math.round(d.y * 0.54) },
    { x: start + reach * 0.45, y: Math.round(d.y * (compact ? 0.14 : 0.17)) },
    { x: start + reach, y: Math.round(d.y * 0.041) },
    { x: center - d.width * 0.16, y: 6 }, { x: center, y: 6 },
  ];
  const rail = [...leftRail, ...leftRail.slice(0, -1).reverse().map(p => ({ x: 2 * center - p.x, y: p.y }))];
  stroke(c, rail, '#0a111a', compact ? 11 : 24);
  stroke(c, rail, '#273646', compact ? 7 : 17);
  stroke(c, rail, '#516577', compact ? 2 : 5);
  stroke(c, rail, '#344351', 1);
  for (const p of [rail[2], rail[3], rail[7], rail[8]]) {
    fill(c, '#111b26', p.x - 3, p.y - 2, 7, 5);
    fill(c, '#b5c1c4', p.x - 1, p.y - 1, 2, 2);
  }
  fill(c, '#111e2d', center - 21, 4, 42, compact ? 8 : 13);
  fill(c, '#bb8047', center - 6, compact ? 8 : 11, 12, 2);
  drawCombiner(c, layout);

  fill(c, '#16212e', d.x, d.y, d.width, d.height);
  fill(c, '#080e17', d.x, d.y, d.width, compact ? 3 : 8);
  fill(c, '#536271', d.x, d.y + 1, d.width, compact ? 1 : 2);
  if (!compact) {
    const lip = [
      { x: d.x, y: d.y + 6 }, { x: center - 247, y: d.y + 6 },
      { x: center - 224, y: d.y + 1 }, { x: center + 224, y: d.y + 1 },
      { x: center + 247, y: d.y + 6 }, { x: right(d), y: d.y + 6 },
    ];
    stroke(c, lip, '#4c5d6b', 2);
  }
  fill(c, '#344454', d.x, bottom(d) - 3, d.width, 1);
  for (const [i, p] of [layout.radar, layout.damage, layout.weapons, layout.gauges].entries()) {
    const screen = i < 3;
    fill(c, '#324452', p.x, p.y, p.width, p.height);
    fill(c, '#0a141c', p.x + 1, p.y + 1, p.width - 2, p.height - 2);
    fill(c, screen ? '#0b201f' : '#101a27', p.x + 3, p.y + 3, p.width - 6, p.height - 7);
    fill(c, '#5c7379', p.x + 1, bottom(p) - 3, p.width - 2, 1);
    if (compact) continue;
    for (const x of [p.x + 7, right(p) - 9]) {
      fill(c, '#7a919e', x, p.y + 5, 2, 2);
      fill(c, '#8a9aa2', x, bottom(p) - 7, 2, 2);
    }
    for (let j = 1; j <= 4; j++) {
      const x = p.x + p.width * j / 5;
      fill(c, '#060b13', x - 9, bottom(p) - 9, 18, 5);
      fill(c, j === 1 ? '#8e6345' : '#445265', x - 6, bottom(p) - 8, 12, 2);
    }
  }
  if (!compact && layout.radar.x - d.x >= 52) {
    // A small, original dash ornament sits outside the instruments.
    const x = layout.radar.x - 53, y = layout.radar.y + 11;
    fill(c, '#090e13', x - 3, y + 14, 30, 4);
    fill(c, '#a85d30', x + 1, y + 10, 20, 5);
    fill(c, '#f3bc45', x, y + 7, 19, 6);
    fill(c, '#ffd96c', x + 8, y + 1, 11, 9);
    fill(c, '#ff8d55', x + 19, y + 6, 6, 3);
    fill(c, '#332334', x + 15, y + 3, 2, 2);
    fill(c, '#ffeab1', x + 8, y, 7, 2);
  }
}

class GlassLabels {
  private readonly atlas: CockpitLabelAtlas;
  private readonly numbers = new Map<number, CockpitLabel>();
  private readonly gLoads = new Map<number, CockpitLabel>();
  private readonly tracked = new Map<number, CockpitLabel>();
  private readonly locked = new Map<number, CockpitLabel>();
  readonly bearings: CockpitLabel[];
  readonly headingTicks: CockpitLabel[];
  readonly pitch: { left: CockpitLabel; right: CockpitLabel }[];

  constructor(font: string, private readonly t: Translate) {
    const atlas = this.atlas = new CockpitLabelAtlas(font);
    this.bearings = Array.from({ length: 360 }, (_, n) => atlas.add(t('cockpit.bearing', {
      value: String(n).padStart(3, '0'),
    }), green, 'center'));
    this.headingTicks = Array.from({ length: 24 }, (_, n) => atlas.add(headingTickLabel(n * 15, t), green, 'center'));
    this.pitch = Array.from({ length: 13 }, (_, n) => {
      const label = String(n * 10 - 60);
      return { left: atlas.add(label, green, 'right', '#16312b'), right: atlas.add(label, green, 'left', '#16312b') };
    });
    for (let n = 0; n <= 220; n++) this.number(n);
    for (let n = 10; n <= 24; n++) this.load(n);
    // Typical contact ranges are bounded by the radar and weapon range.
    for (let n = 0; n <= 500; n++) this.contact(n, false);
    for (let n = 0; n <= 230; n++) this.contact(n, true);
  }

  number(value: number): CockpitLabel {
    const cached = this.numbers.get(value);
    if (cached) return cached;
    const label = this.atlas.add(String(value), green, 'center');
    this.numbers.set(value, label);
    return label;
  }

  load(value: number): CockpitLabel {
    const cached = this.gLoads.get(value);
    if (cached) return cached;
    const label = this.atlas.add(this.t('cockpit.gLoad', { value: (value / 10).toFixed(1) }), green);
    this.gLoads.set(value, label);
    return label;
  }

  contact(value: number, locked: boolean): CockpitLabel {
    const map = locked ? this.locked : this.tracked;
    const cached = map.get(value);
    if (cached) return cached;
    const range = this.t('cockpit.range', { value });
    const label = this.atlas.add(this.t(locked ? 'cockpit.lock' : 'cockpit.track', { range }), locked ? green : '#81bc9d', 'center');
    map.set(value, label);
    return label;
  }
}

function drawHeadingPlate(c: Context, r: Rect, compact: boolean): void {
  fill(c, 'rgba(9,26,28,.83)', r.x, r.y, r.width, r.height);
  outline(c, '#53766a', r);
  if (r.height < 23) return;
  const pad = compact ? 13 : 16, center = r.x + r.width / 2;
  const axisY = r.y + Math.min(r.height - 3, compact ? 18 : 21);
  fill(c, '#53766a', r.x + pad, axisY, r.width - pad * 2, 1);
  fill(c, '#112f2c', center - 22, bottom(r) - 13, 44, 13);
  fill(c, green, center - 2, axisY - 4, 5, 1);
}

function drawHeading(c: Context, r: Rect, yaw: number, compact: boolean, labels: GlassLabels): void {
  const degrees = cockpitHeadingDegrees(yaw);
  const bearing = labels.bearings[Math.round(degrees) % 360], center = r.x + r.width / 2;
  if (r.height < 23) {
    drawCockpitLabel(c, bearing, center, r.y + r.height / 2);
    return;
  }
  const pad = compact ? 13 : 16, step = compact ? 30 : 15;
  const top = r.y + 7, axisY = r.y + Math.min(r.height - 3, compact ? 18 : 21);
  for (let tick = Math.ceil((degrees - 60) / step) * step; tick <= degrees + 60; tick += step) {
    const x = Math.round(center + (r.width - pad * 2) * (tick - degrees) / 120);
    const tickBottom = x >= Math.round(center - 22) && x < Math.round(center + 22) ? Math.min(bottom(r) - 13, axisY) : axisY;
    if (tickBottom > axisY - 3) fill(c, dimGreen, x, axisY - 3, 1, tickBottom - axisY + 3);
    drawCockpitLabel(c, labels.headingTicks[(tick / 15 + 24) % 24], x, top);
  }
  drawCockpitLabel(c, bearing, center, bottom(r) - 6);
}

function drawTapePlate(c: Context, r: Rect, label: string, altitude: boolean): void {
  fill(c, 'rgba(7,24,27,.8)', r.x, r.y, r.width, r.height);
  outline(c, '#53766a', r);
  if (r.height < 37) return;
  const pivot = Math.round(r.y + r.height / 2);
  const axis = altitude ? r.x + 5 : right(r) - 6;
  const chartTop = r.y + 23, chartBottom = bottom(r) - 8;
  text(c, label, r.x + r.width / 2, r.y + 9, green, 'center');
  fill(c, dimGreen, axis, chartTop, 1, chartBottom - chartTop + 1);
  const box = { x: r.x + 3, y: pivot - 9, width: r.width - 6, height: 18 };
  fill(c, '#173735', box.x, box.y, box.width, box.height);
  outline(c, green, box);
}

function drawTape(c: Context, r: Rect, value: number, altitude: boolean, compact: boolean, labels: GlassLabels, target?: number): void {
  const pivot = Math.round(r.y + r.height / 2), scale = compact ? 1.3 : 2.0;
  const axis = altitude ? r.x + 5 : right(r) - 6;
  if (r.height >= 37) {
    const chartTop = r.y + 23, chartBottom = bottom(r) - 8;
    const start = Math.ceil((value + (pivot - chartBottom) / scale) / 5) * 5;
    const end = value + (pivot - chartTop) / scale;
    for (let tick = Math.max(0, start); tick <= end; tick += 5) {
      const y = pivot + (value - tick) * scale;
      if (Math.round(y) >= pivot - 9 && Math.round(y) < pivot + 9) continue;
      const length = tick % 10 === 0 ? 7 : 3;
      fill(c, dimGreen, altitude ? axis : axis - length + 1, y, length, 1);
      if (!compact && tick % 10 === 0 && Math.abs(y - pivot) > 17) {
        const label = labels.number(tick);
        const x = altitude ? axis + 13 + label.advance / 2 : axis - 13 - label.advance / 2;
        drawCockpitLabel(c, label, x, y);
      }
    }
    if (target !== undefined) {
      const y = clamp(pivot + (value - target) * scale, chartTop, chartBottom);
      pixelLine(c, amber, r.x, y - 3, r.x + 4, y);
      pixelLine(c, amber, r.x + 4, y, r.x, y + 3);
    }
  }
  drawCockpitLabel(c, labels.number(Math.round(value)), r.x + r.width / 2, pivot);
}

const ladderOutline = cockpitPixel(0x183f39), horizonColor = cockpitPixel(0x9befb2), ladderColor = cockpitPixel(0x73bb93);

function drawLadder(c: Context, layout: CockpitLayout, view: CockpitView, motion: CockpitMotion,
  labels: GlassLabels, raster: CockpitLineRaster, marks: ReturnType<typeof pitchLadder>, anchor: Point): void {
  const area = layout.aiming, compact = layout.compact;
  const span = Math.min(compact ? 51 : 105, area.width * 0.31), scale = compact ? 2 : 3;
  const slope = Math.atan2(motion.climb, Math.max(12, motion.speed));
  const pitch = clamp(slope * 180 / Math.PI, -32, 32);
  const horizon = view.screen.height * 0.3 + view.camera.pitch * 15 * view.screen.height / view.buffer.height;
  anchor.x = area.x + area.width / 2 - motion.turn * (compact ? 7 : 14);
  anchor.y = area.y + area.height / 2 - area.height * 0.03;
  pitchLadder(anchor, pitch, motion.bank, span, scale, marks);
  raster.clear();
  for (const mark of marks) {
    const weight = mark.angle === 0 ? 2 : 1, color = mark.angle === 0 ? horizonColor : ladderColor;
    rasterLadderSegment(raster, mark.left, mark.angle < 0, color, weight);
    rasterLadderSegment(raster, mark.right, mark.angle < 0, color, weight);
  }
  raster.draw(c, layout.glass);

  c.save();
  c.beginPath();
  c.rect(area.x, area.y, area.width, area.height);
  c.clip();
  for (const mark of marks) {
    if (mark.angle === 0 || (compact && mark.angle % 20 !== 0)) continue;
    const sprites = labels.pitch[(mark.angle + 60) / 10];
    const left = mark.left.from, right = mark.right.to;
    if (left.y >= area.y + 7 && left.y <= bottom(area) - 7) drawCockpitLabel(c, sprites.left, left.x - 7, left.y);
    if (!compact && right.y >= area.y + 7 && right.y <= bottom(area) - 7) drawCockpitLabel(c, sprites.right, right.x + 8, right.y);
  }
  const pathY = clamp(horizon - Math.sin(slope) * 54, area.y + 10, bottom(area) - 10);
  const pathX = anchor.x + motion.turn * (compact ? 3 : 6);
  for (let side = -1; side <= 1; side += 2) {
    fill(c, green, pathX - 2, pathY + side * 4, 5, 1);
    fill(c, green, pathX + side * 4, pathY - 2, 1, 5);
    for (let end = -1; end <= 1; end += 2) fill(c, green, pathX + side * 3, pathY + end * 3, 1, 1);
  }
  fill(c, green, pathX - 11, pathY, 7, 1);
  fill(c, green, pathX + 5, pathY, 7, 1);
  fill(c, green, pathX, pathY - 9, 1, 5);
  c.restore();
}

function rasterLadderSegment(raster: CockpitLineRaster, line: { from: Point; to: Point }, dashed: boolean, color: number, weight: number): void {
  const { from: a, to: b } = line;
  raster.line(ladderOutline, a.x - 1, a.y - 1, b.x - 1, b.y - 1, weight + 2);
  if (dashed) {
    const dx = b.x - a.x, dy = b.y - a.y;
    raster.line(color, a.x, a.y, a.x + dx * 0.38, a.y + dy * 0.38, weight);
    raster.line(color, a.x + dx * 0.62, a.y + dy * 0.62, b.x, b.y, weight);
  } else raster.line(color, a.x, a.y, b.x, b.y, weight);
}

function drawAim(c: Context, area: Rect, aim: Point, target: CockpitTarget | null, elapsed: number, labels: GlassLabels): void {
  const x = clamp(aim.x, area.x + 10, right(area) - 10), y = clamp(aim.y, area.y + 10, bottom(area) - 10);
  if (x === aim.x && y === aim.y) {
    fill(c, ink, x - 9, y - 1, 19, 3);
    fill(c, ink, x - 1, y - 9, 3, 19);
    fill(c, green, x - 8, y, 5, 1);
    fill(c, green, x + 4, y, 5, 1);
    fill(c, green, x, y - 8, 1, 5);
    fill(c, green, x, y + 4, 1, 5);
    fill(c, green, x, y, 1, 1);
  } else {
    const angle = Math.atan2(aim.y - y, aim.x - x);
    const tipX = x + Math.cos(angle) * 4, tipY = y + Math.sin(angle) * 4;
    for (let side = -1; side <= 1; side += 2) {
      const wing = angle + side * 2.5;
      pixelLine(c, green, tipX, tipY, tipX + Math.cos(wing) * 7, tipY + Math.sin(wing) * 7);
    }
  }
  if (!target) return;

  const p = target.point, size = 11, color = target.locked ? green : '#81bc9d';
  const pulse = target.locked && Math.floor(elapsed * 4) % 2 === 0;
  const targetTop = Math.round(p.y) - size;
  c.strokeStyle = pulse ? green : '#254d41';
  c.lineWidth = 1;
  c.strokeRect(Math.round(p.x) - size + 0.5, targetTop + 0.5, size * 2, size * 2);
  for (let dx = -size; dx <= size; dx += size * 2) for (let dy = -size; dy <= size; dy += size * 2) {
    const cornerX = p.x + dx, cornerY = p.y + dy;
    fill(c, color, cornerX - (dx > 0 ? 4 : 0), cornerY, 5, 1);
    fill(c, color, cornerX, cornerY - (dy > 0 ? 4 : 0), 1, 5);
  }
  const label = labels.contact(target.range, target.locked);
  const width = Math.ceil(label.advance) + 10;
  const below = targetTop + size * 2 + 5;
  const labelY = below + 15 <= bottom(area) ? below : Math.max(area.y, targetTop - 19);
  const labelX = clamp(p.x - width / 2, area.x, right(area) - width);
  fill(c, pulse ? '#204335' : ink, labelX, labelY, width, 15);
  drawCockpitLabel(c, label, labelX + width / 2, labelY + 7);
}

function plate(r: Rect, paint: (c: Context) => void): HTMLCanvasElement {
  const { canvas, context } = cockpitSurface(r.width, r.height);
  context.translate(-r.x, -r.y);
  paint(context);
  return canvas;
}

type WarningCell = { rect: Rect; variants: HTMLCanvasElement[]; painted: number };

function warningCells(layout: CockpitLayout, t: Translate, font: string): WarningCell[] {
  const r = layout.warnings, compact = layout.compact;
  const names = [t(compact ? 'cockpit.cautionShort' : 'cockpit.masterCaution'), t('cockpit.lowHull'),
    t('cockpit.altLow'), t('control.boost')];
  return names.map((label, i) => {
    const x = r.x + Math.round(r.width * i / names.length);
    const width = r.x + Math.round(r.width * (i + 1) / names.length) - x - 2;
    const area = { x, y: r.y, width, height: r.height };
    const variant = (caption: string, active: boolean, useAmber: boolean, bright: boolean) => plate(area, c => {
      const color = useAmber ? amber : green;
      fill(c, bright ? (useAmber ? '#593820' : '#25443a') : '#111923', x, r.y, width, r.height);
      outline(c, active ? (useAmber ? '#bb8047' : '#52896b') : '#384650', area);
      fill(c, bright ? color : active ? '#846540' : '#46545a', x + 5, r.y + (r.height - 4) / 2, 4, 4);
      fittedText(c, caption, x + width / 2 + 3, r.y + r.height / 2, active ? color : '#839795', width - 14, font, compact ? 10 : 12);
    });
    const variants = [variant(label, false, true, false), variant(label, true, true, false), variant(label, true, true, true)];
    if (i === 2) variants.push(variant(t('cockpit.pullUp'), true, true, false), variant(t('cockpit.pullUp'), true, true, true));
    if (i === 3) variants.push(variant(label, true, false, false), variant(label, true, false, true));
    return { rect: area, variants, painted: -1 };
  });
}

function updateWarning(c: Context, cell: WarningCell, variant: number): void {
  if (cell.painted === variant) return;
  c.drawImage(cell.variants[variant], cell.rect.x, cell.rect.y);
  cell.painted = variant;
}

function drawStores(c: Context, r: Rect, weapons: WeaponReadout): void {
  const cell = r.width / 3, y = r.y + r.height / 2;
  fill(c, 'rgba(9,26,28,.83)', r.x, r.y, r.width, r.height);
  outline(c, '#53766a', r);
  for (const [i, label] of [weapons.ammo, weapons.missiles, weapons.bombs].entries()) {
    if (i > 0) fill(c, '#38554e', r.x + i * cell, r.y + 3, 1, r.height - 6);
    text(c, label, r.x + (i + 0.5) * cell, y, i === 1 ? dimGreen : green, 'center');
  }
}

type RadarScope = { x: number; y: number; radius: number };
function radarScope(r: Rect, compact: boolean): RadarScope {
  const short = r.height < 40;
  return {
    x: compact ? r.x + r.width / 2 : r.x + r.width * 0.52,
    y: r.y + r.height / 2 + (short ? 1 : compact ? 5 : 3),
    radius: Math.max(5, Math.min(r.height / 2 - (short ? 4 : compact ? 13 : 16), r.width * 0.39)),
  };
}

function drawRadarFace(c: Context, r: Rect, scope: RadarScope, compact: boolean, t: Translate): void {
  const { x, y, radius } = scope;
  text(c, t('hud.radar'), r.x + (compact ? 6 : 12), r.y + (r.height < 40 ? 8 : 11));
  if (!compact) text(c, t('cockpit.range', { value: 240 }), right(r) - 14, r.y + 11, dimGreen, 'right');
  c.strokeStyle = '#285747';
  c.lineWidth = 1;
  for (const ratio of [0.5, 1]) {
    c.beginPath(); c.arc(x, y, radius * ratio, 0, Math.PI * 2); c.stroke();
  }
  fill(c, '#244a40', x - radius, y, radius * 2, 1);
  fill(c, '#244a40', x, y - radius, 1, radius * 2);
}

function drawRadarSweep(c: Context, scope: RadarScope, elapsed: number): void {
  const { x, y, radius } = scope;
  const beam = (elapsed * 2.6) % (Math.PI * 2);
  c.fillStyle = 'rgba(96,232,133,.13)';
  c.beginPath(); c.moveTo(x, y); c.arc(x, y, radius, beam - 0.47, beam); c.closePath(); c.fill();
  pixelLine(c, '#488c66', x, y, x + Math.cos(beam) * radius, y + Math.sin(beam) * radius);
}

function drawRadarBlips(c: Context, scope: RadarScope, state: GameState, compact: boolean): void {
  const { x, y, radius } = scope, player = state.player;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const scale = (radius - 2) / 240, size = compact ? 2 : 3;
  const dot = (wx: number, wz: number, color: string) => {
    const dx = wx - player.x, dz = wz - player.z;
    if (dx * dx + dz * dz > 240 * 240) return;
    const across = (dx * cos - dz * sin) * scale, ahead = (dx * sin + dz * cos) * scale;
    fill(c, color, x + across - 1, y - ahead - 1, size, size);
  };
  for (const e of state.entities) {
    if (e.kind === 'drone' || e.kind === 'boss_orb') dot(e.x, e.z, '#f29080');
    else if (e.kind === 'supply' || e.kind === 'capsule') dot(e.x, e.z, '#8ed9df');
    else if (e.kind === 'pylon' || e.kind === 'lock') dot(e.x, e.z, amber);
    else if (e.kind === 'exit') dot(e.x, e.z, green);
  }
  if (state.boss.active) dot(state.boss.x, state.boss.z, '#ffb0d5');
  fill(c, '#caffd8', x - 1, y - 1, 3, 3);
}

const wing = ['      +      ', '      +      ', '     +++     ', ' +   +++   + ', ' ++ +++++ ++ ', ' +++++++++++ ', '+++++++++++++', '  +++ + +++  ', '      +      '];

function drawDamage(c: Context, r: Rect, state: GameState, compact: boolean, hit: boolean): void {
  const color = state.hull <= state.maxHull / 4 || hit ? amber : green;
  const center = middle(r), unit = r.height < 40 ? 1 : compact ? 2 : 5;
  const spriteTop = Math.round(center.y - wing.length * unit / 2 - (compact ? 1 : 0));
  const spriteX = center.x - wing[0].length * unit / 2;
  for (let row = 0; row < wing.length; row++) {
    const line = wing[row];
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '+') continue;
      const side = i < 6 ? i : line.length - i - 1;
      const shade = state.hull <= 2 && side < 3 ? '#875744' : i === 6 ? color : hit ? '#d88756' : '#498d71';
      fill(c, shade, spriteX + i * unit, spriteTop + row * unit, unit, unit);
    }
  }
  const gap = compact ? 2 : 4, length = Math.min(r.width - 12, compact ? 70 : 138);
  const block = Math.floor((length - gap * (state.maxHull - 1)) / state.maxHull);
  const total = state.maxHull * block + gap * (state.maxHull - 1);
  for (let i = 0; i < state.maxHull; i++) {
    fill(c, i < state.hull ? color : '#3e594f', center.x - total / 2 + i * (block + gap), bottom(r) - (compact ? 12 : 22), block, compact ? 5 : 7);
  }
}

function weaponReadouts(level: number, bombs: number, t: Translate): WeaponReadout {
  return { gun: t('hud.weapon', { level }), ammo: t('cockpit.ammo', { count: '∞' }),
    bombs: t('cockpit.bombs', { count: bombs }), missiles: t('cockpit.missiles', { count: 0 }) };
}

function drawWeapons(c: Context, r: Rect, weapons: WeaponReadout, level: number, compact: boolean, title: string, font: string): void {
  const left = r.x + (compact ? 6 : 12), y = r.y + (r.height < 40 ? 8 : 11);
  text(c, title, left, y);
  const labels = [weapons.gun, weapons.ammo, weapons.bombs, weapons.missiles];
  const columns = r.height < 40 ? 4 : 2;
  const cell = (r.width - (compact ? 12 : 24)) / columns;
  const row = compact ? 13 : 23, firstRow = r.y + (r.height < 40 ? 20 : compact ? 26 : 43);
  for (const [i, label] of labels.entries()) {
    const x = left + i % columns * cell + cell / 2;
    fittedText(c, label, x, firstRow + Math.floor(i / columns) * row, i === 3 ? dimGreen : green, cell - 2, font, compact ? 10 : 14);
  }
  if (!compact) {
    for (let i = 0; i < 3; i++) {
      fill(c, i < level ? '#80db9d' : '#2f554a', left + i * 13, bottom(r) - 28, 10, 5);
    }
  }
}

type GaugeRow = { centers: [number, number, number]; y: number; radius: number; width: number };
function gaugeRow(r: Rect, compact: boolean): GaugeRow {
  const width = (r.width - 6) / 3;
  const radius = Math.max(4, Math.floor(Math.min(width / 2 - 3, r.height * 0.28, compact ? 13 : 26)));
  return {
    centers: [0, 1, 2].map(i => Math.round(r.x + 3 + width * (i + 0.5))) as [number, number, number],
    y: r.y + r.height * 0.43, radius, width,
  };
}

function drawGaugeFaces(c: Context, row: GaugeRow, showLabels: boolean, compact: boolean, t: Translate, font: string): void {
  const labels = [t('hud.speed'), t('hud.boost'), t('hud.hull')];
  const { centers, y, radius, width } = row;
  for (const [i, x] of centers.entries()) {
    c.fillStyle = '#080f1a'; c.strokeStyle = '#647580'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let tick = 0; tick <= 4; tick++) {
      const angle = Math.PI * (0.75 + tick * 0.375);
      fill(c, tick === 4 ? '#cb8a5c' : '#98aea9', x + Math.cos(angle) * (radius - 3), y + Math.sin(angle) * (radius - 3), compact ? 1 : 2, compact ? 1 : 2);
    }
    if (showLabels) fittedText(c, labels[i], x, y + radius + (compact ? 9 : 13), '#c6d5c8', width - 1, font, compact ? 9 : 12);
  }
}

function drawNeedle(c: Context, x: number, y: number, radius: number, value: number, compact: boolean): void {
  const angle = Math.PI * (0.75 + clamp(value, 0, 1) * 1.5);
  pixelLine(c, '#ffac67', x, y, x + Math.cos(angle) * (radius - 3), y + Math.sin(angle) * (radius - 3), compact ? 1 : 2);
  fill(c, '#dce6d4', x - 1, y - 1, 3, 3);
}

function placeLayer(c: Context, r: Rect): void {
  c.canvas.width = r.width;
  c.canvas.height = r.height;
  c.canvas.style.left = r.x + 'px';
  c.canvas.style.top = r.y + 'px';
  c.setTransform(1, 0, 0, 1, -r.x, -r.y);
  c.imageSmoothingEnabled = false;
}

function clearZone(c: Context, r: Rect): void {
  c.clearRect(r.x, r.y, r.width, r.height);
}

function blitPlate(c: Context, r: Rect, face: HTMLCanvasElement): void {
  clearZone(c, r);
  c.drawImage(face, r.x, r.y);
}

export class CockpitDisplay {
  private readonly host: HTMLElement;
  private readonly hud = cockpitSurface(1, 1).context;
  private readonly panels = cockpitSurface(1, 1).context;
  private readonly aim: Point = { x: 0, y: 0 };
  private readonly anchor: Point = { x: 0, y: 0 };
  private readonly marks: ReturnType<typeof pitchLadder> = [];
  private readonly contact: CockpitTarget = { kind: 'drone', point: { x: 0, y: 0 }, altitude: 0, range: 0, locked: false };
  private readonly readout: { target: CockpitTarget | null; warnings: CockpitWarnings } = {
    target: null, warnings: { master: false, lowHull: false, terrain: null, boost: null },
  };
  private layout: CockpitLayout | null = null;
  private language: Language | null = null;
  private key = '';
  private labels!: GlassLabels;
  private ladder: CockpitLineRaster | null = null;
  private radar!: { face: HTMLCanvasElement; scope: RadarScope; blips: Context };
  private airframeLabel!: HTMLCanvasElement;
  private gauges!: { face: HTMLCanvasElement; row: GaugeRow };
  private caution: WarningCell[] = [];
  private readonly stores = new Map<number, HTMLCanvasElement>();
  private readonly weapons = new Map<number, HTMLCanvasElement>();

  private lastOpacity = 1;
  private lastMfd: number | null = null;
  private lastRadar = -1;
  private lastRadarFlicker = -1;
  private lastFlicker = -1;
  private lastHit = false;
  private lastHull = -1;
  private lastMaxHull = -1;
  private lastWeapon = -1;
  private lastBombs = -1;
  private lastSpeed = -1;
  private lastBoost = -1;
  private lastGaugeHull = -1;
  private lastGaugeFlicker = -1;
  private lastG = -1;

  constructor(private readonly frame: HTMLCanvasElement, private readonly font: string) {
    this.host = frame.parentElement!;
    for (const canvas of [this.hud.canvas, this.panels.canvas]) {
      canvas.className = 'cockpit-instruments';
      this.host.append(canvas);
    }
  }

  resize(layout: CockpitLayout | null, width: number, height: number, language: Language, t: Translate): void {
    this.layout = layout;
    this.host.hidden = !layout;
    if (!layout) return;
    const key = cockpitCacheKey(layout, width, height, language);
    if (key === this.key) return;
    this.key = key;
    this.language = language;

    const { compact, aiming } = layout;
    const font = (compact ? 10 : 12) + 'px ' + this.font;
    const chrome = cockpitSurface(width, height);
    drawChrome(chrome.context, layout);
    chrome.context.font = font;
    drawHeadingPlate(chrome.context, layout.heading, compact);
    drawTapePlate(chrome.context, layout.speed, t('hud.speed'), false);
    drawTapePlate(chrome.context, layout.altitude, t('hud.altitude'), true);
    this.frame.width = width;
    this.frame.height = height;
    this.frame.getContext('2d')!.drawImage(chrome.canvas, 0, 0);
    placeLayer(this.hud, layout.glass);
    placeLayer(this.panels, layout.dashboard);
    this.labels = new GlassLabels(font, t);

    const span = Math.min(compact ? 51 : 105, aiming.width * 0.31);
    const half = Math.ceil(Math.hypot(span, 35 * (compact ? 2 : 3))) + 27;
    const ladderX = Math.max(aiming.x, Math.floor(aiming.x + aiming.width / 2 - half));
    const ladderRight = Math.min(right(aiming), Math.ceil(aiming.x + aiming.width / 2 + half));
    this.ladder = aiming.height >= 20 && ladderRight > ladderX
      ? new CockpitLineRaster({ x: ladderX, y: aiming.y, width: ladderRight - ladderX, height: aiming.height })
      : null;

    const scope = radarScope(layout.radar, compact), row = gaugeRow(layout.gauges, compact);
    const blips = cockpitSurface(layout.radar.width, layout.radar.height).context;
    blips.translate(-layout.radar.x, -layout.radar.y);
    this.radar = { scope, blips, face: plate(layout.radar, c => {
      c.font = font;
      drawRadarFace(c, layout.radar, scope, compact, t);
    }) };
    this.gauges = { row, face: plate(layout.gauges, c => drawGaugeFaces(c, row, layout.gauges.height >= 40, compact, t, this.font)) };
    this.airframeLabel = plate(layout.damage, c => {
      c.font = font;
      text(c, t('cockpit.airframe'), layout.damage.x + (compact ? 6 : 12), layout.damage.y + (layout.damage.height < 40 ? 8 : 11));
    });
    this.caution = warningCells(layout, t, this.font);
    this.weapons.clear();
    this.stores.clear();
    for (let bombs = 0; bombs <= 3; bombs++) {
      for (let level = 1; level <= 3; level++) this.cacheWeapons(layout, level, bombs, t);
    }

    this.lastMfd = null;
    this.lastFlicker = this.lastHull = this.lastMaxHull = this.lastWeapon = this.lastBombs = -1;
    this.lastSpeed = this.lastBoost = this.lastGaugeHull = this.lastGaugeFlicker = this.lastG = -1;
  }

  private cacheWeapons(layout: CockpitLayout, level: number, bombs: number, t: Translate): void {
    const { compact, stores, weapons } = layout;
    const readouts = weaponReadouts(level, bombs, t);
    const font = (compact ? 10 : 12) + 'px ' + this.font, title = t('cockpit.weapons');
    this.weapons.set(bombs * 4 + level, plate(weapons, c => {
      c.font = font;
      drawWeapons(c, weapons, readouts, level, compact, title, this.font);
    }));
    if (stores && !this.stores.has(bombs)) this.stores.set(bombs, plate(stores, c => {
      c.font = font;
      drawStores(c, stores, readouts);
    }));
  }

  draw(state: GameState, view: CockpitView, motion: CockpitMotion, clearance: number, impact: number, opacity: number, language: Language, t: Translate) {
    const layout = this.layout;
    if (!layout) return null;
    if (language !== this.language) this.resize(layout, this.frame.width, this.frame.height, language, t);
    if (opacity !== this.lastOpacity) {
      this.host.style.opacity = String(opacity);
      this.lastOpacity = opacity;
    }
    const aim = cockpitAim(view, state, this.aim);
    const target = this.readout.target = selectCockpitTarget(state, view, layout.aiming, aim, this.contact);
    const warnings = cockpitWarnings(state, clearance, motion.climb, this.readout.warnings);
    this.drawGlass(layout, view, state, motion, target);

    const amberPulse = Math.floor(state.elapsed * 4) % 2 === 0 ? 1 : 0;
    const boostPulse = Math.floor(state.elapsed * 3) % 2 === 0 ? 1 : 0;
    updateWarning(this.panels, this.caution[0], warnings.master ? 1 + amberPulse : 0);
    updateWarning(this.panels, this.caution[1], warnings.lowHull ? 1 + amberPulse : 0);
    updateWarning(this.panels, this.caution[2], warnings.terrain ? (warnings.terrain === 'pullUp' ? 3 : 1) + amberPulse : 0);
    updateWarning(this.panels, this.caution[3], warnings.boost === 'active' ? 3 + boostPulse : warnings.boost === 'low' ? 1 + amberPulse : 0);

    const flicker = impact > 0.45 && Math.floor(impact * 12) % 2 === 0 ? 0.6 : 1;
    const refresh = cockpitMfdDue(this.lastMfd, state.elapsed);
    if (refresh) {
      this.lastMfd = state.elapsed;
      this.drawMfds(layout, state, impact > 0, flicker, t);
    }
    if (refresh || state.elapsed !== this.lastRadar || flicker !== this.lastRadarFlicker) {
      const c = this.panels, r = layout.radar;
      c.globalAlpha = flicker;
      blitPlate(c, r, this.radar.face);
      drawRadarSweep(c, this.radar.scope, state.elapsed);
      c.drawImage(this.radar.blips.canvas, r.x, r.y);
      c.globalAlpha = 1;
      this.lastRadar = state.elapsed;
      this.lastRadarFlicker = flicker;
    }
    this.drawGauges(layout, state, motion, flicker);
    return this.readout;
  }

  private drawGlass(layout: CockpitLayout, view: CockpitView, state: GameState, motion: CockpitMotion, target: CockpitTarget | null): void {
    const c = this.hud, { compact, speed, heading, altitude, aiming } = layout;
    clearZone(c, heading);
    drawHeading(c, heading, state.player.yaw, compact, this.labels);
    clearZone(c, speed);
    drawTape(c, speed, motion.speed, false, compact, this.labels);
    clearZone(c, altitude);
    drawTape(c, altitude, state.player.altitude, true, compact, this.labels, target?.altitude);

    const g = Math.round((1 + 0.47 * Math.abs(motion.turn) + 0.013 * Math.abs(motion.climb)) * 10), y = bottom(speed) + 4;
    if (g !== this.lastG && aiming.height > 35 && y + 15 <= bottom(layout.glass)) {
      c.clearRect(speed.x, y, speed.width, 15);
      const label = this.labels.load(g);
      fill(c, ink, speed.x, y, Math.ceil(label.advance) + 10, 15);
      drawCockpitLabel(c, label, speed.x + 5, y + 7);
      this.lastG = g;
    }
    if (this.ladder) {
      clearZone(c, aiming);
      drawLadder(c, layout, view, motion, this.labels, this.ladder, this.marks, this.anchor);
      drawAim(c, aiming, this.aim, target, state.elapsed, this.labels);
    }
  }

  private drawMfds(layout: CockpitLayout, state: GameState, hit: boolean, flicker: number, t: Translate): void {
    const c = this.panels, { compact, radar, damage, stores, weapons } = layout;
    clearZone(this.radar.blips, radar);
    drawRadarBlips(this.radar.blips, this.radar.scope, state, compact);
    c.globalAlpha = flicker;
    if (state.hull !== this.lastHull || state.maxHull !== this.lastMaxHull || hit !== this.lastHit || flicker !== this.lastFlicker) {
      blitPlate(c, damage, this.airframeLabel);
      drawDamage(c, damage, state, compact, hit);
      this.lastHull = state.hull;
      this.lastMaxHull = state.maxHull;
      this.lastHit = hit;
    }
    const weapon = state.bombs * 4 + state.weaponLv;
    if (weapon !== this.lastWeapon || flicker !== this.lastFlicker) {
      if (!this.weapons.has(weapon)) this.cacheWeapons(layout, state.weaponLv, state.bombs, t);
      blitPlate(c, weapons, this.weapons.get(weapon)!);
      this.lastWeapon = weapon;
    }
    if (stores && state.bombs !== this.lastBombs) {
      blitPlate(this.hud, stores, this.stores.get(state.bombs)!);
      this.lastBombs = state.bombs;
    }
    this.lastFlicker = flicker;
    c.globalAlpha = 1;
  }

  private drawGauges(layout: CockpitLayout, state: GameState, motion: CockpitMotion, flicker: number): void {
    // A steady instrument retains its pixels. Clamp away drift past the ends of the dial.
    const speed = clamp(motion.speed / 100, 0, 1), boost = state.bst, hull = state.hull / state.maxHull;
    if (Math.abs(speed - this.lastSpeed) < 1e-6 && boost === this.lastBoost && hull === this.lastGaugeHull && flicker === this.lastGaugeFlicker) return;
    this.lastSpeed = speed;
    this.lastBoost = boost;
    this.lastGaugeHull = hull;
    this.lastGaugeFlicker = flicker;
    const c = this.panels, { centers, y, radius } = this.gauges.row;
    c.globalAlpha = flicker;
    blitPlate(c, layout.gauges, this.gauges.face);
    drawNeedle(c, centers[0], y, radius, speed, layout.compact);
    drawNeedle(c, centers[1], y, radius, boost, layout.compact);
    drawNeedle(c, centers[2], y, radius, hull, layout.compact);
    c.globalAlpha = 1;
  }
}
