type Rng = { rng: number };

// Mulberry32. Both the seed and advancing state belong to the sortie.
export function random(state: Rng): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let n = state.rng;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}

export function rngStream(seed: number, name: string): Rng {
  let key = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) key = Math.imul(key ^ name.charCodeAt(i), 16777619);
  const stream = { rng: key >>> 0 };
  return { rng: (random(stream) * 4294967296) >>> 0 };
}
