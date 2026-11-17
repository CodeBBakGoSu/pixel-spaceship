import './style.css';
import { advanceFlight, createFlight, initialOptions, rollAngle, startRoll, type Input, type View } from './flight';
import { World } from './world';
import type { CameraState } from './camera';
import { drawCockpit, ShipSprite } from './ship';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const glowCanvas = document.querySelector<HTMLCanvasElement>('#glow')!;
const glow = glowCanvas.getContext('2d');
const rollCanvas = document.createElement('canvas');
const rollCtx = rollCanvas.getContext('2d', { alpha: false })!;
const world = new World();
const sprite = new ShipSprite();
const ship = createFlight();
ship.altitude = Math.max(ship.altitude, world.height(ship.x, ship.z) + 70);
const views: View[] = ['overhead', 'chase', 'cockpit'];
const options = initialOptions(location.search);
let view = options.view;
let frame: ImageData;
let lastTime = performance.now();
let accumulator = 0;
let helpTimer = 0;
let touchMode = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let pointerX = 0, pointerY = 0, pointerDown = false;
let downX = 0, downY = 0, downAt = 0, maxMovement = 0;
let previousA = false, previousY = false;
const keys = new Set<string>();
const help = document.querySelector<HTMLElement>('#help')!;
const altitude = document.querySelector<HTMLElement>('#altitude')!;
const speed = document.querySelector<HTMLElement>('#speed')!;
const heading = document.querySelector<HTMLElement>('#heading')!;
const bars = [...document.querySelectorAll<HTMLElement>('#thrust-bars i')];
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function resize(): void {
  const aspect = innerWidth / Math.max(1, innerHeight);
  canvas.width = clamp(Math.round(180 * aspect), 160, 480);
  canvas.height = Math.round(canvas.width / aspect);
  ctx.imageSmoothingEnabled = false;
  rollCanvas.width = canvas.width; rollCanvas.height = canvas.height;
  glowCanvas.width = canvas.width * 2; glowCanvas.height = canvas.height * 2;
  frame = ctx.createImageData(canvas.width, canvas.height);
}

function showHelp(): void {
  help.textContent = touchMode
    ? `${view.toUpperCase()} / DRAG TO STEER  ·  TAP TO ROLL  ·  HOLD TO BOOST  ·  TAP CAMERA TO CHANGE VIEW`
    : `${view.toUpperCase()} / MOUSE OR WASD TO STEER  ·  CLICK TO ROLL  ·  HOLD OR SHIFT TO BOOST  ·  SPACE TO CHANGE VIEW`;
  help.classList.remove('fade');
  clearTimeout(helpTimer);
  helpTimer = window.setTimeout(() => help.classList.add('fade'), 5000);
}

function setView(next: View): void {
  view = next;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  showHelp();
}

for (const button of buttons) button.addEventListener('click', () => setView(button.dataset.view as View));
window.addEventListener('resize', resize);
window.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.code === 'Space' && !event.repeat) setView(views[(views.indexOf(view) + 1) % views.length]);
  keys.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); pointerDown = false; pointerX = pointerY = 0; });

function steer(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 2 - 1;
  const y = (event.clientY - rect.top) / rect.height * 2 - 1;
  const deadzone = (n: number) => Math.abs(n) < 0.08 ? 0 : Math.sign(n) * (Math.abs(n) - 0.08) / 0.92;
  pointerX = clamp(deadzone(x), -1, 1);
  pointerY = clamp(-deadzone(y), -1, 1);
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const isTouch = event.pointerType === 'touch';
  if (touchMode !== isTouch) { touchMode = isTouch; showHelp(); }
  pointerDown = true;
  downAt = performance.now(); downX = event.clientX; downY = event.clientY; maxMovement = 0;
  canvas.setPointerCapture(event.pointerId);
  steer(event);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerType !== 'touch' || pointerDown) steer(event);
  if (pointerDown) maxMovement = Math.max(maxMovement, Math.hypot(event.clientX - downX, event.clientY - downY));
});
canvas.addEventListener('pointerup', event => {
  if (!pointerDown) return;
  pointerDown = false;
  if (performance.now() - downAt < 320 && maxMovement < 20) startRoll(ship);
  if (event.pointerType === 'touch') pointerX = pointerY = 0;
});
canvas.addEventListener('pointercancel', () => { pointerDown = false; pointerX = pointerY = 0; });
canvas.addEventListener('pointerleave', () => { if (!pointerDown) pointerX = pointerY = 0; });

function controls(): Input {
  let turn = pointerX + Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  let climb = pointerY + Number(keys.has('ArrowUp') || keys.has('KeyW')) - Number(keys.has('ArrowDown') || keys.has('KeyS'));
  let boost = options.boost || pointerDown || keys.has('ShiftLeft') || keys.has('ShiftRight');
  const pad = navigator.getGamepads?.()[0];
  if (pad) {
    const stick = (v: number) => Math.abs(v) < 0.15 ? 0 : v;
    turn += stick(pad.axes[0] || 0);
    climb -= stick(pad.axes[1] || 0);
    boost ||= (pad.buttons[7]?.value || 0) > 0.2;
    const a = !!pad.buttons[0]?.pressed, y = !!pad.buttons[3]?.pressed;
    if (a && !previousA) startRoll(ship);
    if (y && !previousY) setView(views[(views.indexOf(view) + 1) % views.length]);
    previousA = a; previousY = y;
  } else { previousA = previousY = false; }
  return { turn: clamp(turn, -1, 1), climb: clamp(climb, -1, 1), boost };
}

function animate(now: number): void {
  accumulator += Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const input = controls();
  while (accumulator >= 1 / 60) {
    advanceFlight(ship, input, 1 / 60, (x, z) => world.height(x, z));
    sprite.update(1 / 60, ship, input.turn);
    accumulator -= 1 / 60;
  }
  const camera: CameraState = { mode: view, x: ship.x, z: ship.z, yaw: ship.yaw, altitude: ship.altitude, pitch: ship.pitch, camOffset: view === 'chase' ? 38 : 0, camHeightOffset: view === 'chase' ? 18 : 2, crossFade: 0 };
  world.render(frame, camera);
  if (view === 'cockpit' && ship.roll > 0) {
    // Roll the outside view around the stationary cockpit frame.
    rollCtx.putImageData(frame, 0, 0);
    const angle = rollAngle(ship.roll);
    const cover = Math.abs(Math.cos(angle)) + Math.max(canvas.width / canvas.height, canvas.height / canvas.width) * Math.abs(Math.sin(angle));
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cover, cover);
    ctx.rotate(-angle);
    ctx.drawImage(rollCanvas, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();
  } else ctx.putImageData(frame, 0, 0);
  world.drawDust(ctx, camera, view, now / 1000);
  if (glow) {
    glow.setTransform(2, 0, 0, 2, 0, 0);
    glow.clearRect(0, 0, canvas.width, canvas.height);
  }
  sprite.draw(ctx, glow, ship, view, world.height(ship.x, ship.z), options.bank);
  if (view === 'cockpit') drawCockpit(ctx, ship.pitch);
  altitude.innerHTML = `${String(Math.round(ship.altitude - world.height(ship.x, ship.z))).padStart(3, '0')} <small>U</small>`;
  speed.innerHTML = `${String(Math.round(ship.speed)).padStart(3, '0')} <small>U/S</small>`;
  heading.innerHTML = `${String(Math.round(((ship.yaw * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}<small>°</small>`;
  const lit = 2 + Math.round(ship.boost * 6);
  bars.forEach((bar, i) => bar.classList.toggle('active', i < lit));
  requestAnimationFrame(animate);
}

resize();
setView(view);
requestAnimationFrame(animate);
