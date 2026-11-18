import { Application, Graphics, Particle, ParticleContainer } from 'pixi.js';
import { bindViewToggle, mountHud } from '@shared/hud';
import { createSim, MAX_BULLETS, parseOptions, stepSim } from '@shared/sim';
import { cameraFor, project, type Camera, type Projection } from './camera';
import { bakeActorSheet, createShipStack, DRONE_BAKE_SCALE } from './sprites';
import { createTerrain, drawSky } from './terrain';

const sim = createSim(parseOptions());
const app = new Application();
await app.init({
  autoStart: false,
  preference: 'webgl',
  background: 0x101826,
  antialias: false,
  resolution: 1,
  roundPixels: true,
});
document.body.appendChild(app.canvas);
const hud = mountHud(document.body, 'PixiJS v8 stacked sprites');

const sky = new Graphics();
const terrain = createTerrain();
const ship = createShipStack();
const cockpit = new Graphics();
const sheet = bakeActorSheet();
const batchOptions = {
  texture: sheet.texture,
  dynamicProperties: { position: true, vertex: true, rotation: true, uvs: true, color: true },
};
const behindShip = new ParticleContainer(batchOptions);
const inFrontOfShip = new ParticleContainer(batchOptions);
app.stage.addChild(sky, terrain.mesh, behindShip, ship.mesh, inFrontOfShip, cockpit);

const enemies = Array.from({ length: sim.n }, (_, i) => new Particle({
  texture: sheet.drones[sim.view][sim.enemies[i * 4 + 3]], anchorX: 0.5, anchorY: 0.5,
}));
const bullets = Array.from({ length: MAX_BULLETS }, () => new Particle({
  texture: sheet.bullet, anchorX: 0.5, anchorY: 0.5,
}));
const actors = [...enemies, ...bullets].map((sprite) => ({ sprite, depth: 0 }));
const visible: typeof actors = [];
const point: Projection = { x: 0, y: 0, depth: 0, scale: 0 };
const tip: Projection = { ...point };

function onScreen(camera: Camera, point: Projection, pad: number): boolean {
  return point.x >= -pad && point.x <= camera.width + pad
    && point.y >= -pad && point.y <= camera.height + pad;
}

function updateActors(camera: Camera): void {
  project(camera, sim.player.x, sim.player.z, sim.player.alt, point);
  const playerDepth = camera.view === 'cockpit' ? Infinity : point.depth;
  const top = camera.view === 'top';
  const poses = sheet.drones[camera.view];
  visible.length = 0;

  for (let i = 0; i < sim.n; i++) {
    const offset = i * 4;
    const x = sim.enemies[offset];
    const z = sim.enemies[offset + 1];
    if (!project(camera, x, z, sim.enemies[offset + 2], point)) continue;

    const scale = Math.max(0.24, Math.min(1.55, point.scale * 0.75 / DRONE_BAKE_SCALE));
    const texture = poses[sim.enemies[offset + 3]];
    if (!onScreen(camera, point, texture.width * scale * 0.75)) continue;

    const actor = actors[i];
    const sprite = actor.sprite;
    sprite.texture = texture;
    sprite.x = Math.round(point.x);
    sprite.y = Math.round(point.y);
    sprite.scaleX = sprite.scaleY = Math.round(texture.width * scale) / texture.width;
    sprite.rotation = top ? Math.atan2(sim.player.x - x, sim.player.z - z) : 0;
    actor.depth = point.depth;
    visible.push(actor);
  }

  for (let i = 0; i < sim.bulletCount; i++) {
    const offset = i * 6;
    const data = sim.bullets;
    const x = data[offset], z = data[offset + 1], alt = data[offset + 2];
    if (!project(camera, x, z, alt, point) || !onScreen(camera, point, 20)) continue;

    const hasTip = project(camera, x + data[offset + 3] * 0.035, z + data[offset + 4] * 0.035, alt, tip);
    const dx = hasTip ? tip.x - point.x : 0;
    const dy = hasTip ? tip.y - point.y : -1;
    const actor = actors[sim.n + i];
    const sprite = actor.sprite;
    sprite.x = Math.round(point.x);
    sprite.y = Math.round(point.y);
    sprite.scaleX = Math.max(1, Math.min(5, Math.round(point.scale * 1.9))) / sheet.bullet.width;
    sprite.scaleY = Math.max(3, Math.min(22, Math.round(Math.hypot(dx, dy) + 2))) / sheet.bullet.height;
    sprite.rotation = Math.atan2(dx, -dy);
    actor.depth = point.depth;
    visible.push(actor);
  }

  // Keep the player between two batches while sorting transparent sprites far to near.
  visible.sort((a, b) => b.depth - a.depth);
  behindShip.particleChildren.length = inFrontOfShip.particleChildren.length = 0;
  for (const actor of visible) {
    const batch = actor.depth >= playerDepth ? behindShip : inFrontOfShip;
    batch.particleChildren.push(actor.sprite);
  }
  behindShip.update();
  inFrontOfShip.update();
}

function drawCockpit(camera: Camera): void {
  cockpit.clear();
  if (camera.view !== 'cockpit') return;

  const x = Math.round(camera.cx), y = Math.round(camera.cy);
  cockpit.rect(x - 11, y, 6, 1).rect(x + 6, y, 6, 1)
    .rect(x, y - 11, 1, 6).rect(x, y + 6, 1, 6).rect(x, y, 1, 1)
    .fill({ color: 0xcaf5e8, alpha: 0.9 });
  for (const alt of [-1, 1]) {
    const row = y + alt * Math.max(16, Math.round(camera.height * 0.1));
    cockpit.rect(x - 24, row, 6, 1).rect(x + 19, row, 6, 1)
      .fill({ color: 0x98d4cc, alpha: 0.6 });
  }
}

let redrawOverlay = true;
function resize(): void {
  const { innerWidth, innerHeight, devicePixelRatio } = window;
  const targetScale = innerWidth < 720 || innerHeight < 500 ? 1 : 2;
  const scale = Math.max(1, Math.round(targetScale * devicePixelRatio)) / devicePixelRatio;
  const width = Math.max(1, Math.ceil(innerWidth / scale));
  const height = Math.max(1, Math.ceil(innerHeight / scale));
  app.renderer.resize(width, height);
  app.canvas.style.width = `${width * scale}px`;
  app.canvas.style.height = `${height * scale}px`;
  redrawOverlay = true;
}
window.addEventListener('resize', resize);
resize();

let averageMs = 0;
let sinceHud = 120;
bindViewToggle(() => sim.view, (view) => {
  sim.view = view;
  redrawOverlay = true;
  sinceHud = 120;
});

app.ticker.add(({ elapsedMS }) => {
  stepSim(sim, Math.min(0.05, elapsedMS / 1000));
  const camera = cameraFor(sim, app.screen.width, app.screen.height);
  if (redrawOverlay) {
    drawSky(sky, camera);
    drawCockpit(camera);
    redrawOverlay = false;
  }
  terrain.update(camera);
  ship.update(camera, sim);
  updateActors(camera);

  averageMs = averageMs === 0 ? elapsedMS : averageMs * 0.88 + elapsedMS * 0.12;
  sinceHud += elapsedMS;
  if (sinceHud >= 120) {
    hud.set({ fps: 1000 / averageMs, ms: averageMs, n: sim.n, view: sim.view });
    sinceHud = 0;
  }
});
app.start();
