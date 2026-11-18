import type { Segment } from './camera.ts';

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type HudLayout = { hud: Rect; boss: Rect; radio: Rect; objective: Rect; radar: Rect; alt: Rect };
export type PhoneLayout = HudLayout & {
  orientation: 'portrait' | 'landscape'; buffer: { width: number; height: number };
  playfield: Rect; dashboard: Rect | null; controls: Rect;
  pause: Rect; stick: Rect; stickLabel: Rect; fire: Rect; boost: Rect; bomb: Rect; view: Rect;
  shipY: number; panelScale: number;
};
export type GuideLayout = { card: Rect; heading: Rect; body: Rect; actions: Rect; columns: 1 | 2 };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });

export function desktopLayout(width: number, height: number, safe: Insets): HudLayout {
  const compact = width <= 600;
  const margin = compact ? 9 : 18;
  const left = safe.left + margin, right = width - safe.right - margin;
  const usableWidth = right - left;
  const hud = rect(left, safe.top + (compact ? 9 : 14), usableWidth, compact ? 56 : 64);
  const boss = rect(left, hud.y + hud.height + 3, Math.min(460, usableWidth * 0.65), 12);
  const radioY = boss.y + boss.height + 6;
  const radarSize = compact ? 48 : 72;
  const radar = rect(right - radarSize, radioY, radarSize, radarSize);
  const radio = rect(left, radioY, Math.min(510, Math.max(0, radar.x - left - 8)), compact ? 76 : 72);
  const objectiveWidth = Math.min(500, usableWidth);
  const objective = rect(left + (usableWidth - objectiveWidth) / 2, radio.y + radio.height + 5, objectiveWidth, 24);
  const altY = objective.y + objective.height + 6, altWidth = compact ? 18 : 24;
  const altHeight = Math.min(height * 0.42, Math.max(0, height - safe.bottom - altY - 4));
  const alt = rect(right - altWidth, altY, altWidth, altHeight);
  return { hud, boss, radio, objective, radar, alt };
}

export function guideLayout(width: number, height: number, safe: Insets): GuideLayout {
  const margin = 16, border = 2;
  const usableWidth = width - safe.left - safe.right, usableHeight = height - safe.top - safe.bottom;
  const cardWidth = Math.min(740, Math.max(0, usableWidth - margin * 2));
  const columns = cardWidth >= 620 ? 2 : 1;
  const cardHeight = Math.min(columns === 2 ? 412 : 606, Math.max(0, usableHeight - margin * 2));
  const card = rect(safe.left + (usableWidth - cardWidth) / 2, safe.top + (usableHeight - cardHeight) / 2, cardWidth, cardHeight);
  const x = card.x + border, innerWidth = Math.max(0, card.width - border * 2);
  const innerHeight = Math.max(0, card.height - border * 2);
  const headingHeight = Math.min(56, Math.floor(innerHeight / 3));
  const actionsHeight = Math.min(64, Math.floor(innerHeight / 3));
  const heading = rect(x, card.y + border, innerWidth, headingHeight);
  const body = rect(x, heading.y + heading.height, innerWidth, innerHeight - headingHeight - actionsHeight);
  const actions = rect(x, body.y + body.height, innerWidth, actionsHeight);
  return { card, heading, body, actions, columns };
}

// CSS pixels; the canvas still covers the entire viewport, including the safe areas.
export function phoneLayout(width: number, height: number, safe: Insets, view: Segment): PhoneLayout {
  const portrait = height >= width, left = safe.left + 8, right = width - safe.right - 8, top = safe.top + 4;
  const usableWidth = right - left, hudWidth = portrait ? usableWidth : Math.min(340, Math.max(270, usableWidth * 0.4));
  const hud = rect(left, top, hudWidth, 56), boss = rect(left, top + 58, hudWidth, 8);
  const radio = portrait ? rect(left, top + 70, usableWidth, 58) : rect(left + hudWidth + 8, top, usableWidth - hudWidth - 8, 62);
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
    shipY: Math.round(playfield.y + playfield.height * (portrait ? 0.72 : 0.52)), panelScale };
}
