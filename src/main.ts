import './style.css';
import { createGame, parseGameOptions, restartGame, stepGame, type GameInput, type GameState } from './game';
import type { Segment } from './camera';
import type { Flight } from './flight';
import { bakeSprites } from './models';
import { drawEntities, drawShots } from './render';
import { drawCockpit, ShipSprite, type ShipPose } from './ship';
import { World } from './world';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const glowCanvas = document.querySelector<HTMLCanvasElement>('#glow')!;
const glow = glowCanvas.getContext('2d');
const world = new World(), shipSprite = new ShipSprite(), sprites = bakeSprites();
const ground = (x: number, z: number) => world.height(x, z);
const options = parseGameOptions(location.search);
let game = createGame(options, ground);
const neutral: GameInput = { moveX: 0, moveY: 0, fire: false };
for (let i = 0; i < Math.round(options.time * 60) && game.phase !== 'win' && game.phase !== 'game_over'; i++) game = stepGame(game, neutral, 1 / 60, ground);
let frame: ImageData, other: ImageData;
let lastTime = performance.now(), accumulator = 0, fps = 60;
let pointerX = 0, pointerY = 0, pointerActive = false, pointerDown = false;
let touchMode = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let pendingStart = false, pendingPause = false;
let lastHelp = '', helpTimer = 0, lastMenu = '';
const keys = new Set<string>();
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const help = $<HTMLElement>('#help'), banner = $<HTMLElement>('#phase-banner');
const overlay = $<HTMLElement>('#game-overlay'), primary = $<HTMLButtonElement>('#primary-action'), restart = $<HTMLButtonElement>('#restart-action');
const score = $<HTMLElement>('#score'), lives = $<HTMLElement>('#lives'), phaseTime = $<HTMLElement>('#phase-time'), timerLabel = $<HTMLElement>('#timer-label');
const segmentName = $<HTMLElement>('#segment-name'), subtitle = $<HTMLElement>('#segment-subtitle');
const bossHud = $<HTMLElement>('#boss-hud'), bossLabel = $<HTMLElement>('#boss-label'), bossCount = $<HTMLElement>('#boss-count'), bossHealth = $<HTMLElement>('#boss-health');
const bars = [...document.querySelectorAll<HTMLElement>('#thrust-bars i')];
const barContainer = $<HTMLElement>('#thrust-bars');
const pills = [...document.querySelectorAll<HTMLElement>('[data-segment]')];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const smooth = (n: number) => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const mix = (a: number, b: number, n: number) => a + (b - a) * n;
const setText = (element: HTMLElement, text: string) => { if (element.textContent !== text) element.textContent = text; };
const phaseNames: Record<Segment, string> = { overhead: 'SKY PATROL', chase: 'CANYON RUN', cockpit: 'CORE ASSAULT' };
const phaseNumbers: Record<Segment, string> = { overhead: '01', chase: '02', cockpit: '03' };

Object.defineProperty(window, '__game', { get: () => Object.freeze({
  phase: game.phase, segment: game.segment, score: game.score, lives: game.lives, hull: game.hull, fps: Math.round(fps),
  loop: game.loop, loopSpeed: game.loopSpeed, phaseTime: game.phaseTime, transitionT: game.transitionT, paused: game.paused,
  bossHp: game.boss.active ? game.boss.hp : null, entities: game.entities.length, bullets: game.bullets.length,
  player: Object.freeze({ ...game.player }), aimX: game.aimX, aimY: game.aimY,
}) });

function resize(): void {
  const aspect = innerWidth / Math.max(1, innerHeight);
  canvas.width = clamp(Math.round(180 * aspect), 160, 480);
  canvas.height = Math.round(canvas.width / aspect);
  ctx.imageSmoothingEnabled = false;
  glowCanvas.width = canvas.width; glowCanvas.height = canvas.height;
  frame = ctx.createImageData(canvas.width, canvas.height);
  other = ctx.createImageData(canvas.width, canvas.height);
}
function showHelp(): void {
  const segment = game.phase === 'transition' ? game.nextSegment : game.segment;
  const movement = segment === 'overhead' ? 'MOVE / DODGE' : segment === 'chase' ? 'STEER / FLY THROUGH RINGS' : 'AIM AT THE CORE';
  help.textContent = touchMode ? `${movement}  ·  DRAG TO STEER  ·  AUTO-FIRE  ·  P TO PAUSE` : `${movement}  ·  WASD / ARROWS OR MOUSE  ·  HOLD SPACE / J / Z OR CLICK TO FIRE  ·  P PAUSE`;
  help.classList.remove('fade'); clearTimeout(helpTimer);
  helpTimer = window.setTimeout(() => help.classList.add('fade'), 5000);
}
function updateHud(): void {
  const displaySegment = game.phase === 'transition' ? game.nextSegment : game.segment;
  const key = `${game.phase}/${displaySegment}/${touchMode}`;
  if (key !== lastHelp) { lastHelp = key; showHelp(); }
  for (const pill of pills) {
    if (pill.dataset.segment === displaySegment) { if (!pill.hasAttribute('aria-current')) pill.setAttribute('aria-current', 'step'); }
    else if (pill.hasAttribute('aria-current')) pill.removeAttribute('aria-current');
  }
  setText(segmentName, phaseNames[displaySegment]);
  setText(subtitle, `VESPER-9  ·  LOOP ${String(game.loop).padStart(2, '0')}`);
  setText(score, String(game.score).padStart(6, '0'));
  setText(lives, String(game.lives).padStart(2, '0'));
  setText(timerLabel, game.boss.active ? 'BOSS HP' : 'TIME');
  const remaining = game.phase === 'transition' ? (game.nextSegment === 'chase' ? 35 : 12) : game.segment === 'overhead' ? Math.max(0, 30 - game.phaseTime) : game.segment === 'chase' ? Math.max(0, 35 - game.phaseTime) : Math.max(0, 12 - game.phaseTime);
  setText(phaseTime, game.boss.active ? `${game.boss.hp} / ${game.boss.maxHp}` : `00:${String(Math.ceil(remaining)).padStart(2, '0')}`);
  bars.forEach((bar, i) => bar.classList.toggle('active', i < game.hull));
  barContainer.classList.toggle('critical', game.hull <= 2);
  if (bossHud.hidden === game.boss.active) bossHud.hidden = !game.boss.active;
  if (game.boss.active) {
    setText(bossLabel, game.boss.hp <= 12 ? 'DREADNOUGHT / CORE EXPOSED' : 'DREADNOUGHT / CORE');
    setText(bossCount, `${game.boss.hp} / ${game.boss.maxHp}`);
    const width = `${game.boss.hp / game.boss.maxHp * 100}%`; if (bossHealth.style.width !== width) bossHealth.style.width = width;
  }
  banner.hidden = !(game.phase === 'transition' || game.phase === 'playing' && (game.phaseTime < 2.2 || game.boss.active && game.phaseTime >= 12 && game.phaseTime < 14));
  setText(banner, game.boss.active && game.phaseTime >= 12 && game.phaseTime < 14 ? 'WARNING // DREADNOUGHT INBOUND' : `PHASE ${phaseNumbers[displaySegment]} // ${phaseNames[displaySegment]}`);
  const menu = game.paused ? 'paused' : game.phase;
  if (menu !== lastMenu) {
    lastMenu = menu;
    const show = menu === 'title' || menu === 'win' || menu === 'game_over' || menu === 'paused';
    overlay.hidden = !show;
    if (show) {
      const title = $<HTMLElement>('#card-title'), copy = $<HTMLElement>('#card-copy'), kicker = $<HTMLElement>('#card-kicker'), hint = $<HTMLElement>('#card-hint');
      restart.hidden = menu !== 'win';
      if (menu === 'title') {
        kicker.textContent = 'ASTER FLIGHT SYSTEMS / MISSION 01'; title.innerHTML = 'VESPER<span>—</span>9';
        copy.innerHTML = 'Three phases. One flight.<br>Clear the skies and take down the dreadnought.';
        primary.innerHTML = 'LAUNCH MISSION <span>↗</span>'; hint.textContent = 'ENTER / SPACE / CLICK TO LAUNCH';
      } else if (menu === 'win') {
        kicker.textContent = 'MISSION COMPLETE'; title.textContent = 'SECTOR CLEAR';
        copy.textContent = `SCORE ${String(game.score).padStart(6, '0')}  ·  ${game.lives} LIVES REMAINING`;
        primary.innerHTML = 'NEXT LOOP <span>↗</span>'; hint.textContent = 'ENTER FOR NEXT LOOP  ·  R TO RESTART';
      } else if (menu === 'game_over') {
        kicker.textContent = 'SIGNAL LOST'; title.textContent = 'MISSION ENDED';
        copy.textContent = `FINAL SCORE ${String(game.score).padStart(6, '0')}`;
        primary.innerHTML = 'RESTART MISSION <span>↗</span>'; hint.textContent = 'ENTER TO RESTART';
      } else {
        kicker.textContent = 'FLIGHT SYSTEMS / STANDBY'; title.textContent = 'PAUSED';
        copy.textContent = 'Mission clock and flight systems are on hold.';
        primary.innerHTML = 'RESUME <span>↗</span>'; hint.textContent = 'P TO RESUME';
      }
    }
  }
}
function action(): void {
  if (game.paused) pendingPause = true;
  else if (game.phase === 'title' || game.phase === 'game_over' || game.phase === 'win') pendingStart = true;
}
primary.addEventListener('click', action);
restart.addEventListener('click', () => { game = restartGame(game, ground); });
overlay.addEventListener('pointerdown', event => { if (event.target === overlay || game.phase === 'title' && !(event.target as Element).closest('button')) action(); });
window.addEventListener('resize', resize);
window.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) pointerActive = false;
  if (!event.repeat && (event.code === 'Enter' || event.code === 'Space' && game.phase !== 'playing')) action();
  if (!event.repeat && event.code === 'KeyP') pendingPause = true;
  if (!event.repeat && event.code === 'KeyR' && (game.phase === 'win' || game.phase === 'game_over')) game = restartGame(game, ground);
  keys.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); pointerDown = false; pointerActive = false; });
function steer(event: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  pointerX = clamp((event.clientX - r.left) / r.width * 2 - 1, -1, 1);
  pointerY = clamp((event.clientY - r.top) / r.height * 2 - 1, -1, 1);
  pointerActive = true;
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  if (game.phase !== 'playing' && game.phase !== 'transition') { action(); return; }
  touchMode = event.pointerType === 'touch'; pointerDown = true; canvas.setPointerCapture(event.pointerId); steer(event);
});
canvas.addEventListener('pointermove', event => { if (event.pointerType !== 'touch' || pointerDown) steer(event); });
canvas.addEventListener('pointerup', event => { pointerDown = false; if (event.pointerType === 'touch') pointerActive = false; });
canvas.addEventListener('pointercancel', () => { pointerDown = false; pointerActive = false; });
canvas.addEventListener('pointerleave', () => { if (!pointerDown) pointerActive = false; });
function controls(): GameInput {
  let x = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  let y = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
  if (pointerActive) { x += Math.abs(pointerX) < 0.08 ? 0 : pointerX; y += Math.abs(pointerY) < 0.08 ? 0 : pointerY; }
  let fire = touchMode || pointerDown || keys.has('Space') || keys.has('KeyJ') || keys.has('KeyZ');
  const pad = navigator.getGamepads?.()[0];
  if (pad) { x += Math.abs(pad.axes[0] || 0) > 0.15 ? pad.axes[0] : 0; y += Math.abs(pad.axes[1] || 0) > 0.15 ? pad.axes[1] : 0; fire ||= !!pad.buttons[0]?.pressed || (pad.buttons[7]?.value || 0) > 0.2; }
  return { moveX: clamp(x, -1, 1), moveY: clamp(y, -1, 1), fire, start: pendingStart, pause: pendingPause,
    aimX: game.segment === 'cockpit' && pointerActive ? pointerX : undefined, aimY: game.segment === 'cockpit' && pointerActive ? pointerY : undefined };
}
function visualFlight(s: GameState): Flight {
  return { x: s.player.x, z: s.player.z, yaw: s.player.yaw, altitude: s.player.altitude, speed: 34 * s.loopSpeed, boost: 0.22, pitch: 0, roll: 0 };
}
function render(): void {
  const w = canvas.width, h = canvas.height;
  const transition = game.phase === 'transition', first = transition && game.segment === 'overhead', second = transition && game.segment === 'chase';
  const t = transition ? smooth(game.transitionT) : 0;
  if (first) {
    world.render(frame, game.camera, 'overhead'); world.render(other, game.camera, 'chase');
    const a = game.camera.crossFade, from = frame.data, to = other.data;
    for (let i = 0; i < from.length; i += 4) { from[i] = mix(from[i], to[i], a); from[i + 1] = mix(from[i + 1], to[i + 1], a); from[i + 2] = mix(from[i + 2], to[i + 2], a); }
  } else world.render(frame, game.camera, game.segment === 'overhead' ? 'overhead' : 'chase');
  ctx.putImageData(frame, 0, 0);
  if (glow) { glow.setTransform(1, 0, 0, 1, 0, 0); glow.clearRect(0, 0, w, h); }
  if (game.segment === 'overhead' && (!first || t < 0.7)) {
    ctx.save(); if (first) ctx.globalAlpha = 1 - smooth(t / 0.7);
    world.drawDust(ctx, game.camera, 'overhead', game.elapsed); ctx.restore();
  }
  ctx.save(); if (transition) ctx.globalAlpha = 1 - t;
  drawEntities(ctx, glow, sprites, game, game.segment, ground);
  ctx.restore();
  const drawShip = game.segment !== 'cockpit' || first || second;
  if (drawShip && !(game.invulnTimer > 0 && Math.floor(game.elapsed * 10) % 2 === 0 && !transition)) {
    const overheadX = w / 2 + game.player.x / 1.4 * Math.min(1, w / 240), overheadY = h / 2 - game.player.y / 1.4;
    const chaseX = w / 2 + game.player.x * 0.35, chaseY = h * 0.59;
    const clearance = Math.max(0, game.player.altitude - ground(game.player.x, game.player.z));
    const overhead = game.segment === 'overhead', blend = first ? t : overhead ? 0 : 1;
    const pose: ShipPose = { x: mix(overheadX, chaseX, blend), y: mix(overheadY, chaseY, blend), scale: mix(0.72, 1, blend), pitch: mix(65, 36, blend), lift: mix(1.4, 1, blend), bank: game.player.bank,
      alpha: second ? 1 - t : 1, perspective: blend, shadowSquash: mix(0.82, 0.28, blend), shadowY: mix(clearance * 0.48, 23 + clearance * 0.24, blend) };
    shipSprite.draw(ctx, glow, visualFlight(game), overhead && !first ? 'overhead' : 'chase', ground(game.player.x, game.player.z), false, pose);
  }
  ctx.save(); if (transition) ctx.globalAlpha = 1 - t;
  drawShots(ctx, glow, game, game.segment);
  ctx.restore();
  if (game.segment === 'cockpit' || second) drawCockpit(ctx, game.camera.pitch, game.aimX, game.aimY, second ? 1 - t : 0);
  updateHud();
}
function animate(now: number): void {
  const elapsed = Math.max(0, (now - lastTime) / 1000); lastTime = now;
  if (elapsed > 0 && elapsed < 0.25) fps += (1 / elapsed - fps) * 0.05;
  accumulator += Math.min(0.05, elapsed);
  while (accumulator >= 1 / 60) {
    const input = controls();
    game = stepGame(game, input, 1 / 60, ground);
    pendingStart = pendingPause = false;
    if (!game.paused) shipSprite.update(1 / 60, visualFlight(game), game.player.bank / 0.65);
    accumulator -= 1 / 60;
  }
  render();
  requestAnimationFrame(animate);
}
resize();
requestAnimationFrame(animate);
