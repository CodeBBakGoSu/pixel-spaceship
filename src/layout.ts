import type { Segment } from './camera.ts';

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type HudLayout = { hud: Rect; boss: Rect; radio: Rect; objective: Rect; radar: Rect; alt: Rect };
export type CockpitLayout = {
  compact: boolean;
  panelScale: number;
  glass: Rect; heading: Rect; speed: Rect; altitude: Rect; aiming: Rect; stores: Rect | null;
  message: Rect; help: Rect | null;
  dashboard: Rect; warnings: Rect; radar: Rect; damage: Rect; weapons: Rect; gauges: Rect;
};
export type PhoneLayout = HudLayout & {
  orientation: 'portrait' | 'landscape'; buffer: { width: number; height: number };
  playfield: Rect; dashboard: Rect | null; controls: Rect;
  pause: Rect; stick: Rect; stickLabel: Rect; loop: Rect; boost: Rect; bomb: Rect; flare: Rect; view: Rect;
  shipY: number; cockpit: CockpitLayout | null;
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
  const radarSize = compact ? 62 : 88;
  const radar = rect(right - radarSize, radioY, radarSize, radarSize);
  const radio = rect(left, radioY, Math.min(510, Math.max(0, radar.x - left - 8)), compact ? 70 : 88);
  const objectiveWidth = Math.min(500, usableWidth);
  const objective = rect(left + (usableWidth - objectiveWidth) / 2, radio.y + radio.height + 5, objectiveWidth, 24);
  const altY = objective.y + objective.height + 6, altWidth = compact ? 34 : 46;
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

export function cockpitLayout(width: number, height: number, safe: Insets, objective: Rect, controls?: Rect): CockpitLayout {
  const portrait = height >= width, short = height < 480, compact = width < 620 || short;
  const availableWidth = width - safe.left - safe.right;
  const bottom = controls?.y ?? height - safe.bottom;
  const standardHeight = clamp(Math.round(height * 0.24), 110, 176);
  // Reserve the canopy and its tapes before widening and raising the desktop rack.
  const panelSpace = bottom - objective.y - objective.height - 230;
  const panelScale = controls || portrait || compact ? 1 : clamp(panelSpace / standardHeight, 1, 1.34);
  const heightWanted = portrait ? clamp(Math.round(width * 0.23), 82, 105)
    : short && controls ? 52 : Math.round(standardHeight * panelScale);
  const dashboard = rect(safe.left, bottom - heightWanted, availableWidth, heightWanted);
  const help = controls ? null : rect(safe.left + 10, dashboard.y - 21, availableWidth - 20, 17);
  const messageHeight = short ? 16 : 22;
  const message = rect(safe.left + 10, (help?.y ?? dashboard.y) - messageHeight - 3, availableWidth - 20, messageHeight);

  const glassInset = compact ? 12 : clamp(Math.round(width * 0.052), 32, 78);
  const glassTop = objective.y + objective.height + 5;
  const glass = rect(safe.left + glassInset, glassTop, availableWidth - 2 * glassInset, Math.max(0, message.y - 3 - glassTop));
  const headingHeight = Math.min(compact ? 28 : 34, Math.floor(glass.height * 0.52));
  const headingWidth = Math.min(compact ? 180 : 294, glass.width);
  const heading = rect(glass.x + (glass.width - headingWidth) / 2, glass.y, headingWidth, headingHeight);
  const storesHeight = compact ? 16 : 19;
  const stores = glass.height >= 125 ? rect(heading.x, glass.y + glass.height - storesHeight, heading.width, storesHeight) : null;
  const aimingTop = heading.y + heading.height + 3;
  const aimingBottom = stores ? stores.y - 4 : glass.y + glass.height;
  const aimingHeight = Math.max(0, aimingBottom - aimingTop);
  const tapeWidth = compact ? 44 : 73, tapeHeight = Math.min(compact ? 112 : 154, aimingHeight);
  const tapeY = aimingTop + (aimingHeight - tapeHeight) * 0.44;
  const speed = rect(glass.x, tapeY, tapeWidth, tapeHeight);
  const altitude = rect(glass.x + glass.width - tapeWidth, tapeY, tapeWidth, tapeHeight);
  const aiming = rect(glass.x + tapeWidth + 5, aimingTop, glass.width - 2 * (tapeWidth + 5), aimingHeight);

  const rackWidth = Math.min(Math.round(1040 * panelScale), availableWidth - (compact ? 12 : 80));
  const rackX = Math.round(safe.left + (availableWidth - rackWidth) / 2);
  const warnings = rect(rackX, dashboard.y + (compact ? 3 : 8), rackWidth, short ? 12 : compact ? 16 : 22 * panelScale);
  const panelTop = warnings.y + warnings.height + (compact ? 3 : 8);
  const panelHeight = bottom - panelTop - (compact ? 4 : 14);
  const gap = compact ? 4 : 10, columnSpace = rackWidth - 3 * gap;
  const radarWidth = Math.round(columnSpace * (compact ? 0.235 : 0.25));
  const damageWidth = Math.round(columnSpace * 0.23);
  const weaponsWidth = Math.round(columnSpace * (compact ? 0.3 : 0.25));
  const radar = rect(rackX, panelTop, radarWidth, panelHeight);
  const damage = rect(radar.x + radar.width + gap, panelTop, damageWidth, panelHeight);
  const weapons = rect(damage.x + damage.width + gap, panelTop, weaponsWidth, panelHeight);
  const gauges = rect(weapons.x + weapons.width + gap, panelTop, columnSpace - radarWidth - damageWidth - weaponsWidth, panelHeight);
  return { compact, panelScale, glass, heading, speed, altitude, aiming, stores, message, help, dashboard, warnings, radar, damage, weapons, gauges };
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
  const bufferWidth = portrait ? 288 : clamp(Math.round(288 * width / height), 256, 768);
  const buffer = { width: bufferWidth, height: Math.round(bufferWidth * height / width) };
  const cockpit = view === 'cockpit' ? cockpitLayout(width, height, safe, objective, controls) : null;
  const dashboard = cockpit?.dashboard ?? null;
  const fieldTop = objective.y + objective.height + 4, fieldBottom = dashboard ? dashboard.y : controls.y;
  const playfield = rect(left, fieldTop, usableWidth, Math.max(0, fieldBottom - fieldTop));
  const radarSize = Math.min(76, Math.max(20, playfield.height - 8));
  const alt = rect(right - 30, fieldTop + 2, 30, Math.max(0, playfield.height - 4));
  const radar = rect(alt.x - 4 - radarSize, fieldTop + 4, radarSize, radarSize);
  const pause = rect(hud.x + hud.width - 44, hud.y + 6, 44, 44);
  const stickSize = portrait ? clamp(Math.round(width * 0.25), 88, 100) : 80;
  const stick = rect(controls.x + 12, controls.y + (controls.height - stickSize) / 2 + 3, stickSize, stickSize);
  const stickLabel = rect(stick.x, stick.y - 14, stick.width, 10);
  const loopSize = portrait ? clamp(Math.round(width * 0.2), 68, 78) : 64;
  const side = controls.x + controls.width - 8;
  const loop = rect(side - loopSize, controls.y + controls.height - 8 - loopSize, loopSize, loopSize);
  const boost = rect(side - 52, controls.y + 6, 52, 52);
  const bomb = rect(boost.x - 8 - 48, controls.y + 8, 48, 48);
  const flare = rect(bomb.x - 8 - bomb.width, bomb.y, bomb.width, bomb.height);
  const viewButton = rect(loop.x - 8 - 52, controls.y + controls.height - 8 - 52, 52, 52);
  return { orientation: portrait ? 'portrait' : 'landscape', buffer, hud, boss, radio, objective, playfield, dashboard, controls,
    radar, alt, pause, stick, stickLabel, loop, boost, bomb, flare, view: viewButton,
    shipY: Math.round(playfield.y + playfield.height * (portrait ? 0.72 : 0.52)), cockpit };
}
