import { aceDodgeWindow } from './ace.ts';
import { ACE } from './data/ace.ts';
import type { Rect } from './layout.ts';
import type { AceTell, StageState } from './stage-types.ts';

export type Sight = { x: number; y: number; radius: number };
type Projection = { projectAirframe(state: StageState, subject: 'player' | 'boss'): Sight | null };

export const bracketRadius = (radius: number, progress: number) => radius + 16 * (1 - progress);

function stroke(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = '#17202b';
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function drawAceLocks(ctx: CanvasRenderingContext2D, state: StageState, projection: Projection, field?: Rect,
  firedTell?: AceTell | null): void {
  const boss = state.boss;
  if (!boss?.hp || boss.entry || state.phase !== 'playing' || state.paused) return;
  const lock = state.view !== 'cockpit' && state.lock?.id === boss.id ? state.lock : null;
  const tell = boss.tell;
  const incoming = tell && tell.kind !== 'roll'
    && (state.tick <= tell.until || tell.dodgeGraceUntil !== undefined && state.tick <= tell.dodgeGraceUntil);
  const sightTell = incoming ? tell : firedTell ?? null;
  if (!lock && !sightTell) return;

  ctx.save();
  if (field) {
    ctx.beginPath();
    ctx.rect(field.x, field.y, field.width, field.height);
    ctx.clip();
  }
  const limit = Math.min(field?.width ?? ctx.canvas.width, field?.height ?? ctx.canvas.height) * 0.28;
  if (lock) {
    const point = projection.projectAirframe(state, 'boss');
    if (point) {
      const r = bracketRadius(Math.min(limit, Math.max(11, point.radius + 3)), lock.progress);
      const arm = Math.min(14, r / 2);
      ctx.beginPath();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ctx.moveTo(point.x + sx * (r - arm), point.y + sy * r);
        ctx.lineTo(point.x + sx * r, point.y + sy * r);
        ctx.lineTo(point.x + sx * r, point.y + sy * (r - arm));
      }
      stroke(ctx, lock.ready ? '#adfff0' : '#64dfce', lock.ready ? 3 : 2);
    }
  }
  if (sightTell) {
    // There is no visible player model in first person; frame the flight glass instead.
    const point = state.view === 'cockpit' && field
      ? { x: field.x + field.width / 2, y: field.y + field.height / 2, radius: 25 }
      : projection.projectAirframe(state, 'player');
    if (point) {
      const duration = Math.max(1, sightTell.until - sightTell.since);
      const dodgeTicks = Math.min(ACE.lock.dodgeTicks, duration);
      const remaining = Math.max(0, Math.min(duration, sightTell.until - state.tick));
      const referenceRadius = Math.min(limit, Math.max(4, Math.min(22, limit * 0.2)));
      const enclosurePadding = Math.max(4, referenceRadius * 0.25);
      const maxOuterRadius = Math.min(limit, Math.max(referenceRadius * 2.25, point.radius + enclosurePadding));
      const maxGap = Math.max(0, maxOuterRadius - referenceRadius);
      const windowGap = Math.min(maxGap, Math.max(1.5, referenceRadius * 0.25));
      const preWindowTicks = Math.max(1, duration - dodgeTicks);
      const preWindowProgress = duration > dodgeTicks ? (duration - remaining) / preWindowTicks : 1;
      const gap = remaining >= dodgeTicks
        ? windowGap + (1 - preWindowProgress) ** 2 * (maxGap - windowGap)
        : windowGap * remaining / dodgeTicks;
      const outerRadius = referenceRadius + gap;
      const dodge = aceDodgeWindow(sightTell, state.tick)
        || sightTell.dodgeGraceUntil !== undefined && state.tick <= sightTell.dodgeGraceUntil;
      ctx.beginPath();
      if (!dodge) ctx.setLineDash([9, 5]);
      else ctx.setLineDash([]);
      ctx.arc(point.x, point.y, outerRadius, 0, Math.PI * 2);
      stroke(ctx, dodge ? '#ff705c' : '#ffb77c', dodge ? 3.5 : 2.5);
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.arc(point.x, point.y, referenceRadius, 0, Math.PI * 2);
      stroke(ctx, dodge ? '#f2fff8' : '#7de8d7', 2);
    }
  }
  ctx.restore();
}
