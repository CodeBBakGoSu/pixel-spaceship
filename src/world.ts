import type { View } from './flight';
import type { CameraState } from './camera';

const SIZE = 512;
const MASK = SIZE - 1;
const SKY_W = 1024;
const SKY_H = 256;
const rgba = (r: number, g: number, b: number) => (255 << 24) | (Math.max(0, Math.min(255, b)) << 16) | (Math.max(0, Math.min(255, g)) << 8) | Math.max(0, Math.min(255, r));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (x: number, y: number) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

// Periodic value noise keeps the heightmap seamless at its edges.
function noise(x: number, y: number, scale: number): number {
  const cells = SIZE / scale;
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const sx = gx - x0, sy = gy - y0;
  const tx = sx * sx * (3 - 2 * sx), ty = sy * sy * (3 - 2 * sy);
  const sample = (a: number, b: number) => hash((a + cells) % cells, (b + cells) % cells);
  return mix(mix(sample(x0, y0), sample(x0 + 1, y0), tx), mix(sample(x0, y0 + 1), sample(x0 + 1, y0 + 1), tx), ty);
}

export class World {
  private heights = new Float32Array(SIZE * SIZE);
  private colors = new Uint32Array(SIZE * SIZE);
  private crater = new Uint8Array(SIZE * SIZE);
  private sky = new Uint32Array(SKY_W * SKY_H);

  constructor() {
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      this.heights[z * SIZE + x] = 28 + noise(x, z, 256) * 14 + noise(x, z, 128) * 9 + noise(x, z, 64) * 4;
    }
    // Carved basins and raised rims, all wrapped onto the same map.
    for (let c = 0; c < 48; c++) {
      const cx = Math.floor(hash(c, 9) * SIZE), cz = Math.floor(hash(c, 17) * SIZE);
      const radius = 10 + Math.floor(hash(c, 23) * 20);
      const mineral = hash(c, 41) > 0.68 ? (hash(c, 53) > 0.48 ? 1 : 2) : 0;
      for (let dz = -radius - 2; dz <= radius + 2; dz++) for (let dx = -radius - 2; dx <= radius + 2; dx++) {
        const d = Math.sqrt(dx * dx + dz * dz) / radius;
        if (d > 1.1) continue;
        const i = ((cz + dz) & MASK) * SIZE + ((cx + dx) & MASK);
        const bowl = d < 0.85 ? (1 - (d / 0.85) ** 2) * 7 : 0;
        const rim = Math.max(0, 1 - Math.abs(d - 0.9) / 0.22) * 2.5;
        this.heights[i] = Math.max(3, this.heights[i] - bowl + rim);
        if (d < 0.56 && mineral) this.crater[i] = mineral;
      }
    }
    // Smooth overlapping crater rims before projection; height bands remain in the colour map.
    for (let pass = 0; pass < 8; pass++) {
      const smooth = new Float32Array(SIZE * SIZE);
      for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
        const i = z * SIZE + x;
        smooth[i] = (this.heights[i] * 4 + this.height(x - 1, z) + this.height(x + 1, z) + this.height(x, z - 1) + this.height(x, z + 1)) / 8;
      }
      this.heights = smooth;
    }
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x, h = this.heights[i];
      const slope = this.height(x - 2, z - 2) - this.height(x + 2, z + 2);
      const light = (slope > 0.8 ? 18 : slope < -0.8 ? -18 : 0) + (Math.floor(h / 2.5) % 4 - 1.5) * 6;
      const region = noise((x + 128) % SIZE, (z + 64) % SIZE, 128);
      let base = h < 34 ? [54, 51, 62] : h < 40 ? [173, 145, 119] : h < 46 ? [157, 91, 75] : h < 51 ? [191, 122, 91] : [218, 169, 127];
      if (region < 0.34) base = h < 41 ? [61, 63, 73] : [101, 90, 91];
      else if (region > 0.64) base = h < 43 ? [179, 153, 128] : [215, 183, 150];
      let r = base[0] + light, g = base[1] + light * 0.8, b = base[2] + light * 0.7;
      if (this.crater[i] === 1) {
        const crack = Math.abs(noise(x, z, 16) - 0.52);
        [r, g, b] = crack < 0.03 ? [255, 166, 69] : crack < 0.08 ? [204, 79, 42] : [92, 49, 54];
      } else if (this.crater[i] === 2) {
        const glow = noise(x, z, 16);
        [r, g, b] = glow > 0.54 ? [91, 187, 177] : [53, 76, 83];
        if (glow > 0.68) [r, g, b] = [161, 224, 197];
      } else if (region < 0.36 && h < 44 && Math.abs(noise(x, z, 32) - 0.5) < 0.012 && noise(x, z, 64) > 0.5) {
        [r, g, b] = [213, 83, 46];
      }
      this.colors[i] = rgba(r | 0, g | 0, b | 0);
    }
    this.makeSky();
  }

  height(x: number, z: number): number {
    return this.heights[((Math.floor(z) & MASK) * SIZE) + (Math.floor(x) & MASK)];
  }

  private makeSky(): void {
    for (let y = 0; y < SKY_H; y++) for (let x = 0; x < SKY_W; x++) {
      const band = Math.exp(-(((y - 76 - Math.sin(x * 0.013) * 21) / 30) ** 2));
      const clouds = band * (noise(x % SIZE, y, 64) * 0.65 + noise(x % SIZE, y, 32) * 0.35);
      const horizon = Math.min(1, y / 150);
      let r = 9 + horizon * 20 + clouds * 54;
      let g = 12 + horizon * 13 + clouds * 17;
      let b = 29 + horizon * 28 + clouds * 42;
      const star = hash(x + 301, y + 9);
      if (star > 0.9974 && y < 150) { r = 170 + star * 70; g = 167 + star * 70; b = 184 + star * 60; }
      this.sky[y * SKY_W + x] = rgba(r | 0, g | 0, b | 0);
    }
    this.planet(440, 50, 28, true);
    this.planet(648, 66, 12, false);
  }

  private planet(cx: number, cy: number, radius: number, ring: boolean): void {
    const put = (x: number, y: number, color: number) => {
      if (x >= 0 && x < SKY_W && y >= 0 && y < SKY_H) this.sky[y * SKY_W + x] = color;
    };
    if (ring) for (let y = -12; y <= 12; y++) for (let x = -47; x <= 47; x++) {
      const d = Math.sqrt((x / 46) ** 2 + ((y + x * 0.15) / 9) ** 2);
      if (d > 0.82 && d < 1.02) put(cx + x, cy + y, rgba(126, 105, 120));
    }
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const d = (x * x + y * y) / (radius * radius);
      if (d > 1) continue;
      const light = Math.max(0.18, Math.min(1, 0.8 - x / radius * 0.45 - y / radius * 0.14));
      const texture = Math.sin(y * 0.65 + Math.sin(x * 0.18) * 2) * (ring ? 9 : 3) + (hash(x + cx, y + cy) - 0.5) * 6;
      const base = ring ? [188, 139, 129] : [99, 135, 143];
      put(cx + x, cy + y, rgba((base[0] * light + texture) | 0, (base[1] * light + texture) | 0, (base[2] * light + texture) | 0));
    }
  }

  drawDust(ctx: CanvasRenderingContext2D, ship: CameraState, view: View, time: number): void {
    if (view !== 'overhead') return;
    const wrap = (n: number) => ((n + 256) % 512 + 512) % 512 - 256;
    ctx.save();
    for (let i = 0; i < 34; i++) {
      const high = i % 2 === 0;
      const drift = time * (high ? 1.5 : 0.5);
      const x = Math.round(ctx.canvas.width / 2 + wrap(hash(i, 201) * 512 - ship.x * (high ? 0.68 : 0.84) + drift) / 1.4);
      const y = Math.round(ctx.canvas.height / 2 - wrap(hash(i, 202) * 512 - ship.z * (high ? 0.68 : 0.84) + drift * 0.4) / 1.4);
      const size = high ? 2 : 1;
      ctx.globalAlpha = high ? 0.38 : 0.26;
      ctx.fillStyle = '#201e32';
      ctx.fillRect(x - size * 2 + 3, y + 4, size * 6, size * 2);
      ctx.fillStyle = high ? '#e8d5c4' : '#cbb2a9';
      ctx.fillRect(x - size * 3, y, size * 6, size);
      ctx.fillRect(x - size * 2, y - size, size * 4, size * 3);
      ctx.fillRect(x, y - size * 2, size * 2, size * 2);
      ctx.fillRect(x + size * 2, y, size * 2, size * 2);
    }
    ctx.restore();
  }

  render(image: ImageData, ship: CameraState, view: View = ship.mode): void {
    const w = image.width, h = image.height;
    const pixels = new Uint32Array(image.data.buffer);
    if (view === 'overhead') {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const wx = Math.floor(ship.x + (x - w / 2) * 1.4) & MASK;
        const flatZ = ship.z - (y - h / 2) * 1.4;
        const raised = this.height(wx, flatZ);
        const wz = Math.floor(flatZ - (raised - 36) * 0.3) & MASK;
        pixels[y * w + x] = this.colors[wz * SIZE + wx];
      }
      return;
    }

    const offset = Math.floor((SKY_W - w) / 2 + ship.yaw * 100);
    for (let y = 0; y < h; y++) {
      const sy = Math.max(0, Math.min(SKY_H - 1, Math.floor(y - ship.pitch * 12)));
      for (let x = 0; x < w; x++) pixels[y * w + x] = this.sky[sy * SKY_W + ((x + offset) & (SKY_W - 1))];
    }

    const horizon = h * 0.30 + ship.pitch * 15;
    const forwardX = Math.sin(ship.yaw), forwardZ = Math.cos(ship.yaw);
    const cameraOffset = ship.camOffset;
    const camX = ship.x - forwardX * cameraOffset, camZ = ship.z - forwardZ * cameraOffset;
    const cameraHeight = ship.altitude + ship.camHeightOffset;
    const hidden = new Int16Array(w);
    hidden.fill(h);
    for (let distance = 2; distance < 800; distance += 1 + distance * 0.023) {
      const leftX = camX + forwardX * distance - forwardZ * distance * 0.8;
      const leftZ = camZ + forwardZ * distance + forwardX * distance * 0.8;
      const dx = forwardZ * distance * 1.6 / w, dz = -forwardX * distance * 1.6 / w;
      const scale = h * 0.95 / distance;
      const fog = Math.min(0.84, Math.max(0, (distance - 55) / 650));
      for (let x = 0; x < w; x++) {
        const px = leftX + dx * x, pz = leftZ + dz * x;
        const ix = Math.floor(px), iz = Math.floor(pz), wx = ix & MASK, wz = iz & MASK;
        const index = wz * SIZE + wx, fx = px - ix, fz = pz - iz;
        const a = mix(this.heights[index], this.heights[wz * SIZE + ((wx + 1) & MASK)], fx);
        const b0 = mix(this.heights[((wz + 1) & MASK) * SIZE + wx], this.heights[((wz + 1) & MASK) * SIZE + ((wx + 1) & MASK)], fx);
        const elevation = mix(a, b0, fz);
        let top = Math.floor(horizon + (cameraHeight - elevation) * scale);
        if (top >= hidden[x]) continue;
        top = Math.max(0, top);
        const color = this.colors[index];
        const r = mix(color & 255, 74, fog) | 0;
        const g = mix((color >>> 8) & 255, 57, fog) | 0;
        const b = mix((color >>> 16) & 255, 79, fog) | 0;
        const topColor = rgba(r, g, b);
        const wall = rgba((r * 0.9) | 0, (g * 0.9) | 0, (b * 0.91) | 0);
        const wallDark = rgba((r * 0.84) | 0, (g * 0.84) | 0, (b * 0.87) | 0);
        const thickness = hidden[x] - top;
        for (let y = top; y < hidden[x]; y++) {
          const band = Math.floor((elevation - (y - top) / scale) / 4) & 1;
          pixels[y * w + x] = thickness <= 2 || y === top ? topColor : band ? wall : wallDark;
        }
        hidden[x] = top;
      }
    }
  }
}
