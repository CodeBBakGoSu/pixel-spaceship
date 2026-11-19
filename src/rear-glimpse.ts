import type { PerspectiveCamera } from 'three';
import type { CockpitLayout, HudLayout, PhoneLayout, Rect } from './layout.ts';
import { clamp } from './stage-combat.ts';
import type { Position, StageState } from './stage-types.ts';

export const REAR_VIEW_WIDTH = 128;
export const REAR_VIEW_HEIGHT = 56;
export const REAR_VIEW_ASPECT = REAR_VIEW_WIDTH / REAR_VIEW_HEIGHT;

const WIPE_TICKS = 9;
const bottom = (rect: Rect): number => rect.y + rect.height;
const right = (rect: Rect): number => rect.x + rect.width;

export function layoutRearInset(hud: HudLayout, height: number, phone: PhoneLayout | null): Rect | null {
  const field = phone?.playfield;
  const x = field?.x ?? hud.hud.x;
  const y = Math.max(field?.y ?? 0, bottom(hud.objective), bottom(hud.radio)) + 12;
  // The TOP arena map can sit beside the radar on short viewports.
  const mapSpace = Math.min(78, hud.radar.width) + 5;
  const usableWidth = Math.min(hud.radar.x - mapSpace, hud.alt.x) - x - 8;
  const usableHeight = (field ? bottom(field) - 10 : height - 44) - y;
  const cap = phone?.orientation === 'portrait' ? 136 : phone ? 168 : 224;
  const width = Math.floor(Math.min(cap, usableWidth, usableHeight * REAR_VIEW_ASPECT));
  return width >= 36 ? { x, y, width, height: Math.round(width / REAR_VIEW_ASPECT) } : null;
}

export function layoutRearMirror(cockpit: CockpitLayout, phone: PhoneLayout | null): { rest: Rect; focus: Rect } | null {
  const { altitude, compact, glass, heading } = cockpit;
  const short = glass.height < 100;
  // Portrait uses the glass above the altitude tape. The wide canopy can dock beside it.
  const portrait = phone?.orientation === 'portrait' || compact && !short;
  const edge = portrait ? right(glass) - 12 : altitude.x - 5;
  const end = portrait ? Math.min(altitude.y, bottom(glass)) - 4 : bottom(glass) - 2;
  const beside = glass.y + 3;
  const below = bottom(heading) + 4;
  const besideWidth = Math.min(edge - right(heading) - 5, (end - beside) * REAR_VIEW_ASPECT);
  const belowWidth = Math.min(glass.width * 0.4, (end - below) * REAR_VIEW_ASPECT);
  const alongside = !portrait || besideWidth >= belowWidth;
  const y = alongside ? beside : below;
  const availableWidth = alongside ? besideWidth : belowWidth;
  const width = Math.floor(Math.min(compact ? 108 : 128, alongside ? availableWidth : Math.min(availableWidth, glass.width * 0.35)));
  if (width < 32) return null;
  const focusWidth = Math.floor(Math.min(compact ? 130 : 156, availableWidth));
  const anchored = (w: number): Rect => ({ x: edge - w, y, width: w, height: Math.round(w / REAR_VIEW_ASPECT) });
  return { rest: anchored(width), focus: anchored(focusWidth) };
}

export function glimpseWipe(tick: number, glimpse: { since: number; until: number } | null, reducedMotion = false): number {
  if (!glimpse || tick < glimpse.since || tick >= glimpse.until) return 0;
  if (reducedMotion) return 1;
  const fraction = clamp(Math.min(tick - glimpse.since + 1, glimpse.until - tick) / WIPE_TICKS, 0, 1);
  return fraction * fraction * (3 - 2 * fraction);
}

export function frameRearCamera(camera: PerspectiveCamera, player: StageState['player'], active: boolean, target?: Position): void {
  const { x, z, altitude, yaw } = player;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  // A wider view of the tail keeps the payload in the lens as soon as it drops.
  const offset = active ? 8 : -4;
  camera.position.set(x + offset * fx, altitude + 4, -(z + offset * fz));
  if (target) camera.lookAt(target.x, target.alt, -target.z);
  else camera.lookAt(x - 100 * fx, altitude - (active ? 9 : 2), -(z - 100 * fz));
  camera.updateMatrixWorld();
}
