import { advanceBank, rollAngle, type Flight, type View } from './flight';
import { buildFaces, projection, projectPoint, VoxelProjector, type Face, type VoxelModel } from './voxel';

// The model is made of solid voxels, not painted outlines. Exposed voxel faces are
// projected in depth order, so the underside, tail and fins stay solid in a roll.
const W = 35, L = 43, H = 18;
const CENTER_X = 17, CENTER_Y = 21, CENTER_Z = 6;
const palette = [
  [0, 0, 0], [195, 207, 200], [145, 164, 166], [77, 96, 110],
  [232, 126, 81], [64, 155, 167], [34, 44, 57], [255, 165, 79], [225, 231, 214],
];
type Particle = { x: number; z: number; altitude: number; vx: number; vz: number; life: number; total: number; size: number };
export type ShipPose = { x: number; y: number; scale: number; pitch: number; lift: number; bank: number; alpha: number; perspective: number; shadowSquash: number; shadowY: number };

export class ShipSprite {
  private faces: Face[] = [];
  private shadow = document.createElement('canvas');
  private projector = new VoxelProjector();
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
      // Layered wings, a tapered fuselage and a rounded belly.
      const leading = -5 + Math.max(0, ax - 4) * 0.7;
      const trailing = 13 - Math.max(0, ax - 10) * 0.3;
      if (ax <= 16 && y >= leading && y <= trailing && z >= 2 && z <= 6) {
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
    const model: VoxelModel = { width: W, length: L, height: H, pivot: [CENTER_X, CENTER_Y, CENTER_Z], data: voxels };
    this.faces = buildFaces(model);
    this.shadow.width = W; this.shadow.height = L;
    const shadowCtx = this.shadow.getContext('2d')!;
    shadowCtx.fillStyle = '#10101d';
    for (let y = 0; y < L; y++) for (let x = 0; x < W; x++) {
      for (let z = 0; z < H; z++) if (get(x, y, z)) { shadowCtx.fillRect(x, y, 1, 1); break; }
    }
  }

  update(dt: number, ship: Flight, turn: number): void {
    this.time += dt;
    this.bank = advanceBank(this.bank, turn, dt);
    this.emission += dt * (28 + ship.boost * 45);
    const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw);
    const rx = Math.cos(ship.yaw), rz = -Math.sin(ship.yaw);
    while (this.emission >= 1) {
      this.emission--;
      for (const side of [-1, 1]) {
        const distance = 18 * 1.5, across = side * 5.5 * 1.5;
        const exhaustSpeed = 42 + ship.boost * 38;
        const life = 0.3 + Math.random() * (0.35 + ship.boost * 0.25);
        this.particles.push({ x: ship.x - fx * distance + rx * across, z: ship.z - fz * distance + rz * across,
          altitude: ship.altitude - 1.5, vx: fx * (ship.speed - exhaustSpeed), vz: fz * (ship.speed - exhaustSpeed),
          life, total: life, size: 1 + Math.random() * (1.5 + ship.boost) });
      }
    }
    for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt; }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, ship: Flight, view: View, ground: number, demoBank: boolean, pose?: ShipPose): void {
    if (view === 'cockpit') return;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const cx = Math.round(pose?.x ?? w / 2), cy = Math.round(pose?.y ?? (view === 'overhead' ? h * 0.5 : h * 0.59));
    const scale = Math.max(0.8, Math.min(1.35, w / 250)) * (pose?.scale ?? 1);
    const pitch = (pose?.pitch ?? (view === 'overhead' ? 65 : 36)) * Math.PI / 180;
    const yaw = view === 'overhead' ? ship.yaw : -this.bank * 0.08;
    const roll = (pose?.bank ?? this.bank) + (demoBank ? 0.72 : 0) + rollAngle(ship.roll);
    const lift = pose?.lift ?? (view === 'overhead' ? 1.4 : 1);
    const camera = projection({ cx, cy, scale, pitch, yaw, roll, lift, perspective: pose?.perspective ?? (view === 'chase' ? 1 : 0) });
    const project = (x: number, y: number, z: number) => projectPoint(camera, x, y, z);

    ctx.save();
    ctx.globalAlpha *= pose?.alpha ?? 1;
    if (glow) { glow.save(); glow.globalAlpha *= pose?.alpha ?? 1; }
    // Silhouette falls farther from the jet and softens as clearance increases.
    const clearance = Math.max(0, ship.altitude - ground);
    ctx.save();
    ctx.globalAlpha *= Math.max(0.2, 0.46 - clearance * 0.0018);
    ctx.translate(cx + clearance * (view === 'overhead' ? 0.85 : 0.38), cy + (pose?.shadowY ?? (view === 'overhead' ? clearance * 0.48 : 23 + clearance * 0.24)));
    ctx.rotate(yaw);
    const shadowScale = scale * Math.max(0.58, 0.92 - clearance * 0.002);
    ctx.scale(shadowScale, shadowScale * (pose?.shadowSquash ?? (view === 'overhead' ? 0.82 : 0.28)));
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
      const length = (13 + ship.boost * 22) * (0.88 + 0.12 * Math.sin(this.time * 34));
      for (const side of [-1, 1]) {
        for (let pass = 0; pass < 3; pass++) for (let t = length; t >= 0; t -= 0.8) {
          const u = t / length;
          if (pass === 2 && u > 0.78) continue;
          const sway = Math.sin(this.time * 23 + t * 0.9 + side) * u * 1.1;
          const point = project(side * 5.5 + sway, 18 + t, -1);
          const flicker = 0.86 + 0.18 * Math.sin(this.time * 37 - t * 1.4 + side);
          const radius = (2.3 + ship.boost * 2.1) * Math.pow(1 - u * 0.88, 0.7) * point.scale * flicker;
          const r = Math.max(1, Math.round(radius * (pass === 0 ? 1.25 : pass === 1 ? 1 : 0.48)));
          const x = Math.round(point.x), y = Math.round(point.y);
          ctx.fillStyle = pass === 0 ? `rgba(220,56,31,${0.12 + (1 - u) * 0.32})`
            : pass === 1 ? (u > 0.7 ? '#d64931' : u > 0.34 ? '#f8742e' : '#ffae43')
            : u < 0.24 ? '#fff9d4' : u < 0.56 ? '#ffe678' : '#ffb542';
          for (let row = -r; row <= r; row++) {
            const span = Math.floor(Math.sqrt(r * r - row * row));
            ctx.fillRect(x - span, y + row, span * 2 + 1, 1);
          }
        }
        if (glow) {
          glow.save();
          glow.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 4; i++) {
            const t = length * i * 0.23;
            const point = project(side * 5.5, 18 + t, -1);
            const radius = (4.5 + ship.boost * 5) * (1 - i * 0.15) * point.scale;
            const halo = glow.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
            halo.addColorStop(0, `rgba(255,150,50,${(0.17 + ship.boost * 0.18) * (1 - i * 0.2)})`);
            halo.addColorStop(1, 'rgba(255,65,12,0)');
            glow.fillStyle = halo;
            glow.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
          }
          glow.restore();
        }
      }
      ctx.restore();
    };
    drawFlames();

    this.projector.draw(ctx, this.faces, palette, camera);
    ctx.restore();
    if (glow) glow.restore();
  }
}

export function drawCockpit(ctx: CanvasRenderingContext2D, pitch: number, aimX = 0, aimY = 0, slide = 0): void {
  const w = ctx.canvas.width, h = ctx.canvas.height, cx = Math.floor(w / 2);
  ctx.save();
  ctx.translate(0, slide * h * 0.45);
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
  const sightX = Math.round(cx + aimX * w * 0.38);
  const sightY = Math.floor(h * 0.42 + aimY * h * 0.27 + pitch * 8);
  ctx.fillStyle = 'rgba(169, 230, 208, .8)';
  ctx.fillRect(sightX - 10, sightY, 6, 1); ctx.fillRect(sightX + 5, sightY, 6, 1);
  ctx.fillRect(sightX, sightY - 9, 1, 5); ctx.fillRect(sightX, sightY + 5, 1, 5);
  ctx.restore();
}
