import type { PerspectiveCamera } from 'three';
import type { CockpitLayout, HudLayout, PhoneLayout, Rect } from './layout.ts';
import { clamp } from './stage-combat.ts';
import type { Position, StageState } from './stage-types.ts';

export const REAR_INSET_WIDTH = 128;
export const REAR_INSET_HEIGHT = 56;
export const REAR_VIEW_ASPECT = REAR_INSET_WIDTH / REAR_INSET_HEIGHT;

const WIPE_TICKS = 9;
const MIRROR_FOCUS_SCALE = 11 / 9;
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
  const { aiming, altitude, compact, glass, heading } = cockpit;
  const portrait = phone ? phone.orientation === 'portrait' : compact && glass.height >= 100;
  let left = right(heading) + 5;
  let edge = portrait ? right(glass) - 12 : altitude.x - 5;
  const end = portrait ? Math.min(altitude.y, bottom(glass)) - 4 : bottom(glass) - 2;
  let y = glass.y + 3;
  let available = Math.min(edge - left, (end - y) * REAR_VIEW_ASPECT);
  let restCap = compact ? 216 : 288;
  if (portrait) {
    // Use the row below the heading and leave the center of the aiming area open.
    const rowTop = bottom(heading) + 4;
    const rowBottom = Math.floor(aiming.y + aiming.height * 0.48) - 28;
    const rowWidth = Math.min(aiming.width, (rowBottom - rowTop) * REAR_VIEW_ASPECT);
    if (rowWidth > available) {
      left = aiming.x;
      edge = right(aiming);
      y = rowTop;
      available = rowWidth;
      restCap = Math.round(glass.width * 0.56);
    }
  }
  const focusWidth = Math.floor(Math.min(Math.round(restCap * MIRROR_FOCUS_SCALE), available));
  if (focusWidth < 32) return null;
  const restWidth = Math.max(32, Math.min(restCap, Math.floor(focusWidth / MIRROR_FOCUS_SCALE)));
  // Center the expanded frame in the available slot, away from the canopy strut.
  const anchor = Math.floor((left + edge + focusWidth) / 2);
  const anchored = (w: number): Rect => ({ x: anchor - w, y, width: w, height: Math.round(w / REAR_VIEW_ASPECT) });
  return { rest: anchored(restWidth), focus: anchored(focusWidth) };
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
