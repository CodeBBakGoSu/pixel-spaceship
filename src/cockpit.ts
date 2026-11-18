import { projectWorld, type CameraState, type Point, type Size } from './camera.ts';
import { wardenTargets, type Entity, type GameState } from './game.ts';
import type { createTranslator, Language } from './i18n.ts';
import type { CockpitLayout, Rect } from './layout.ts';

export type CockpitView = { camera: CameraState; buffer: Size; screen: Size };
export type CockpitMotion = { speed: number; climb: number; bank: number; turn: number };
type Line = { from: Point; to: Point };
type PitchMark = { angle: number; left: Line; right: Line };
type CombatEntity = 'drone' | 'supply' | 'pylon' | 'lock';
type CombatKind = CombatEntity | 'pod' | 'core';
export type CockpitTarget = { kind: CombatKind; point: Point; altitude: number; range: number; locked: boolean };
export type CockpitWarnings = {
  master: boolean; lowHull: boolean; terrain: 'altLow' | 'pullUp' | null; boost: 'active' | 'low' | null;
};

const cardinal = ['cockpit.north', 'cockpit.east', 'cockpit.south', 'cockpit.west'] as const;
const heading = (degrees: number) => (degrees % 360 + 360) % 360;
const threeDigits = (value: number) => String(value).padStart(3, '0');

export function cockpitCacheKey(layout: CockpitLayout, width: number, height: number, language: Language): string {
  return JSON.stringify([width, height, language, layout]);
}

export function cockpitMfdDue(previous: number | null, elapsed: number): boolean {
  return previous === null || elapsed < previous || elapsed - previous >= 1 / 20 - 1e-6;
}

export const cockpitHeadingDegrees = (yaw: number) => heading(yaw * 180 / Math.PI);

export function headingTickLabel(angle: number, t: ReturnType<typeof createTranslator>): string {
  const tick = heading(angle);
  return tick % 90 === 0 ? t(cardinal[tick / 90]) : threeDigits(tick);
}

export function headingTape(yaw: number, step: 15 | 30, t: ReturnType<typeof createTranslator>) {
  const degrees = cockpitHeadingDegrees(yaw);
  const bearing = t('cockpit.bearing', { value: threeDigits(heading(Math.round(degrees))) });
  const ticks: { offset: number; label: string }[] = [];
  for (let angle = Math.ceil((degrees - 60) / step) * step; angle <= degrees + 60; angle += step) {
    ticks.push({ offset: angle - degrees, label: headingTickLabel(angle, t) });
  }
  return { bearing, ticks };
}

export function pitchLadder(center: Point, pitch: number, bank: number, span: number, pixelsPerDegree: number, marks: PitchMark[] = []): PitchMark[] {
  const cos = Math.cos(bank), sin = Math.sin(bank);
  const middle = Math.round(pitch / 10) * 10;
  const gap = span * 0.3;
  for (let i = 0; i < 7; i++) {
    const angle = middle - 30 + i * 10;
    const y = (pitch - angle) * pixelsPerDegree;
    const outer = angle === 0 ? span : span * 0.78;
    const mark = marks[i] ?? (marks[i] = {
      angle, left: { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      right: { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
    });
    mark.angle = angle;
    // Keep the same subpixel anchors for both the integer lines and their labels.
    mark.left.from.x = center.x - outer * cos + y * sin;
    mark.left.from.y = center.y + outer * sin + y * cos;
    mark.left.to.x = center.x - gap * cos + y * sin;
    mark.left.to.y = center.y + gap * sin + y * cos;
    mark.right.from.x = center.x + gap * cos + y * sin;
    mark.right.from.y = center.y - gap * sin + y * cos;
    mark.right.to.x = center.x + outer * cos + y * sin;
    mark.right.to.y = center.y - outer * sin + y * cos;
  }
  return marks;
}

export function measureCockpitMotion(previous: GameState, state: GameState, motion: CockpitMotion, dt: number): CockpitMotion {
  if (state.elapsed < previous.elapsed) return { speed: 0, climb: 0, bank: 0, turn: 0 };
  if (state.phase !== 'playing' || state.elapsed === previous.elapsed || state.segment !== previous.segment) return motion;
  const { player } = state, before = previous.player;
  const yawDelta = player.yaw - before.yaw;
  const trim = previous.elapsed === 0 ? 1 : 1 - Math.exp(-dt * 8);
  const ease = (value: number, sample: number) => value + (sample - value) * trim;
  return {
    speed: ease(motion.speed, Math.hypot(player.x - before.x, player.z - before.z) / dt),
    climb: ease(motion.climb, (player.altitude - before.altitude) / dt),
    bank: ease(motion.bank, player.bank),
    turn: ease(motion.turn, Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta)) / dt),
  };
}

export function cockpitAim(view: CockpitView, state: Pick<GameState, 'aimX' | 'aimY' | 'aspect'>, point: Point = { x: 0, y: 0 }): Point {
  const { camera, buffer, screen } = view;
  point.x = (buffer.width / 2 + state.aimX * 0.38 * state.aspect * buffer.height) * screen.width / buffer.width;
  point.y = screen.height * (0.42 + state.aimY * 0.27) + camera.pitch * 15 * screen.height / buffer.height;
  return point;
}

function isCombatTarget(kind: Entity['kind']): kind is CombatEntity {
  return kind === 'drone' || kind === 'supply' || kind === 'pylon' || kind === 'lock';
}

export function selectCockpitTarget(state: GameState, view: CockpitView, area: Rect, aim = cockpitAim(view, state), result?: CockpitTarget): CockpitTarget | null {
  const { camera, buffer, screen } = view;
  const { player } = state;
  let nearest: CockpitTarget | null = null, distance = Infinity;

  function consider(kind: CombatKind, x: number, z: number, alt: number): void {
    const range = Math.hypot(x - player.x, z - player.z, alt - player.altitude);
    if (range >= distance) return;
    const projected = projectWorld(camera, x, z, alt, buffer.width, buffer.height, 'cockpit');
    if (!projected) return;
    const px = projected.x * screen.width / buffer.width, py = projected.y * screen.height / buffer.height;
    const inset = 12;
    if (px < area.x + inset || px > area.x + area.width - inset
      || py < area.y + inset || py > area.y + area.height - inset) return;
    const coneX = (px - aim.x) / (screen.width * 0.14);
    const coneY = (py - aim.y) / (screen.height * 0.14);
    nearest = result ?? nearest ?? { kind, point: { x: 0, y: 0 }, altitude: 0, range: 0, locked: false };
    nearest.kind = kind;
    nearest.point.x = px;
    nearest.point.y = py;
    nearest.altitude = alt;
    nearest.range = Math.round(range);
    nearest.locked = range <= 230 && coneX * coneX + coneY * coneY <= 1;
    distance = range;
  }

  for (const entity of state.entities) {
    if (entity.hp > 0 && isCombatTarget(entity.kind)) consider(entity.kind, entity.x, entity.z, entity.alt);
  }
  if (state.boss.active && state.boss.coreHp > 0) {
    for (const target of wardenTargets(state)) consider(target.kind, target.x, target.z, target.alt);
  }
  return nearest;
}

export function cockpitWarnings(state: Pick<GameState, 'hull' | 'maxHull' | 'biome' | 'boosting' | 'bst'>, clearance: number, climb: number,
  result: CockpitWarnings = { master: false, lowHull: false, terrain: null, boost: null }): CockpitWarnings {
  const lowHull = state.hull <= state.maxHull / 4;
  const terrain = state.biome === 'space' || clearance > 40 ? null
    : clearance <= 26 || (clearance <= 34 && climb < -4) ? 'pullUp' : 'altLow';
  const boost = !state.boosting || state.bst <= 0 ? null : state.bst <= 0.25 ? 'low' : 'active';
  result.master = lowHull || terrain !== null || boost === 'low';
  result.lowHull = lowHull;
  result.terrain = terrain;
  result.boost = boost;
  return result;
}
