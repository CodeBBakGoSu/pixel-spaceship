import type { Flight, View } from './flight';
import { outlineShip } from './outline';

// The model is made of solid voxels, not painted outlines. Exposed voxel faces are
// projected in depth order, so the underside, tail and fins stay solid in a roll.
const W = 35, L = 43, H = 18;
const CENTER_X = 17, CENTER_Y = 21, CENTER_Z = 6;
const palette = [
  [0, 0, 0], [195, 207, 200], [145, 164, 166], [77, 96, 110],
  [232, 126, 81], [64, 155, 167], [34, 44, 57], [255, 165, 79], [225, 231, 214],
];
const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
type Face = { x: number; y: number; z: number; side: number; material: number };
type Particle = { x: number; z: number; altitude: number; vx: number; vz: number; life: number; total: number; size: number };
type Projection = { x: number; y: number; depth: number; scale: number };
const pack = (r: number, g: number, b: number) => (255 << 24) | (b << 16) | (g << 8) | r;

export class ShipSprite {
  private faces: Face[] = [];
  private shadow = document.createElement('canvas');
  private layer = document.createElement('canvas');
  private layerCtx = this.layer.getContext('2d')!;
  private image!: ImageData;
  private depth = new Float32Array(0);
  private particles: Particle[] = [];
  private emission = 0;
  private time = 0;
  private bank = 0;

  constructor() {
    const voxels = new Uint8Array(W * L * H);
    const at = (x: number, y: number, z: number) => (z * L + y) * W + x;
    const get = (x: number, y: number, z: number) => x < 0 || x >= W || y < 0 || y >= L || z < 0 || z >= H ? 0 : voxels[at(x, y, z)];
    for (let z = 0; z < H; z++) for (let iy = 0; iy < L; iy++) for (let ix = 0; ix < W; ix++) {
      const x = ix - CENTER_X, y = iy - CENTER_Y, ax = Math.abs(x);
      let m = 0;
      // Three-voxel wing thickness, a tapered fuselage and a rounded belly.
      const leading = -5 + Math.max(0, ax - 4) * 0.7;
      const trailing = 13 - Math.max(0, ax - 10) * 0.3;
      if (ax <= 16 && y >= leading && y <= trailing && z >= 3 && z <= 5) {
        m = ax > 13 || (ax > 8 && y > 8) ? 4 : 2;
        if (ax > 7 && y === 5) m = 3;
      }
      const halfWidth = y < -17 ? 1 : y < -13 ? 2 : y < -8 ? 3 : y < 11 ? 4 : 3;
      const top = y < -15 ? 6 : y < -10 ? 8 : 10;
      if (y >= -20 && y <= 16 && ax <= halfWidth && z >= 2 + Math.max(0, ax - 2) && z <= top - Math.max(0, ax - 2)) {
        m = z <= 3 ? 3 : ax === halfWidth ? 2 : 1;
        if (x === 0 && y < -10 && z >= 6) m = 8;
        if (ax === 3 && y >= 2 && y <= 9 && z >= 6) m = 4;
        if (ax === 1 && y >= 5 && y <= 12 && z >= 9) m = 2;
      }
      // Twin cylindrical engine housings, with dark rear rims and hot centres.
      const engine = ((ax - 5.5) / 3) ** 2 + ((z - 5) / 3) ** 2;
      if (y >= 4 && y <= 18 && engine <= 1) {
        m = y >= 17 ? (engine < 0.26 ? 7 : 6) : z < 4 ? 3 : 2;
        if (y === 15 && z >= 6) m = 4;
      }
      // Two raised tail fins and a framed, domed canopy.
      if (ax >= 5 && ax <= 6 && y >= 7 && y <= 15 && z >= 8 && z <= 16 - Math.max(0, 10 - y)) m = z > 13 ? 4 : 3;
      const canopyTop = y < -7 || y > 0 ? 10 : y < -4 ? 12 : 14;
      if (y >= -10 && y <= 2 && ax <= 2 && z >= 9 && z <= canopyTop - (ax === 2 ? 2 : 0)) {
        m = ax === 2 || y === 2 || y === -10 ? 3 : 5;
        if (x === -1 && y >= -5 && y <= -3 && z >= 12) m = 8;
      }
      if (m) voxels[at(ix, iy, z)] = m;
    }
    this.shadow.width = W; this.shadow.height = L;
    const shadowCtx = this.shadow.getContext('2d')!;
    shadowCtx.fillStyle = '#10101d';
    for (let y = 0; y < L; y++) for (let x = 0; x < W; x++) {
      let occupied = false;
      for (let z = 0; z < H; z++) {
        const material = get(x, y, z);
        if (!material) continue;
        occupied = true;
        for (let side = 0; side < dirs.length; side++) {
          const [dx, dy, dz] = dirs[side];
          if (!get(x + dx, y + dy, z + dz)) this.faces.push({ x: x - CENTER_X, y: y - CENTER_Y, z: z - CENTER_Z, side, material });
        }
      }
      if (occupied) shadowCtx.fillRect(x, y, 1, 1);
    }
  }

  update(dt: number, ship: Flight, turn: number): void {
    this.time += dt;
    this.bank += (turn * 0.55 - this.bank) * Math.min(1, dt * 5);
    this.emission += dt * (28 + ship.boost * 45);
    const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw);
    const rx = Math.cos(ship.yaw), rz = -Math.sin(ship.yaw);
    while (this.emission >= 1) {
      this.emission--;
      for (const side of [-1, 1]) {
        const distance = 18 * 1.5, across = side * 5.5 * 1.5;
        const exhaustSpeed = 42 + ship.boost * 38;
        const life = 0.22 + Math.random() * (0.2 + ship.boost * 0.2);
        this.particles.push({ x: ship.x - fx * distance + rx * across, z: ship.z - fz * distance + rz * across,
          altitude: ship.altitude - 1.5, vx: fx * (ship.speed - exhaustSpeed), vz: fz * (ship.speed - exhaustSpeed),
          life, total: life, size: 1 + Math.random() * (1.5 + ship.boost) });
      }
    }
    for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt; }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private resize(w: number, h: number): void {
    if (this.layer.width === w && this.layer.height === h && this.image) return;
    this.layer.width = w; this.layer.height = h;
    this.image = this.layerCtx.createImageData(w, h);
    this.depth = new Float32Array(w * h);
  }

  draw(ctx: CanvasRenderingContext2D, ship: Flight, view: View, ground: number, demoBank: boolean): void {
    if (view === 'cockpit') return;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    this.resize(w, h);
    const cx = Math.round(w / 2), cy = Math.round(view === 'overhead' ? h * 0.5 : h * 0.68);
    const scale = Math.max(0.8, Math.min(1.35, w / 250));
    const pitch = (view === 'overhead' ? 68 : 19) * Math.PI / 180;
    const yaw = view === 'overhead' ? ship.yaw : -this.bank * 0.08;
    const roll = this.bank + (demoBank ? 0.72 : 0) + (ship.roll ? (1 - ship.roll) * Math.PI * 2 : 0);
    const cr = Math.cos(roll), sr = Math.sin(roll), ca = Math.cos(yaw), sa = Math.sin(yaw);
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const xx = ca * cr, xy = -sa, xz = ca * sr;
    const yx = sa * cr * sp + sr * cp, yy = ca * sp, yz = sa * sr * sp - cr * cp;
    const dx = sa * cr * cp - sr * sp, dy = ca * cp, dz = sa * sr * cp + cr * sp;
    const project = (x: number, y: number, z: number): Projection => {
      const depth = dx * x + dy * y + dz * z;
      const mag = scale * (view === 'chase' ? 1 / Math.max(0.75, 1 - depth * 0.008) : 1);
      return { x: cx + (xx * x + xy * y + xz * z) * mag, y: cy + (yx * x + yy * y + yz * z) * mag, depth, scale: mag };
    };

    // Silhouette falls farther from the jet and softens as clearance increases.
    const clearance = Math.max(0, ship.altitude - ground);
    ctx.save();
    ctx.globalAlpha = Math.max(0.12, 0.33 - clearance * 0.002);
    ctx.translate(cx + clearance * 0.25, cy + (view === 'overhead' ? clearance * 0.29 : 15 + clearance * 0.18));
    ctx.rotate(yaw);
    const shadowScale = scale * Math.max(0.58, 0.92 - clearance * 0.002);
    ctx.scale(shadowScale, shadowScale * (view === 'overhead' ? 0.82 : 0.28));
    ctx.drawImage(this.shadow, -CENTER_X, -CENTER_Y);
    ctx.restore();

    // Fire samples follow the nozzle axis; released embers retain world coordinates.
    const drawFlames = () => {
      ctx.save();
      for (const p of this.particles) {
        const ax = p.x - ship.x, az = p.z - ship.z;
        const localX = (ax * Math.cos(ship.yaw) - az * Math.sin(ship.yaw)) / 1.5;
        const localY = -(ax * Math.sin(ship.yaw) + az * Math.cos(ship.yaw)) / 1.5;
        const point = project(localX, localY, (p.altitude - ship.altitude) / 1.5 - 1);
        const alpha = p.life / p.total;
        const size = Math.max(1, Math.round(p.size * point.scale * alpha));
        ctx.fillStyle = alpha > 0.5 ? `rgba(255,168,70,${alpha * 0.8})` : `rgba(235,79,45,${alpha * 0.7})`;
        ctx.fillRect(Math.round(point.x - size / 2), Math.round(point.y - size / 2), size, size);
      }
      const length = (11 + ship.boost * 20) * (0.9 + 0.1 * Math.sin(this.time * 34));
      for (const side of [-1, 1]) for (let pass = 0; pass < 3; pass++) for (let t = length; t >= 0; t -= 0.8) {
        const u = t / length;
        if (pass === 2 && u > 0.78) continue;
        const point = project(side * 5.5 + Math.sin(this.time * 24 + t) * u * 0.4, 18 + t, -1);
        const radius = (2.1 + ship.boost * 1.55) * (1 - u * 0.72) * point.scale;
        const r = Math.max(1, Math.round(radius * (pass === 0 ? 1.3 : pass === 1 ? 1 : 0.52)));
        const x = Math.round(point.x), y = Math.round(point.y);
        ctx.fillStyle = pass === 0 ? `rgba(236,71,32,${0.18 + (1 - u) * 0.25})`
          : pass === 1 ? (u > 0.65 ? '#e55a30' : u > 0.3 ? '#ff8c32' : '#ffb849')
          : u < 0.28 ? '#fff6c9' : u < 0.58 ? '#ffe778' : '#ffc45c';
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
    };
    if (view === 'overhead') drawFlames();

    // Draw visible surface samples to a depth buffer. Each face has its own light level.
    const pixels = new Uint32Array(this.image.data.buffer);
    pixels.fill(0); this.depth.fill(-Infinity);
    const shades = dirs.map(([nx, ny, nz]) => {
      const nDepth = dx * nx + dy * ny + dz * nz;
      const up = cr * nz - sr * nx;
      const left = cr * nx + sr * nz;
      const light = Math.max(0, up * 0.85 - left * 0.36 - ny * 0.18);
      return { visible: nDepth > 0.001, value: Math.max(0.32, Math.min(1.12, 0.43 + light * 0.72)) };
    });
    for (const face of this.faces) {
      const shade = shades[face.side];
      if (!shade.visible) continue;
      const [nx, ny, nz] = dirs[face.side];
      const color = palette[face.material];
      const lighting = shade.value * (nz < 0 ? 0.65 : 1);
      const col = pack(Math.min(255, Math.round(color[0] * lighting)), Math.min(255, Math.round(color[1] * lighting)), Math.min(255, Math.round(color[2] * lighting)));
      for (let a = -0.375; a <= 0.375; a += 0.25) for (let b = -0.375; b <= 0.375; b += 0.25) {
        const x = face.x + nx * 0.5 + (nx ? 0 : a);
        const y = face.y + ny * 0.5 + (nx ? a : ny ? 0 : b);
        const z = face.z + nz * 0.5 + (nz ? 0 : b);
        const point = project(x, y, z);
        const px = Math.round(point.x), py = Math.round(point.y);
        if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
        const i = py * w + px;
        if (point.depth > this.depth[i]) { this.depth[i] = point.depth; pixels[i] = col; }
      }
    }
    // One-pixel silhouette outline, written only outside the ship mask.
    outlineShip(pixels, w, h, cx - 60, cy - 60, cx + 60, cy + 60);
    this.layerCtx.putImageData(this.image, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    if (view === 'chase') drawFlames();
  }
}

export function drawCockpit(ctx: CanvasRenderingContext2D, pitch: number): void {
  const w = ctx.canvas.width, h = ctx.canvas.height, cx = Math.floor(w / 2);
  ctx.save();
  ctx.fillStyle = '#121b29';
  ctx.fillRect(0, h - 18, w, 18);
  ctx.fillStyle = '#334958';
  ctx.fillRect(0, h - 19, w, 2);
  ctx.fillRect(cx - 49, h - 15, 98, 2);
  ctx.fillStyle = '#1c2e3a';
  ctx.fillRect(cx - 46, h - 12, 92, 9);
  ctx.fillStyle = '#79c5ba';
  for (let i = 0; i < 10; i++) ctx.fillRect(cx - 42 + i * 3, h - 9, 2, i % 3 === 0 ? 4 : 2);
  for (let i = 0; i < 5; i++) ctx.fillRect(cx + 24 + i * 4, h - 9, 2, 4);
  ctx.fillStyle = '#f3aa75'; ctx.fillRect(cx - 3, h - 9, 6, 3);
  const sightY = Math.floor(h * 0.48 + pitch * 8);
  ctx.fillStyle = 'rgba(169, 230, 208, .8)';
  ctx.fillRect(cx - 10, sightY, 6, 1); ctx.fillRect(cx + 5, sightY, 6, 1);
  ctx.fillRect(cx, sightY - 9, 1, 5); ctx.fillRect(cx, sightY + 5, 1, 5);
  ctx.restore();
}
