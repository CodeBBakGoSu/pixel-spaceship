import { cockpitLadderSpan, type Line, type PitchMark, type Point } from './camera.ts';
import {
  cockpitCacheKey, cockpitHeadingDegrees, cockpitMfdDue, cockpitWarnings, headingTickLabel, reversalCharge,
  type CockpitMotion, type CockpitWarnings,
} from './cockpit';
import { markerRadius, type CockpitMarker } from './cockpit-markers.ts';
import {
  CockpitLabelAtlas, CockpitLineRaster, cockpitPixel, cockpitSurface, drawCockpitLabel, type CockpitLabel,
} from './cockpit-pixels';
import { altitudeDeltaText, RadarDisplay, type RadarReadout } from './instruments.ts';
import { MANEUVERS, maneuverAttitude, maneuverViewYaw } from './maneuvers.ts';
import { MAX_BOMBS, MAX_FLARES, TICKS_PER_SECOND } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';
import type { createTranslator, Language } from './i18n';
import type { CockpitLayout, Rect } from './layout';

type Context = CanvasRenderingContext2D;
type Translate = ReturnType<typeof createTranslator>;
type WeaponReadout = { gun: string; pods: string; bombs: string; flares: string };
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
  for (const [i, p] of [layout.radar, layout.weapons, layout.gauges].entries()) {
    const screen = i < 2;
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
  private readonly deltas = new Map<string, CockpitLabel>();
  private readonly tracked = new Map<number, CockpitLabel>();
  private readonly locked = new Map<number, CockpitLabel>();
  private readonly ranges = new Map<number, CockpitLabel>();
  private readonly relativeDeltas = new Map<number, CockpitLabel>();
  readonly bearings: CockpitLabel[];
  readonly headingTicks: CockpitLabel[];
  readonly pitch: { left: CockpitLabel; right: CockpitLabel }[];
  readonly inverted: CockpitLabel;
  readonly rear: CockpitLabel;

  constructor(font: string, private readonly t: Translate) {
    const atlas = this.atlas = new CockpitLabelAtlas(font);
    this.bearings = Array.from({ length: 360 }, (_, n) => atlas.add(t('cockpit.bearing', {
      value: String(n).padStart(3, '0'),
    }), green, 'center'));
    this.headingTicks = Array.from({ length: 24 }, (_, n) => atlas.add(headingTickLabel(n * 15, t), green, 'center'));
    this.pitch = Array.from({ length: 19 }, (_, n) => {
      const label = String(n * 10 - 90);
      return { left: atlas.add(label, green, 'right', '#16312b'), right: atlas.add(label, green, 'left', '#16312b') };
    });
    this.inverted = atlas.add(t('cockpit.inverted'), amber, 'center');
    this.rear = atlas.add(t('cockpit.rearShort'), '#c6d8ce');
    for (let n = 0; n <= 220; n++) this.number(n);
    for (let n = 10; n <= 24; n++) this.load(n);
  }

  number(value: number): CockpitLabel {
    const cached = this.numbers.get(value);
    if (cached) return cached;
    const label = this.atlas.add(String(value), green, 'center');
    this.numbers.set(value, label);
    return label;
  }

  delta(value: number): CockpitLabel {
    const copy = altitudeDeltaText(value, this.t);
    let label = this.deltas.get(copy);
    if (!label) {
      label = this.atlas.add(copy, amber, 'center');
      this.deltas.set(copy, label);
    }
    return label;
  }

  load(value: number): CockpitLabel {
    const cached = this.gLoads.get(value);
    if (cached) return cached;
    const label = this.atlas.add(this.t('cockpit.gLoad', { value: (value / 10).toFixed(1) }), green);
    this.gLoads.set(value, label);
    return label;
  }

  contact(value: number, status: 'lock' | 'track' | null): CockpitLabel {
    const map = status === 'lock' ? this.locked : status === 'track' ? this.tracked : this.ranges;
    const cached = map.get(value);
    if (cached) return cached;
    const range = this.t('cockpit.range', { value });
    const label = this.atlas.add(status ? this.t(`cockpit.${status}`, { range }) : range, status === 'lock' ? green : '#e0f6eb');
    map.set(value, label);
    return label;
  }

  relativeDelta(value: number): CockpitLabel {
    const amount = Math.round(Math.abs(value)), delta = value < 0 ? -amount : amount;
    const cached = this.relativeDeltas.get(delta);
    if (cached) return cached;
    const label = this.atlas.add(`${delta > 0 ? '^' : delta < 0 ? 'v' : '='}${amount}`,
      delta > 0 ? '#abddff' : delta < 0 ? '#c2bcff' : '#d9f4d7');
    this.relativeDeltas.set(delta, label);
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
  if (r.height < (altitude ? 57 : 37)) return;
  const pivot = Math.round(r.y + r.height / 2);
  const axis = altitude ? r.x + 5 : right(r) - 6;
  const chartTop = r.y + 23, chartBottom = bottom(r) - (altitude ? 22 : 8);
  text(c, label, r.x + r.width / 2, r.y + 9, green, 'center');
  fill(c, dimGreen, axis, chartTop, 1, chartBottom - chartTop + 1);
  const box = { x: r.x + 3, y: pivot - 9, width: r.width - 6, height: 18 };
  fill(c, '#173735', box.x, box.y, box.width, box.height);
  outline(c, green, box);
}

function drawTape(c: Context, r: Rect, value: number, altitude: boolean, compact: boolean, labels: GlassLabels, target?: number): void {
  const shortAltitude = altitude && r.height < 57 && target !== undefined;
  const pivot = Math.round(r.y + r.height * (shortAltitude ? 0.29 : 0.5)), scale = compact ? 1.3 : 2.0;
  const axis = altitude ? r.x + 5 : right(r) - 6;
  if (r.height >= (altitude ? 57 : 37)) {
    const chartTop = r.y + 23, chartBottom = bottom(r) - (altitude ? 22 : 8);
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
  if (target !== undefined && r.height >= 20) {
    const y = shortAltitude ? r.y + Math.round(r.height * 0.76) : bottom(r) - 9;
    fill(c, '#173735', r.x + 2, y - 7, r.width - 4, 14);
    drawCockpitLabel(c, labels.delta(target - value), r.x + r.width / 2, y);
  }
}

const ladderOutline = cockpitPixel(0x183f39), horizonColor = cockpitPixel(0x9befb2), ladderColor = cockpitPixel(0x73bb93);

function drawLadder(c: Context, layout: CockpitLayout, aim: Point | null, motion: CockpitMotion,
  labels: GlassLabels, raster: CockpitLineRaster, marks: PitchMark[],
  attitude: ReturnType<typeof maneuverAttitude> | null): void {
  const area = layout.aiming, compact = layout.compact;
  const centerX = area.x + area.width / 2;
  const slope = Math.atan2(motion.climb, Math.max(12, motion.speed));
  raster.clear();
  for (const mark of marks) {
    const weight = mark.angle === 0 ? 2 : 1, color = mark.angle === 0 ? horizonColor : ladderColor;
    for (const line of mark.left) rasterLadderSegment(raster, area, line, mark.angle < 0, color, weight);
    for (const line of mark.right) rasterLadderSegment(raster, area, line, mark.angle < 0, color, weight);
  }
  raster.draw(c, layout.glass);

  c.save();
  c.beginPath();
  c.rect(area.x, area.y, area.width, area.height);
  c.clip();
  for (const mark of marks) {
    if (mark.angle === 0 || (compact && mark.angle % 20 !== 0 && Math.abs(mark.angle) !== 90)) continue;
    const sprites = labels.pitch[(mark.angle + 90) / 10];
    const left = mark.left[0].from, right = mark.right[mark.right.length - 1].to;
    if (left.y >= area.y + 7 && left.y <= bottom(area) - 7) drawCockpitLabel(c, sprites.left, left.x - 7, left.y);
    if (!compact && right.y >= area.y + 7 && right.y <= bottom(area) - 7) drawCockpitLabel(c, sprites.right, right.x + 8, right.y);
  }
  const tag = attitude?.inverted ? labels.inverted : null;
  if (tag) {
    fill(c, ink, centerX - tag.advance / 2 - 4, area.y + 3, tag.advance + 8, 13);
    drawCockpitLabel(c, tag, centerX, area.y + 9);
  }
  if (!aim) {
    c.restore();
    return;
  }
  const zero = marks.find(mark => mark.angle === 0);
  const horizonY = zero ? (zero.left[zero.left.length - 1].to.y + zero.right[0].from.y) / 2 : aim.y;
  const pathY = clamp(horizonY - Math.sin(slope) * 54, area.y + 10, bottom(area) - 10);
  const pathX = centerX - motion.turn * (compact ? 4 : 8);
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

function rasterLadderSegment(raster: CockpitLineRaster, area: Rect, line: Line, dashed: boolean, color: number, weight: number): void {
  const { from, to } = line, top = area.y, end = bottom(area) - 1;
  if (Math.max(from.y, to.y) < top || Math.min(from.y, to.y) > end) return;
  // Clip before rasterizing so a rung near the edge of the camera cannot make a long offscreen loop.
  const clip = (point: Point, other: Point): Point => {
    const y = clamp(point.y, top, end);
    return y === point.y ? point : { x: point.x + (other.x - point.x) * (y - point.y) / (other.y - point.y), y };
  };
  const a = clip(from, to), b = clip(to, from);
  raster.line(ladderOutline, a.x - 1, a.y - 1, b.x - 1, b.y - 1, weight + 2);
  if (dashed) {
    const dx = b.x - a.x, dy = b.y - a.y;
    raster.line(color, a.x, a.y, a.x + dx * 0.38, a.y + dy * 0.38, weight);
    raster.line(color, a.x + dx * 0.62, a.y + dy * 0.62, b.x, b.y, weight);
  } else raster.line(color, a.x, a.y, b.x, b.y, weight);
}

function drawAim(c: Context, area: Rect, aim: Point): void {
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
}

function drawMarker(c: Context, marker: CockpitMarker, radius: number, pulse: boolean): void {
  const x = Math.round(marker.x) + 0.5, y = Math.round(marker.y) + 0.5;
  const color = marker.locked ? green : marker.color;
  c.globalAlpha = marker.opacity;
  c.beginPath();
  if (marker.boxed) {
    for (let side = -1; side <= 1; side += 2) for (let vertical = -1; vertical <= 1; vertical += 2) {
      c.moveTo(x + side * (radius - 5), y + vertical * radius);
      c.lineTo(x + side * radius, y + vertical * radius);
      c.lineTo(x + side * radius, y + vertical * (radius - 5));
    }
  } else if (marker.placement === 'forward') {
    c.moveTo(x, y - radius);
    c.lineTo(x + radius, y);
    c.lineTo(x, y + radius);
    c.lineTo(x - radius, y);
    c.closePath();
  } else {
    const dx = Math.cos(marker.angle), dy = Math.sin(marker.angle);
    const rear = marker.placement === 'rear';
    for (let n = 0; n < (rear ? 2 : 1); n++) {
      const shift = rear ? -1 - n * 5 : 0;
      c.moveTo(x + dx * (shift - 3) - dy * 5, y + dy * (shift - 3) + dx * 5);
      c.lineTo(x + dx * (shift + 5), y + dy * (shift + 5));
      c.lineTo(x + dx * (shift - 3) + dy * 5, y + dy * (shift - 3) - dx * 5);
    }
  }
  c.lineJoin = 'bevel';
  c.strokeStyle = ink;
  c.lineWidth = 3;
  c.stroke();
  c.strokeStyle = color;
  c.lineWidth = marker.danger ? 2 : 1;
  c.stroke();
  if (marker.boxed && pulse) c.strokeRect(x - radius, y - radius, 2 * radius, 2 * radius);
  if (marker.boxed && !marker.locked && marker.lockProgress > 0) {
    fill(c, ink, x - radius, y + radius + 2, radius * 2, 2);
    fill(c, green, x - radius, y + radius + 2, Math.max(1, Math.round(radius * 2 * marker.lockProgress)), 2);
  }
  if (marker.former && marker.placement === 'forward') {
    fill(c, green, x - radius - 4, y - 2, 2, 3);
    fill(c, green, x + radius + 1, y - 2, 2, 3);
  } else if (marker.former && marker.placement === 'edge') {
    fill(c, green, x - Math.cos(marker.angle) * 7 - 1, y - Math.sin(marker.angle) * 7 - 1, 3, 3);
  }
}

function overlaps(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
}

function placeMarkerLabel(box: Rect, marker: CockpitMarker, layout: CockpitLayout, markers: readonly CockpitMarker[],
  obstructions: readonly Readonly<Rect>[], used: Rect[], count: number): boolean {
  const { aiming, compact } = layout;
  if (box.width + 2 > aiming.width) return false;
  const radius = markerRadius(marker, compact) + 6;
  for (let option = marker.placement === 'rear' ? 1 : 0; option < 4; option++) {
    const x = option === 2 ? marker.x + radius : option === 3 ? marker.x - radius - box.width : marker.x - box.width / 2;
    const y = option === 0 ? marker.y + radius : option === 1 ? marker.y - radius - box.height : marker.y - box.height / 2;
    box.x = Math.round(clamp(x, aiming.x + 1, right(aiming) - box.width - 1));
    box.y = Math.round(y);
    if (box.y < aiming.y + 1 || bottom(box) > bottom(aiming) - 1 || obstructions.some(rect => overlaps(box, rect))) continue;
    if (markers.some(other => {
      const pad = markerRadius(other, compact) + 3;
      return other.x > box.x - pad && other.x < right(box) + pad && other.y > box.y - pad && other.y < bottom(box) + pad;
    })) continue;
    let collision = false;
    for (let i = 0; i < count; i++) if (overlaps(box, used[i])) collision = true;
    if (!collision) return true;
  }
  return false;
}

function drawMarkers(c: Context, layout: CockpitLayout, markers: readonly CockpitMarker[], obstructions: readonly Readonly<Rect>[],
  labels: GlassLabels, boxes: Rect[], tick: number): void {
  if (!markers.length) return;
  const { aiming, compact } = layout;
  c.save();
  c.beginPath();
  c.rect(aiming.x, aiming.y, aiming.width, aiming.height);
  c.clip();
  const pulse = Math.floor(tick / 15) % 2 === 0;
  for (const marker of markers) drawMarker(c, marker, markerRadius(marker, compact), marker.locked && pulse);
  let count = 0, labeledFormerArrow = false;
  for (const marker of markers) {
    const arrow = marker.placement === 'edge';
    if (arrow && (!marker.former || labeledFormerArrow)) continue;
    const range = labels.contact(Math.round(marker.range), marker.locked ? 'lock' : marker.warden ? 'track' : null);
    const delta = labels.relativeDelta(marker.delta);
    const rear = marker.placement === 'rear' ? labels.rear : null;
    const box = boxes[count];
    box.width = Math.ceil(range.advance + delta.advance + (rear ? rear.advance + 6 : 0)) + 14;
    box.height = compact ? 13 : 15;
    if (!placeMarkerLabel(box, marker, layout, markers, obstructions, boxes, count)) continue;
    count++;
    if (arrow) labeledFormerArrow = true;
    c.globalAlpha = marker.opacity;
    fill(c, marker.danger ? '#382326' : marker.locked && pulse ? '#204335' : ink, box.x, box.y, box.width, box.height);
    const y = box.y + (box.height - 1) / 2;
    const x = box.x + (rear ? rear.advance + 6 : 0) + 4;
    if (rear) drawCockpitLabel(c, rear, box.x + 4, y);
    drawCockpitLabel(c, range, x, y);
    drawCockpitLabel(c, delta, x + range.advance + 6, y);
  }
  c.restore();
}

function drawGraceShimmer(c: Context, area: Rect, left: number, tick: number): void {
  const pulse = 0.18 + 0.24 * (1 + Math.cos(tick * 0.86)) / 2;
  c.globalAlpha = Math.min(1, (left + 1) / 10) * pulse;
  c.strokeStyle = '#a8ffe1';
  c.lineWidth = 1;
  c.strokeRect(area.x + 1.5, area.y + 1.5, area.width - 3, area.height - 3);
  for (let side = 0; side < 2; side++) {
    const x = side ? right(area) - 4 : area.x + 2;
    const y = area.y + 3 + (area.height - 17) * ((tick * 0.07 + side * 0.5) % 1);
    fill(c, '#d1ffed', x, y, 2, 11);
  }
  c.globalAlpha = 1;
}

function plate(r: Rect, paint: (c: Context) => void): HTMLCanvasElement {
  const { canvas, context } = cockpitSurface(r.width, r.height);
  context.translate(-r.x, -r.y);
  paint(context);
  return canvas;
}

type WarningCell = { rect: Rect; variants: HTMLCanvasElement[]; painted: number };

function warningCells(layout: CockpitLayout, t: Translate, font: string): WarningCell[] {
  const r = layout.warnings, { compact, panelScale } = layout;
  const names = [t(compact ? 'cockpit.cautionShort' : 'cockpit.masterCaution'),
    t('cockpit.altLow'), t('control.boost'), t('control.loop')];
  return names.map((label, i) => {
    const x = r.x + Math.round(r.width * i / names.length);
    const width = r.x + Math.round(r.width * (i + 1) / names.length) - x - 2;
    const area = { x, y: r.y, width, height: r.height };
    const variant = (caption: string, active: boolean, useAmber: boolean, bright: boolean) => plate(area, c => {
      const color = useAmber ? amber : green;
      fill(c, bright ? (useAmber ? '#593820' : '#25443a') : '#111923', x, r.y, width, r.height);
      outline(c, active ? (useAmber ? '#bb8047' : '#52896b') : '#384650', area);
      fill(c, bright ? color : active ? '#846540' : '#46545a', x + 5, r.y + (r.height - 4) / 2, 4, 4);
      fittedText(c, caption, x + width / 2 + 3, r.y + r.height / 2, active ? color : '#839795', width - 14, font,
        compact ? 10 : Math.round(12 * panelScale));
    });
    const variants = [variant(label, false, true, false), variant(label, true, true, false), variant(label, true, true, true)];
    if (i === 1) variants.push(variant(t('cockpit.pullUp'), true, true, false), variant(t('cockpit.pullUp'), true, true, true));
    if (i === 2) variants.push(variant(label, true, false, false), variant(label, true, false, true));
    if (i === 3) {
      variants.push(variant(t('hud.loopReadyShort'), true, false, true));
      const maxSeconds = MANEUVERS['j-turn'].cooldown / TICKS_PER_SECOND;
      for (let seconds = 1; seconds <= maxSeconds; seconds++) {
        variants.push(variant(t('hud.loopCooldown', { seconds }), true, true, false));
      }
    }
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
  for (const [i, label] of [weapons.gun, weapons.pods, weapons.bombs].entries()) {
    if (i > 0) fill(c, '#38554e', r.x + i * cell, r.y + 3, 1, r.height - 6);
    text(c, label, r.x + (i + 0.5) * cell, y, green, 'center');
  }
}

function weaponReadouts(state: StageState, t: Translate): WeaponReadout {
  return { gun: t('hud.weapon', { level: state.twinRank }), pods: t('hud.pods', { level: state.podRank }),
    bombs: t('cockpit.bombs', { count: state.bombs, max: MAX_BOMBS }),
    flares: t('cockpit.flares', { count: state.flareCharges, max: MAX_FLARES }) };
}

function drawWeapons(c: Context, r: Rect, weapons: WeaponReadout, level: number, compact: boolean, title: string,
  font: string, scale: number): void {
  const left = r.x + (compact ? 6 : 12 * scale), y = r.y + (r.height < 40 ? 8 : 11 * scale);
  text(c, title, left, y);
  const labels = [weapons.gun, weapons.pods, weapons.bombs, weapons.flares];
  const columns = r.height < 40 ? 4 : 2;
  const cell = (r.width - (left - r.x) * 2) / columns;
  const row = compact ? 13 : 23 * scale, firstRow = r.y + (r.height < 40 ? 20 : compact ? 26 : 43 * scale);
  for (const [i, label] of labels.entries()) {
    const x = left + i % columns * cell + cell / 2;
    fittedText(c, label, x, firstRow + Math.floor(i / columns) * row, i === 3 ? amber : green, cell - 2, font,
      compact ? 10 : Math.round(14 * scale));
  }
  if (!compact) {
    for (let i = 0; i < 3; i++) {
      fill(c, i < level ? '#80db9d' : '#2f554a', left + i * 13 * scale, bottom(r) - 28 * scale, 10 * scale, 5 * scale);
    }
  }
}

type GaugeRow = { centers: [number, number, number]; y: number; radius: number; width: number };
function gaugeRow(r: Rect, compact: boolean, scale: number): GaugeRow {
  const width = (r.width - 6) / 3;
  const radius = Math.max(4, Math.floor(Math.min(width / 2 - 3, r.height * 0.28, compact ? 13 : 26 * scale)));
  return {
    centers: [0, 1, 2].map(i => Math.round(r.x + 3 + width * (i + 0.5))) as [number, number, number],
    y: r.y + r.height * 0.43, radius, width,
  };
}

function drawGaugeFaces(c: Context, row: GaugeRow, showLabels: boolean, compact: boolean, t: Translate, font: string, scale: number): void {
  const labels = [t('hud.speed'), t('hud.boost'), t('hud.reverseShort')];
  const { centers, y, radius, width } = row;
  for (const [i, x] of centers.entries()) {
    c.fillStyle = '#080f1a'; c.strokeStyle = '#647580'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let tick = 0; tick <= 4; tick++) {
      const angle = Math.PI * (0.75 + tick * 0.375);
      fill(c, tick === 4 ? '#cb8a5c' : '#98aea9', x + Math.cos(angle) * (radius - 3), y + Math.sin(angle) * (radius - 3), compact ? 1 : 2, compact ? 1 : 2);
    }
    if (showLabels) fittedText(c, labels[i], x, y + radius + (compact ? 9 : 13 * scale), '#c6d5c8', width - 1, font,
      compact ? 9 : Math.round(12 * scale));
  }
}

function drawNeedle(c: Context, x: number, y: number, radius: number, value: number, compact: boolean, scale: number): void {
  const angle = Math.PI * (0.75 + clamp(value, 0, 1) * 1.5);
  pixelLine(c, '#ffac67', x, y, x + Math.cos(angle) * (radius - 3), y + Math.sin(angle) * (radius - 3), compact ? 1 : Math.round(2 * scale));
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
  private readonly warnings: CockpitWarnings = { master: false, lowHull: false, terrain: null, boost: null };
  private readonly markerLabels = Array.from({ length: 8 }, (): Rect => ({ x: 0, y: 0, width: 0, height: 0 }));
  private layout: CockpitLayout | null = null;
  private language: Language | null = null;
  private key = '';
  private labels!: GlassLabels;
  private ladder: CockpitLineRaster | null = null;
  private readonly radar = new RadarDisplay();
  private gauges!: { face: HTMLCanvasElement; row: GaugeRow };
  private caution: WarningCell[] = [];
  private readonly stores = new Map<number, HTMLCanvasElement>();
  private readonly weapons = new Map<number, HTMLCanvasElement>();

  private lastMfd: number | null = null;
  private lastFlicker = -1;
  private lastWeapon = -1;
  private lastStores = -1;
  private lastSpeed = -1;
  private lastBoost = -1;
  private lastReversalCharge = -1;
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

    const { compact, aiming, panelScale } = layout;
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

    const half = Math.ceil(cockpitLadderSpan(layout)) + 4;
    const ladderX = Math.max(aiming.x, Math.floor(aiming.x + aiming.width / 2 - half));
    const ladderRight = Math.min(right(aiming), Math.ceil(aiming.x + aiming.width / 2 + half));
    this.ladder = aiming.height >= 20 && ladderRight > ladderX
      ? new CockpitLineRaster({ x: ladderX, y: aiming.y, width: ladderRight - ladderX, height: aiming.height })
      : null;

    const row = gaugeRow(layout.gauges, compact, panelScale);
    this.radar.resize(layout.radar.width, layout.radar.height, this.font, t('hud.radar'), compact ? undefined : Math.round(10 * panelScale));
    this.gauges = {
      row, face: plate(layout.gauges, c => drawGaugeFaces(c, row, layout.gauges.height >= 40, compact, t, this.font, panelScale)),
    };
    this.caution = warningCells(layout, t, this.font);
    this.weapons.clear();
    this.stores.clear();
    this.lastMfd = null;
    this.lastFlicker = this.lastWeapon = this.lastStores = -1;
    this.lastSpeed = this.lastBoost = this.lastReversalCharge = this.lastGaugeFlicker = this.lastG = -1;
  }

  private cacheWeapons(layout: CockpitLayout, key: number, state: StageState, t: Translate): void {
    const { compact, stores, weapons, panelScale } = layout;
    const readouts = weaponReadouts(state, t);
    const font = (compact ? 10 : 12) + 'px ' + this.font, title = t('cockpit.weapons');
    this.weapons.set(key, plate(weapons, c => {
      c.font = `${compact ? 10 : Math.round(12 * panelScale)}px ${this.font}`;
      drawWeapons(c, weapons, readouts, state.twinRank, compact, title, this.font, panelScale);
    }));
    if (stores && !this.stores.has(key)) this.stores.set(key, plate(stores, c => {
      c.font = font;
      drawStores(c, stores, readouts);
    }));
  }

  draw(state: StageState, aim: Point | null, marks: PitchMark[], motion: CockpitMotion, clearance: number, impact: number,
    readout: RadarReadout, markers: readonly CockpitMarker[], markerObstructions: readonly Readonly<Rect>[],
    mirror: Readonly<Rect> | null, trackAltitude: number | undefined, language: Language, t: Translate): void {
    const layout = this.layout;
    if (!layout) return;
    if (language !== this.language) this.resize(layout, this.frame.width, this.frame.height, language, t);
    const elapsed = state.tick / 60;
    const warnings = cockpitWarnings(state, clearance, motion.climb, this.warnings);
    this.drawGlass(layout, aim, marks, state, motion, markers, markerObstructions, trackAltitude);
    if (mirror) clearZone(this.hud, mirror);

    const amberPulse = Math.floor(elapsed * 4) % 2 === 0 ? 1 : 0;
    const boostPulse = Math.floor(elapsed * 3) % 2 === 0 ? 1 : 0;
    updateWarning(this.panels, this.caution[0], (warnings.terrain || warnings.boost === 'low') ? 1 + amberPulse : 0);
    updateWarning(this.panels, this.caution[1], warnings.terrain ? (warnings.terrain === 'pullUp' ? 3 : 1) + amberPulse : 0);
    updateWarning(this.panels, this.caution[2], warnings.boost === 'active' ? 3 + boostPulse : warnings.boost === 'low' ? 1 + amberPulse : 0);
    const loopSeconds = Math.max(0, Math.ceil((state.maneuverReadyAt - state.tick) / TICKS_PER_SECOND));
    updateWarning(this.panels, this.caution[3], state.maneuver ? 2 : state.tick <= state.graceUntil ? 0 : 3 + loopSeconds);

    const flicker = impact > 0.45 && Math.floor(impact * 12) % 2 === 0 ? 0.6 : 1;
    const refresh = cockpitMfdDue(this.lastMfd, elapsed);
    if (refresh) {
      this.lastMfd = elapsed;
      this.drawMfds(layout, state, flicker, t);
      const { radar } = layout;
      this.panels.globalAlpha = flicker;
      clearZone(this.panels, radar);
      this.radar.draw(this.panels, radar.x, radar.y, readout, maneuverViewYaw(state), state.tick);
      this.panels.globalAlpha = 1;
    }
    this.drawGauges(layout, state, motion, flicker);
  }

  private drawGlass(layout: CockpitLayout, aim: Point | null, marks: PitchMark[], state: StageState, motion: CockpitMotion,
    markers: readonly CockpitMarker[], markerObstructions: readonly Readonly<Rect>[], targetAltitude?: number): void {
    const c = this.hud, { compact, speed, heading, altitude, aiming } = layout;
    clearZone(c, heading);
    drawHeading(c, heading, maneuverViewYaw(state), compact, this.labels);
    clearZone(c, speed);
    drawTape(c, speed, motion.speed, false, compact, this.labels);
    clearZone(c, altitude);
    drawTape(c, altitude, state.player.altitude, true, compact, this.labels, targetAltitude);

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
      const m = state.maneuver;
      const attitude = m && maneuverAttitude(m, state.player.bank);
      if (m) {
        const invertedAt = m.kind === 'immelmann' ? MANEUVERS.immelmann.flipTick : m.kind === 'split-s' ? 10 : Infinity;
        const flash = Math.max(0, 1 - m.elapsed / 7, m.elapsed >= invertedAt ? 1 - (m.elapsed - invertedAt) / 8 : 0);
        if (flash > 0) {
          c.globalAlpha = flash * 0.19;
          fill(c, m.kind === 'split-s' ? '#ffc993' : '#caeef0', aiming.x, aiming.y, aiming.width, aiming.height);
          c.globalAlpha = 1;
        }
      }
      drawLadder(c, layout, aim, motion, this.labels, this.ladder, marks, attitude);
      if (state.bodyGraceUntil > 0 && state.tick <= state.bodyGraceUntil) {
        drawGraceShimmer(c, aiming, state.bodyGraceUntil - state.tick, state.tick);
      }
      if (aim) drawAim(c, aiming, aim);
      drawMarkers(c, layout, markers, markerObstructions, this.labels, this.markerLabels, state.tick);
    }
  }

  private drawMfds(layout: CockpitLayout, state: StageState, flicker: number, t: Translate): void {
    const c = this.panels, { stores, weapons } = layout;
    c.globalAlpha = flicker;
    const weapon = (state.bombs * (MAX_FLARES + 1) + state.flareCharges) * 12 + state.podRank * 4 + state.twinRank;
    if (weapon !== this.lastWeapon || flicker !== this.lastFlicker) {
      if (!this.weapons.has(weapon)) this.cacheWeapons(layout, weapon, state, t);
      blitPlate(c, weapons, this.weapons.get(weapon)!);
      this.lastWeapon = weapon;
    }
    if (stores && weapon !== this.lastStores) {
      blitPlate(this.hud, stores, this.stores.get(weapon)!);
      this.lastStores = weapon;
    }
    this.lastFlicker = flicker;
    c.globalAlpha = 1;
  }

  private drawGauges(layout: CockpitLayout, state: StageState, motion: CockpitMotion, flicker: number): void {
    // A steady instrument retains its pixels. Clamp away drift past the ends of the dial.
    const speed = clamp(motion.speed / 100, 0, 1), boost = state.boost, charge = reversalCharge(state);
    if (Math.abs(speed - this.lastSpeed) < 1e-6 && boost === this.lastBoost && charge === this.lastReversalCharge && flicker === this.lastGaugeFlicker) return;
    this.lastSpeed = speed;
    this.lastBoost = boost;
    this.lastReversalCharge = charge;
    this.lastGaugeFlicker = flicker;
    const c = this.panels, { centers, y, radius } = this.gauges.row;
    c.globalAlpha = flicker;
    blitPlate(c, layout.gauges, this.gauges.face);
    drawNeedle(c, centers[0], y, radius, speed, layout.compact, layout.panelScale);
    drawNeedle(c, centers[1], y, radius, boost, layout.compact, layout.panelScale);
    drawNeedle(c, centers[2], y, radius, charge, layout.compact, layout.panelScale);
    c.globalAlpha = 1;
  }
}
