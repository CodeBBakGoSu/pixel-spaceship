import type { Segment } from './camera.ts';

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type PhoneLayout = {
  orientation: 'portrait' | 'landscape'; buffer: { width: number; height: number };
  hud: Rect; boss: Rect; radio: Rect; objective: Rect; playfield: Rect; dashboard: Rect | null; controls: Rect;
  radar: Rect; alt: Rect; pause: Rect; stick: Rect; stickLabel: Rect; fire: Rect; boost: Rect; bomb: Rect; view: Rect;
  shipY: number; panelScale: number;
};
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });

// CSS pixels; the canvas still covers the entire viewport, including the safe areas.
export function phoneLayout(width: number, height: number, safe: Insets, view: Segment): PhoneLayout {
  const portrait = height >= width, left = safe.left + 8, right = width - safe.right - 8, top = safe.top + 4;
  const usableWidth = right - left, hudWidth = portrait ? usableWidth : Math.min(340, Math.max(270, usableWidth * 0.4));
  const hud = rect(left, top, hudWidth, 56), boss = rect(left, top + 58, hudWidth, 8);
  const radio = portrait ? rect(left, top + 70, usableWidth, 54) : rect(left + hudWidth + 8, top, usableWidth - hudWidth - 8, 62);
  const objectiveY = portrait ? radio.y + radio.height + 4 : top + 70;
  const objective = rect(left, objectiveY, usableWidth, 22);
  const controlHeight = portrait ? clamp(Math.round(height * 0.19), 146, 170) : clamp(Math.round(height * 0.35), 134, 140);
  const controls = rect(safe.left, height - safe.bottom - controlHeight, width - safe.left - safe.right, controlHeight);
  const bufferWidth = portrait ? 180 : clamp(Math.round(180 * width / height), 160, 480);
  const buffer = { width: bufferWidth, height: Math.round(bufferWidth * height / width) };
  const panelScale = portrait ? 1 : 0.55, panelHeight = Math.round(34 * height / buffer.height * panelScale);
  const dashboard = view === 'cockpit' ? rect(safe.left, controls.y - panelHeight, controls.width, panelHeight) : null;
  const fieldTop = objective.y + objective.height + 4, fieldBottom = dashboard ? dashboard.y : controls.y;
  const playfield = rect(left, fieldTop, usableWidth, Math.max(0, fieldBottom - fieldTop));
  const radarSize = Math.min(48, Math.max(20, playfield.height - 8));
  const alt = rect(right - 18, fieldTop + 2, 18, Math.max(0, playfield.height - 4));
  const radar = rect(alt.x - 4 - radarSize, fieldTop + 4, radarSize, radarSize);
  const pause = rect(hud.x + hud.width - 44, hud.y + 6, 44, 44);
  const stickSize = portrait ? clamp(Math.round(width * 0.25), 88, 100) : 80;
  const stick = rect(controls.x + 12, controls.y + (controls.height - stickSize) / 2 + 3, stickSize, stickSize);
  const stickLabel = rect(stick.x, stick.y - 14, stick.width, 10);
  const fireSize = portrait ? clamp(Math.round(width * 0.2), 68, 78) : 64;
  const side = controls.x + controls.width - 8;
  const fire = rect(side - fireSize, controls.y + controls.height - 8 - fireSize, fireSize, fireSize);
  const boost = rect(side - 52, controls.y + 6, 52, 52);
  const bomb = rect(boost.x - 8 - 48, controls.y + 8, 48, 48);
  const viewButton = rect(fire.x - 8 - 52, controls.y + controls.height - 8 - 52, 52, 52);
  return { orientation: portrait ? 'portrait' : 'landscape', buffer, hud, boss, radio, objective, playfield, dashboard, controls,
    radar, alt, pause, stick, stickLabel, fire, boost, bomb, view: viewButton,
    shipY: Math.round(playfield.y + playfield.height * (portrait ? 0.72 : 0.68)), panelScale };
}
