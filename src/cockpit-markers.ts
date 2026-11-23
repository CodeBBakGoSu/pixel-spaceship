import { cockpitTarget } from './cockpit.ts';
import { bracketRadius } from './ace-sights.ts';
import type { ContactProjection } from './contact-projection.ts';
import type { RearDanger, RearPursuit } from './instruments.ts';
import type { CockpitLayout, Rect } from './layout.ts';
import { activeTrail, formerPursuer } from './maneuvers.ts';
import { activeAce } from './stage.ts';
import { clamp, inBand } from './stage-combat.ts';
import type { Position, StageState } from './stage-types.ts';

export type CockpitMarker = {
  id: number; x: number; y: number; angle: number;
  placement: 'forward' | 'edge' | 'rear';
  range: number; delta: number; opacity: number; color: string;
  boxed: boolean; former: boolean; ace: boolean; locked: boolean; lockProgress: number; danger: boolean;
};
type ContactSource = { projectContact(contact: Position, out: ContactProjection): void };
const TRACK_RANGE = 420;
const arrowRadius = 9;

const newMarker = (): CockpitMarker => ({
  id: 0, x: 0, y: 0, angle: 0, placement: 'forward', range: 0, delta: 0, opacity: 1, color: '',
  boxed: false, former: false, ace: false, locked: false, lockProgress: 0, danger: false,
});
const nearest = (a: CockpitMarker, b: CockpitMarker) => a.range - b.range || a.id - b.id;
const forwardPriority = (a: CockpitMarker, b: CockpitMarker) =>
  Number(b.boxed) - Number(a.boxed) || Number(b.former) - Number(a.former) || nearest(a, b);

export function markerRadius(marker: CockpitMarker, compact: boolean): number {
  if (marker.placement !== 'forward') return arrowRadius;
  const radius = marker.boxed ? compact ? 9 : 11 : compact ? 5 : 6;
  return marker.ace && marker.lockProgress > 0 ? bracketRadius(radius, marker.lockProgress) : radius;
}

function contains(rect: Readonly<Rect>, x: number, y: number, padding: number): boolean {
  return x > rect.x - padding && x < rect.x + rect.width + padding
    && y > rect.y - padding && y < rect.y + rect.height + padding;
}

export class CockpitMarkers {
  private readonly pool: CockpitMarker[] = [];
  private readonly forward: CockpitMarker[] = [];
  private readonly edges: CockpitMarker[] = [];
  private readonly selected: CockpitMarker[] = [];
  private readonly blockers: Readonly<Rect>[] = [];
  private readonly status: Rect = { x: 0, y: 0, width: 50, height: 17 };
  private readonly projected: ContactProjection = { x: 0, y: 0, depth: 0 };
  private readonly bounds = { left: 0, right: 0, top: 0, bottom: 0 };

  get obstructions(): readonly Readonly<Rect>[] { return this.blockers; }

  snapshot(): ReadonlyArray<Readonly<CockpitMarker>> {
    return this.selected.map(marker => ({ ...marker }));
  }

  update(state: StageState, layout: CockpitLayout, source: ContactSource, mirror: Readonly<Rect> | null,
    danger: RearDanger | null = null, pursuit: RearPursuit | null = null): readonly CockpitMarker[] {
    const { aiming, compact } = layout;
    this.selected.length = this.forward.length = this.edges.length = this.blockers.length = 0;
    if (aiming.width < 30 || aiming.height < 22) return this.selected;

    const inset = compact ? 12 : 14, verticalInset = Math.min(inset, Math.floor(aiming.height / 2) - 1);
    const bounds = this.bounds;
    bounds.left = aiming.x + inset;
    bounds.right = aiming.x + aiming.width - inset;
    bounds.top = aiming.y + verticalInset;
    bounds.bottom = aiming.y + aiming.height - verticalInset;
    if (mirror) this.blockers.push(mirror);
    if (state.maneuver && state.maneuver.kind !== 'j-turn') {
      this.status.x = aiming.x + (aiming.width - this.status.width) / 2;
      this.status.y = aiming.y;
      this.blockers.push(this.status);
    }

    const player = state.player, trail = activeTrail(state), ace = activeAce(state);
    let rear: CockpitMarker | null = null, used = 0;
    const scan = (target: Position & { id: number }, former: boolean, ace: boolean, firing: boolean, urgent = false) => {
      const range = Math.hypot(target.x - player.x, target.z - player.z);
      if (range > TRACK_RANGE) return;
      source.projectContact(target, this.projected);
      const { x, y, depth } = this.projected;
      const marker = this.pool[used] ??= newMarker();
      used++;
      marker.id = target.id;
      marker.x = x;
      marker.y = y;
      marker.angle = 0;
      marker.range = range;
      marker.delta = target.alt - player.altitude;
      marker.former = former;
      marker.ace = ace;
      marker.locked = false;
      marker.lockProgress = 0;
      marker.boxed = false;
      marker.danger = urgent;
      marker.opacity = clamp(1 - (range - 130) / 440, former ? 0.7 : 0.34, 1);
      const sameBand = inBand(target.alt, player.altitude);
      marker.color = firing || (sameBand && range < 70) ? '#ff8a7d' : ace || sameBand ? '#ffd593'
        : marker.delta > 0 ? '#abddff' : '#c2bcff';

      if (urgent || depth <= 0.05) {
        marker.placement = 'rear';
        marker.color = urgent ? '#ff8772' : sameBand ? '#c6d8ce' : marker.delta > 0 ? '#abddff' : '#c2bcff';
        if (!rear || urgent || (!rear.danger && nearest(marker, rear) < 0)) rear = marker;
      } else if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
        && !this.blocked(x, y, inset)) {
        marker.placement = 'forward';
        this.forward.push(marker);
      } else if (this.placeEdge(marker)) {
        marker.placement = 'edge';
        this.edges.push(marker);
      }
    };
    for (const enemy of state.enemies) if (enemy.hp > 0) {
      scan(enemy, formerPursuer(state, trail, enemy), false, !!enemy.tell || enemy.maneuver?.phase === 'diving',
        danger?.kind === 'contact' ? enemy.id === danger.enemyId : enemy.id === pursuit?.id);
    }
    // --- S7e lane ---
    if (ace) scan(ace, false, true, !!ace.tell, !danger && pursuit?.id === ace.id);
    if (danger?.kind === 'shot') scan({ ...danger, id: -1 }, false, false, false, true);

    this.forward.sort(nearest);
    const box = this.forward.find(marker => marker.id === (state.lock?.id ?? ace?.id)) ?? this.forward[0];
    if (box) {
      const target = cockpitTarget(box, box, aiming, state.lock, verticalInset);
      box.boxed = true;
      box.locked = target?.locked ?? false;
      box.lockProgress = target?.progress ?? 0;
      box.opacity = Math.max(0.7, box.opacity);
      this.selected.push(box);
    }
    if (rear) this.placeRear(rear, compact);

    this.edges.sort(nearest);
    // Keep one slot for off-screen information even if the center is crowded.
    const firstArrow = this.edges.find(marker => this.add(marker, compact));
    const capacity = compact ? 5 : 8, edgeLimit = compact ? 2 : 3;
    this.forward.sort(forwardPriority);
    for (const marker of this.forward) {
      if (this.selected.length === capacity) break;
      if (marker !== box) this.add(marker, compact);
    }
    let arrows = firstArrow ? 1 : 0;
    for (const marker of this.edges) {
      if (this.selected.length === capacity || arrows === edgeLimit) break;
      if (marker !== firstArrow && this.add(marker, compact)) arrows++;
    }
    return this.selected;
  }

  private blocked(x: number, y: number, padding: number): boolean {
    return this.blockers.some(rect => contains(rect, x, y, padding));
  }

  private add(marker: CockpitMarker, compact: boolean): boolean {
    const radius = markerRadius(marker, compact);
    for (const other of this.selected) {
      const spacing = radius + markerRadius(other, compact) + 4;
      if (Math.abs(other.x - marker.x) < spacing && Math.abs(other.y - marker.y) < spacing) return false;
    }
    this.selected.push(marker);
    return true;
  }

  private placeRear(marker: CockpitMarker, compact: boolean): void {
    const { left, right, bottom } = this.bounds, center = (left + right) / 2;
    marker.y = bottom;
    marker.angle = Math.PI / 2;
    for (let step = 0; step < 3; step++) {
      marker.x = clamp(center + (step === 1 ? -34 : step === 2 ? 34 : 0), left, right);
      if (!this.blocked(marker.x, marker.y, arrowRadius) && this.add(marker, compact)) return;
    }
  }

  private placeEdge(marker: CockpitMarker): boolean {
    const { left, right, top, bottom } = this.bounds;
    const x = marker.x, y = marker.y, centerX = (left + right) / 2, centerY = (top + bottom) / 2;
    const across = x - centerX, down = y - centerY;
    const nx = Math.abs(across) / (right - centerX), ny = Math.abs(down) / (bottom - centerY);
    const scale = 1 / Math.max(nx, ny);
    if (!Number.isFinite(scale)) return false;
    marker.x = centerX + across * scale;
    marker.y = centerY + down * scale;

    // Slide along the edge when the mirror or flight status occupies the intersection.
    for (const rect of this.blockers) {
      if (!contains(rect, marker.x, marker.y, arrowRadius)) continue;
      const side = nx >= ny, at = side ? marker.y : marker.x;
      const min = side ? top : left, max = side ? bottom : right;
      const end = side ? rect.y - arrowRadius : rect.x - arrowRadius;
      const start = end + (side ? rect.height : rect.width) + 2 * arrowRadius;
      const before = end >= min, after = start <= max;
      if (!before && !after) return false;
      const shift = before && (!after || at - end < start - at) ? end : start;
      if (side) marker.y = shift;
      else marker.x = shift;
    }
    marker.angle = Math.atan2(y - marker.y, x - marker.x);
    // A contact just inside the frame may have been moved here to read around a blocker.
    return !this.blocked(marker.x, marker.y, arrowRadius);
  }
}
