export type Segment = 'overhead' | 'chase' | 'cockpit';
export type CameraState = {
  mode: Segment; x: number; z: number; yaw: number; altitude: number;
  pitch: number; camOffset: number; camHeightOffset: number; crossFade: number;
};

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type WorldProjection = Point & { scale: number; depth: number };

export function projectWorld(camera: CameraState, x: number, z: number, alt: number, w: number, h: number, mode: Segment): WorldProjection | null {
  if (mode === 'overhead') return { x: w / 2 + (x - camera.x) / 1.4 * Math.min(1, w / 240), y: h / 2 - (z - camera.z) / 1.4, scale: 1 / 1.4, depth: z - camera.z };
  const sin = Math.sin(camera.yaw), cos = Math.cos(camera.yaw);
  const dx = x - (camera.x - sin * camera.camOffset), dz = z - (camera.z - cos * camera.camOffset);
  const depth = dx * sin + dz * cos, right = dx * cos - dz * sin;
  if (depth < 8) return null;
  const scale = h * 0.95 / depth;
  return { x: w / 2 + right * h * 0.95 / depth, y: h * 0.3 + camera.pitch * 15 + (camera.altitude + camera.camHeightOffset - alt) * scale, scale, depth };
}
