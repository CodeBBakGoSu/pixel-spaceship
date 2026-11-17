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
  private particles: Particle[] = Array.from({ length: 96 }, () => ({ x: 0, z: 0, altitude: 0, vx: 0, vz: 0, life: 0, total: 1, size: 1 }));
  private particleIndex = 0;
  private halo = document.createElement('canvas');
  private emission = 0;
  private time = 0;
  private bank = 0;

  constructor() {
    this.halo.width = this.halo.height = 32;
    const halo = this.halo.getContext('2d')!, gradient = halo.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,160,62,.42)'); gradient.addColorStop(1, 'rgba(255,65,12,0)');
    halo.fillStyle = gradient; halo.fillRect(0, 0, 32, 32);
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
    this.emission += dt * (18 + ship.boost * 20);
    const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw), rx = fz, rz = -fx;
    for (const p of this.particles) if (p.life > 0) { p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt; }
    while (this.emission >= 1) {
      this.emission--;
      for (const side of [-1, 1]) {
        const distance = 27, across = side * 8.25, exhaustSpeed = 42 + ship.boost * 38;
        const life = 0.3 + Math.random() * (0.35 + ship.boost * 0.25), p = this.particles[this.particleIndex++ % this.particles.length];
        p.x = ship.x - fx * distance + rx * across; p.z = ship.z - fz * distance + rz * across;
        p.altitude = ship.altitude - 1.5; p.vx = fx * (ship.speed - exhaustSpeed); p.vz = fz * (ship.speed - exhaustSpeed);
        p.life = p.total = life; p.size = 1 + Math.random() * (1.5 + ship.boost);
      }
    }
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

    // A fixed particle pool and a cached halo avoid per-frame allocations during boost.
    const cos = Math.cos(ship.yaw), sin = Math.sin(ship.yaw);
    for (const p of this.particles) if (p.life > 0) {
      const ax = p.x - ship.x, az = p.z - ship.z;
      const point = project((ax * cos - az * sin) / 1.5, -(ax * sin + az * cos) / 1.5, (p.altitude - ship.altitude) / 1.5 - 1);
      const alpha = p.life / p.total, size = Math.max(1, Math.round(p.size * point.scale * alpha));
      ctx.fillStyle = alpha > 0.5 ? '#ffa846' : '#e5572d';
      ctx.fillRect(Math.round(point.x - size / 2), Math.round(point.y - size / 2), size, size);
    }
    const length = (13 + ship.boost * 22) * (0.88 + 0.12 * Math.sin(this.time * 34));
    if (ship.boost > 0.1) for (const side of [-1, 1]) {
      ctx.strokeStyle = side < 0 ? 'rgba(255,110,185,.65)' : 'rgba(107,237,255,.65)';
      ctx.lineWidth = Math.max(1, scale * 1.3); ctx.beginPath();
      for (const t of [0, 25, 50]) { const q = project(side * (15 + t * 0.04), 8 + t, 1); if (!t) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
    if (glow) glow.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const steps = ship.boost > 0.1 ? 18 : 11;
      for (let pass = 0; pass < 3; pass++) for (let i = steps; i >= 0; i--) {
        const u = i / steps; if (pass === 2 && u > 0.78) continue;
        const t = u * length, sway = Math.sin(this.time * 23 + t * 0.9 + side) * u;
        const point = project(side * 5.5 + sway, 18 + t, -1);
        const r = Math.max(1, Math.round((2.3 + ship.boost * 2.1) * (1 - u * 0.8) * point.scale * (pass === 0 ? 1.25 : pass === 1 ? 1 : 0.48)));
        const x = Math.round(point.x), y = Math.round(point.y);
        ctx.fillStyle = pass === 0 ? '#b9422e' : pass === 1 ? (u > 0.7 ? '#d64931' : u > 0.34 ? '#f8742e' : '#ffae43') : u < 0.24 ? '#fff9d4' : u < 0.56 ? '#ffe678' : '#ffb542';
        ctx.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
      }
      if (glow) for (const u of [0.2, 0.6]) {
        const point = project(side * 5.5, 18 + length * u, -1), radius = (5 + ship.boost * 5) * (1 - u * 0.45) * point.scale;
        glow.drawImage(this.halo, point.x - radius, point.y - radius, radius * 2, radius * 2);
      }
    }

    this.projector.draw(ctx, this.faces, palette, camera);
    ctx.restore();
    if (glow) glow.restore();
  }
}

export function drawCockpit(ctx: CanvasRenderingContext2D, pitch: number, aimX = 0, aimY = 0, slide = 0, altitude = 110, speed = 120, bottomInset = 0, panelScale = 1, safeLeft = 0, safeRight = 0): void {
  const w=ctx.canvas.width,h=ctx.canvas.height,cx=Math.floor((w+safeLeft-safeRight)/2),panel=Math.round(h-34*panelScale-bottomInset);
  ctx.save();ctx.translate(0,slide*h*0.45);
  // Canopy ribs and luminous pitch ladder.
  const frameBottom=bottomInset ? panel+34*panelScale : h;
  ctx.strokeStyle='#182635';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(safeLeft,frameBottom);ctx.lineTo(w*0.07,0);ctx.moveTo(w-safeRight,frameBottom);ctx.lineTo(w*0.93,0);ctx.stroke();
  ctx.strokeStyle='rgba(134,234,189,.68)';ctx.lineWidth=1;
  for (let i=-2;i<=2;i++) { const y=Math.round(h*0.43+i*15+pitch*10);ctx.beginPath();ctx.moveTo(cx-22,y);ctx.lineTo(cx-8,y);ctx.moveTo(cx+8,y);ctx.lineTo(cx+22,y);ctx.stroke(); }
  if(panelScale!==1){ctx.save();ctx.translate(0,panel);ctx.scale(1,panelScale);ctx.translate(0,-panel);}
  ctx.fillStyle='#152431';ctx.fillRect(0,panel,w,34);ctx.fillStyle='#415866';ctx.fillRect(0,panel,w,2);
  ctx.fillStyle='#071c1b';ctx.fillRect(safeLeft+7,panel+5,Math.max(36,(w-safeLeft-safeRight)*0.25),24);ctx.fillStyle='#0c2927';ctx.fillRect(w-safeRight-70,panel+5,62,24);
  ctx.fillStyle='#7ddf9e';ctx.font='bold 5px monospace';ctx.textAlign='left';ctx.fillText('RDR',safeLeft+10,panel+11);ctx.fillText('SPD '+Math.round(speed),w-safeRight-66,panel+12);ctx.fillText('ALT '+Math.round(altitude),w-safeRight-66,panel+21);
  const rx=safeLeft+28,ry=panel+19;ctx.strokeStyle='#2c7957';ctx.beginPath();ctx.arc(rx,ry,8,0,Math.PI*2);ctx.moveTo(rx-8,ry);ctx.lineTo(rx+8,ry);ctx.moveTo(rx,ry-8);ctx.lineTo(rx,ry+8);ctx.stroke();ctx.fillStyle='#a5f0c2';ctx.fillRect(rx+3,ry-5,2,2);
  ctx.fillStyle='#b5dbe0';ctx.fillText('TWIN',cx-15,panel+11);ctx.fillStyle='#58d5c9';for(let i=0;i<5;i++)ctx.fillRect(cx-15+i*5,panel+17,4,4);
  if(panelScale!==1)ctx.restore();
  const sightX=Math.round(cx+aimX*w*0.38),sightY=Math.floor(h*0.42+aimY*h*0.27+pitch*8);
  ctx.fillStyle='rgba(169,230,208,.9)';ctx.fillRect(sightX-10,sightY,6,1);ctx.fillRect(sightX+5,sightY,6,1);ctx.fillRect(sightX,sightY-9,1,5);ctx.fillRect(sightX,sightY+5,1,5);
  ctx.restore();
}
