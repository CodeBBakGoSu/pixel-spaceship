import { advanceBank } from './flight.ts';
import type { CameraState, Segment } from './camera.ts';
export type { CameraState, Segment } from './camera.ts';

export type SegmentId = 'reach' | 'atoll' | 'canyon' | 'orbit';
export type Biome = 'jungle' | 'canyon' | 'space';
export type Rank = 'S' | 'A' | 'B' | 'C';
export type DialogueBeat = { at: number; speaker: 'OPAL' | 'GALE' | 'WARDEN'; text: string };
export type SegmentDef = { id: SegmentId; name: string; defaultView: Segment; biome: Biome; goal: 'waves' | 'pylons' | 'doors' | 'boss'; duration?: number; beats: DialogueBeat[] };
export const SCRIPT: readonly SegmentDef[] = [
  { id: 'reach', name: 'KESTREL REACH', defaultView: 'overhead', biome: 'jungle', goal: 'waves', duration: 24, beats: [
    { at: 0, speaker: 'OPAL', text: 'Kestrel Reach ahead. Watch your altitude, courier.' },
    { at: 10, speaker: 'GALE', text: 'Supply drones carry power capsules. Grab what you can.' },
  ] },
  { id: 'atoll', name: 'THE ATOLL', defaultView: 'chase', biome: 'jungle', goal: 'pylons', beats: [
    { at: 0, speaker: 'OPAL', text: 'Four relay pylons guard the exit. Take them down.' },
  ] },
  { id: 'canyon', name: 'BASE CANYON', defaultView: 'chase', biome: 'canyon', goal: 'doors', beats: [
    { at: 0, speaker: 'GALE', text: 'Blast doors ahead. Shoot both locks to open each gate.' },
  ] },
  { id: 'orbit', name: 'KESTREL ORBIT', defaultView: 'cockpit', biome: 'space', goal: 'boss', beats: [
    { at: 0, speaker: 'WARDEN', text: 'Unregistered courier. This lane is closed.' },
    { at: 7, speaker: 'OPAL', text: 'Break the four outer pods. Then hit the eye.' },
  ] },
];
export type GamePhase = 'title' | 'playing' | 'transition' | 'win' | 'game_over';
export type GameOptions = { segment: SegmentId | null; view: Segment | null; seed: number; autoplay: boolean; loop: number; time: number; touch: boolean };
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
  bst: number; boosting: boolean; bombs: number; weaponLv: 1 | 2 | 3; roll: number; wipeT: number; viewTagT: number;
  dialogue: { speaker: string; text: string; timer: number } | null; beatIndex: number;
  phaseTime: number; transitionT: number; invulnTimer: number; aimX: number; aimY: number; aspect: number;
  rng: number; seed: number; autoplay: boolean; paused: boolean; elapsed: number; spawnTimer: number; supplyTimer: number; waveId: number;
  pylonsDown: number; doorsCleared: number; doorOpen: boolean; doorTimer: number;
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
  return { segment: raw ? aliases[raw] || null : null, view, seed, autoplay: q.get('autoplay') === '1', loop: Number.isFinite(loopValue) && loopValue >= 1 ? Math.min(99, Math.floor(loopValue)) : 1, time: Number.isFinite(timeValue) ? clamp(timeValue, 0, 180) : 0, touch: q.get('touch') === '1' };
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
function spawnWave(s: GameState): void {
  if (s.entities.filter(e => e.kind === 'drone' || e.kind === 'supply').length >= 7) return;
  const id = ++s.waveId, center = (random(s) - 0.5) * 70;
  s.waves.push({ id, remaining: 3, perfect: true });
  for (let i = 0; i < 3; i++) {
    const e = entity(i === 1 && id % 2 === 0 ? 'supply' : 'drone', center + (i - 1) * 32, s.player.z + 145 + i * 14, clamp(s.player.altitude + (i - 1) * 12, 65, 155));
    e.waveId = id; e.vz = -5 - random(s) * 3; e.fireTimer = 3 + random(s) * 2; s.entities.push(e);
  }
}
function spawnSupply(s: GameState): void {
  if (s.entities.some(e => e.kind === 'supply' || e.kind === 'capsule')) return;
  const e = entity('supply', s.player.x + (random(s) - 0.5) * 24, s.player.z + 110, s.player.altitude);
  e.vz = -3; e.fireTimer = 6; s.entities.push(e);
}
function spawnDoor(s: GameState): void {
  s.doorOpen = false; s.doorTimer = 0;
  const z = s.player.z + 125, alt = s.player.altitude;
  s.entities.push(entity('door', 0, z, alt), entity('lock', -18, z, alt), entity('lock', 18, z, alt));
}
function updateCamera(s: GameState): void {
  const p = s.player, c = s.camera, mode = c.mode;
  c.altitude = p.altitude; c.pitch = 0;
  if (mode === 'overhead') { c.x = 0; c.z = p.z - p.y; c.yaw = 0; c.camOffset = 0; c.camHeightOffset = 2; c.crossFade = 0; }
  else { c.x = p.x * 0.45; c.z = p.z; c.yaw = p.yaw; c.camOffset = mode === 'chase' ? 38 : 0; c.camHeightOffset = mode === 'chase' ? 18 : 2; c.crossFade = 1; }
}
function enterSegment(s: GameState, id: SegmentId, ground: Ground, view?: Segment | null): void {
  const def = SCRIPT.find(d => d.id === id)!;
  s.scriptIndex = SCRIPT.indexOf(def); s.segment = id; s.nextSegment = id; s.biome = def.biome; s.phase = 'playing'; s.phaseTime = 0; s.transitionT = 0;
  s.entities = []; s.bullets = []; s.effects = []; s.waves = []; s.spawnTimer = 0.8; s.supplyTimer = 0.6; s.beatIndex = 0; s.dialogue = null;
  s.pylonsDown = 0; s.doorsCleared = 0; s.doorOpen = false; s.doorTimer = 0; s.boss = blankBoss();
  s.player.x = 0; s.player.y = -55; s.player.yaw = 0; s.player.bank = 0;
  s.player.altitude = clamp(Math.max(s.player.altitude, ground(0, s.player.z) + 65), 65, 155);
  s.camera.mode = view || def.defaultView; updateCamera(s);
  if (def.goal === 'waves') s.objective = 'CLEAR THE APPROACH';
  if (def.goal === 'pylons') {
    s.objective = 'DESTROY THE RELAY PYLONS  0/4';
    for (const x of [-42, -14, 14, 42]) s.entities.push(entity('pylon', x, s.player.z + 120, s.player.altitude));
  }
  if (def.goal === 'doors') { s.objective = 'BLAST DOORS // SHOOT THE LOCKS  0/2'; spawnDoor(s); }
  if (def.goal === 'boss') { s.objective = 'WARDEN // DESTROY THE FOUR PODS'; s.boss.active = true; s.boss.z = s.player.z + 110; s.boss.alt = s.player.altitude; }
}
export function createGame(options: GameOptions = parseGameOptions(''), ground: Ground = () => 30): GameState {
  const id = options.segment || 'reach';
  const s: GameState = { phase: options.segment ? 'playing' : 'title', segment: id, nextSegment: id, initialView: options.view, scriptIndex: 0, biome: 'jungle', objective: '',
    loop: options.loop, loopSpeed: Math.min(1.8, 1 + (options.loop - 1) * 0.2), score: 0, salvage: 0, lives: 3, hull: 8, maxHull: 8, hitsTaken: 0, rank: null,
    bst: 1, boosting: false, bombs: 3, weaponLv: 1, roll: 0, wipeT: 0, viewTagT: 0, dialogue: null, beatIndex: 0,
    phaseTime: 0, transitionT: 0, invulnTimer: 0, aimX: 0, aimY: 0, aspect: 16 / 9, rng: options.seed >>> 0, seed: options.seed >>> 0, autoplay: options.autoplay, paused: false, elapsed: 0,
    spawnTimer: 0.8, supplyTimer: 0.6, waveId: 0, pylonsDown: 0, doorsCleared: 0, doorOpen: false, doorTimer: 0, waves: [],
    player: { x: 0, y: -55, z: 0, altitude: 110, bank: 0, yaw: 0, fireCooldown: 0 },
    camera: { mode: 'overhead', x: 0, z: 55, yaw: 0, altitude: 110, pitch: 0, camOffset: 0, camHeightOffset: 2, crossFade: 0 },
    entities: [], bullets: [], effects: [], boss: blankBoss() };
  enterSegment(s, id, ground, options.view); if (!options.segment) s.phase = 'title'; return s;
}
export function restartGame(s: GameState, ground: Ground = () => 30): GameState {
  return createGame({ segment: 'reach', view: s.initialView, seed: s.seed, autoplay: s.autoplay, loop: 1, time: 0, touch: false }, ground);
}
export function nextLoop(s: GameState, ground: Ground = () => 30): GameState {
  const next = createGame({ segment: 'reach', view: s.initialView, seed: s.seed, autoplay: s.autoplay, loop: s.loop + 1, time: 0, touch: false }, ground);
  next.score = s.score; next.salvage = s.salvage; next.lives = s.lives; return next;
}
function copy(s: GameState): GameState {
  return { ...s, dialogue: s.dialogue && { ...s.dialogue }, player: { ...s.player }, camera: { ...s.camera }, boss: { ...s.boss, pods: [...s.boss.pods] }, entities: s.entities.map(e => ({ ...e })), bullets: s.bullets.map(b => ({ ...b })), effects: s.effects.map(e => ({ ...e })), waves: s.waves.map(w => ({ ...w })) };
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
  const b = s.boss, offsets = [[-18, 0], [0, 18], [18, 0], [0, -18]];
  if (b.pods.some(hp => hp > 0)) return offsets.flatMap(([x, alt], index) => b.pods[index] > 0 ? [{ kind: 'pod' as const, index, x: b.x + x, z: b.z, alt: b.alt + alt }] : []);
  return [{ kind: 'core', index: 0, x: b.x, z: b.z, alt: b.alt }];
}
function bot(s: GameState): GameInput {
  const p = s.player;
  const power = s.weaponLv < 3 ? s.entities.filter(e => (e.kind === 'capsule' || e.kind === 'supply') && e.z > p.z - 30).sort((a, b) => a.z - b.z) : [];
  const targets = power.length ? power : s.boss.active ? wardenTargets(s) : s.entities.filter(e => ['pylon', 'lock', 'exit', 'supply', 'drone'].includes(e.kind) && e.z > p.z).sort((a, b) => a.z - b.z);
  const target = targets[0];
  if (!target) return { moveX: Math.sin(s.phaseTime * 0.7) * 0.2, moveY: 0, fire: true };
  if (s.camera.mode === 'cockpit' && target.kind !== 'exit') {
    const depth = Math.max(40, target.z - p.z), right = target.x - s.camera.x - Math.sin(s.camera.yaw) * depth;
    const span = 0.4 * s.aspect * depth, excess = Math.max(0, Math.abs(right) - span * 0.72);
    return { moveX: Math.sign(right) * clamp(excess / 18, 0, 1), moveY: 0, fire: true, aimX: clamp(right / span, -1, 1), aimY: clamp((0.95 * (s.camera.altitude + s.camera.camHeightOffset - target.alt) / depth - 0.12) / 0.27, -1, 1) };
  }
  return { moveX: clamp((target.x - p.x) / 15, -1, 1), moveY: clamp((p.altitude - target.alt) / 12, -1, 1), fire: true };
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
      s.camera.x = s.player.x * 0.45 * t; s.camera.z = s.player.z - s.player.y * (1 - t);
      s.camera.camOffset = (target === 'chase' ? 38 : 0) * t; s.camera.camHeightOffset = 2 + (target === 'chase' ? 16 : 0) * t; s.camera.crossFade = t;
    } else if (s.camera.mode !== 'overhead' && target !== 'overhead') {
      const from = s.camera.mode === 'chase' ? 1 : 0, to = target === 'chase' ? 1 : 0, amount = from + (to - from) * t;
      s.camera.camOffset = 38 * amount; s.camera.camHeightOffset = 2 + 16 * amount;
    }
    if (s.transitionT >= 1) { enterSegment(s, s.nextSegment, ground); s.wipeT = 0.35; s.viewTagT = 1.4; }
    return s;
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
      if (['drone', 'supply', 'pylon', 'lock'].includes(e.kind) && Math.abs(e.x - p.x) < 90 && e.z > p.z && e.z < p.z + 180) { e.hp -= 2; e.shotDown = true; e.hitFlash = 0.15; }
    }
    if (s.boss.active) { const target = wardenTargets(s)[0]; if (target.kind === 'pod') s.boss.pods[target.index] = Math.max(0, s.boss.pods[target.index] - 2); else s.boss.coreHp = Math.max(0, s.boss.coreHp - 2); }
    s.effects.push({ x: p.x, z: p.z + 40, alt: p.altitude, life: 0.8, kind: 'ring' });
  }
  p.bank = advanceBank(p.bank, mx, dt); p.x = clamp(p.x + mx * 45 * dt, -70, 70);
  const speed = 34 * s.loopSpeed * (s.boosting ? 1.55 : 1);
  p.z += speed * dt; p.altitude = clamp(p.altitude - my * 32 * dt, s.biome === 'space' ? 55 : ground(p.x, p.z) + 22, 165);
  p.yaw += (mx * 0.08 - p.yaw) * Math.min(1, dt * 3);
  if (s.camera.mode === 'cockpit') {
    s.aimX = control.aimX !== undefined ? clamp(control.aimX, -1, 1) : clamp(s.aimX + mx * dt, -1, 1);
    s.aimY = control.aimY !== undefined ? clamp(control.aimY, -1, 1) : clamp(s.aimY + my * dt, -1, 1);
  }
  updateCamera(s);
  if (mission.goal === 'waves' && s.phaseTime >= (mission.duration || 24)) { transition(s); return s; }
  s.spawnTimer -= dt;
  if (mission.goal === 'waves' && s.spawnTimer <= 0) { spawnWave(s); s.spawnTimer = 4.5 / s.loopSpeed; }
  s.supplyTimer -= dt;
  if (s.supplyTimer <= 0) { spawnSupply(s); s.supplyTimer = 14; }
  if (s.boss.active) { s.boss.z = p.z + 110; s.boss.fireTimer -= dt; s.boss.hitFlash = Math.max(0, s.boss.hitFlash - dt);
    if (s.boss.fireTimer <= 0 && !bombTriggered && s.entities.filter(e => e.kind === 'boss_orb').length < 10) {
      for (let i = -1; i <= 1; i++) { const orb = entity('boss_orb', s.boss.x + i * 13, s.boss.z - 5, s.boss.alt); orb.vx = (p.x - orb.x) * 0.6 + i * 5; orb.valt = (p.altitude - orb.alt) * 0.6; orb.vz = -55; s.entities.push(orb); }
      s.boss.fireTimer = 3.2 / s.loopSpeed;
    }
  }
  p.fireCooldown -= dt;
  if (control.fire && p.fireCooldown <= 0 && s.bullets.filter(b => b.friendly).length < 40) {
    const offsets = s.weaponLv === 1 ? [-3, 3] : s.weaponLv === 2 ? [-8, -3, 3, 8] : [-12, -7, -2, 2, 7, 12];
    for (const side of offsets) {
      let vx = 0, vy = 0; const vz = 230;
      if (s.camera.mode === 'cockpit') {
        const depth = 110, targetX = s.camera.x + Math.sin(s.camera.yaw) * depth + s.aimX * 0.4 * s.aspect * depth;
        const targetAlt = s.camera.altitude + s.camera.camHeightOffset - (0.12 + s.aimY * 0.27) * depth / 0.95;
        vx = (targetX - p.x) / depth * (vz - speed); vy = (targetAlt - p.altitude) / depth * (vz - speed);
      }
      s.bullets.push({ x: p.x + side, y: 0, z: p.z + 8, alt: p.altitude, vx, vy, vz, friendly: true, life: 2 });
    }
    p.fireCooldown = 0.2;
  }
  const oldZ = previous.player.z;
  for (const e of s.entities) {
    if (e.hp <= 0) continue;
    e.x += e.vx * dt; e.z += e.vz * dt; e.alt += e.valt * dt;
    if (e.kind === 'capsule' && s.camera.mode === 'overhead') {
      const dx = p.x - e.x, dz = p.z - e.z, distance = Math.hypot(dx, dz);
      if (distance < 150 && distance > 0) { e.x += dx / distance * 65 * dt; e.z += dz / distance * 65 * dt; }
    }
    if (e.kind === 'pylon' || e.kind === 'door' || e.kind === 'lock') e.z = p.z + 120;
    e.hitFlash = Math.max(0, e.hitFlash - dt); e.fireTimer -= dt;
    if ((e.kind === 'pylon' || e.kind === 'lock') && e.fireTimer <= 0 && s.bullets.filter(b => !b.friendly).length < 16) {
      const dz = Math.max(1, e.z - p.z), velocity = 38;
      s.bullets.push({ x: e.x, y: 0, z: e.z - 3, alt: e.alt, vx: (p.x - e.x) / dz * velocity, vy: (p.altitude - e.alt) / dz * velocity, vz: -velocity, friendly: false, life: 4 });
      e.fireTimer = 5 + random(s) * 2;
    }
    if (e.kind === 'drone' || e.kind === 'supply') {
      e.bank = Math.sin(s.elapsed * 2 + e.waveId) * 0.35;
      if (e.fireTimer <= 0 && s.bullets.filter(b => !b.friendly).length < 25) {
        const dz = Math.max(1, e.z - p.z), velocity = 55;
        s.bullets.push({ x: e.x, y: 0, z: e.z - 3, alt: e.alt, vx: (p.x - e.x) / dz * velocity, vy: (p.altitude - e.alt) / dz * velocity, vz: -velocity, friendly: false, life: 4 }); e.fireTimer = 3 + random(s) * 2;
      }
      if (Math.abs(e.z - p.z) < 9 && Math.abs(e.x - p.x) < 10 && Math.abs(e.alt - p.altitude) < 12) { damage(s); e.hp = 0; }
    } else if (e.kind === 'boss_orb' && Math.abs(e.z - p.z) < 8 && Math.abs(e.x - p.x) < 9 && Math.abs(e.alt - p.altitude) < 10) { damage(s); e.hp = 0; }
    else if (e.kind === 'capsule' && Math.hypot(e.z - p.z, e.x - p.x) < 26 && Math.abs(e.alt - p.altitude) < (s.camera.mode === 'overhead' ? 25 : 60)) { s.weaponLv = Math.min(3, s.weaponLv + 1) as 1 | 2 | 3; s.score += 100; e.hp = 0; }
    else if (e.kind === 'exit' && oldZ <= e.z && p.z >= e.z) {
      if (Math.abs(e.x - p.x) < 18 && Math.abs(e.alt - p.altitude) < 18) { s.score += 1000; transition(s); }
      else e.z = p.z + 100;
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
  for (const e of s.entities) if (e.hp <= 0 || e.z < p.z - 100) {
    const destroyed = e.hp <= 0 && e.shotDown;
    if (destroyed && (e.kind === 'drone' || e.kind === 'supply')) {
      s.score += 100; s.salvage += 10; s.effects.push({ x: e.x, z: e.z, alt: e.alt, life: 0.45, kind: 'burst' });
      if (e.kind === 'supply') s.entities.push(entity('capsule', e.x, e.z, e.alt));
    }
    if (destroyed && e.kind === 'pylon') { s.pylonsDown++; s.score += 1500; s.salvage += 50; }
    const wave = s.waves.find(w => w.id === e.waveId && e.waveId !== 0);
    if (wave) { wave.remaining--; if (!destroyed) wave.perfect = false; if (wave.remaining === 0 && wave.perfect) s.score += 300; }
  }
  s.entities = s.entities.filter(e => e.hp > 0 && e.z >= p.z - 100);
  if (mission.goal === 'pylons') {
    if (s.pylonsDown === 4 && !s.entities.some(e => e.kind === 'exit')) { s.entities.push(entity('exit', 0, p.z + 130, p.altitude)); s.dialogue = { speaker: 'OPAL', text: 'Pylons down. Follow the gold exit ring.', timer: 5 }; }
    s.objective = s.pylonsDown === 4 ? 'PYLONS DOWN // FLY THROUGH EXIT' : `DESTROY THE RELAY PYLONS  ${s.pylonsDown}/4`;
  }
  if (mission.goal === 'doors') {
    if (!s.doorOpen && !s.entities.some(e => e.kind === 'lock')) { s.doorOpen = true; s.doorTimer = 1; s.objective = 'DOOR OPEN'; }
    else if (s.doorOpen) {
      s.doorTimer -= dt;
      if (s.doorTimer <= 0) { s.doorsCleared++; s.entities = s.entities.filter(e => e.kind !== 'door');
        if (s.doorsCleared >= 2) transition(s); else { s.objective = `BLAST DOORS // SHOOT THE LOCKS  ${s.doorsCleared}/2`; spawnDoor(s); }
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
