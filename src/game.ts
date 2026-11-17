import { advanceBank } from './flight.ts';
import type { CameraState, Segment } from './camera.ts';
export type { CameraState, Segment } from './camera.ts';
export type GamePhase = 'title' | 'playing' | 'transition' | 'win' | 'game_over';
export type GameOptions = { segment: Segment | 'boss' | null; seed: number; autoplay: boolean; loop: number; time: number };
export type GameInput = { moveX: number; moveY: number; fire: boolean; aimX?: number; aimY?: number; start?: boolean; restart?: boolean; next?: boolean; pause?: boolean };
export type Entity = {
  kind: 'drone' | 'pillar' | 'ring' | 'boss_orb'; x: number; z: number; alt: number; vx: number; vz: number;
  hp: number; waveId: number; bank: number; hitFlash: number; fireTimer: number; valt: number; shotDown?: boolean;
};
export type Bullet = { x: number; y: number; z: number; alt: number; vx: number; vy: number; vz: number; friendly: boolean; life: number };
export type GameState = {
  phase: GamePhase; segment: Segment; nextSegment: Segment; loop: number; loopSpeed: number; score: number;
  lives: number; hull: number; phaseTime: number; transitionT: number; invulnTimer: number; aimX: number; aimY: number;
  rng: number; seed: number; autoplay: boolean; paused: boolean; elapsed: number; spawnTimer: number; waveId: number;
  waves: { id: number; remaining: number; perfect: boolean }[];
  player: { x: number; y: number; z: number; altitude: number; bank: number; yaw: number; fireCooldown: number };
  camera: CameraState; entities: Entity[]; bullets: Bullet[];
  effects: { x: number; z: number; alt: number; life: number; kind: 'hit' | 'ring' | 'burst' }[];
  boss: { active: boolean; hp: number; maxHp: number; x: number; z: number; alt: number; fireTimer: number; hitFlash: number; hitCooldown: number };
};
type Ground = (x: number, z: number) => number;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const smooth = (n: number) => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const blankBoss = () => ({ active: false, hp: 24, maxHp: 24, x: 0, z: 110, alt: 90, fireTimer: 1.3, hitFlash: 0, hitCooldown: 0 });

export function parseGameOptions(search: string): GameOptions {
  const q = new URLSearchParams(search), raw = q.get('segment');
  const segment = raw === 'overhead' || raw === 'chase' || raw === 'cockpit' || raw === 'boss' ? raw : null;
  const seedValue = q.get('seed'), seed = seedValue !== null && /^-?\d+$/.test(seedValue) ? Number(seedValue) >>> 0 : 1;
  const loopValue = Number(q.get('loop')), timeValue = Number(q.get('t'));
  return { segment, seed, autoplay: q.get('autoplay') === '1', loop: Number.isFinite(loopValue) && loopValue >= 1 ? Math.min(99, Math.floor(loopValue)) : 1, time: Number.isFinite(timeValue) ? clamp(timeValue, 0, 180) : 0 };
}

// Mulberry32 advances only the state supplied by the caller.
function random(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let n = s.rng;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
function entity(kind: Entity['kind'], x: number, z: number, alt: number): Entity {
  return { kind, x, z, alt, vx: 0, vz: 0, hp: kind === 'drone' ? 2 : 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 2, valt: 0 };
}
function spawnWave(s: GameState): void {
  if (s.entities.filter(e => e.kind === 'drone').length > 4) return;
  const id = ++s.waveId, center = (random(s) - 0.5) * 60;
  s.waves.push({ id, remaining: 4, perfect: true });
  for (let i = 0; i < 4; i++) {
    const e = entity('drone', center + (i - 1.5) * 31, s.camera.z + 112 + (i % 2) * 13, s.player.altitude);
    e.waveId = id; e.vz = -8 - random(s) * 5; e.fireTimer = 2.5 + random(s) * 1.5;
    s.entities.push(e);
  }
}
function spawnCanyon(s: GameState, ground: Ground, first = false): void {
  const base = s.player.z + (first ? 145 : 240);
  if (s.entities.filter(e => e.kind === 'ring').length < 4) {
    const ring = entity('ring', first ? 0 : (random(s) - 0.5) * 80, base, clamp(s.player.altitude + (first ? 0 : (random(s) - 0.5) * 25), 65, 145));
    s.entities.push(ring);
  }
  for (let i = 0; i < 2 && s.entities.filter(e => e.kind === 'pillar').length < 8; i++) {
    const x = first ? (i ? 38 : -38) : (random(s) - 0.5) * 100;
    const z = base + 30 + i * 35;
    s.entities.push(entity('pillar', x, z, ground(x, z)));
  }
  if (s.entities.filter(e => e.kind === 'drone').length < 8) {
    const drone = entity('drone', first ? 27 : (random(s) - 0.5) * 90, base + 65, s.player.altitude + 5);
    drone.vz = -7; drone.fireTimer = 2.3; s.entities.push(drone);
  }
}
function enterSegment(s: GameState, segment: Segment, ground: Ground): void {
  s.segment = segment; s.nextSegment = segment; s.phase = 'playing'; s.phaseTime = 0; s.transitionT = 0;
  s.entities = []; s.bullets = []; s.effects = []; s.waves = []; s.spawnTimer = segment === 'overhead' ? 0.6 : 7;
  s.player.x = 0; s.player.y = -65; s.player.yaw = 0; s.player.bank = 0;
  s.player.altitude = clamp(Math.max(s.player.altitude, ground(0, s.player.z) + 65), 65, 150);
  s.camera = { mode: segment, x: 0, z: segment === 'overhead' ? s.player.z - s.player.y : s.player.z, yaw: 0,
    altitude: s.player.altitude, pitch: 0, camOffset: segment === 'chase' ? 38 : 0, camHeightOffset: segment === 'chase' ? 18 : 2, crossFade: segment === 'overhead' ? 0 : 1 };
  if (segment === 'chase') spawnCanyon(s, ground, true);
}

export function createGame(options: GameOptions = parseGameOptions(''), ground: Ground = () => 30): GameState {
  const segment: Segment = options.segment === 'boss' ? 'cockpit' : options.segment || 'overhead';
  const s: GameState = { phase: options.segment ? 'playing' : 'title', segment, nextSegment: segment,
    loop: options.loop, loopSpeed: Math.min(1.8, 1 + (options.loop - 1) * 0.2), score: 0, lives: 3, hull: 8,
    phaseTime: 0, transitionT: 0, invulnTimer: 0, aimX: 0, aimY: 0, rng: options.seed >>> 0, seed: options.seed >>> 0,
    autoplay: options.autoplay, paused: false, elapsed: 0, spawnTimer: 0.6, waveId: 0, waves: [],
    player: { x: 0, y: -65, z: 0, altitude: 110, bank: 0, yaw: 0, fireCooldown: 0 },
    camera: { mode: segment, x: 0, z: 65, yaw: 0, altitude: 110, pitch: 0, camOffset: 0, camHeightOffset: 2, crossFade: 0 },
    entities: [], bullets: [], effects: [], boss: blankBoss() };
  if (options.segment) enterSegment(s, segment, ground);
  if (options.segment === 'boss') { s.boss.active = true; s.boss.x = 0; s.boss.z = s.player.z + 110; s.boss.alt = s.player.altitude - 8; }
  return s;
}
export function restartGame(s: GameState, ground: Ground = () => 30): GameState {
  return createGame({ segment: 'overhead', seed: s.seed, autoplay: s.autoplay, loop: 1, time: 0 }, ground);
}
export function nextLoop(s: GameState, ground: Ground = () => 30): GameState {
  const next = createGame({ segment: 'overhead', seed: s.seed, autoplay: s.autoplay, loop: s.loop + 1, time: 0 }, ground);
  next.score = s.score; next.lives = s.lives; return next;
}
function copy(s: GameState): GameState {
  return { ...s, player: { ...s.player }, camera: { ...s.camera }, boss: { ...s.boss }, entities: s.entities.map(e => ({ ...e })), bullets: s.bullets.map(b => ({ ...b })), effects: s.effects.map(e => ({ ...e })), waves: s.waves.map(w => ({ ...w })) };
}
function damage(s: GameState): void {
  if (s.invulnTimer > 0 || s.phase !== 'playing') return;
  s.hull -= 2; s.invulnTimer = 1;
  s.effects.push({ x: s.player.x, z: s.player.z, alt: s.player.altitude, life: 0.5, kind: 'hit' });
  if (s.hull <= 0) {
    s.lives--;
    if (s.lives <= 0) { s.lives = 0; s.hull = 0; s.phase = 'game_over'; }
    else { s.hull = 8; s.invulnTimer = 2; }
  }
}
function updateCamera(s: GameState): void {
  const p = s.player, c = s.camera;
  c.altitude = p.altitude; c.pitch = 0;
  if (s.phase === 'transition') {
    const t = smooth(s.transitionT);
    if (s.segment === 'overhead') {
      c.mode = 'chase'; c.x = p.x * 0.45 * t; c.z = lerp(p.z - p.y, p.z, t); c.yaw = p.yaw * t;
      c.camOffset = 38 * t; c.camHeightOffset = lerp(2, 18, t); c.crossFade = smooth((s.transitionT - 0.2) / 0.4);
    } else {
      c.mode = 'cockpit'; c.x = p.x * 0.45; c.z = p.z; c.yaw = p.yaw;
      c.camOffset = 38 * (1 - t); c.camHeightOffset = lerp(18, 2, t); c.crossFade = 1;
    }
  } else if (s.segment === 'overhead') {
    c.mode = 'overhead'; c.x = 0; c.z = p.z - p.y; c.yaw = 0; c.camOffset = 0; c.camHeightOffset = 2; c.crossFade = 0;
  } else {
    c.mode = s.segment; c.x = p.x * 0.45; c.z = p.z; c.yaw = p.yaw; c.camOffset = s.segment === 'chase' ? 38 : 0; c.camHeightOffset = s.segment === 'chase' ? 18 : 2; c.crossFade = 1;
  }
}
function bot(s: GameState): GameInput {
  if (s.segment === 'overhead') {
    const target = s.entities.filter(e => e.kind === 'drone' && e.z > s.player.z).sort((a, b) => a.z - b.z)[0];
    return { moveX: target ? clamp((target.x - s.player.x) / 25, -1, 1) : Math.sin(s.phaseTime * 0.7) * 0.4, moveY: 0, fire: true };
  }
  if (s.segment === 'chase') {
    const ring = s.entities.filter(e => e.kind === 'ring' && e.z > s.player.z).sort((a, b) => a.z - b.z)[0];
    const pillar = s.entities.find(e => e.kind === 'pillar' && e.z > s.player.z && e.z - s.player.z < 55 && Math.abs(e.x - s.player.x) < 20);
    return { moveX: pillar ? (pillar.x > s.player.x ? -1 : 1) : ring ? clamp((ring.x - s.player.x) / 20 + Math.sin(s.phaseTime * 1.6) * 0.4, -1, 1) : Math.sin(s.phaseTime * 0.6) * 0.3,
      moveY: ring ? clamp((s.player.altitude - ring.alt) / 18, -1, 1) : 0, fire: true };
  }
  if (s.boss.active) {
    const depth = Math.max(40, s.boss.z - s.player.z), right = (s.boss.x - s.camera.x) - Math.sin(s.camera.yaw) * depth;
    const aimX = clamp(right / (0.608 * depth), -1, 1);
    const aimY = clamp((0.3 + 0.95 * (s.camera.altitude + s.camera.camHeightOffset - s.boss.alt) / depth - 0.42) / 0.27, -1, 1);
    return { moveX: 0, moveY: 0, aimX, aimY, fire: true };
  }
  return { moveX: 0, moveY: 0, aimX: Math.sin(s.phaseTime) * 0.18, aimY: -0.1, fire: true };
}

export function stepGame(previous: GameState, input: GameInput, elapsed: number, ground: Ground = () => 30): GameState {
  const s = copy(previous), dt = clamp(elapsed, 0, 0.05);
  if (input.restart) return restartGame(s, ground);
  if (s.phase === 'win' && (input.next || input.start)) return nextLoop(s, ground);
  if (s.phase === 'game_over' && input.start) return restartGame(s, ground);
  if (s.phase === 'title') {
    if (input.start) return restartGame(s, ground);
    s.player.z += dt * 8; updateCamera(s); return s;
  }
  if (s.phase === 'win' || s.phase === 'game_over') return s;
  if (input.pause) s.paused = !s.paused;
  if (s.paused) return s;
  s.elapsed += dt; s.invulnTimer = Math.max(0, s.invulnTimer - dt);
  if (s.phase === 'transition') {
    s.transitionT = Math.min(1, s.transitionT + dt / 1.5); updateCamera(s);
    if (s.transitionT >= 1) enterSegment(s, s.nextSegment, ground);
    return s;
  }
  const control = s.autoplay ? bot(s) : input;
  const mx = clamp(control.moveX, -1, 1), my = clamp(control.moveY, -1, 1), p = s.player;
  s.phaseTime += dt;
  p.bank = advanceBank(p.bank, mx, dt);
  if (s.segment === 'overhead') {
    p.x = clamp(p.x + mx * 100 * dt, -110, 110); p.y = clamp(p.y - my * 100 * dt, -95, 55);
    s.camera.z += 34 * s.loopSpeed * dt; p.z = s.camera.z + p.y; p.yaw = 0;
  } else {
    p.x = clamp(p.x + mx * 42 * dt, -55, 55);
    p.z += 38 * s.loopSpeed * dt;
    p.altitude = clamp(p.altitude - my * 32 * dt, ground(p.x, p.z) + 22, 160);
    p.yaw += (mx * 0.16 - p.yaw) * Math.min(1, dt * 3);
    if (s.segment === 'cockpit') {
      s.aimX = control.aimX !== undefined ? clamp(control.aimX, -1, 1) : clamp(s.aimX + mx * dt * 1.4, -1, 1);
      s.aimY = control.aimY !== undefined ? clamp(control.aimY, -1, 1) : clamp(s.aimY + my * dt * 1.4, -1, 1);
    }
  }
  updateCamera(s);
  if (s.segment === 'overhead' && s.phaseTime >= 30 || s.segment === 'chase' && s.phaseTime >= 35) {
    s.phase = 'transition'; s.nextSegment = s.segment === 'overhead' ? 'chase' : 'cockpit'; s.transitionT = 0; s.invulnTimer = Math.max(s.invulnTimer, 1.5); updateCamera(s); return s;
  }
  s.spawnTimer -= dt;
  if (s.spawnTimer <= 0 && s.segment === 'overhead') { spawnWave(s); s.spawnTimer = 5 / s.loopSpeed; }
  if (s.spawnTimer <= 0 && s.segment === 'chase') { spawnCanyon(s, ground); s.spawnTimer = 7 / s.loopSpeed; }
  if (s.segment === 'cockpit' && !s.boss.active && s.phaseTime >= 12) { s.boss.active = true; s.boss.fireTimer = 1.3; }
  if (s.boss.active) {
    const phase2 = s.boss.hp <= 12, t = s.phaseTime;
    s.boss.x = Math.sin(t * (phase2 ? 1.05 : 0.65)) * (phase2 ? 28 : 18);
    s.boss.z = p.z + 110; s.boss.alt = p.altitude - 8 + Math.sin(t * 0.9) * (phase2 ? 12 : 7);
    s.boss.fireTimer -= dt; s.boss.hitFlash = Math.max(0, s.boss.hitFlash - dt); s.boss.hitCooldown = Math.max(0, s.boss.hitCooldown - dt);
    if (s.boss.fireTimer <= 0) {
      for (let i = phase2 ? -1 : 0; i <= (phase2 ? 1 : 0); i++) {
        const orb = entity('boss_orb', s.boss.x + i * 7, s.boss.z - 5, s.boss.alt);
        const travel = Math.max(1, orb.z - p.z), velocity = 75;
        orb.vx = (p.x - orb.x) / travel * velocity + i * 8; orb.valt = (p.altitude - orb.alt) / travel * velocity; orb.vz = -velocity;
        s.entities.push(orb);
      }
      s.boss.fireTimer = (phase2 ? 1.7 : 2.5) / s.loopSpeed;
    }
  }
  p.fireCooldown -= dt;
  if (control.fire && p.fireCooldown <= 0 && s.bullets.filter(b => b.friendly).length <= 30) {
    for (const side of [-1, 1]) {
      let vx = 0, vy = 0, vz = 230;
      if (s.segment === 'cockpit') {
        const depth = 110, camX = s.camera.x, angle = s.camera.yaw;
        const targetX = camX + Math.sin(angle) * depth + Math.cos(angle) * s.aimX * 0.608 * depth;
        const targetAlt = s.camera.altitude + s.camera.camHeightOffset - (0.12 + s.aimY * 0.27) * depth / 0.95;
        vx = (targetX - p.x) / depth * vz; vy = (targetAlt - p.altitude) / depth * vz;
      }
      s.bullets.push({ x: p.x + side * 3, y: 0, z: p.z + 8, alt: p.altitude, vx, vy, vz, friendly: true, life: 2 });
    }
    p.fireCooldown = 0.2;
  }
  const oldZ = previous.player.z;
  for (const e of s.entities) {
    e.x += e.vx * dt; e.z += e.vz * dt; e.alt += e.valt * dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt); e.fireTimer -= dt;
    if (e.kind === 'drone') {
      e.bank = Math.sin(s.elapsed * 2 + e.waveId) * 0.35;
      if (e.fireTimer <= 0 && s.bullets.filter(b => !b.friendly).length < 48) {
        const dz = Math.max(1, e.z - p.z), speed = 55;
        s.bullets.push({ x: e.x, y: 0, z: e.z - 3, alt: e.alt, vx: (p.x - e.x) / dz * speed, vy: (p.altitude - e.alt) / dz * speed, vz: -speed, friendly: false, life: 4 });
        e.fireTimer = 3 + random(s) * 2;
      }
      if (Math.abs(e.z - p.z) < 9 && Math.abs(e.x - p.x) < 10 && (s.segment === 'overhead' || Math.abs(e.alt - p.altitude) < 12)) { damage(s); e.hp = 0; }
    } else if (e.kind === 'boss_orb') {
      if (Math.abs(e.z - p.z) < 8 && Math.abs(e.x - p.x) < 9 && Math.abs(e.alt - p.altitude) < 10) { damage(s); e.hp = 0; }
    } else if (oldZ <= e.z && p.z >= e.z) {
      if (e.kind === 'ring' && Math.abs(e.x - p.x) < 14 && Math.abs(e.alt - p.altitude) < 14) {
        s.score += 250; s.hull = Math.min(8, s.hull + 1); e.hp = 0;
        s.effects.push({ x: e.x, z: e.z, alt: e.alt, life: 0.7, kind: 'ring' });
      } else if (e.kind === 'pillar' && Math.abs(e.x - p.x) < 10 && p.altitude < e.alt + 55) { damage(s); e.hp = 0; }
    }
  }
  for (const b of s.bullets) {
    b.x += b.vx * dt; b.z += b.vz * dt; b.alt += b.vy * dt; b.life -= dt;
    if (!b.friendly) {
      if (Math.abs(b.x - p.x) < 8 && Math.abs(b.z - p.z) < 8 && (s.segment === 'overhead' || Math.abs(b.alt - p.altitude) < 9)) { damage(s); b.life = 0; }
      continue;
    }
    for (const e of s.entities) {
      if ((e.kind !== 'drone' && e.kind !== 'boss_orb') || e.hp <= 0) continue;
      if (Math.abs(b.x - e.x) < 10 && Math.abs(b.z - e.z) < 10 && (s.segment === 'overhead' || Math.abs(b.alt - e.alt) < 10)) { e.hp--; if (e.hp <= 0) e.shotDown = true; e.hitFlash = 0.12; b.life = 0; break; }
    }
    if (b.life > 0 && s.boss.active && s.boss.hitCooldown <= 0 && Math.abs(b.x - s.boss.x) < (s.boss.hp <= 12 ? 9 : 16) && Math.abs(b.z - s.boss.z) < 9 && Math.abs(b.alt - s.boss.alt) < (s.boss.hp <= 12 ? 8 : 12)) {
      s.boss.hp--; s.boss.hitFlash = 0.12; s.boss.hitCooldown = 0.45; b.life = 0;
      if (s.boss.hp <= 0) { s.score += 2000 + 500 * s.lives; s.phase = 'win'; s.boss.active = false; s.effects.push({ x: s.boss.x, z: s.boss.z, alt: s.boss.alt, life: 1, kind: 'burst' }); }
    }
  }
  for (const e of s.entities) if (e.hp <= 0 || e.z < p.z - 100) {
    const destroyed = e.hp <= 0;
    if (destroyed && e.kind === 'drone') { if (e.shotDown) s.score += 100; s.effects.push({ x: e.x, z: e.z, alt: e.alt, life: 0.45, kind: 'burst' }); }
    if (destroyed && e.kind === 'boss_orb') { if (e.shotDown) s.score += 50; s.effects.push({ x: e.x, z: e.z, alt: e.alt, life: 0.3, kind: 'hit' }); }
    const wave = s.waves.find(w => w.id === e.waveId && e.waveId !== 0);
    if (wave) { wave.remaining--; if (!e.shotDown) wave.perfect = false; if (wave.remaining === 0 && wave.perfect) s.score += 300; }
  }
  s.entities = s.entities.filter(e => e.hp > 0 && e.z >= p.z - 100);
  s.bullets = s.bullets.filter(b => b.life > 0);
  for (const fx of s.effects) fx.life -= dt;
  s.effects = s.effects.filter(fx => fx.life > 0);
  s.waves = s.waves.filter(w => w.remaining > 0);
  return s;
}
