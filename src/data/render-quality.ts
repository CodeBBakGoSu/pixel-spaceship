export const QUALITY_TIERS = ['high', 'medium', 'low'] as const;
export type RenderQuality = (typeof QUALITY_TIERS)[number];
export const DEFAULT_QUALITY: RenderQuality = 'high';

export const RENDER_QUALITY = {
  high: { desktopDivisor: 1, phoneDivisor: 1, detailedModels: true },
  medium: { desktopDivisor: 2, phoneDivisor: null, detailedModels: true },
  low: { desktopDivisor: 3, phoneDivisor: 2, detailedModels: false },
} as const satisfies Record<RenderQuality, {
  desktopDivisor: number; phoneDivisor: number | null; detailedModels: boolean;
}>;

export const LEGACY_PHONE_BUFFER = {
  portraitWidth: 336, landscapeHeight: 288, minWidth: 256, maxWidth: 768,
} as const;
export const MEDIUM_PHONE_WIDTH_FRACTION = { min: 0.6, max: 0.9 } as const;
export const COMPARISON_DIVISOR = 1.5;

export const QUALITY_FRAME_BUDGET_MS = 16.8;
export const QUALITY_SAMPLE_FRAMES = 120;
export const QUALITY_SETTLE_FRAMES = 24;
