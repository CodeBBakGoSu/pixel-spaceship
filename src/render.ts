import type { CameraState, Segment } from './camera';
import type { GameState } from './game';
import type { SpriteCache } from './models';

type Point = { x: number; y: number; scale: number; depth: number };
export function projectWorld(camera: CameraState, x: number, z: number, alt: number, w: number, h: number, mode: Segment): Point | null {
  if (mode === 'overhead') return { x: w / 2 + (x - camera.x) / 1.4 * Math.min(1, w / 240), y: h / 2 - (z - camera.z) / 1.4, scale: 1 / 1.4, depth: z - camera.z };
  const sin = Math.sin(camera.yaw), cos = Math.cos(camera.yaw);
  const dx = x - (camera.x - sin * camera.camOffset), dz = z - (camera.z - cos * camera.camOffset);
  const depth = dx * sin + dz * cos, right = dx * cos - dz * sin;
  if (depth < 8) return null;
  const scale = h * 0.95 / depth;
  return { x: w / 2 + right * w / (1.6 * depth), y: h * 0.3 + camera.pitch * 15 + (camera.altitude + camera.camHeightOffset - alt) * scale, scale, depth };
}

export function drawEntities(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, cache: SpriteCache, s: GameState, mode: Segment, ground: (x: number, z: number) => number): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const objects = s.entities.map(e => ({ e, boss: false, point: projectWorld(s.camera, e.x, e.z, e.alt, w, h, mode) }));
  if (s.boss.active && mode !== 'overhead') objects.push({ e: { kind: 'drone', x: s.boss.x, z: s.boss.z, alt: s.boss.alt, vx: 0, vz: 0, hp: s.boss.hp, waveId: 0, bank: Math.sin(s.phaseTime) * 0.2, hitFlash: s.boss.hitFlash, fireTimer: 0, valt: 0 }, boss: true, point: projectWorld(s.camera, s.boss.x, s.boss.z, s.boss.alt, w, h, mode) });
  objects.sort((a, b) => (b.point?.depth ?? -1) - (a.point?.depth ?? -1));
  for (const { e, boss, point } of objects) {
    if (!point || point.x < -150 || point.x > w + 150 || point.y < -150 || point.y > h + 150) continue;
    if (mode === 'overhead' && e.kind !== 'drone') continue;
    const x = Math.round(point.x), y = Math.round(point.y);
    if (e.kind === 'boss_orb') {
      const r = Math.max(2, Math.min(8, Math.round(point.scale * 4)));
      ctx.fillStyle = '#271923'; ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
      ctx.fillStyle = '#ef586c'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = '#fff0b2'; ctx.fillRect(x - 1, y - 1, 2, 2);
      if (glow) { glow.fillStyle = 'rgba(255,68,89,.25)'; glow.fillRect(x - r * 2, y - r * 2, r * 4, r * 4); }
      continue;
    }
    if (e.kind === 'drone') {
      const shadow = projectWorld(s.camera, e.x, e.z, ground(e.x, e.z), w, h, mode);
      if (shadow && !boss) { ctx.fillStyle = 'rgba(15,16,26,.28)'; ctx.fillRect(Math.round(shadow.x - 4), Math.round(shadow.y + 2), 9, 3); }
    }
    const sprite = boss ? cache.boss[Math.max(0, Math.min(2, Math.round(e.bank * 5) + 1))]
      : e.kind === 'drone' ? cache.drones[Math.max(0, Math.min(8, Math.round(e.bank * 8) + 4))]
      : e.kind === 'pillar' ? cache.pillar : cache.ring;
    const base = boss ? 1.5 : e.kind === 'drone' ? 1.65 : e.kind === 'pillar' ? 1.35 : 1.6;
    const scale = mode === 'overhead' ? 0.65 : Math.max(0.15, Math.min(3, point.scale / base)) * Math.min(1, w / 240);
    const sx = scale * (e.kind === 'ring' ? 1.35 : 1), sy = scale * (e.kind === 'pillar' ? 1.5 : e.kind === 'ring' ? 1.35 : 1);
    ctx.save();
    if (e.hitFlash > 0) ctx.globalAlpha = 0.5;
    ctx.drawImage(sprite.canvas, Math.round(x - sprite.x * sx), Math.round(y - sprite.y * sy), Math.max(1, Math.round(sprite.canvas.width * sx)), Math.max(1, Math.round(sprite.canvas.height * sy)));
    ctx.restore();
    if (boss) {
      const r = Math.max(2, Math.min(6, Math.round(point.scale * (s.boss.hp <= 12 ? 2 : 3))));
      ctx.fillStyle = '#261b27'; ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
      ctx.fillStyle = '#ff654c'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = '#ffe8a1'; ctx.fillRect(x - 1, y - 1, 2, 2);
      if (glow) { glow.fillStyle = 'rgba(255,95,60,.25)'; glow.fillRect(x - r * 2, y - r * 2, r * 4, r * 4); }
    }
  }
}

export function drawShots(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, s: GameState, mode: Segment): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  for (const b of s.bullets) {
    const p = projectWorld(s.camera, b.x, b.z, b.alt, w, h, mode);
    if (!p || p.x < 0 || p.x >= w || p.y < 0 || p.y >= h) continue;
    const x = Math.round(p.x), y = Math.round(p.y), length = mode === 'overhead' ? 5 : Math.max(2, Math.min(5, Math.round(p.scale * 2)));
    ctx.fillStyle = '#211a25'; ctx.fillRect(x - 1, y - length, 3, length * 2);
    ctx.fillStyle = b.friendly ? '#a8fff0' : '#ff7681'; ctx.fillRect(x, y - length + 1, 1, length * 2 - 2);
    if (glow && b.friendly) { glow.fillStyle = 'rgba(100,255,218,.16)'; glow.fillRect(x - 2, y - length, 5, length * 2); }
  }
  for (const fx of s.effects) {
    const p = projectWorld(s.camera, fx.x, fx.z, fx.alt, w, h, mode);
    if (!p) continue;
    const r = Math.max(2, Math.round((1 - fx.life) * (fx.kind === 'burst' ? 14 : 8)));
    ctx.fillStyle = fx.kind === 'ring' ? '#a4fff0' : '#ffb35e';
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.fillRect(Math.round(p.x + Math.cos(a) * r), Math.round(p.y + Math.sin(a) * r), 2, 2); }
  }
}
