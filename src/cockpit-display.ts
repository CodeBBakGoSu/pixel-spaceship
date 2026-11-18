import type { Point } from './camera';
import {
  cockpitAim, cockpitWarnings, headingTape, pitchLadder, selectCockpitTarget,
  type CockpitMotion, type CockpitTarget, type CockpitView, type CockpitWarnings,
} from './cockpit';
import type { GameState } from './game';
import type { createTranslator } from './i18n';
import type { CockpitLayout, Rect } from './layout';

type Context = CanvasRenderingContext2D;
type Translate = ReturnType<typeof createTranslator>;
type Sign = { label: string; active: boolean; amber: boolean };
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

function pixelLine(c: Context, color: string, a: Point, b: Point, weight = 1): void {
  const dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i <= steps; i++) {
    c.rect(Math.round(a.x + dx * i / steps), Math.round(a.y + dy * i / steps), weight, weight);
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

function drawHeading(c: Context, r: Rect, yaw: number, compact: boolean, t: Translate): void {
  const pad = compact ? 13 : 16, center = middle(r).x;
  const top = r.y + 7, axisY = r.y + Math.min(r.height - 3, compact ? 18 : 21);
  fill(c, 'rgba(9,26,28,.83)', r.x, r.y, r.width, r.height);
  outline(c, '#53766a', r);
  const tape = headingTape(yaw, compact ? 30 : 15, t);
  if (r.height < 23) {
    text(c, tape.bearing, center, middle(r).y, green, 'center');
    return;
  }
  for (const tick of tape.ticks) {
    const x = center + (r.width - pad * 2) * tick.offset / 120;
    fill(c, dimGreen, x, axisY - 3, 1, 4);
    text(c, tick.label, x, top, green, 'center');
  }
  fill(c, '#53766a', r.x + pad, axisY, r.width - pad * 2, 1);
  fill(c, '#112f2c', center - 22, bottom(r) - 13, 44, 13);
  fill(c, green, center - 2, axisY - 4, 5, 1);
  text(c, tape.bearing, center, bottom(r) - 6, green, 'center');
}

function drawTape(c: Context, r: Rect, value: number, label: string, altitude: boolean, compact: boolean, target?: number): void {
  const pivot = Math.round(middle(r).y), scale = compact ? 1.3 : 2.0;
  const axis = altitude ? r.x + 5 : right(r) - 6;
  const edge = altitude ? axis + 2 : axis - 2;
  const box = { x: r.x + 3, y: pivot - 9, width: r.width - 6, height: 18 };
  fill(c, 'rgba(7,24,27,.8)', r.x, r.y, r.width, r.height);
  outline(c, '#53766a', r);
  if (r.height < 37) {
    text(c, String(Math.round(value)), middle(r).x, pivot, green, 'center');
    return;
  }
  text(c, label, middle(r).x, r.y + 9, green, 'center');
  const chartTop = r.y + 23, chartBottom = bottom(r) - 8;
  fill(c, dimGreen, axis, chartTop, 1, chartBottom - chartTop + 1);
  const start = Math.ceil((value + (pivot - chartBottom) / scale) / 5) * 5;
  const end = value + (pivot - chartTop) / scale;
  for (let tick = start; tick <= end; tick += 5) {
    if (tick < 0) continue;
    const y = pivot + (value - tick) * scale;
    const length = tick % 10 === 0 ? 7 : 3;
    fill(c, dimGreen, altitude ? axis : axis - length + 1, y, length, 1);
    if (!compact && tick % 10 === 0 && Math.abs(y - pivot) > 17) {
      text(c, String(tick), edge + (altitude ? 11 : -11), y, green, altitude ? 'left' : 'right');
    }
  }
  fill(c, '#173735', box.x, box.y, box.width, box.height);
  outline(c, green, box);
  text(c, String(Math.round(value)), middle(box).x, pivot, green, 'center');
  if (target !== undefined) {
    const y = clamp(pivot + (value - target) * scale, chartTop, chartBottom);
    pixelLine(c, amber, { x: r.x, y: y - 3 }, { x: r.x + 4, y });
    pixelLine(c, amber, { x: r.x + 4, y }, { x: r.x, y: y + 3 });
  }
}

function drawLadder(c: Context, layout: CockpitLayout, view: CockpitView, motion: CockpitMotion): void {
  const area = layout.aiming, compact = layout.compact, center = middle(area);
  const span = Math.min(compact ? 51 : 105, area.width * 0.31);
  const slope = Math.atan2(motion.climb, Math.max(12, motion.speed));
  const pitch = clamp(slope * 180 / Math.PI, -32, 32);
  const horizon = view.screen.height * 0.3 + view.camera.pitch * 15 * view.screen.height / view.buffer.height;
  const anchor = { x: center.x - motion.turn * (compact ? 7 : 14), y: center.y - area.height * 0.03 };
  c.save();
  c.beginPath();
  c.rect(area.x, area.y, area.width, area.height);
  c.clip();
  for (const mark of pitchLadder(anchor, pitch, motion.bank, span, compact ? 2.0 : 3.0)) {
    const weight = mark.angle === 0 ? 2 : 1;
    const color = mark.angle === 0 ? '#9befb2' : '#73bb93';
    for (const line of [mark.left, mark.right]) {
      pixelLine(c, '#183f39', { x: line.from.x - 1, y: line.from.y - 1 }, { x: line.to.x - 1, y: line.to.y - 1 }, weight + 2);
      if (mark.angle < 0) {
        const middle = (part: number) => ({ x: line.from.x + (line.to.x - line.from.x) * part, y: line.from.y + (line.to.y - line.from.y) * part });
        pixelLine(c, color, line.from, middle(0.38), weight);
        pixelLine(c, color, middle(0.62), line.to, weight);
      } else {
        pixelLine(c, color, line.from, line.to, weight);
      }
    }
    if (mark.angle === 0 || (compact && mark.angle % 20 !== 0)) continue;
    const writeAngle = (p: Point, labelX: number, align: CanvasTextAlign) => {
      if (p.y < area.y + 7 || p.y > bottom(area) - 7) return;
      c.strokeStyle = '#16312b';
      c.lineWidth = 2;
      c.textAlign = align;
      c.strokeText(String(mark.angle), Math.round(labelX), Math.round(p.y));
      text(c, String(mark.angle), labelX, p.y, green, align);
    };
    writeAngle(mark.left.from, mark.left.from.x - 7, 'right');
    if (!compact) writeAngle(mark.right.to, mark.right.to.x + 8, 'left');
  }
  const pathY = clamp(horizon - Math.sin(slope) * 54, area.y + 10, bottom(area) - 10);
  const pathX = anchor.x + motion.turn * (compact ? 3 : 6);
  for (const side of [-1, 1]) {
    fill(c, green, pathX - 2, pathY + side * 4, 5, 1);
    fill(c, green, pathX + side * 4, pathY - 2, 1, 5);
    for (const end of [-1, 1]) fill(c, green, pathX + side * 3, pathY + end * 3, 1, 1);
  }
  fill(c, green, pathX - 11, pathY, 7, 1);
  fill(c, green, pathX + 5, pathY, 7, 1);
  fill(c, green, pathX, pathY - 9, 1, 5);
  c.restore();
}

function drawAim(c: Context, area: Rect, aim: Point, target: CockpitTarget | null, elapsed: number, t: Translate): void {
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
    const point = { x: x + Math.cos(angle) * 4, y: y + Math.sin(angle) * 4 };
    for (const wing of [angle + 2.5, angle - 2.5]) {
      pixelLine(c, green, point, { x: point.x + Math.cos(wing) * 7, y: point.y + Math.sin(wing) * 7 });
    }
  }
  if (!target) return;

  const p = target.point, size = 11, color = target.locked ? green : '#81bc9d';
  const pulse = target.locked && Math.floor(elapsed * 4) % 2 === 0;
  const targetBox = { x: Math.round(p.x) - size, y: Math.round(p.y) - size, width: size * 2 + 1, height: size * 2 + 1 };
  outline(c, pulse ? green : '#254d41', targetBox);
  for (const dx of [-size, size]) for (const dy of [-size, size]) {
    const cornerX = p.x + dx, cornerY = p.y + dy;
    fill(c, color, cornerX - (dx > 0 ? 4 : 0), cornerY, 5, 1);
    fill(c, color, cornerX, cornerY - (dy > 0 ? 4 : 0), 1, 5);
  }
  const range = t('cockpit.range', { value: target.range });
  const label = t(target.locked ? 'cockpit.lock' : 'cockpit.track', { range });
  const width = Math.ceil(c.measureText(label).width) + 10;
  const below = bottom(targetBox) + 4;
  const labelY = below + 15 <= bottom(area) ? below : targetBox.y - 19;
  const labelX = clamp(p.x - width / 2, area.x, right(area) - width);
  fill(c, pulse ? '#204335' : ink, labelX, labelY, width, 15);
  text(c, label, labelX + width / 2, labelY + 7, color, 'center');
}

function drawWarnings(c: Context, layout: CockpitLayout, warnings: CockpitWarnings, elapsed: number, t: Translate, font: string): void {
  const r = layout.warnings, compact = layout.compact;
  const signs: Sign[] = [
    { label: t(compact ? 'cockpit.cautionShort' : 'cockpit.masterCaution'), active: warnings.master, amber: true },
    { label: t('cockpit.lowHull'), active: warnings.lowHull, amber: true },
    { label: t(warnings.terrain === 'pullUp' ? 'cockpit.pullUp' : 'cockpit.altLow'), active: warnings.terrain !== null, amber: true },
    { label: t('control.boost'), active: warnings.boost !== null, amber: warnings.boost === 'low' },
  ];
  const size = compact ? 10 : 12;
  for (const [i, sign] of signs.entries()) {
    const x = r.x + Math.round(r.width * i / signs.length);
    const width = r.x + Math.round(r.width * (i + 1) / signs.length) - x - 2;
    const color = sign.amber ? amber : green;
    const bright = sign.active && Math.floor(elapsed * (sign.amber ? 4 : 3)) % 2 === 0;
    fill(c, bright ? (sign.amber ? '#593820' : '#25443a') : '#111923', x, r.y, width, r.height);
    outline(c, sign.active ? (sign.amber ? '#bb8047' : '#52896b') : '#384650', { ...r, x, width });
    fill(c, bright ? color : sign.active ? '#846540' : '#46545a', x + 5, r.y + (r.height - 4) / 2, 4, 4);
    fittedText(c, sign.label, x + width / 2 + 3, middle(r).y, sign.active ? color : '#839795', width - 14, font, size);
  }
}

function drawStores(c: Context, r: Rect, weapons: WeaponReadout): void {
  const cell = r.width / 3, y = middle(r).y;
  fill(c, 'rgba(9,26,28,.83)', r.x, r.y, r.width, r.height);
  outline(c, '#53766a', r);
  for (const [i, label] of [weapons.ammo, weapons.missiles, weapons.bombs].entries()) {
    if (i > 0) fill(c, '#38554e', r.x + i * cell, r.y + 3, 1, r.height - 6);
    text(c, label, r.x + (i + 0.5) * cell, y, i === 1 ? dimGreen : green, 'center');
  }
}

function drawRadar(c: Context, r: Rect, state: GameState, compact: boolean, t: Translate): void {
  const short = r.height < 40, player = state.player;
  const x = compact ? middle(r).x : r.x + r.width * 0.52, y = middle(r).y + (short ? 1 : compact ? 5 : 3);
  const radius = Math.max(5, Math.min(r.height / 2 - (short ? 4 : compact ? 13 : 16), r.width * 0.39));
  text(c, t('hud.radar'), r.x + (compact ? 6 : 12), r.y + (short ? 8 : 11));
  if (!compact) text(c, t('cockpit.range', { value: 240 }), right(r) - 14, r.y + 11, dimGreen, 'right');
  c.strokeStyle = '#285747';
  c.lineWidth = 1;
  for (const ratio of [0.5, 1]) {
    c.beginPath(); c.arc(x, y, radius * ratio, 0, Math.PI * 2); c.stroke();
  }
  fill(c, '#244a40', x - radius, y, radius * 2, 1);
  fill(c, '#244a40', x, y - radius, 1, radius * 2);
  const beam = (state.elapsed * 2.6) % (Math.PI * 2);
  c.fillStyle = 'rgba(96,232,133,.13)';
  c.beginPath(); c.moveTo(x, y); c.arc(x, y, radius, beam - 0.47, beam); c.closePath(); c.fill();
  pixelLine(c, '#488c66', { x, y }, { x: x + Math.cos(beam) * radius, y: y + Math.sin(beam) * radius });

  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const dot = (wx: number, wz: number, color: string) => {
    const dx = wx - player.x, dz = wz - player.z, distance = Math.hypot(dx, dz);
    if (distance > 240) return;
    const scale = (radius - 2) / 240;
    const across = (dx * cos - dz * sin) * scale, ahead = (dx * sin + dz * cos) * scale;
    fill(c, color, x + across - 1, y - ahead - 1, compact ? 2 : 3, compact ? 2 : 3);
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

function drawDamage(c: Context, r: Rect, state: GameState, compact: boolean, impact: number, t: Translate): void {
  const color = state.hull <= state.maxHull / 4 || impact > 0 ? amber : green;
  const short = r.height < 40, center = middle(r);
  text(c, t('cockpit.airframe'), r.x + (compact ? 6 : 12), r.y + (short ? 8 : 11));
  const size = compact ? 2 : 5, unit = short ? 1 : size;
  const spriteTop = Math.round(center.y - wing.length * unit / 2 - (compact ? 1 : 0));
  const spriteX = center.x - wing[0].length * unit / 2;
  for (const [row, line] of wing.entries()) for (let i = 0; i < line.length; i++) {
    if (line[i] !== '+') continue;
    const side = i < 6 ? i : line.length - i - 1;
    const shade = state.hull <= 2 && side < 3 ? '#875744' : i === 6 ? color : impact > 0 ? '#d88756' : '#498d71';
    fill(c, shade, spriteX + i * unit, spriteTop + row * unit, unit, unit);
  }
  const gap = compact ? 2 : 4, length = Math.min(r.width - 12, compact ? 70 : 138);
  const block = Math.floor((length - gap * (state.maxHull - 1)) / state.maxHull);
  const total = state.maxHull * block + gap * (state.maxHull - 1);
  for (let i = 0; i < state.maxHull; i++) {
    fill(c, i < state.hull ? color : '#3e594f', center.x - total / 2 + i * (block + gap), bottom(r) - (compact ? 12 : 22), block, compact ? 5 : 7);
  }
}

function drawWeapons(c: Context, r: Rect, weapons: WeaponReadout, level: number, compact: boolean, title: string, font: string): void {
  const left = r.x + (compact ? 6 : 12), y = r.y + (r.height < 40 ? 8 : 11);
  text(c, title, left, y, green);
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

function drawGauges(c: Context, r: Rect, state: GameState, motion: CockpitMotion, compact: boolean, t: Translate, font: string): void {
  const values = [motion.speed / 100, state.bst, state.hull / state.maxHull];
  const labels = [t('hud.speed'), t('hud.boost'), t('hud.hull')];
  const width = (r.width - 6) / 3, y = r.y + r.height * 0.43;
  const radius = Math.max(4, Math.floor(Math.min(width / 2 - 3, r.height * 0.28, compact ? 13 : 26)));
  for (let i = 0; i < values.length; i++) {
    const x = Math.round(r.x + 3 + width * (i + 0.5));
    c.fillStyle = '#080f1a'; c.strokeStyle = '#647580'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let tick = 0; tick <= 4; tick++) {
      const angle = Math.PI * (0.75 + tick * 0.375);
      fill(c, tick === 4 ? '#cb8a5c' : '#98aea9', x + Math.cos(angle) * (radius - 3), y + Math.sin(angle) * (radius - 3), compact ? 1 : 2, compact ? 1 : 2);
    }
    const angle = Math.PI * (0.75 + clamp(values[i], 0, 1) * 1.5);
    pixelLine(c, '#ffac67', { x, y }, { x: x + Math.cos(angle) * (radius - 3), y: y + Math.sin(angle) * (radius - 3) }, compact ? 1 : 2);
    fill(c, '#dce6d4', x - 1, y - 1, 3, 3);
    if (r.height >= 40) fittedText(c, labels[i], x, y + radius + (compact ? 9 : 13), '#c6d5c8', width - 1, font, compact ? 9 : 12);
  }
}

export class CockpitDisplay {
  private readonly ctx: Context;
  private readonly chrome = document.createElement('canvas');
  private layout: CockpitLayout | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly font: string) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(layout: CockpitLayout | null, width: number, height: number): void {
    this.layout = layout;
    this.canvas.hidden = !layout;
    if (!layout) return;
    this.chrome.width = this.canvas.width = width;
    this.chrome.height = this.canvas.height = height;
    drawChrome(this.chrome.getContext('2d')!, layout);
  }

  draw(state: GameState, view: CockpitView, motion: CockpitMotion, clearance: number, impact: number, opacity: number, t: Translate) {
    const layout = this.layout;
    if (!layout) return null;
    const c = this.ctx, { compact } = layout;
    const aim = cockpitAim(view, state), target = selectCockpitTarget(state, view, layout.aiming, aim);
    const warnings = cockpitWarnings(state, clearance, motion.climb);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalAlpha = opacity;
    c.drawImage(this.chrome, 0, 0);
    c.textBaseline = 'middle';
    const fontSize = compact ? 10 : 12;
    c.font = `${fontSize}px ${this.font}`;
    const weapons: WeaponReadout = {
      gun: t('hud.weapon', { level: state.weaponLv }), ammo: t('cockpit.ammo', { count: '∞' }),
      bombs: t('cockpit.bombs', { count: state.bombs }), missiles: t('cockpit.missiles', { count: 0 }),
    };
    drawHeading(c, layout.heading, state.player.yaw, compact, t);
    drawTape(c, layout.speed, motion.speed, t('hud.speed'), false, compact);
    drawTape(c, layout.altitude, state.player.altitude, t('hud.altitude'), true, compact, target?.altitude);
    const g = (1 + 0.47 * Math.abs(motion.turn) + 0.013 * Math.abs(motion.climb)).toFixed(1);
    if (layout.aiming.height > 35) {
      const gText = t('cockpit.gLoad', { value: g });
      const width = Math.ceil(c.measureText(gText).width) + 10;
      const x = layout.speed.x, y = bottom(layout.speed) + 4;
      if (y + 15 <= bottom(layout.glass)) {
        fill(c, ink, x, y, width, 15);
        text(c, gText, x + 5, y + 7);
      }
    }
    if (layout.aiming.height >= 20) {
      drawLadder(c, layout, view, motion);
      drawAim(c, layout.aiming, aim, target, state.elapsed, t);
    }
    if (layout.stores) drawStores(c, layout.stores, weapons);
    drawWarnings(c, layout, warnings, state.elapsed, t, this.font);

    const flicker = impact > 0.45 && Math.floor(impact * 12) % 2 === 0 ? 0.6 : 1;
    c.globalAlpha = opacity * flicker;
    c.font = `${fontSize}px ${this.font}`;
    drawRadar(c, layout.radar, state, compact, t);
    drawDamage(c, layout.damage, state, compact, impact, t);
    drawWeapons(c, layout.weapons, weapons, state.weaponLv, compact, t('cockpit.weapons'), this.font);
    drawGauges(c, layout.gauges, state, motion, compact, t, this.font);
    c.globalAlpha = 1;
    return { target, warnings };
  }
}
