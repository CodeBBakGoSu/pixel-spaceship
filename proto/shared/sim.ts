export const BANDS = [75, 110, 145] as const;
export type ViewName = 'top' | 'chase' | 'cockpit';

export type ProtoOptions = { n: number; view: ViewName; seed: number };

export function parseOptions(search = typeof location !== 'undefined' ? location.search : ''): ProtoOptions {
  const q = new URLSearchParams(search);
  const rawN = Number(q.get('n'));
  const n = Number.isFinite(rawN) ? Math.max(1, Math.min(8000, Math.floor(rawN))) : 500;
  const v = q.get('view');
  const view: ViewName = v === 'chase' || v === 'cockpit' ? v : v === 'overhead' || v === 'top' ? 'top' : 'chase';
  const seedRaw = q.get('seed');
  const seed = seedRaw !== null && /^-?\d+$/.test(seedRaw) ? Number(seedRaw) >>> 0 : 1;
  return { n, view, seed };
}

export function cycleView(view: ViewName): ViewName {
  return view === 'top' ? 'chase' : view === 'chase' ? 'cockpit' : 'top';
}

/** Gentle rolling heightmap, peaks well below the low flight band. */
export function terrainHeight(x: number, z: number): number {
  return 18 + 7 * Math.sin(x * 0.018) * Math.cos(z * 0.015) + 4 * Math.sin((x + z) * 0.011);
}

export type SimState = {
  time: number;
  view: ViewName;
  n: number;
  seed: number;
  player: { x: number; z: number; alt: number; yaw: number };
  /** packed [x, z, alt, bandIndex] * n */
  enemies: Float32Array;
  /** packed [x, z, alt, vx, vz, life] * maxBullets */
  bullets: Float32Array;
  bulletCount: number;
  fireAcc: number;
};

export const MAX_BULLETS = 400;
const ARENA = 420;
const ENEMY_SPEED = 38;
const BULLET_SPEED = 220;
const BULLET_LIFE = 1.6;
const FIRE_INTERVAL = 0.048;
const SHOTS_PER_BURST = 2;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createSim(options: ProtoOptions = parseOptions('')): SimState {
  const rand = mulberry(options.seed);
  const enemies = new Float32Array(options.n * 4);
  for (let i = 0; i < options.n; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 40 + rand() * ARENA;
    const band = i % 3;
    enemies[i * 4] = Math.sin(ang) * dist;
    enemies[i * 4 + 1] = Math.cos(ang) * dist;
    enemies[i * 4 + 2] = BANDS[band] + (rand() - 0.5) * 6;
    enemies[i * 4 + 3] = band;
  }
  return {
    time: 0,
    view: options.view,
    n: options.n,
    seed: options.seed,
    player: { x: 0, z: 0, alt: BANDS[1], yaw: 0 },
    enemies,
    bullets: new Float32Array(MAX_BULLETS * 6),
    bulletCount: 0,
    fireAcc: 0,
  };
}

export function stepSim(s: SimState, dt: number): void {
  const t = Math.min(0.05, Math.max(0, dt));
  s.time += t;
  const p = s.player;
  p.yaw += t * 0.22;
  const speed = 28;
  p.x += Math.sin(p.yaw) * speed * t;
  p.z += Math.cos(p.yaw) * speed * t;
  p.alt = BANDS[1] + Math.sin(s.time * 0.7) * 4;

  const ex = s.enemies;
  for (let i = 0; i < s.n; i++) {
    const o = i * 4;
    let x = ex[o], z = ex[o + 1];
    const dx = p.x - x, dz = p.z - z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 16) {
      const ang = Math.atan2(x - p.x, z - p.z) + 0.7;
      x = p.x + Math.sin(ang) * (80 + (i % 7) * 12);
      z = p.z + Math.cos(ang) * (80 + (i % 7) * 12);
    } else {
      x += (dx / d) * ENEMY_SPEED * t;
      z += (dz / d) * ENEMY_SPEED * t;
    }
    ex[o] = x;
    ex[o + 1] = z;
  }

  let w = 0;
  const b = s.bullets;
  for (let i = 0; i < s.bulletCount; i++) {
    const o = i * 6;
    let life = b[o + 5] - t;
    if (life <= 0) continue;
    const xo = w * 6;
    b[xo] = b[o] + b[o + 3] * t;
    b[xo + 1] = b[o + 1] + b[o + 4] * t;
    b[xo + 2] = b[o + 2];
    b[xo + 3] = b[o + 3];
    b[xo + 4] = b[o + 4];
    b[xo + 5] = life;
    w++;
  }
  s.bulletCount = w;

  s.fireAcc += t;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  while (s.fireAcc >= FIRE_INTERVAL && s.bulletCount + SHOTS_PER_BURST <= MAX_BULLETS) {
    s.fireAcc -= FIRE_INTERVAL;
    for (let k = 0; k < SHOTS_PER_BURST; k++) {
      const o = s.bulletCount * 6;
      const side = k === 0 ? -2.4 : 2.4;
      b[o] = p.x + fx * 10 + fz * side;
      b[o + 1] = p.z + fz * 10 - fx * side;
      b[o + 2] = p.alt;
      b[o + 3] = fx * BULLET_SPEED;
      b[o + 4] = fz * BULLET_SPEED;
      b[o + 5] = BULLET_LIFE;
      s.bulletCount++;
    }
  }
}
