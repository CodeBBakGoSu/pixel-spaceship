import { outlineShip } from './outline.ts';

export type VoxelModel = { width: number; length: number; height: number; pivot: [number, number, number]; data: Uint8Array };
export type Face = { x: number; y: number; z: number; side: number; material: number };
export const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function buildFaces(model: VoxelModel): Face[] {
  const { width: w, length: l, height: h, data, pivot } = model;
  const get = (x: number, y: number, z: number) => x < 0 || x >= w || y < 0 || y >= l || z < 0 || z >= h ? 0 : data[(z * l + y) * w + x];
  const faces: Face[] = [];
  for (let z = 0; z < h; z++) for (let y = 0; y < l; y++) for (let x = 0; x < w; x++) {
    const material = get(x, y, z);
    if (!material) continue;
    for (let side = 0; side < directions.length; side++) {
      const [dx, dy, dz] = directions[side];
      if (!get(x + dx, y + dy, z + dz)) faces.push({ x: x - pivot[0], y: y - pivot[1], z: z - pivot[2], side, material });
    }
  }
  return faces;
}

export type VoxelPose = { cx: number; cy: number; scale: number; pitch: number; yaw: number; roll: number; lift: number; perspective: boolean };
export function projection(pose: VoxelPose) {
  const { cx, cy, scale, pitch, yaw, roll, lift, perspective } = pose;
  const cr = Math.cos(roll), sr = Math.sin(roll), ca = Math.cos(yaw), sa = Math.sin(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { cx, cy, scale, perspective, cr, sr,
    xx: ca * cr, xy: -sa, xz: ca * sr * lift,
    yx: sa * cr * sp + sr * cp, yy: ca * sp, yz: (sa * sr * sp - cr * cp) * lift,
    dx: sa * cr * cp - sr * sp, dy: ca * cp, dz: (sa * sr * cp + cr * sp) * lift };
}
export type Projection = ReturnType<typeof projection>;
export function projectPoint(p: Projection, x: number, y: number, z: number) {
  const depth = p.dx * x + p.dy * y + p.dz * z;
  const scale = p.scale * (p.perspective ? 1 / Math.max(0.75, 1 - depth * 0.008) : 1);
  return { x: p.cx + (p.xx * x + p.xy * y + p.xz * z) * scale, y: p.cy + (p.yx * x + p.yy * y + p.yz * z) * scale, depth, scale };
}

export class VoxelProjector {
  private layer = document.createElement('canvas');
  private layerCtx = this.layer.getContext('2d')!;
  private image!: ImageData;
  private depth = new Float32Array(0);

  draw(ctx: CanvasRenderingContext2D, faces: Face[], palette: number[][], p: Projection): void {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (this.layer.width !== w || this.layer.height !== h || !this.image) {
      this.layer.width = w; this.layer.height = h;
      this.image = this.layerCtx.createImageData(w, h);
      this.depth = new Float32Array(w * h);
    }
    const pixels = new Uint32Array(this.image.data.buffer);
    pixels.fill(0); this.depth.fill(-Infinity);
    const shades = directions.map(([nx, ny, nz]) => {
      const nDepth = p.dx * nx + p.dy * ny + p.dz * nz;
      const up = p.cr * nz - p.sr * nx, left = p.cr * nx + p.sr * nz;
      const light = Math.max(0, up * 0.85 - left * 0.36 - ny * 0.18);
      return { visible: nDepth > 0.001, value: Math.max(0.32, Math.min(1.12, 0.43 + light * 0.72)) };
    });
    for (const face of faces) {
      const shade = shades[face.side];
      if (!shade.visible) continue;
      const [nx, ny, nz] = directions[face.side], color = palette[face.material];
      const light = shade.value * (nz < 0 ? 0.65 : 1);
      const col = (255 << 24) | (Math.min(255, Math.round(color[2] * light)) << 16) | (Math.min(255, Math.round(color[1] * light)) << 8) | Math.min(255, Math.round(color[0] * light));
      for (let a = -0.375; a <= 0.375; a += 0.25) for (let b = -0.375; b <= 0.375; b += 0.25) {
        const x = face.x + nx * 0.5 + (nx ? 0 : a), y = face.y + ny * 0.5 + (nx ? a : ny ? 0 : b), z = face.z + nz * 0.5 + (nz ? 0 : b);
        const depth = p.dx * x + p.dy * y + p.dz * z;
        const mag = p.scale * (p.perspective ? 1 / Math.max(0.75, 1 - depth * 0.008) : 1);
        const px = Math.round(p.cx + (p.xx * x + p.xy * y + p.xz * z) * mag), py = Math.round(p.cy + (p.yx * x + p.yy * y + p.yz * z) * mag);
        if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
        const i = py * w + px;
        if (depth > this.depth[i]) { this.depth[i] = depth; pixels[i] = col; }
      }
    }
    outlineShip(pixels, w, h, p.cx - 80, p.cy - 80, p.cx + 80, p.cy + 80);
    this.layerCtx.putImageData(this.image, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
  }
}
export function projectModel(renderer: VoxelProjector, ctx: CanvasRenderingContext2D, faces: Face[], palette: number[][], pose: VoxelPose): void {
  renderer.draw(ctx, faces, palette, projection(pose));
}
