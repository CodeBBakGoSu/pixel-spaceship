const IMPACT_WINDOW_MS = 80;
const THICK_HIT_COUNT = 3;
const GNAT_BURST_COUNT = 6;

export const IMPACT_LAYERS = ['impact_tick', 'impact_body', 'impact_spark'] as const;
export type ImpactCue = typeof IMPACT_LAYERS[number];

export class ImpactBatch {
  private until = Infinity;
  private hits = 0;
  private gnats = 0;
  private critical = false;

  hit(now: number, damage: number, critical: boolean): void {
    if (!Number.isFinite(damage) || damage <= 0) return;
    this.until = Math.min(this.until, now + IMPACT_WINDOW_MS);
    this.hits++;
    this.critical ||= critical;
  }

  destroyedGnat(now: number): void {
    this.until = Math.min(this.until, now + IMPACT_WINDOW_MS);
    this.gnats++;
  }

  // Drain before collecting the next frame's contacts.
  drain(now: number): number {
    if (now < this.until) return 0;
    const layers = Number(this.hits > 0) | (Number(this.hits >= THICK_HIT_COUNT) << 1)
      | (Number(this.critical || this.gnats >= GNAT_BURST_COUNT) << 2);
    this.clear();
    return layers;
  }

  clear(): void {
    this.until = Infinity;
    this.hits = this.gnats = 0;
    this.critical = false;
  }
}
