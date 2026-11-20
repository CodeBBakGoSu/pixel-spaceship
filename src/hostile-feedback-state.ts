import type { Segment } from './camera.ts';

const GRAZE_POPUP_MS = 480;
const GRAZE_POPUP_INTERVAL_MS = 150;

export function hitDirection(view: Segment, yaw: number, dx: number, dz: number, altitudeDelta: number): number {
  if (Math.abs(dx) + Math.abs(dz) < 0.01) return altitudeDelta < 0 ? Math.PI : 0;
  return Math.atan2(dx, dz) - (view === 'overhead' ? 0 : yaw);
}

export class GrazePopup {
  private lastEventAt = -Infinity;
  private count = 0;
  private pending = false;
  shownAt = -Infinity;

  add(now: number): void {
    this.count = now - this.lastEventAt < GRAZE_POPUP_MS ? this.count + 1 : 1;
    this.lastEventAt = now;
    this.pending = true;
  }

  take(now: number): number {
    if (!this.pending || now - this.shownAt < GRAZE_POPUP_INTERVAL_MS || now - this.lastEventAt >= GRAZE_POPUP_MS) return 0;
    this.pending = false;
    this.shownAt = now;
    return this.count;
  }

  active(now: number): boolean {
    return this.opacity(now) > 0 || (this.pending && now - this.lastEventAt < GRAZE_POPUP_MS);
  }

  opacity(now: number): number {
    return Math.max(0, Math.min(1, (this.shownAt + GRAZE_POPUP_MS - now) / 160));
  }

  reset(): void {
    this.lastEventAt = this.shownAt = -Infinity;
    this.count = 0;
    this.pending = false;
  }
}
