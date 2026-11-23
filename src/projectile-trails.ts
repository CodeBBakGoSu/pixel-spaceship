import type { Position, Shot } from './stage-types.ts';

export const PROJECTILE_TRAIL_CAP = 48;
const PHONE_TRAIL_CAP = 24;
const SAMPLE_TICKS = 3;
export const TRAIL_LIFETIME = 18;

type TrailStyle = 'bolt' | 'rocket';
type Sample = Position & { tick: number };
type Segment = { from: Position; to: Position; born: number; style: TrailStyle };

export function trailBudget(phone: boolean, low: boolean, reducedMotion: boolean): number {
  return reducedMotion ? 0 : (phone ? PHONE_TRAIL_CAP : PROJECTILE_TRAIL_CAP) >> Number(low);
}

export class ProjectileTrails {
  private last = new WeakMap<Shot, Sample>();
  private readonly segments: Segment[] = Array.from({ length: PROJECTILE_TRAIL_CAP }, () => ({
    from: { x: 0, z: 0, alt: 0 }, to: { x: 0, z: 0, alt: 0 }, born: -Infinity, style: 'bolt',
  }));
  private cursor = 0;
  private previousTick = -1;

  advance(shots: readonly Shot[], tick: number, twinRank: number, enabled: boolean): void {
    if (!enabled || tick < this.previousTick) {
      if (this.previousTick >= 0) {
        for (const segment of this.segments) segment.born = -Infinity;
        this.last = new WeakMap();
      }
      this.previousTick = -1;
    }
    if (!enabled || tick === this.previousTick) return;
    this.previousTick = tick;
    for (const shot of shots) {
      const rocket = shot.kind === 'seeker' && shot.rack;
      if (!rocket && (shot.kind !== 'twin' || shot.reversal || (twinRank < 6 && !shot.aurora))) continue;
      const before = this.last.get(shot);
      if (before && tick - before.tick < SAMPLE_TICKS) continue;
      if (before && tick - before.tick <= 9 && (before.x !== shot.x || before.z !== shot.z || before.alt !== shot.alt)) {
        const segment = this.segments[this.cursor];
        segment.from.x = before.x; segment.from.z = before.z; segment.from.alt = before.alt;
        segment.to.x = shot.x; segment.to.z = shot.z; segment.to.alt = shot.alt;
        segment.born = tick;
        segment.style = rocket ? 'rocket' : 'bolt';
        this.cursor = (this.cursor + 1) % PROJECTILE_TRAIL_CAP;
      }
      if (before) {
        before.x = shot.x; before.z = shot.z; before.alt = shot.alt; before.tick = tick;
      } else this.last.set(shot, { x: shot.x, z: shot.z, alt: shot.alt, tick });
    }
  }

  newest(index: number, tick: number): Segment | undefined {
    if (index < 0 || index >= PROJECTILE_TRAIL_CAP) return;
    const segment = this.segments[(this.cursor + PROJECTILE_TRAIL_CAP - 1 - index) % PROJECTILE_TRAIL_CAP];
    return tick - segment.born < TRAIL_LIFETIME ? segment : undefined;
  }
}
