import {
  BoxGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, Fog, Frustum, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Scene, Sphere, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { bindViewToggle, mountHud } from '../../shared/hud.ts';
import { droneFaces, dronePalette, shipFaces, shipPalette } from '../../shared/models.ts';
import { createSim, MAX_BULLETS, parseOptions, stepSim, terrainHeight } from '../../shared/sim.ts';
import { bakeDistantDrone, bakeOverheadDrone, bakeVoxels } from './voxel-geometry.ts';

const query = new URLSearchParams(location.search);
if (!query.has('n')) query.set('n', '500');
const sim = createSim(parseOptions(query.toString()));
const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.domElement.setAttribute('aria-label', 'ASTER WING Three.js flight scene');
document.body.append(renderer.domElement);

const sky = new Color(0x9eb8c7);
const scene = new Scene();
scene.background = sky;
scene.fog = new Fog(sky, 270, 1030);

function makeTerrain(): Mesh {
  const geometry = new PlaneGeometry(2048, 2048, 96, 96).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const basin = new Color(0x294b54), shore = new Color(0x68877a), ridge = new Color(0x879869);
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = -position.getZ(i);
    const altitude = terrainHeight(x, z);
    position.setY(i, altitude);
    if (altitude < 18) color.copy(basin).lerp(shore, Math.max(0, (altitude - 11) / 7));
    else color.copy(shore).lerp(ridge, Math.min(1, (altitude - 18) / 10));
    const slope = altitude - terrainHeight(x - 7, z + 10);
    color.multiplyScalar(0.86 + slope * 0.16 + (Math.floor(altitude) % 3) * 0.06);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
}

const voxelMaterial = new MeshBasicMaterial({ vertexColors: true });
const ship = new Mesh(bakeVoxels(shipFaces(), shipPalette, 0.44), voxelMaterial);
const droneSize = 0.64;
const droneGeometry = bakeVoxels(droneFaces(), dronePalette, droneSize);
const distantGeometry = bakeDistantDrone(droneSize);
const overheadDrone = bakeOverheadDrone(droneSize);
const detailLimit = Math.min(sim.n, 72);
const nearby = new InstancedMesh(droneGeometry, voxelMaterial, detailLimit);
const distant = new InstancedMesh(distantGeometry, voxelMaterial, sim.n);
const overhead = new InstancedMesh(overheadDrone.geometry, new MeshBasicMaterial({
  map: overheadDrone.texture,
  alphaTest: 0.5,
}), sim.n);
const bullets = new InstancedMesh(new BoxGeometry(0.75, 0.62, 4.6), new MeshBasicMaterial({ color: 0xafffee }), MAX_BULLETS);
const bandTint = [new Color(0xb3d9ff), new Color(0xfff4df), new Color(0xffadc7)];
for (const mesh of [nearby, distant, overhead, bullets]) {
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
}
for (const mesh of [nearby, distant, overhead]) {
  mesh.setColorAt(0, bandTint[1]);
  mesh.instanceColor!.setUsage(DynamicDrawUsage);
}
scene.add(makeTerrain(), ship, nearby, distant, overhead, bullets);

const topCamera = new OrthographicCamera(-1, 1, 1, -1, 0.5, 900);
topCamera.up.set(0, 0, -1);
const overheadHalfHeight = 112;
const overheadCellSize = 4;
let overheadColumns = 0;
let overheadCells = new Int32Array(0);
const chaseCamera = new PerspectiveCamera(60, 1, 0.45, 1250);
const cockpitCamera = new PerspectiveCamera(62, 1, 0.45, 1250);
const look = new Vector3();

function updateCamera() {
  const { x, z, alt, yaw } = sim.player;
  const worldZ = -z, forwardX = Math.sin(yaw), forwardZ = -Math.cos(yaw);
  if (sim.view === 'top') {
    topCamera.position.set(x, 310, worldZ);
    topCamera.lookAt(x, 0, worldZ);
    return topCamera;
  }
  if (sim.view === 'chase') {
    const setback = 44 + Math.max(0, 0.9 - chaseCamera.aspect) * 28;
    chaseCamera.position.set(x - forwardX * setback, alt + 18, worldZ - forwardZ * setback);
    look.set(x + forwardX * 110, alt - 4, worldZ + forwardZ * 110);
    chaseCamera.lookAt(look);
    return chaseCamera;
  }
  cockpitCamera.position.set(x + forwardX * 4.5, alt + 3.9, worldZ + forwardZ * 4.5);
  look.set(x + forwardX * 100, alt + 3.9, worldZ + forwardZ * 100);
  cockpitCamera.lookAt(look);
  return cockpitCamera;
}

const matrix = new Matrix4();
const viewProjection = new Matrix4();
const frustum = new Frustum();
const radius = Math.max(...[droneGeometry, distantGeometry, overheadDrone.geometry].map(geometry => {
  const bounds = geometry.boundingSphere!;
  return bounds.radius + bounds.center.length();
}));
const overheadMargin = radius + overheadCellSize;
const droneBounds = new Sphere(new Vector3(), radius);

function instanceTransform(x: number, y: number, z: number, dx: number, dz: number): Matrix4 {
  const distance = Math.sqrt(dx * dx + dz * dz);
  const sin = distance > 0 ? dx / distance : 0;
  const cos = distance > 0 ? dz / distance : 1;
  // The shared sim's north is positive Z. Three's craft and camera face negative Z.
  return matrix.set(cos, 0, -sin, x, 0, 1, 0, y, sin, 0, cos, -z, 0, 0, 0, 1);
}

function commitInstances(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  if (!count) return;
  const transforms = mesh.instanceMatrix;
  transforms.clearUpdateRanges();
  transforms.addUpdateRange(0, count * 16);
  transforms.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.clearUpdateRanges();
    mesh.instanceColor.addUpdateRange(0, count * 3);
    mesh.instanceColor.needsUpdate = true;
  }
}

function writeDrone(mesh: InstancedMesh, index: number, offset: number): void {
  const { player, enemies } = sim;
  const x = enemies[offset], z = enemies[offset + 1];
  mesh.setMatrixAt(index, instanceTransform(x, enemies[offset + 2], z, player.x - x, player.z - z));
  mesh.setColorAt(index, bandTint[enemies[offset + 3]]);
}

function updateDrones(): void {
  let closeCount = 0, farCount = 0;
  const { player, enemies } = sim;
  const top = sim.view === 'top';
  const coarse = top ? overhead : distant;
  const groupOverlaps = top && sim.n > 2000;
  if (groupOverlaps) overheadCells.fill(-1);
  nearby.visible = distant.visible = !top;
  overhead.visible = top;
  for (let i = 0; i < enemies.length; i += 4) {
    const x = enemies[i], z = enemies[i + 1], alt = enemies[i + 2];
    droneBounds.center.set(x, alt, -z);
    if (!frustum.intersectsSphere(droneBounds)) continue;
    const dx = player.x - x, dz = player.z - z;
    if (groupOverlaps) {
      // In the flat view, group silhouettes whose centers project only a few pixels apart.
      const column = Math.floor((-dx - topCamera.left + overheadMargin) / overheadCellSize);
      const row = Math.floor((-dz + overheadHalfHeight + overheadMargin) / overheadCellSize);
      const cell = row * overheadColumns + column, previous = overheadCells[cell];
      if (previous === -1 || alt > enemies[previous + 2]) overheadCells[cell] = i;
      continue;
    }
    const useDetail = !top && closeCount < detailLimit && dx * dx + dz * dz <= 118 ** 2;
    if (useDetail) writeDrone(nearby, closeCount++, i);
    else writeDrone(coarse, farCount++, i);
  }
  if (groupOverlaps) {
    for (const i of overheadCells) if (i >= 0) writeDrone(overhead, farCount++, i);
  }
  commitInstances(nearby, closeCount);
  commitInstances(coarse, farCount);
}

function updateBullets(): void {
  const data = sim.bullets;
  for (let i = 0; i < sim.bulletCount; i++) {
    const o = i * 6;
    bullets.setMatrixAt(i, instanceTransform(data[o], data[o + 2], data[o + 1], data[o + 3], data[o + 4]));
  }
  commitInstances(bullets, sim.bulletCount);
}

const pixelScale = 4;
const target = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
const presentation = new Scene();
const screen = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
screen.position.z = 1;
presentation.add(new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({
  map: target.texture,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})));

function resize(): void {
  const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
  const lowWidth = Math.ceil(width / pixelScale), lowHeight = Math.ceil(height / pixelScale);
  const aspect = lowWidth / lowHeight;
  renderer.setSize(width, height, false);
  target.setSize(lowWidth, lowHeight);
  // Crop partial blocks at the edge instead of squeezing the texels on odd sizes.
  renderer.setViewport(0, 0, lowWidth * pixelScale, lowHeight * pixelScale);
  topCamera.left = -overheadHalfHeight * aspect;
  topCamera.right = overheadHalfHeight * aspect;
  topCamera.top = overheadHalfHeight;
  topCamera.bottom = -overheadHalfHeight;
  topCamera.updateProjectionMatrix();
  if (sim.n > 2000) {
    overheadColumns = Math.ceil((topCamera.right * 2 + overheadMargin * 2) / overheadCellSize);
    const rows = Math.ceil((overheadHalfHeight * 2 + overheadMargin * 2) / overheadCellSize);
    overheadCells = new Int32Array(overheadColumns * rows);
  }
  for (const camera of [chaseCamera, cockpitCamera]) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

const hud = mountHud(document.body, 'THREE.js InstancedMesh');
const compass = document.createElement('span');
compass.textContent = 'N ↑';
compass.setAttribute('aria-label', 'North is up');
compass.style.cssText = 'position:fixed;right:8px;top:8px;color:#d7efe8;background:#101923;border:1px solid #2a3a4a;padding:5px 8px;font:12px ui-monospace,monospace;pointer-events:none';
document.body.append(compass);

const durations = new Float64Array(30);
let previousTime: number | undefined, sample = 0, samples = 0, totalDuration = 0, hudFrame = 0;
function updateHud(): void {
  const ms = samples ? totalDuration / samples : 0;
  hud.set({ fps: ms > 0 ? 1000 / ms : 0, ms, n: sim.n, view: sim.view });
  compass.hidden = sim.view !== 'top';
}
bindViewToggle(() => sim.view, view => {
  sim.view = view;
  updateHud();
});

function frame(now: number): void {
  const elapsed = previousTime === undefined ? 0 : now - previousTime;
  previousTime = now;
  if (elapsed > 0) {
    totalDuration += elapsed - durations[sample];
    durations[sample] = elapsed;
    sample = (sample + 1) % durations.length;
    samples = Math.min(samples + 1, durations.length);
  }
  stepSim(sim, elapsed / 1000);
  const { player } = sim;
  ship.position.set(player.x, player.alt, -player.z);
  ship.rotation.y = -player.yaw;

  const camera = updateCamera();
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  updateDrones();
  updateBullets();

  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(presentation, screen);
  if (++hudFrame % 6 === 0 || samples === 1) updateHud();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
updateHud();
requestAnimationFrame(frame);
