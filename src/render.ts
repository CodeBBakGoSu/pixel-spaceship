import type { CameraState, Segment } from './camera';
import { elevationBracket, wardenTargets, type GameState } from './game';
import type { SpriteCache } from './models';

type Point = { x: number; y: number; scale: number; depth: number };
export type EntityLabels = { font: string; exit: string; warden: string; weakPoint: string };
export function projectWorld(camera: CameraState, x: number, z: number, alt: number, w: number, h: number, mode: Segment): Point | null {
  if (mode === 'overhead') return { x: w / 2 + (x - camera.x) / 1.4 * Math.min(1, w / 240), y: h / 2 - (z - camera.z) / 1.4, scale: 1 / 1.4, depth: z - camera.z };
  const sin = Math.sin(camera.yaw), cos = Math.cos(camera.yaw);
  const dx = x - (camera.x - sin * camera.camOffset), dz = z - (camera.z - cos * camera.camOffset);
  const depth = dx * sin + dz * cos, right = dx * cos - dz * sin;
  if (depth < 8) return null;
  const scale = h * 0.95 / depth;
  return { x: w / 2 + right * h * 0.95 / depth, y: h * 0.3 + camera.pitch * 15 + (camera.altitude + camera.camHeightOffset - alt) * scale, scale, depth };
}

export function drawEntities(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, cache: SpriteCache, s: GameState, mode: Segment, ground: (x: number, z: number) => number, labels: EntityLabels): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const objects = s.entities.map(e => ({ e, point: projectWorld(s.camera, e.x, e.z, e.alt, w, h, mode) }));
  objects.sort((a, b) => (b.point?.depth ?? -1) - (a.point?.depth ?? -1));
  ctx.font = labels.font; ctx.textAlign = 'center';
  for (const { e, point } of objects) {
    if (!point || point.y < -120 || point.y > h + 120) continue;
    if ((point.x < 6 || point.x > w - 6) && (e.kind === 'pylon' || e.kind === 'lock')) {
      ctx.fillStyle = '#ff9a70'; ctx.fillText(point.x < 6 ? '<' : '>', point.x < 6 ? 5 : w - 5, Math.max(12, Math.min(h - 12, point.y)));
    }
    if (point.x < -120 || point.x > w + 120) continue;
    const x = Math.round(point.x), y = Math.round(point.y);
    if (e.kind === 'boss_orb' || e.kind === 'capsule' || e.kind === 'lock') {
      const r = e.kind === 'lock' ? 4 : 3;
      ctx.fillStyle = '#171927'; ctx.fillRect(x-r-1,y-r-1,r*2+2,r*2+2);
      ctx.fillStyle = e.kind === 'lock' ? '#ffbd40' : e.kind === 'capsule' ? '#68e7f1' : '#ff5b82'; ctx.fillRect(x-r,y-r,r*2,r*2);
      ctx.fillStyle = '#fff4ca'; if (e.kind === 'capsule') ctx.fillText('P',x,y+2); else ctx.fillRect(x-1,y-1,2,2);
      if (e.kind === 'lock') {
        const cue = elevationBracket(e.alt,s.player.altitude); ctx.fillStyle = cue === 'inline' ? '#ff5e66' : cue === 'above' ? '#6ef3ff' : '#ffaa4c';
        ctx.fillText(cue === 'inline' ? '[ ]' : cue === 'above' ? '^' : 'v',x,y-8);
      }
      if (glow && e.kind === 'boss_orb') { glow.fillStyle = 'rgba(255,68,89,.25)'; glow.fillRect(x-r*2,y-r*2,r*4,r*4); }
      continue;
    }
    if (e.kind === 'drone' || e.kind === 'supply') {
      const shadow = projectWorld(s.camera, e.x, e.z, ground(e.x, e.z), w, h, mode);
      if (shadow && s.biome !== 'space') { ctx.fillStyle = 'rgba(15,16,26,.28)'; ctx.fillRect(Math.round(shadow.x-4),Math.round(shadow.y+2),9,3); }
    }
    const sprite = e.kind === 'drone' ? cache.drones[Math.max(0,Math.min(8,Math.round(e.bank*8)+4))]
      : e.kind === 'supply' ? cache.supply : e.kind === 'pylon' ? cache.pylon : e.kind === 'door' ? cache.door : cache.ring;
    const base = e.kind === 'drone' || e.kind === 'supply' ? 1.65 : e.kind === 'pylon' ? 1.35 : 1.6;
    const scale = mode === 'overhead' ? 0.65 : Math.max(0.2, Math.min(2.5, point.scale/base)) * Math.min(1,w/240);
    const foot = e.kind === 'pylon' && mode !== 'overhead' ? projectWorld(s.camera,e.x,e.z,ground(e.x,e.z),w,h,mode) : null;
    const spriteY = foot ? Math.round(foot.y) : y, sx = e.kind === 'pylon' ? scale * 0.65 : scale;
    const sy = foot ? Math.max(scale, (spriteY - y + 8) / 49) : scale;
    ctx.save(); if (e.hitFlash > 0) ctx.globalAlpha = 0.5;
    ctx.drawImage(sprite.canvas,Math.round(x-sprite.x*sx),Math.round(spriteY-sprite.y*sy),Math.max(1,Math.round(sprite.canvas.width*sx)),Math.max(1,Math.round(sprite.canvas.height*sy)));
    ctx.restore();
    if (e.kind === 'door' && !s.doorOpen) {
      const width = Math.max(15, Math.round(38*scale)), height = Math.max(12, Math.round(22*scale));
      ctx.fillStyle = '#27303c'; ctx.fillRect(x-width,y-height,width*2,height*2);
      for (let k=-height;k<height;k+=4) { ctx.fillStyle = k%8 ? '#38434d' : '#505965'; ctx.fillRect(x-width,y+k,width*2,2); }
      ctx.fillStyle = '#e0a543'; for (let k=-width;k<width;k+=8) ctx.fillRect(x+k,y+height-3,4,2);
    }
    if (e.kind === 'exit') { ctx.fillStyle='#ffe16c'; ctx.fillText(labels.exit,x,y-18*scale); }
    if (e.kind === 'pylon') { ctx.fillStyle='#171927'; ctx.fillRect(x-6,y-6,12,3); ctx.fillStyle='#ffd454'; ctx.fillRect(x-5,y-5,Math.max(0,Math.round(e.hp/12*10)),1); }
    if (['drone','supply','pylon'].includes(e.kind)) {
      const cue = elevationBracket(e.alt,s.player.altitude); ctx.fillStyle = cue === 'inline' ? '#ff5e66' : cue === 'above' ? '#6ef3ff' : '#ffaa4c';
      ctx.fillText(cue === 'inline' ? '[  ]' : cue === 'above' ? '^' : 'v',x,y-11);
    }
  }
  if (s.boss.active) {
    const p = projectWorld(s.camera,s.boss.x,s.boss.z,s.boss.alt,w,h,mode);
    if (p) {
      const scale = mode === 'overhead' ? 0.62 : Math.max(0.3,Math.min(2,p.scale/1.65))*Math.min(1,w/240);
      const x=Math.round(p.x), y=Math.round(p.y);
      ctx.drawImage(cache.warden.canvas,Math.round(x-cache.warden.x*scale),Math.round(y-cache.warden.y*scale),Math.round(cache.warden.canvas.width*scale),Math.round(cache.warden.canvas.height*scale));
      const open = !s.boss.pods.some(hp => hp > 0);
      ctx.fillStyle='#182331'; ctx.fillRect(x-7,y-7,14,14);
      ctx.fillStyle=open ? '#fff3a6' : '#79dce7'; ctx.fillRect(x-4,y-4,8,8);
      ctx.fillStyle='#11222a'; ctx.fillRect(x-2,y-2,4,4);
      for (const target of wardenTargets(s)) if (target.kind === 'pod') {
        const q = projectWorld(s.camera,target.x,target.z,target.alt,w,h,mode); if (!q) continue;
        const px=Math.round(q.x), py=Math.round(q.y + (mode === 'overhead' ? -(target.alt-s.boss.alt)*0.65 : 0));
        ctx.fillStyle='#1b1c28';ctx.fillRect(px-5,py-5,10,10);ctx.fillStyle='#f8b52e';ctx.fillRect(px-4,py-4,8,8);ctx.fillStyle='#fff0a2';ctx.fillRect(px-2,py-2,4,4);
        const cue=elevationBracket(target.alt,s.player.altitude);ctx.fillStyle=cue==='inline'?'#ff5e66':cue==='above'?'#6ef3ff':'#ffaa4c';ctx.fillText(cue==='inline'?'[ ]':cue==='above'?'^':'v',px,py-7);
      }
      ctx.fillStyle=open ? '#fff09a' : '#ffcf6b';ctx.fillText(open ? labels.weakPoint : labels.warden,x,y-35*scale);
    }
  }
}

export function drawShots(ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D | null, s: GameState, mode: Segment): void {
  const w=ctx.canvas.width,h=ctx.canvas.height;
  for (const b of s.bullets) {
    const p=projectWorld(s.camera,b.x,b.z,b.alt,w,h,mode); if (!p || p.x<0 || p.x>=w || p.y<0 || p.y>=h) continue;
    const x=Math.round(p.x),y=Math.round(p.y),length=mode==='overhead'?5:Math.max(2,Math.min(5,Math.round(p.scale*2)));
    ctx.fillStyle='#211a25';ctx.fillRect(x-1,y-length,3,length*2);ctx.fillStyle=b.friendly?'#a8fff0':'#ff7681';ctx.fillRect(x,y-length+1,1,length*2-2);
    if (glow && b.friendly) { glow.fillStyle='rgba(100,255,218,.16)';glow.fillRect(x-2,y-length,5,length*2); }
  }
  for (const fx of s.effects) {
    const p=projectWorld(s.camera,fx.x,fx.z,fx.alt,w,h,mode); if (!p) continue;
    const r=Math.max(2,Math.round((1-fx.life)*(fx.kind==='burst'?14:20)));ctx.fillStyle=fx.kind==='ring'?'#a4fff0':'#ffb35e';
    for (let i=0;i<8;i++) { const a=i*Math.PI/4;ctx.fillRect(Math.round(p.x+Math.cos(a)*r),Math.round(p.y+Math.sin(a)*r),2,2); }
  }
}
