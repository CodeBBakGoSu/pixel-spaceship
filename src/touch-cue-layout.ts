import type { PhoneLayout, Rect } from './layout.ts';

export type ScreenPoint = { x: number; y: number };
export type CueSize = { width: number; height: number };
export type TouchOcclusionCue = { rect: Rect; rotation: number };

export const AEGIS_CUE_SIZE: CueSize = Object.freeze({ width: 160, height: 44 });
export const TOUCH_THREAT_CUE_SIZE: CueSize = Object.freeze({ width: 48, height: 40 });

type TouchLayout = Pick<PhoneLayout,
  'controls' | 'playfield' | 'dashboard' | 'pause' | 'audio' | 'stick' | 'stickLabel' | 'loop' | 'roll' | 'boost' | 'view'>;

const TOUCH_TARGETS = ['pause', 'audio', 'stick', 'stickLabel', 'loop', 'roll', 'boost', 'view'] as const;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function findTouchCueRect(layout: TouchLayout, size: CueSize, gap = 4, reserved: readonly Rect[] = []): Rect | null {
  const { controls } = layout;
  if (![size.width, size.height, gap].every(Number.isFinite) || size.width <= 0 || size.height <= 0 || gap < 0) return null;
  const targets = [...TOUCH_TARGETS.map(key => layout[key]), ...(layout.dashboard ? [layout.dashboard] : []), ...reserved];
  const xCandidates = edgeCandidates(controls.x, controls.width, size.width, targets, 'x', gap);
  const yCandidates = edgeCandidates(controls.y, controls.height, size.height, targets, 'y', gap);

  for (const y of yCandidates) for (const x of xCandidates) {
    const rect = { x, y, width: size.width, height: size.height };
    if (!contains(controls, rect) || overlaps(rect, layout.playfield)) continue;
    if (targets.some(target => overlaps(rect, expand(target, gap)))) continue;
    return rect;
  }
  return null;
}

function expand(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

function edgeCandidates(origin: number, extent: number, size: number, obstacles: readonly Rect[], axis: 'x' | 'y', gap: number): number[] {
  const start = origin + gap, end = origin + extent - size - gap;
  if (end < start) return [];
  const center = (start + end) / 2;
  const candidates = [start, center, end];
  for (const obstacle of obstacles) {
    const obstacleStart = axis === 'x' ? obstacle.x : obstacle.y;
    const obstacleExtent = axis === 'x' ? obstacle.width : obstacle.height;
    candidates.push(obstacleStart - size - gap, obstacleStart + obstacleExtent + gap);
  }
  return [...new Set(candidates.filter(candidate => Number.isFinite(candidate) && candidate >= start && candidate <= end))]
    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
}

export function findTouchCueRects(layout: TouchLayout, sizes: readonly CueSize[], gap = 4,
  reserved: readonly Rect[] = []): (Rect | null)[] {
  const obstacles = [...reserved];
  return sizes.map(size => {
    const rect = findTouchCueRect(layout, size, gap, obstacles);
    if (rect) obstacles.push(rect);
    return rect;
  });
}

export function pointBehindTouchControls(point: ScreenPoint, controls: Rect, margin = 0): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(margin) && margin >= 0
    && point.x >= controls.x - margin && point.x <= controls.x + controls.width + margin
    && point.y >= controls.y - margin && point.y <= controls.y + controls.height + margin;
}

export function touchControlOcclusionRect(layout: Pick<PhoneLayout, 'controls'>,
  viewport: { width: number; height: number }): Rect {
  if (![layout.controls.y, viewport.width, viewport.height].every(Number.isFinite)) return { x: 0, y: 0, width: 0, height: 0 };
  const y = Math.max(0, Math.min(viewport.height, layout.controls.y));
  return { x: 0, y, width: Math.max(0, viewport.width), height: Math.max(0, viewport.height - y) };
}

export function isDescendingDiveWarning(maneuver: { phase: string; band: number } | undefined,
  currentBand: number): boolean {
  return maneuver?.phase === 'warning' && Number.isFinite(maneuver.band) && maneuver.band < currentBand;
}

export function touchCueScreenReference(projected: ScreenPoint & { depth: number },
  layout: Pick<PhoneLayout, 'cockpit' | 'playfield'>): ScreenPoint {
  if (projected.depth > 0.05 && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
    return { x: projected.x, y: projected.y };
  }
  const anchor = layout.cockpit?.aiming ?? layout.playfield;
  return { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height * 0.72 };
}

export function screenArrowRotation(from: ScreenPoint, to: ScreenPoint): number | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) < 0.001) return null;
  return ((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360 + 360) % 360;
}

export function touchOcclusionCue(layout: TouchLayout, from: ScreenPoint, target: ScreenPoint,
  size: CueSize, margin = 8, occlusion = layout.controls, reserved: readonly Rect[] = [], preferredSlot?: Rect | null): TouchOcclusionCue | null {
  if (!pointBehindTouchControls(target, occlusion, margin)) return null;
  const rect = preferredSlot === undefined ? findTouchCueRect(layout, size, 4, reserved) : preferredSlot;
  const rotation = screenArrowRotation(from, target);
  return rect && rotation !== null ? { rect, rotation } : null;
}
