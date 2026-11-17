import { advanceBank } from './flight.ts';
import type { CameraState, Segment } from './camera.ts';
export type { CameraState, Segment } from './camera.ts';

export type SegmentId = 'reach' | 'atoll' | 'canyon' | 'orbit';
export type Biome = 'jungle' | 'canyon' | 'space';
export type Rank = 'S' | 'A' | 'B' | 'C';
export type DialogueBeat = { at: number; speaker: 'OPAL' | 'GALE' | 'WARDEN'; text: string };
export type SegmentDef = { id: SegmentId; name: string; defaultView: Segment; biome: Biome; goal: 'waves' | 'pylons' | 'doors' | 'boss'; duration?: number; waveEvery: number; supplyEvery: number; doorCount?: number; approach?: number; beats: DialogueBeat[] };
export const SCRIPT: readonly SegmentDef[] = [
  { id: 'reach', name: 'KESTREL REACH', defaultView: 'overhead', biome: 'jungle', goal: 'waves', duration: 50, waveEvery: 12, supplyEvery: 14, beats: [
    { at: 0, speaker: 'OPAL', text: 'Kestrel Reach ahead. Watch your altitude, courier.' },
    { at: 10, speaker: 'GALE', text: 'Supply drones carry power capsules. Grab what you can.' },
  ] },
  { id: 'atoll', name: 'THE ATOLL', defaultView: 'chase', biome: 'jungle', goal: 'pylons', waveEvery: 25, supplyEvery: 18, beats: [
    { at: 0, speaker: 'OPAL', text: 'Four relay pylons guard the exit. Take them down.' },
  ] },
  { id: 'canyon', name: 'BASE CANYON', defaultView: 'chase', biome: 'canyon', goal: 'doors', waveEvery: 24, supplyEvery: 18, doorCount: 3, beats: [
    { at: 0, speaker: 'GALE', text: 'Blast doors ahead. Shoot both locks to open each gate.' },
  ] },
  { id: 'orbit', name: 'KESTREL ORBIT', defaultView: 'cockpit', biome: 'space', goal: 'boss', waveEvery: 12, supplyEvery: 18, approach: 14, beats: [
    { at: 0, speaker: 'WARDEN', text: 'Unregistered courier. This lane is closed.' },
    { at: 7, speaker: 'OPAL', text: 'Break the four outer pods. Then hit the eye.' },
  ] },
];
export type GamePhase = 'title' | 'playing' | 'transition' | 'win' | 'game_over';
export type GameOptions = { segment: SegmentId | null; view: Segment | null; seed: number; autoplay: boolean; loop: number; time: number; touch: boolean; boss?: boolean };
export type GameInput = { moveX: number; moveY: number; fire: boolean; aimX?: number; aimY?: number; aspect?: number; start?: boolean; restart?: boolean; next?: boolean; pause?: boolean; boost?: boolean; bomb?: boolean; toggleView?: boolean };
export type Entity = {
  kind: 'drone' | 'supply' | 'pylon' | 'exit' | 'door' | 'lock' | 'capsule' | 'boss_orb';
  x: number; z: number; alt: number; vx: number; vz: number; hp: number; waveId: number; bank: number;
  hitFlash: number; fireTimer: number; valt: number; shotDown?: boolean;
};
export type Bullet = { x: number; y: number; z: number; alt: number; vx: number; vy: number; vz: number; friendly: boolean; life: number };
export type GameState = {
  phase: GamePhase; segment: SegmentId; nextSegment: SegmentId; initialView: Segment | null; scriptIndex: number; biome: Biome; objective: string;
  loop: number; loopSpeed: number; score: number; salvage: number; lives: number; hull: number; maxHull: number; hitsTaken: number; rank: Rank | null;
  bst: number; boosting: boolean; bombs: number; weaponLv: 1 | 2 | 3; peakWeaponLv: 1 | 2 | 3; roll: number; wipeT: number; viewTagT: number;
  dialogue: { speaker: string; text: string; timer: number } | null; beatIndex: number;
  phaseTime: number; transitionT: number; invulnTimer: number; aimX: number; aimY: number; aspect: number;
  rng: number; seed: number; autoplay: boolean; paused: boolean; elapsed: number; spawnTimer: number; supplyTimer: number; waveId: number;
  pylonsDown: number; doorsCleared: number; doorOpen: boolean; doorTimer: number; boundaryWarning: boolean; botRetreat: boolean;
  arena: { x: number; z: number; radius: number };
  waves: { id: number; remaining: number; perfect: boolean }[];
  player: { x: number; y: number; z: number; altitude: number; bank: number; yaw: number; fireCooldown: number };
  camera: CameraState; entities: Entity[]; bullets: Bullet[];
  effects: { x: number; z: number; alt: number; life: number; kind: 'hit' | 'ring' | 'burst' }[];
  boss: { active: boolean; hp: number; maxHp: number; pods: number[]; coreHp: number; maxCoreHp: number; x: number; z: number; alt: number; fireTimer: number; hitFlash: number };
};
type Ground = (x: number, z: number) => number;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const blankBoss = () => ({ active: false, hp: 104, maxHp: 104, pods: [16, 16, 16, 16], coreHp: 40, maxCoreHp: 40, x: 0, z: 110, alt: 110, fireTimer: 2.5, hitFlash: 0 });
export const elevationBracket = (target: number, player: number): 'inline' | 'above' | 'below' => Math.abs(target - player) < 18 ? 'inline' : target > player ? 'above' : 'below';
export const calculateRank = (hits: number): Rank => hits === 0 ? 'S' : hits <= 2 ? 'A' : hits <= 5 ? 'B' : 'C';

export function parseGameOptions(search: string): GameOptions {
  const q = new URLSearchParams(search), raw = q.get('segment');
  const aliases: Record<string, SegmentId> = { reach: 'reach', atoll: 'atoll', canyon: 'canyon', orbit: 'orbit', overhead: 'reach', chase: 'atoll', cockpit: 'orbit', boss: 'orbit' };
  const v = q.get('view'), view = v === 'overhead' || v === 'chase' || v === 'cockpit' ? v : null;
  const seedValue = q.get('seed'), seed = seedValue !== null && /^-?\d+$/.test(seedValue) ? Number(seedValue) >>> 0 : 1;
  const loopValue = Number(q.get('loop')), timeValue = Number(q.get('t'));
  return { segment: raw ? aliases[raw] || null : null, view, seed, autoplay: q.get('autoplay') === '1', loop: Number.isFinite(loopValue) && loopValue >= 1 ? Math.min(99, Math.floor(loopValue)) : 1, time: Number.isFinite(timeValue) ? clamp(timeValue, 0, 600) : 0, touch: q.get('touch') === '1', ...(raw === 'boss' ? { boss: true } : {}) };
}
// Mulberry32 state belongs entirely to the simulation.
function random(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let n = s.rng; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
function entity(kind: Entity['kind'], x: number, z: number, alt: number): Entity {
  return { kind, x, z, alt, vx: 0, vz: 0, hp: kind === 'pylon' ? 12 : kind === 'lock' ? 8 : kind === 'drone' || kind === 'supply' ? 2 : 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 3, valt: 0 };
}
function containSpawn(s: GameState, e: Entity): void {
  const a = s.arena;
  if (s.segment === 'atoll' || s.segment === 'orbit') {
    const centerZ = a.z + (s.segment === 'orbit' ? 120 : 0), dx = e.x - a.x, dz = e.z - centerZ, d = Math.hypot(dx, dz), limit = a.radius - 55;
    if (d > limit) { e.x = a.x + dx / d * limit; e.z = centerZ + dz / d * limit; }
  } else if (s.segment === 'canyon') {
    e.x = clamp(e.x, a.x - a.radius + 25, a.x + a.radius - 25);
    e.z = clamp(e.z, a.z - 90, a.z + 820);
  }
}
function spawnWave(s: GameState): void {
  if (s.entities.filter(e => e.kind === 'drone' || e.kind === 'supply').length >= 7) return;
  const id = ++s.waveId, p = s.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), rx = fz, rz = -fx;
  const center = (random(s) - 0.5) * 30;
  s.waves.push({ id, remaining: 3, perfect: true });
  for (let i = 0; i < 3; i++) {
    const across = center + (i - 1) * 27, distance = 145 + i * 12;
    const e = entity(i === 1 && id % 2 === 0 ? 'supply' : 'drone', p.x + fx * distance + rx * across, p.z + fz * distance + rz * across, clamp(p.altitude + (i - 1) * 12, 65, 155));
    containSpawn(s, e);
    const speed = 5 + random(s) * 3; e.waveId = id; e.vx = -fx * speed; e.vz = -fz * speed; e.fireTimer = 5 + random(s) * 3; s.entities.push(e);
  }
}
function spawnSupply(s: GameState): void {
  if (s.entities.some(e => e.kind === 'supply' || e.kind === 'capsule')) return;
  const p = s.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), across = (random(s) - 0.5) * 20;
  const e = entity('supply', p.x + fx * 110 + fz * across, p.z + fz * 110 - fx * across, p.altitude);
  containSpawn(s, e); e.vx = -fx * 3; e.vz = -fz * 3; e.fireTimer = 7; s.entities.push(e);
}
function spawnDoor(s: GameState): void {
  s.doorOpen = false; s.doorTimer = 0;
  const x = s.arena.x, z = s.arena.z + 190 + s.doorsCleared * 220, alt = 110;
  s.entities.push(entity('door', x, z, alt), entity('lock', x - 18, z, alt), entity('lock', x + 18, z, alt));
}
// Soft inward force begins before the hard edge, leaving room to turn back.
function applyBoundary(s: GameState, dt: number): void {
  const p = s.player, a = s.arena;
  s.boundaryWarning = false;
  if (s.segment === 'atoll' || s.segment === 'orbit') {
    const centerZ = a.z + (s.segment === 'orbit' ? 120 : 0), dx = p.x - a.x, dz = p.z - centerZ, distance = Math.hypot(dx, dz);
    s.boundaryWarning = distance > a.radius - 40;
    if (distance > a.radius - 30) {
      const force = Math.min(100, (distance - a.radius + 30) * 2.2) * dt / Math.max(1, distance);
      p.x -= dx * force; p.z -= dz * force;
    }
    const after = Math.hypot(p.x - a.x, p.z - centerZ), limit = a.radius + 30;
    if (after > limit) { p.x = a.x + (p.x - a.x) * limit / after; p.z = centerZ + (p.z - centerZ) * limit / after; }
  } else if (s.segment === 'canyon') {
    const dx = p.x - a.x, side = Math.abs(dx);
    s.boundaryWarning = side > a.radius - 30 || p.z < a.z - 110 || p.z > a.z + 850;
    if (side > a.radius - 25) p.x -= Math.sign(dx) * Math.min(100, (side - a.radius + 25) * 2.5) * dt;
    p.x = clamp(p.x, a.x - a.radius - 20, a.x + a.radius + 20);
    if (p.z < a.z - 120) p.z += Math.min(100, (a.z - 120 - p.z) * 2.5) * dt;
    if (p.z > a.z + 860) p.z -= Math.min(100, (p.z - a.z - 860) * 2.5) * dt;
    p.z = clamp(p.z, a.z - 150, a.z + 890);
  }
}
function updateCamera(s: GameState): void {
  const p = s.player, c = s.camera, mode = c.mode;
  c.altitude = p.altitude; c.pitch = 0;
  if (mode === 'overhead') { c.x = p.x; c.z = p.z - p.y; c.yaw = 0; c.camOffset = 0; c.camHeightOffset = 2; c.crossFade = 0; }
  else { c.x = p.x; c.z = p.z; c.yaw = p.yaw; c.camOffset = mode === 'chase' ? 38 : 0; c.camHeightOffset = mode === 'chase' ? 18 : 2; c.crossFade = 1; }
}
function enterSegment(s: GameState, id: SegmentId, ground: Ground, view?: Segment | null): void {
  const def = SCRIPT.find(d => d.id === id)!;
  s.scriptIndex = SCRIPT.indexOf(def); s.segment = id; s.nextSegment = id; s.biome = def.biome; s.phase = 'playing'; s.phaseTime = 0; s.transitionT = 0;
  s.entities = []; s.bullets = []; s.effects = []; s.waves = []; s.spawnTimer = 0.8; s.supplyTimer = 0.6; s.beatIndex = 0; s.dialogue = null;
  s.pylonsDown = 0; s.doorsCleared = 0; s.doorOpen = false; s.doorTimer = 0; s.boss = blankBoss();
  s.player.y = -55; s.player.yaw = 0; s.player.bank = 0; s.boundaryWarning = false; s.botRetreat = false;
  s.arena = { x: s.player.x, z: s.player.z, radius: id === 'atoll' ? 220 : id === 'canyon' ? 95 : 350 };
  s.player.altitude = clamp(Math.max(s.player.altitude, ground(s.player.x, s.player.z) + 65), 65, 155);
  s.camera.mode = view || def.defaultView; updateCamera(s);
  if (def.goal === 'waves') s.objective = 'CLEAR THE APPROACH';
  if (def.goal === 'pylons') {
    s.objective = 'DESTROY THE RELAY PYLONS  0/4';
    for (const [x, z] of [[-105, 115], [105, 140], [120, -70], [-115, -90]]) s.entities.push(entity('pylon', s.arena.x + x, s.arena.z + z, s.player.altitude));
  }
  if (def.goal === 'doors') { s.objective = `BLAST DOORS // SHOOT THE LOCKS  0/${def.doorCount}`; spawnDoor(s); }
  if (def.goal === 'boss') { s.objective = 'ORBIT APPROACH // CLEAR THE ESCORTS'; s.boss.x = s.arena.x; s.boss.z = s.arena.z + 245; s.boss.alt = s.player.altitude; }
}
export function createGame(options: GameOptions = parseGameOptions(''), ground: Ground = () => 30): GameState {
  const id = options.segment || 'reach';
  const s: GameState = { phase: options.segment ? 'playing' : 'title', segment: id, nextSegment: id, initialView: options.view, scriptIndex: 0, biome: 'jungle', objective: '',
    loop: options.loop, loopSpeed: Math.min(1.8, 1 + (options.loop - 1) * 0.2), score: 0, salvage: 0, lives: 3, hull: 8, maxHull: 8, hitsTaken: 0, rank: null,
    bst: 1, boosting: false, bombs: 3, weaponLv: 1, peakWeaponLv: 1, roll: 0, wipeT: 0, viewTagT: 0, dialogue: null, beatIndex: 0,
    phaseTime: 0, transitionT: 0, invulnTimer: 0, aimX: 0, aimY: 0, aspect: 16 / 9, rng: options.seed >>> 0, seed: options.seed >>> 0, autoplay: options.autoplay, paused: false, elapsed: 0,
    spawnTimer: 0.8, supplyTimer: 0.6, waveId: 0, pylonsDown: 0, doorsCleared: 0, doorOpen: false, doorTimer: 0, boundaryWarning: false, botRetreat: false, arena: { x: 0, z: 0, radius: 220 }, waves: [],
    player: { x: 0, y: -55, z: 0, altitude: 110, bank: 0, yaw: 0, fireCooldown: 0 },
    camera: { mode: 'overhead', x: 0, z: 55, yaw: 0, altitude: 110, pitch: 0, camOffset: 0, camHeightOffset: 2, crossFade: 0 },
    entities: [], bullets: [], effects: [], boss: blankBoss() };
  enterSegment(s, id, ground, options.view);
  if (options.boss && id === 'orbit') { s.boss.active = true; s.boss.z = s.player.z + 130; s.objective = 'WARDEN // DESTROY THE FOUR PODS'; }
  if (!options.segment) s.phase = 'title'; return s;
}
export function restartGame(s: GameState, ground: Ground = () => 30): GameState {
  return createGame({ segment: 'reach', view: s.initialView, seed: s.seed, autoplay: s.autoplay, loop: 1, time: 0, touch: false }, ground);
}
export function nextLoop(s: GameState, ground: Ground = () => 30): GameState {
  const next = createGame({ segment: 'reach', view: s.initialView, seed: s.seed, autoplay: s.autoplay, loop: s.loop + 1, time: 0, touch: false }, ground);
  next.score = s.score; next.salvage = s.salvage; next.lives = s.lives; return next;
}
function copy(s: GameState): GameState {
  return { ...s, dialogue: s.dialogue && { ...s.dialogue }, player: { ...s.player }, camera: { ...s.camera }, arena: { ...s.arena }, boss: { ...s.boss, pods: [...s.boss.pods] }, entities: s.entities.map(e => ({ ...e })), bullets: s.bullets.map(b => ({ ...b })), effects: s.effects.map(e => ({ ...e })), waves: s.waves.map(w => ({ ...w })) };
}
function damage(s: GameState): void {
  if (s.invulnTimer > 0 || s.phase !== 'playing') return;
  s.hull -= 2; s.hitsTaken++; s.weaponLv = Math.max(1, s.weaponLv - 1) as 1 | 2 | 3; s.invulnTimer = 1;
  s.effects.push({ x: s.player.x, z: s.player.z, alt: s.player.altitude, life: 0.5, kind: 'hit' });
  if (s.hull <= 0) { s.lives--; if (s.lives <= 0) { s.lives = 0; s.hull = 0; s.phase = 'game_over'; } else { s.hull = s.maxHull; s.invulnTimer = 2; } }
}
function transition(s: GameState): void {
  const next = SCRIPT[s.scriptIndex + 1]; if (!next) return;
  s.phase = 'transition'; s.nextSegment = next.id; s.transitionT = 0; s.invulnTimer = Math.max(s.invulnTimer, 1.5); s.boosting = false;
}
export function wardenTargets(s: GameState): { kind: 'pod' | 'core'; index: number; x: number; z: number; alt: number }[] {
  const b = s.boss, offsets = [[-18, 0], [0, 18], [18, 0], [0, -18]], rightX = Math.cos(s.player.yaw), rightZ = -Math.sin(s.player.yaw);
  if (b.pods.some(hp => hp > 0)) return offsets.flatMap(([x, alt], index) => b.pods[index] > 0 ? [{ kind: 'pod' as const, index, x: b.x + x * rightX, z: b.z + x * rightZ, alt: b.alt + alt }] : []);
  return [{ kind: 'core', index: 0, x: b.x, z: b.z, alt: b.alt }];
}
function bot(s: GameState): GameInput {
  const p = s.player, distance = (e: { x: number; z: number }) => Math.hypot(e.x - p.x, e.z - p.z);
  const power = s.weaponLv < 3 ? s.entities.filter(e => e.kind === 'capsule' || e.kind === 'supply').sort((a, b) => distance(a) - distance(b)) : [];
  const objectives = s.entities.filter(e => e.kind === 'pylon' || e.kind === 'lock' || e.kind === 'exit');
  const enemies = s.entities.filter(e => e.kind === 'drone' || e.kind === 'supply');
  const targets = power.length ? power : s.boss.active ? wardenTargets(s) : objectives.length ? objectives : enemies;
  const target = [...targets].sort((a, b) => distance(a) - distance(b))[0];
  if (s.botRetreat && !power.length && s.boss.active) {
    const dx = p.x - s.boss.x, dz = p.z - s.boss.z;
    const heading = Math.atan2(dx, dz) - p.yaw;
    return { moveX: clamp(Math.atan2(Math.sin(heading), Math.cos(heading)) * 2.2, -1, 1), moveY: 0, fire: false };
  }
  if (!target) return { moveX: 0, moveY: 0, fire: true };
  const dx = target.x - p.x, dz = target.z - p.z, range = Math.hypot(dx, dz);
  let angle = Math.atan2(dx, dz) - p.yaw;
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  const turn = clamp(angle * 2.2, -1, 1), climb = clamp((p.altitude - target.alt) / 18, -1, 1);
  if (s.camera.mode === 'cockpit' && target.kind !== 'exit' && target.kind !== 'capsule') {
    const depth = Math.max(20, dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)), right = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
    const aimX = clamp(right / (0.4 * s.aspect * depth), -1, 1);
    const aimY = clamp((0.95 * (s.camera.altitude + s.camera.camHeightOffset - target.alt) / depth - 0.12) / 0.27, -1, 1);
    return { moveX: turn, moveY: 0, fire: Math.abs(angle) < 0.65, aimX, aimY };
  }
  return { moveX: turn, moveY: climb, fire: target.kind !== 'capsule' && Math.abs(angle) < 0.35 && range < 230 };
}

export function stepGame(previous: GameState, input: GameInput, elapsed: number, ground: Ground = () => 30): GameState {
  const s = copy(previous), dt = clamp(elapsed, 0, 0.05);
  if (input.aspect !== undefined && Number.isFinite(input.aspect)) s.aspect = clamp(input.aspect, 0.3, 3);
  if (input.restart) return restartGame(s, ground);
  if (s.phase === 'win' && (input.next || input.start)) return nextLoop(s, ground);
  if (s.phase === 'game_over' && input.start) return restartGame(s, ground);
  if (s.phase === 'title') { if (input.start) return restartGame(s, ground); s.player.z += dt * 8; updateCamera(s); return s; }
  if (s.phase === 'win' || s.phase === 'game_over') return s;
  if (input.pause) s.paused = !s.paused;
  if (s.paused) return s;
  s.elapsed += dt; s.invulnTimer = Math.max(0, s.invulnTimer - dt); s.wipeT = Math.max(0, s.wipeT - dt); s.viewTagT = Math.max(0, s.viewTagT - dt); s.roll = Math.max(0, s.roll - dt / 0.85);
  if (input.toggleView) {
    const views: Segment[] = ['overhead', 'chase', 'cockpit']; s.camera.mode = views[(views.indexOf(s.camera.mode) + 1) % views.length]; s.wipeT = 0.35; s.viewTagT = 1.4; updateCamera(s);
  }
  if (s.phase === 'transition') {
    s.transitionT = Math.min(1, s.transitionT + dt / 1.5);
    updateCamera(s);
    const t = s.transitionT * s.transitionT * (3 - 2 * s.transitionT), target = SCRIPT.find(d => d.id === s.nextSegment)!.defaultView;
    if (s.camera.mode === 'overhead' && target !== 'overhead') {
      s.camera.x = s.player.x; s.camera.z = s.player.z - s.player.y * (1 - t); s.camera.yaw = s.player.yaw * t;
      s.camera.camOffset = (target === 'chase' ? 38 : 0) * t; s.camera.camHeightOffset = 2 + (target === 'chase' ? 16 : 0) * t; s.camera.crossFade = t;
    } else if (s.camera.mode !== 'overhead' && target !== 'overhead') {
      const from = s.camera.mode === 'chase' ? 1 : 0, to = target === 'chase' ? 1 : 0, amount = from + (to - from) * t;
      s.camera.camOffset = 38 * amount; s.camera.camHeightOffset = 2 + 16 * amount;
    }
    if (s.transitionT >= 1) { enterSegment(s, s.nextSegment, ground); s.wipeT = 0.35; s.viewTagT = 1.4; }
    return s;
  }
  if (s.autoplay && s.boss.active) {
    const range = Math.hypot(s.boss.x - s.player.x, s.boss.z - s.player.z);
    if (range < 65) s.botRetreat = true; else if (range > 140) s.botRetreat = false;
  }
  const control = s.autoplay ? { ...bot(s), boost: input.boost, bomb: input.bomb } : input;
  const mx = clamp(control.moveX, -1, 1), my = clamp(control.moveY, -1, 1), p = s.player;
  s.phaseTime += dt;
  const mission = SCRIPT[s.scriptIndex], beat = mission.beats[s.beatIndex];
  if (beat && s.phaseTime >= beat.at) { s.dialogue = { speaker: beat.speaker, text: beat.text, timer: 5 }; s.beatIndex++; }
  if (s.dialogue) { s.dialogue.timer -= dt; if (s.dialogue.timer <= 0) s.dialogue = null; }
  s.boosting = !!control.boost && s.bst > 0;
  s.bst = clamp(s.bst + (control.boost ? -0.5 : 0.35) * dt, 0, 1);
  const bombTriggered = !!control.bomb && s.bombs > 0;
  if (bombTriggered) {
    s.bombs--; s.roll = 1; s.bullets = s.bullets.filter(b => b.friendly);
    for (const e of s.entities) {
      if (e.kind === 'boss_orb') { e.hp = 0; continue; }
      if (['drone', 'supply', 'pylon', 'lock'].includes(e.kind) && Math.hypot(e.x - p.x, e.z - p.z) < 180) { e.hp -= 2; e.shotDown = true; e.hitFlash = 0.15; }
    }
    if (s.boss.active) { const target = wardenTargets(s)[0]; if (target.kind === 'pod') s.boss.pods[target.index] = Math.max(0, s.boss.pods[target.index] - 2); else s.boss.coreHp = Math.max(0, s.boss.coreHp - 2); }
    s.effects.push({ x: p.x + Math.sin(p.yaw) * 40, z: p.z + Math.cos(p.yaw) * 40, alt: p.altitude, life: 0.8, kind: 'ring' });
  }
  p.bank = advanceBank(p.bank, mx, dt);
  p.yaw = Math.atan2(Math.sin(p.yaw + mx * 1.45 * dt), Math.cos(p.yaw + mx * 1.45 * dt));
  const speed = 34 * s.loopSpeed * (s.boosting ? 1.55 : 1) * (1 - Math.abs(mx) * 0.25);
  p.x += Math.sin(p.yaw) * speed * dt; p.z += Math.cos(p.yaw) * speed * dt;
  applyBoundary(s, dt);
  p.altitude = clamp(p.altitude - my * 32 * dt, s.biome === 'space' ? 55 : ground(p.x, p.z) + 22, 165);
  if (s.camera.mode === 'cockpit') {
    s.aimX = control.aimX !== undefined ? clamp(control.aimX, -1, 1) : clamp(s.aimX + mx * dt, -1, 1);
    s.aimY = control.aimY !== undefined ? clamp(control.aimY, -1, 1) : clamp(s.aimY + my * dt, -1, 1);
  }
  updateCamera(s);
  if (mission.goal === 'waves' && s.phaseTime >= (mission.duration || 24)) { transition(s); return s; }
  s.spawnTimer -= dt;
  if (s.spawnTimer <= 0 && (mission.goal !== 'boss' || !s.boss.active)) { spawnWave(s); s.spawnTimer = mission.waveEvery / s.loopSpeed; }
  s.supplyTimer -= dt;
  if (s.supplyTimer <= 0) { spawnSupply(s); s.supplyTimer = mission.supplyEvery; }
  if (mission.goal === 'boss' && !s.boss.active && s.phaseTime >= (mission.approach || 14)) { s.boss.active = true; s.objective = 'WARDEN // DESTROY THE FOUR PODS'; }
  if (s.boss.active) { s.boss.fireTimer -= dt; s.boss.hitFlash = Math.max(0, s.boss.hitFlash - dt);
    if (s.boss.fireTimer <= 0 && !bombTriggered && s.entities.filter(e => e.kind === 'boss_orb').length < 10) {
      for (let i = -1; i <= 1; i++) { const orb = entity('boss_orb', s.boss.x + i * 13, s.boss.z, s.boss.alt); const dx = p.x - orb.x, dz = p.z - orb.z, d = Math.max(1, Math.hypot(dx, dz)); orb.vx = dx / d * 45 + i * 5; orb.vz = dz / d * 45; orb.valt = (p.altitude - orb.alt) / d * 45; orb.fireTimer = 4; s.entities.push(orb); }
      s.boss.fireTimer = 5 / s.loopSpeed;
    }
  }
  p.fireCooldown -= dt;
  if (control.fire && p.fireCooldown <= 0 && s.bullets.filter(b => b.friendly).length < 40) {
    const offsets = s.weaponLv === 1 ? [-3, 3] : s.weaponLv === 2 ? [-8, -3, 3, 8] : [-12, -7, -2, 2, 7, 12];
    for (const side of offsets) {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), rx = fz, rz = -fx;
      const horizontal = s.camera.mode === 'cockpit' ? s.aimX * 0.4 * s.aspect : 0;
      const vy = s.camera.mode === 'cockpit' ? (s.camera.camHeightOffset / 110 - (0.12 + s.aimY * 0.27) / 0.95) * 230 : 0;
      s.bullets.push({ x: p.x + fx * 8 + rx * side, y: 0, z: p.z + fz * 8 + rz * side, alt: p.altitude,
        vx: (fx + rx * horizontal) * 230, vy, vz: (fz + rz * horizontal) * 230, friendly: true, life: 2 });
    }
    p.fireCooldown = 0.2;
  }
  const oldX = previous.player.x, oldZ = previous.player.z;
  for (const e of s.entities) {
    if (e.hp <= 0) continue;
    e.x += e.vx * dt; e.z += e.vz * dt; e.alt += e.valt * dt;
    if (e.kind === 'capsule') {
      const dx = p.x - e.x, dz = p.z - e.z, distance = Math.hypot(dx, dz), overhead = s.camera.mode === 'overhead';
      if (distance < (overhead ? 150 : 90) && distance > 0) { const drift = (overhead ? 65 : 30) * dt / distance; e.x += dx * drift; e.z += dz * drift; }
    }
    e.hitFlash = Math.max(0, e.hitFlash - dt); e.fireTimer -= dt;
    if ((e.kind === 'pylon' || e.kind === 'lock') && e.fireTimer <= 0 && s.bullets.filter(b => !b.friendly).length < 16) {
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.max(1, Math.hypot(dx, dz)), velocity = 38;
      s.bullets.push({ x: e.x, y: 0, z: e.z, alt: e.alt, vx: dx / d * velocity, vy: (p.altitude - e.alt) / d * velocity, vz: dz / d * velocity, friendly: false, life: 6 });
      e.fireTimer = 5 + random(s) * 2;
    }
    if (e.kind === 'drone' || e.kind === 'supply') {
      e.bank = Math.sin(s.elapsed * 2 + e.waveId) * 0.35;
      if (e.fireTimer <= 0 && s.bullets.filter(b => !b.friendly).length < 25) {
        const dx = p.x - e.x, dz = p.z - e.z, d = Math.max(1, Math.hypot(dx, dz)), velocity = 50;
        s.bullets.push({ x: e.x, y: 0, z: e.z, alt: e.alt, vx: dx / d * velocity, vy: (p.altitude - e.alt) / d * velocity, vz: dz / d * velocity, friendly: false, life: 6 }); e.fireTimer = 5 + random(s) * 3;
      }
      if (Math.abs(e.z - p.z) < 9 && Math.abs(e.x - p.x) < 10 && Math.abs(e.alt - p.altitude) < 12) { damage(s); e.hp = 0; }
    } else if (e.kind === 'boss_orb' && e.fireTimer <= 0) { e.hp = 0; }
    else if (e.kind === 'boss_orb' && Math.abs(e.z - p.z) < 8 && Math.abs(e.x - p.x) < 9 && Math.abs(e.alt - p.altitude) < 10) { damage(s); e.hp = 0; }
    else if (e.kind === 'capsule' && Math.hypot(e.z - p.z, e.x - p.x) < 26 && Math.abs(e.alt - p.altitude) < (s.camera.mode === 'overhead' ? 25 : 60)) { s.weaponLv = Math.min(3, s.weaponLv + 1) as 1 | 2 | 3; s.peakWeaponLv = Math.max(s.peakWeaponLv, s.weaponLv) as 1 | 2 | 3; s.score += 100; e.hp = 0; }
    else if (e.kind === 'exit') {
      const dx = p.x - oldX, dz = p.z - oldZ, l2 = dx * dx + dz * dz;
      const t = l2 ? clamp(((e.x - oldX) * dx + (e.z - oldZ) * dz) / l2, 0, 1) : 0;
      if (Math.hypot(oldX + dx * t - e.x, oldZ + dz * t - e.z) < 18 && Math.abs(e.alt - p.altitude) < 22) { s.score += 1000; transition(s); }
    }
  }
  // Fire generated on the bomb frame is cleared before it can reach the player.
  if (bombTriggered) s.bullets = s.bullets.filter(b => b.friendly);
  for (const b of s.bullets) {
    b.x += b.vx * dt; b.z += b.vz * dt; b.alt += b.vy * dt; b.life -= dt;
    if (!b.friendly) {
      if (Math.abs(b.x - p.x) < 8 && Math.abs(b.z - p.z) < 8 && Math.abs(b.alt - p.altitude) < 12) { damage(s); b.life = 0; }
      continue;
    }
    for (const e of s.entities) {
      if (!['drone', 'supply', 'boss_orb', 'pylon', 'lock'].includes(e.kind) || e.hp <= 0) continue;
      if (Math.abs(b.x - e.x) < 9 && Math.abs(b.z - e.z) < 10 && Math.abs(b.alt - e.alt) < (s.camera.mode === 'overhead' ? 18 : 12)) { e.hp--; if (e.hp <= 0) e.shotDown = true; e.hitFlash = 0.12; b.life = 0; break; }
    }
    if (b.life > 0 && s.boss.active) for (const target of wardenTargets(s)) {
      if (Math.abs(b.x - target.x) < 8 && Math.abs(b.z - target.z) < 10 && Math.abs(b.alt - target.alt) < 10) {
        if (target.kind === 'pod') s.boss.pods[target.index] = Math.max(0, s.boss.pods[target.index] - 1); else s.boss.coreHp = Math.max(0, s.boss.coreHp - 1);
        s.boss.hitFlash = 0.12; b.life = 0; break;
      }
    }
  }
  for (const e of s.entities) if (e.hp <= 0 || (['drone', 'supply', 'capsule', 'boss_orb'].includes(e.kind) && Math.hypot(e.x - p.x, e.z - p.z) > 500)) {
    const destroyed = e.hp <= 0 && e.shotDown;
    if (destroyed && (e.kind === 'drone' || e.kind === 'supply')) {
      s.score += 100; s.salvage += 10; s.effects.push({ x: e.x, z: e.z, alt: e.alt, life: 0.45, kind: 'burst' });
      if (e.kind === 'supply') s.entities.push(entity('capsule', e.x, e.z, e.alt));
    }
    if (destroyed && e.kind === 'pylon') { s.pylonsDown++; s.score += 1500; s.salvage += 50; }
    const wave = s.waves.find(w => w.id === e.waveId && e.waveId !== 0);
    if (wave) { wave.remaining--; if (!destroyed) wave.perfect = false; if (wave.remaining === 0 && wave.perfect) s.score += 300; }
  }
  s.entities = s.entities.filter(e => e.hp > 0 && (!['drone', 'supply', 'capsule', 'boss_orb'].includes(e.kind) || Math.hypot(e.x - p.x, e.z - p.z) <= 500));
  if (mission.goal === 'pylons') {
    if (s.pylonsDown === 4 && !s.entities.some(e => e.kind === 'exit')) { s.entities.push(entity('exit', s.arena.x, s.arena.z + 180, p.altitude)); s.dialogue = { speaker: 'OPAL', text: 'Pylons down. Follow the gold exit ring.', timer: 5 }; }
    s.objective = s.pylonsDown === 4 ? 'PYLONS DOWN // FLY THROUGH EXIT' : `DESTROY THE RELAY PYLONS  ${s.pylonsDown}/4`;
  }
  if (mission.goal === 'doors') {
    if (!s.doorOpen && !s.entities.some(e => e.kind === 'lock')) { s.doorOpen = true; s.doorTimer = 1; s.objective = 'DOOR OPEN'; }
    else if (s.doorOpen) {
      s.doorTimer -= dt;
      if (s.doorTimer <= 0) { s.doorsCleared++; s.entities = s.entities.filter(e => e.kind !== 'door');
        if (s.doorsCleared >= (mission.doorCount || 3)) transition(s); else { s.objective = `BLAST DOORS // SHOOT THE LOCKS  ${s.doorsCleared}/${mission.doorCount}`; spawnDoor(s); }
      }
    }
  }
  if (s.boss.active) {
    s.boss.hp = s.boss.pods.reduce((sum, hp) => sum + hp, 0) + s.boss.coreHp;
    if (!s.boss.pods.some(hp => hp > 0)) s.objective = 'THE EYE IS OPEN // HIT THE CORE';
    if (s.boss.coreHp <= 0 && s.phase === 'playing') {
      s.score += 25000; s.rank = calculateRank(s.hitsTaken); s.salvage += { S: 500, A: 300, B: 150, C: 50 }[s.rank];
      s.phase = 'win'; s.boss.active = false; s.effects.push({ x: s.boss.x, z: s.boss.z, alt: s.boss.alt, life: 1, kind: 'burst' });
    }
  }
  s.bullets = s.bullets.filter(b => b.life > 0);
  for (const fx of s.effects) fx.life -= dt;
  s.effects = s.effects.filter(fx => fx.life > 0); s.waves = s.waves.filter(w => w.remaining > 0);
  return s;
}
