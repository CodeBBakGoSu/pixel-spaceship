import type { SimState, ViewName } from '@shared/sim';

export type Camera = {
  view: ViewName;
  width: number;
  height: number;
  cx: number;
  cy: number;
  focal: number;
  x: number;
  z: number;
  alt: number;
  sinYaw: number;
  cosYaw: number;
  sinPitch: number;
  cosPitch: number;
};

export type Projection = { x: number; y: number; depth: number; scale: number };

export function cameraFor(sim: SimState, width: number, height: number): Camera {
  const { player, view } = sim;
  const chase = view === 'chase';
  const top = view === 'top';
  const yaw = player.yaw + (chase ? 0.48 : 0);
  const offset = chase ? -102 : 20;
  const pitch = chase ? 0.37 : 0;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  return {
    view, width, height, cx: width / 2,
    cy: height * (chase ? 0.54 : 0.5),
    focal: top ? Math.min(width, height) / 735 : Math.min(height, width * 1.2) * 0.9,
    x: top ? player.x : player.x + sinYaw * offset,
    z: top ? player.z : player.z + cosYaw * offset,
    alt: player.alt + (chase ? 48 : 0),
    sinYaw, cosYaw, sinPitch: Math.sin(pitch), cosPitch: Math.cos(pitch),
  };
}

export function project(camera: Camera, x: number, z: number, alt: number, out: Projection): boolean {
  const dx = x - camera.x;
  const dz = z - camera.z;

  if (camera.view === 'top') {
    out.x = camera.cx + dx * camera.focal;
    out.y = camera.cy - dz * camera.focal;
    out.depth = -alt;
    out.scale = camera.focal;
    return true;
  }

  const right = dx * camera.cosYaw - dz * camera.sinYaw;
  const forward = dx * camera.sinYaw + dz * camera.cosYaw;
  const up = alt - camera.alt;
  const depth = forward * camera.cosPitch - up * camera.sinPitch;
  if (depth < 8) return false;

  const scale = camera.focal / depth;
  out.x = camera.cx + right * scale;
  out.y = camera.cy - (forward * camera.sinPitch + up * camera.cosPitch) * scale;
  out.depth = depth;
  out.scale = scale;
  return true;
}
