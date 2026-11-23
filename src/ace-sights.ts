import { aceDodgeWindow } from './ace.ts';
import type { Rect } from './layout.ts';
import type { StageState } from './stage-types.ts';

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

export function drawAceLocks(ctx: CanvasRenderingContext2D, state: StageState, projection: Projection, field?: Rect): void {
  const boss = state.boss;
  if (!boss?.hp || boss.entry || state.phase !== 'playing' || state.paused) return;
  const lock = state.view !== 'cockpit' && state.lock?.id === boss.id ? state.lock : null;
  const tell = boss.tell;
  const incoming = tell && tell.kind !== 'roll' && state.tick < tell.until;
  if (!lock && !incoming) return;

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
  if (incoming) {
    // There is no visible player model in first person; frame the flight glass instead.
    const point = state.view === 'cockpit' && field
      ? { x: field.x + field.width / 2, y: field.y + field.height / 2, radius: 25 }
      : projection.projectAirframe(state, 'player');
    if (point) {
      const inner = Math.min(limit, Math.max(17, point.radius + 3));
      const remaining = (tell.until - state.tick) / (tell.until - tell.since);
      const r = inner + remaining * Math.min(38, limit / 2);
      const dodge = aceDodgeWindow(tell, state.tick);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2, dx = Math.cos(angle), dy = Math.sin(angle);
        ctx.moveTo(point.x + dx * (inner - 3), point.y + dy * (inner - 3));
        ctx.lineTo(point.x + dx * (inner + 4), point.y + dy * (inner + 4));
      }
      stroke(ctx, '#ffdfb1', 2);
      ctx.beginPath();
      if (!dodge) ctx.setLineDash([9, 5]);
      ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
      stroke(ctx, dodge ? '#ff705c' : '#ffb77c', dodge ? 3 : 2);
    }
  }
  ctx.restore();
}
