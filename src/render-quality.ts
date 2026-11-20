import {
  DEFAULT_QUALITY, QUALITY_FRAME_BUDGET_MS, QUALITY_SAMPLE_FRAMES, QUALITY_SETTLE_FRAMES, QUALITY_TIERS,
  type RenderQuality,
} from './data/render-quality.ts';

const STORAGE_KEY = 'aster.render-quality';
const P95_INDEX = Math.ceil(QUALITY_SAMPLE_FRAMES * 0.95) - 1;

export function parseRenderQuality(value: string | null): RenderQuality | undefined {
  return QUALITY_TIERS.find(tier => tier === value);
}

export function initialRenderQuality(query: URLSearchParams, storage: Pick<Storage, 'getItem'>): RenderQuality {
  const override = parseRenderQuality(query.get('quality'));
  if (override) return override;
  try {
    return parseRenderQuality(storage.getItem(STORAGE_KEY)) ?? DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function saveRenderQuality(tier: RenderQuality, storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(STORAGE_KEY, tier); } catch { /* The session setting still applies. */ }
}

/** Owns only a renderer's effective tier. No gameplay state or clock is changed. */
export class AdaptiveQuality {
  private readonly samples = new Float64Array(QUALITY_SAMPLE_FRAMES);
  private count = 0;
  private settle = QUALITY_SETTLE_FRAMES;
  private index: number;

  constructor(tier: RenderQuality) {
    this.index = QUALITY_TIERS.indexOf(tier);
  }

  get tier(): RenderQuality { return QUALITY_TIERS[this.index]; }

  select(tier: RenderQuality): void {
    this.index = QUALITY_TIERS.indexOf(tier);
    this.resetSamples();
  }

  resetSamples(): void {
    this.count = 0;
    this.settle = QUALITY_SETTLE_FRAMES;
  }

  observe(milliseconds: number | null): boolean {
    if (milliseconds === null || !Number.isFinite(milliseconds)) {
      this.resetSamples();
      return false;
    }
    if (this.index === QUALITY_TIERS.length - 1 || milliseconds <= 0) return false;
    if (this.settle > 0) {
      this.settle--;
      return false;
    }
    this.samples[this.count++] = milliseconds;
    if (this.count < this.samples.length) return false;
    this.count = 0;
    this.samples.sort();
    // Subtracting frame timestamps can put 16.8 ms slightly above the threshold.
    const p95 = Math.round(this.samples[P95_INDEX] * 1000) / 1000;
    if (p95 <= QUALITY_FRAME_BUDGET_MS) return false;
    this.index++;
    this.resetSamples();
    return true;
  }
}
