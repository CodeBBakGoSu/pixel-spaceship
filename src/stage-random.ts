import type { StageState } from './stage-types.ts';

// Mulberry32. Both the seed and advancing state belong to the sortie.
export function random(state: StageState): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let n = state.rng;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
