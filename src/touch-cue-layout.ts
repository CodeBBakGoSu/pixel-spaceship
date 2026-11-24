import type { PhoneLayout, Rect } from './layout.ts';

export type ScreenPoint = { x: number; y: number };
export type ProjectedScreenPoint = ScreenPoint & { depth: number };
export type CueSize = { width: number; height: number };
export type TouchOcclusionCue = { rect: Rect; rotation: number };

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
  const centeredX = controls.x + (controls.width - size.width) / 2;
  const xCandidates = [...new Set([centeredX, controls.x + gap, controls.x + controls.width - size.width - gap])]
    .sort((a, b) => Math.abs(a - centeredX) - Math.abs(b - centeredX));
  const top = controls.y + gap, middle = controls.y + (controls.height - size.height) / 2;
  const bottom = controls.y + controls.height - size.height - gap;
  const yCandidates = [...new Set([top, middle, bottom])].sort((a, b) => a - b);
  const targets = [...TOUCH_TARGETS.map(key => layout[key]), ...(layout.dashboard ? [layout.dashboard] : []), ...reserved];

  for (const y of yCandidates) for (const x of xCandidates) {
    const rect = { x, y, width: size.width, height: size.height };
    if (!contains(controls, rect) || overlaps(rect, layout.playfield)) continue;
    if (targets.some(target => overlaps(rect, target))) continue;
    return rect;
  }
  return null;
}

export function pointBehindTouchControls(point: ScreenPoint, controls: Rect, margin = 0): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(margin) && margin >= 0
    && point.x >= controls.x - margin && point.x <= controls.x + controls.width + margin
    && point.y >= controls.y - margin && point.y <= controls.y + controls.height + margin;
}

export function screenPointObscured(point: ProjectedScreenPoint, viewport: { width: number; height: number },
  obstacles: readonly Rect[]): boolean {
  if (![point.x, point.y, point.depth, viewport.width, viewport.height].every(Number.isFinite)
    || point.depth <= 0.05 || viewport.width <= 0 || viewport.height <= 0) return true;
  if (point.x < 0 || point.x >= viewport.width || point.y < 0 || point.y >= viewport.height) return true;
  return obstacles.some(rect => point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height);
}

export function touchControlOcclusionRect(layout: Pick<PhoneLayout, 'controls'>,
  viewport: { width: number; height: number }): Rect {
  if (![layout.controls.y, viewport.width, viewport.height].every(Number.isFinite)) return { x: 0, y: 0, width: 0, height: 0 };
  const y = Math.max(0, Math.min(viewport.height, layout.controls.y));
  return { x: 0, y, width: Math.max(0, viewport.width), height: Math.max(0, viewport.height - y) };
}
export function screenArrowRotation(from: ScreenPoint, to: ScreenPoint): number | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) < 0.001) return null;
  return ((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360 + 360) % 360;
}

export function touchOcclusionCue(layout: TouchLayout, from: ScreenPoint, target: ScreenPoint,
  size: CueSize, margin = 8, occlusion = layout.controls, reserved: readonly Rect[] = []): TouchOcclusionCue | null {
  if (!pointBehindTouchControls(target, occlusion, margin)) return null;
  const rect = findTouchCueRect(layout, size, 4, reserved);
  const rotation = screenArrowRotation(from, target);
  return rect && rotation !== null ? { rect, rotation } : null;
}
