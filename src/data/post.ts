export const POST = {
  vivid: 0.2,
  contrast: 0.1,
  bloom: {
    downscale: 2,
    amount: 0.76,
    peak: [0.74, 0.98],
    chroma: [0.42, 0.64],
  },
  vignette: {
    strength: [0.25, 0.4],
    innerRadius: [0.72, 0.51],
    outerRadius: 1.23,
  },
  haze: { steps: 10, smoothVisibleFraction: 0.865 },
  cloudFlash: 0.4,
  grain: { enabled: false, amount: 0.025 },
} as const;
