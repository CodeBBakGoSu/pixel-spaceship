import { buildFaces, projectModel, VoxelProjector, type VoxelModel } from './voxel';

type CachedSprite = { canvas: HTMLCanvasElement; x: number; y: number };
export type SpriteCache = { drones: CachedSprite[]; pillar: CachedSprite; ring: CachedSprite; boss: CachedSprite[] };
const palette = [[0,0,0],[54,64,77],[102,121,133],[205,213,206],[225,105,70],[91,203,200],[255,213,121],[140,75,65]];

function makeModel(w: number, l: number, h: number, pivot: [number, number, number], material: (x: number, y: number, z: number) => number): VoxelModel {
  const data = new Uint8Array(w * l * h);
  for (let z = 0; z < h; z++) for (let y = 0; y < l; y++) for (let x = 0; x < w; x++) data[(z * l + y) * w + x] = material(x - pivot[0], y - pivot[1], z - pivot[2]);
  return { width: w, length: l, height: h, pivot, data };
}

export function bakeSprites(): SpriteCache {
  const drone = buildFaces(makeModel(17, 19, 9, [8, 9, 3], (x, y, z) => {
    const ax = Math.abs(x);
    if (y >= -8 && y <= 8 && ax <= (y < -4 ? 1 : 2) && z >= -2 && z <= 4 - Math.floor(ax / 2)) return y < -4 ? 4 : z > 2 ? 3 : 2;
    if (y >= -2 + ax * 0.5 && y <= 6 && ax <= 8 && z >= -1 && z <= 1) return ax > 5 ? 4 : 1;
    if (y > 4 && ax >= 2 && ax <= 4 && z >= -2 && z <= 2) return y === 8 ? 6 : 2;
    return 0;
  }));
  const pillar = buildFaces(makeModel(14, 14, 36, [7, 7, 0], (x, y, z) => {
    const r = 5.5 - Math.max(0, z - 25) * 0.13 + Math.sin(z * 0.6 + x) * 0.4;
    if (x * x + y * y > r * r || z < 0) return 0;
    return z > 28 ? 3 : z % 8 < 2 ? 7 : 2;
  }));
  const ring = buildFaces(makeModel(21, 5, 21, [10, 2, 10], (x, y, z) => {
    const d = Math.hypot(x, z);
    return Math.abs(y) <= 2 && d >= 7 && d <= 10 ? (d > 8.5 ? 5 : 6) : 0;
  }));
  const boss = buildFaces(makeModel(48, 36, 16, [24, 18, 5], (x, y, z) => {
    const ax = Math.abs(x);
    if (y >= -15 && y <= 14 && ax <= (y < -8 ? 5 : 8) && z >= -4 && z <= 8 - Math.floor(ax / 4)) return z > 5 ? 3 : 2;
    if (y >= -4 + ax * 0.38 && y <= 11 && ax <= 22 && z >= -2 && z <= 2) return ax > 16 ? 4 : 1;
    if (y >= 9 && ax <= 5 && z >= -2 && z <= 5) return ax <= 2 && z <= 2 ? 6 : 4;
    if (y >= 3 && y <= 12 && ax >= 9 && ax <= 12 && z >= 0 && z <= 8) return 4;
    return 0;
  }));
  const renderer = new VoxelProjector();
  function bake(faces: ReturnType<typeof buildFaces>, w: number, h: number, x: number, y: number, scale: number, pitch: number, roll: number, yaw = 0): CachedSprite {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    projectModel(renderer, ctx, faces, palette, { cx: x, cy: y, scale, pitch, yaw, roll, lift: 1, perspective: false });
    return { canvas, x, y };
  }
  return {
    drones: Array.from({ length: 9 }, (_, i) => bake(drone, 44, 44, 22, 22, 1.65, 0.85, (i - 4) * 0.12, Math.PI)),
    pillar: bake(pillar, 40, 72, 20, 65, 1.35, 0.55, 0),
    ring: bake(ring, 48, 48, 24, 24, 1.6, 0.2, 0),
    boss: [-0.2, 0, 0.2].map(roll => bake(boss, 96, 72, 48, 40, 1.5, 0.6, roll)),
  };
}
