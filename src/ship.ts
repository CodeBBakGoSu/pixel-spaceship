import type { Flight, View } from './flight';

const SIZE = 32;
const LAYERS = 11;
const colors = ['#252b3a', '#465263', '#768895', '#b9c7bd', '#e8e8d7', '#f8f2db', '#e77f58', '#b64f44', '#274859', '#468d9a', '#a8e2d5'];

type Particle = { x: number; y: number; life: number; total: number; size: number };

export class ShipSprite {
  private slices: HTMLCanvasElement[] = [];
  private particles: Particle[] = [];
  private emission = 0;

  constructor() {
    for (let z = 0; z < LAYERS; z++) {
      const slice = document.createElement('canvas');
      slice.width = slice.height = SIZE;
      const ctx = slice.getContext('2d')!;
      for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) {
        const ax = Math.abs(x);
        let color = -1;
        // Swept wings, thick central hull and twin rear engine pods.
        const wingWidth = 4 + (y + 4) * 0.72;
        if (y >= -4 && y <= 10 && ax <= wingWidth && z <= 2) {
          color = z === 0 ? 1 : z === 1 ? 2 : 3;
          if ((ax > wingWidth - 2 || (y > 5 && ax > 7)) && z === 2) color = 6;
          if (y === 7 && ax > 5 && z === 2) color = 7;
        }
        const hullWidth = y < -10 ? 1 : y < -6 ? 2 : y < 4 ? 3 : y < 11 ? 4 : 3;
        const hullHeight = y < -9 ? 3 : y < -5 ? 5 : y < 8 ? 7 : 5;
        if (y >= -13 && y <= 12 && ax <= hullWidth && z <= hullHeight - Math.max(0, ax - 1)) {
          color = z < 2 ? 1 : z < 4 ? 2 : z < 6 ? 3 : 4;
          if (ax === hullWidth && z > 1) color = 2;
          if (x === 0 && y < -7 && z >= 3) color = 5;
          if (ax === 3 && y >= 3 && y <= 8 && z >= 3) color = 6;
        }
        if (y >= 8 && y <= 13 && ax >= 3 && ax <= 6 && z <= 4 - Math.floor(Math.abs(ax - 4.5))) {
          color = y >= 12 ? 0 : z < 2 ? 1 : 3;
          if (y === 11 && z >= 2) color = 6;
        }
        // The canopy is made of the upper voxels, with a one-pixel glint.
        if (y >= -6 && y <= 2 && ax <= (y < -4 || y > 0 ? 1 : 2) && z >= 6 && z <= (ax === 2 ? 7 : 9)) {
          color = z === 6 ? 8 : z < 9 ? 9 : 10;
          if (x === -1 && y >= -3 && y <= -1 && z === 9) color = 5;
        }
        if (color >= 0) { ctx.fillStyle = colors[color]; ctx.fillRect(x + SIZE / 2, y + SIZE / 2, 1, 1); }
      }
      this.slices.push(slice);
    }
  }

  update(dt: number, boost: number): void {
    this.emission += dt * (36 + boost * 50);
    while (this.emission >= 1) {
      this.emission--;
      for (const side of [-1, 1]) this.particles.push({
        x: side * 4.5 + (Math.random() - 0.5) * 1.4,
        y: 12 + Math.random() * 2,
        life: 0.14 + Math.random() * (0.18 + boost * 0.18),
        total: 0.35 + boost * 0.16,
        size: 1 + Math.random() * (1.3 + boost),
      });
    }
    for (const p of this.particles) { p.life -= dt; p.y += dt * (18 + boost * 26); p.x += (Math.random() - 0.5) * dt * 4; }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, ship: Flight, view: View, turn: number): void {
    if (view === 'cockpit') return;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const scale = Math.max(1.4, Math.min(2.3, w / 150));
    const squash = view === 'overhead' ? 0.88 : 0.68;
    const cx = Math.round(w / 2), cy = Math.round(view === 'overhead' ? h * 0.52 : h * 0.72);
    const yaw = view === 'overhead' ? ship.yaw : turn * 0.1;
    const roll = ship.roll ? (1 - ship.roll) * Math.PI * 2 : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale * squash);
    ctx.save();
    ctx.rotate(yaw);
    // Exhaust is drawn behind the stacked slices and grows with the throttle.
    for (const p of this.particles) {
      const age = p.life / p.total;
      ctx.fillStyle = age > 0.6 ? '#fff4bf' : age > 0.3 ? '#ffb75f' : '#e66b4d';
      const size = Math.max(1, Math.ceil(p.size * age));
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y), size, size + (ship.boost > 0.4 ? 1 : 0));
    }
    ctx.restore();
    const order = Math.cos(roll) >= 0 ? [...this.slices.keys()] : [...this.slices.keys()].reverse();
    for (const z of order) {
      ctx.save();
      ctx.translate(0, -(z - 5) * Math.cos(roll) - 5);
      ctx.rotate(yaw);
      ctx.translate((z - 5) * Math.sin(roll), 0);
      ctx.transform(Math.cos(roll), -Math.sin(roll) * 0.45, 0, 1, 0, 0);
      ctx.drawImage(this.slices[z], -SIZE / 2, -SIZE / 2);
      ctx.restore();
    }
    ctx.restore();
  }
}

export function drawCockpit(ctx: CanvasRenderingContext2D, pitch: number): void {
  const w = ctx.canvas.width, h = ctx.canvas.height, cx = Math.floor(w / 2);
  ctx.save();
  // Stepped rectangles keep the frame and instruments pixel-native.
  ctx.fillStyle = '#121b29';
  ctx.fillRect(0, h - 22, w, 22);
  for (let i = 0; i < 6; i++) {
    const width = 5 + i * 3;
    ctx.fillRect(0, h - 27 - i * 9, width, 12);
    ctx.fillRect(w - width, h - 27 - i * 9, width, 12);
  }
  ctx.fillStyle = '#334958';
  ctx.fillRect(0, h - 23, w, 2);
  ctx.fillRect(cx - 49, h - 18, 98, 2);
  ctx.fillStyle = '#1c2e3a';
  ctx.fillRect(cx - 46, h - 14, 92, 10);
  ctx.fillStyle = '#79c5ba';
  for (let i = 0; i < 10; i++) ctx.fillRect(cx - 42 + i * 3, h - 11, 2, i % 3 === 0 ? 4 : 2);
  for (let i = 0; i < 5; i++) ctx.fillRect(cx + 24 + i * 4, h - 11, 2, 4);
  ctx.fillStyle = '#f3aa75';
  ctx.fillRect(cx - 3, h - 11, 6, 3);
  const sightY = Math.floor(h * 0.48 + pitch * 8);
  ctx.fillStyle = 'rgba(169, 230, 208, .8)';
  ctx.fillRect(cx - 10, sightY, 6, 1); ctx.fillRect(cx + 5, sightY, 6, 1);
  ctx.fillRect(cx, sightY - 9, 1, 5); ctx.fillRect(cx, sightY + 5, 1, 5);
  ctx.restore();
}
