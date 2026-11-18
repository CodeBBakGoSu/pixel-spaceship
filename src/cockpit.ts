import { projectWorld, type CameraState, type Point, type Size } from './camera.ts';
import { wardenTargets, type Entity, type GameState } from './game.ts';
import type { createTranslator } from './i18n.ts';
import type { Rect } from './layout.ts';

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

export function headingTape(yaw: number, step: 15 | 30, t: ReturnType<typeof createTranslator>) {
  const degrees = heading(yaw * 180 / Math.PI);
  const bearing = t('cockpit.bearing', { value: threeDigits(heading(Math.round(degrees))) });
  const ticks: { offset: number; label: string }[] = [];
  for (let angle = Math.ceil((degrees - 60) / step) * step; angle <= degrees + 60; angle += step) {
    const tick = heading(angle);
    const label = tick % 90 === 0 ? t(cardinal[tick / 90]) : threeDigits(tick);
    ticks.push({ offset: angle - degrees, label });
  }
  return { bearing, ticks };
}

export function pitchLadder(center: Point, pitch: number, bank: number, span: number, pixelsPerDegree: number): PitchMark[] {
  const cos = Math.cos(bank), sin = Math.sin(bank);
  const rotate = (x: number, y: number): Point => ({
    x: center.x + x * cos + y * sin,
    y: center.y - x * sin + y * cos,
  });
  const marks: PitchMark[] = [];
  const middle = Math.round(pitch / 10) * 10;
  for (let angle = middle - 30; angle <= middle + 30; angle += 10) {
    const y = (pitch - angle) * pixelsPerDegree;
    const outer = angle === 0 ? span : span * 0.78;
    const gap = span * 0.3;
    marks.push({
      angle,
      left: { from: rotate(-outer, y), to: rotate(-gap, y) },
      right: { from: rotate(gap, y), to: rotate(outer, y) },
    });
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

export function cockpitAim(view: CockpitView, state: Pick<GameState, 'aimX' | 'aimY' | 'aspect'>): Point {
  const { camera, buffer, screen } = view;
  return {
    x: (buffer.width / 2 + state.aimX * 0.38 * state.aspect * buffer.height) * screen.width / buffer.width,
    y: screen.height * (0.42 + state.aimY * 0.27) + camera.pitch * 15 * screen.height / buffer.height,
  };
}

function isCombatTarget(kind: Entity['kind']): kind is CombatEntity {
  return kind === 'drone' || kind === 'supply' || kind === 'pylon' || kind === 'lock';
}

export function selectCockpitTarget(state: GameState, view: CockpitView, area: Rect, aim = cockpitAim(view, state)): CockpitTarget | null {
  const { camera, buffer, screen } = view;
  const { player } = state;
  let nearest: CockpitTarget | null = null, distance = Infinity;

  function consider(kind: CombatKind, x: number, z: number, alt: number): void {
    const range = Math.hypot(x - player.x, z - player.z, alt - player.altitude);
    if (range >= distance) return;
    const projected = projectWorld(camera, x, z, alt, buffer.width, buffer.height, 'cockpit');
    if (!projected) return;
    const point = { x: projected.x * screen.width / buffer.width, y: projected.y * screen.height / buffer.height };
    const inset = 12;
    if (point.x < area.x + inset || point.x > area.x + area.width - inset
      || point.y < area.y + inset || point.y > area.y + area.height - inset) return;
    const coneX = (point.x - aim.x) / (screen.width * 0.14);
    const coneY = (point.y - aim.y) / (screen.height * 0.14);
    nearest = { kind, point, altitude: alt, range: Math.round(range), locked: range <= 230 && coneX * coneX + coneY * coneY <= 1 };
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

export function cockpitWarnings(state: Pick<GameState, 'hull' | 'maxHull' | 'biome' | 'boosting' | 'bst'>, clearance: number, climb: number): CockpitWarnings {
  const lowHull = state.hull <= state.maxHull / 4;
  const terrain = state.biome === 'space' || clearance > 40 ? null
    : clearance <= 26 || (clearance <= 34 && climb < -4) ? 'pullUp' : 'altLow';
  const boost = !state.boosting || state.bst <= 0 ? null : state.bst <= 0.25 ? 'low' : 'active';
  return { master: lowHull || terrain !== null || boost === 'low', lowHull, terrain, boost };
}
