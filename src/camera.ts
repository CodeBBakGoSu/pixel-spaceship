import { Vector3, type PerspectiveCamera } from 'three';
import type { CockpitLayout } from './layout.ts';
import type { maneuverAttitude } from './maneuvers.ts';
import { clamp } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';
import { TERRAIN_HALF_WIDTH, TERRAIN_MESH_STEP } from './world.ts';

export type Segment = 'overhead' | 'chase' | 'cockpit';
export type Point = { x: number; y: number };
export type Line = { from: Point; to: Point };
export type PitchMark = { angle: number; left: Line[]; right: Line[] };
type CockpitFraming = { width: number; height: number; cockpit: CockpitLayout | null };

const WORLD_UP = new Vector3(0, 1, 0);

export function frameCockpit(camera: PerspectiveCamera, player: StageState['player'], frame: CockpitFraming,
  attitude: ReturnType<typeof maneuverAttitude> | null, ground: Ground, visibleDepth: number): PitchMark[] {
  const { width, height, cockpit } = frame;
  const pitch = attitude?.cameraPitch ?? 0, bank = attitude?.cameraBank ?? 0;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const center = cockpit ? (cockpit.aiming.y + cockpit.aiming.height * 0.48) / height : 0.45;
  const minimumFov = 2 * Math.atan(Math.tan(20 * Math.PI / 180) * height / width) * 180 / Math.PI;
  camera.fov = Math.max(60 + Math.abs(pitch) * 66, minimumFov);
  let shift = clamp(center, 0.29, 0.64);
  if (cockpit && pitch) {
    const { y, height: glassHeight } = cockpit.aiming;
    const margin = Math.min(0.19, glassHeight / height * 0.42);
    const horizonOffset = Math.tan(pitch) / (2 * Math.tan(camera.fov * Math.PI / 360));
    const edge = pitch > 0 ? (y + glassHeight) / height - margin : y / height + margin;
    shift = clamp(pitch > 0 ? Math.min(shift, edge - horizonOffset) : Math.max(shift, edge - horizonOffset), 0.14, 0.82);
  }
  const viewOffset = Math.round(height * (0.5 - shift));
  camera.setViewOffset(width, height, 0, viewOffset, width, height);
  camera.position.set(player.x + fx * 5, player.altitude + 2.7, -(player.z + fz * 5));
  camera.lookAt(player.x + fx * 105, camera.position.y + Math.tan(pitch) * 100, -(player.z + fz * 105));
  camera.rotateZ(bank);
  camera.updateMatrixWorld();
  if (!cockpit || cockpit.aiming.height < 20) return [];

  const marks = projectPitchLadder(camera, frame, ground, visibleDepth);
  const zero = marks.find(mark => mark.angle === 0);
  if (!zero) return marks;
  const { y, height: glassHeight } = cockpit.aiming;
  const heights = [...zero.left, ...zero.right].flatMap(line => [line.from.y, line.to.y]);
  const shiftUp = Math.max(...heights) - (y + glassHeight - 6);
  const shiftDown = Math.min(...heights) - (y + 6);
  const adjustment = Math.round(shiftUp <= shiftDown ? clamp(0, shiftUp, shiftDown) : (shiftUp + shiftDown) / 2);
  if (!adjustment) return marks;

  // Move the lens rather than clamping the bar, so both scene and HUD keep the same skyline.
  camera.setViewOffset(width, height, 0, viewOffset + adjustment, width, height);
  return projectPitchLadder(camera, frame, ground, visibleDepth);
}

export const cockpitLadderSpan = (layout: CockpitLayout): number =>
  Math.min(layout.compact ? 51 : 105, layout.aiming.width * 0.31);

// Match the two triangles in each PlaneGeometry cell, including its reversed world Z.
function meshHeight(ground: Ground, x: number, z: number): number {
  const step = TERRAIN_MESH_STEP;
  const left = Math.floor(x / step) * step, top = Math.floor(z / step) * step;
  const u = (x - left) / step, v = (z - top) / step;
  const b = ground(left, -(top + step)), d = ground(left + step, -top);
  if (u + v <= 1) return ground(left, -top) * (1 - u - v) + u * d + v * b;
  return ground(left + step, -(top + step)) * (u + v - 1) + (1 - u) * b + (1 - v) * d;
}

function terrainElevation(eye: Vector3, horizontal: Vector3, vertical: Vector3, gaze: Vector3,
  ground: Ground, near: number, far: number): number {
  const horizontalDepth = gaze.dot(horizontal), verticalDepth = gaze.dot(vertical);
  const sample = (distance: number): number => {
    const x = eye.x + distance * horizontal.x, z = eye.z + distance * horizontal.z;
    let offset = (meshHeight(ground, x, z) - eye.y) / vertical.y;
    for (let i = 0; i < 2; i++) {
      offset = (meshHeight(ground, x + offset * vertical.x, z + offset * vertical.z) - eye.y) / vertical.y;
    }
    const depth = distance * horizontalDepth + offset * verticalDepth;
    if (depth < near || depth > far
      || Math.abs(x + offset * vertical.x) > TERRAIN_HALF_WIDTH
      || Math.abs(z + offset * vertical.z) > TERRAIN_HALF_WIDTH) return -Infinity;
    return Math.atan2(offset, distance);
  };
  let highest = -Infinity;
  for (let distance = TERRAIN_MESH_STEP; distance <= 3 * TERRAIN_HALF_WIDTH; distance += TERRAIN_MESH_STEP) {
    const angle = sample(distance);
    if (angle === -Infinity && highest !== -Infinity) {
      // Refine the last step at the fog cutoff or the edge of the mesh.
      let inside = distance - TERRAIN_MESH_STEP, outside = distance;
      for (let i = 0; i < 8; i++) {
        const middle = (inside + outside) / 2, edge = sample(middle);
        if (edge === -Infinity) outside = middle;
        else {
          inside = middle;
          highest = Math.max(highest, edge);
        }
      }
      break;
    }
    highest = Math.max(highest, angle);
  }
  return highest;
}

function projectPitchLadder(camera: PerspectiveCamera, frame: CockpitFraming, ground: Ground, visibleDepth: number): PitchMark[] {
  const { width, height, cockpit } = frame;
  if (!cockpit) return [];
  const eye = camera.position, gaze = camera.getWorldDirection(new Vector3());
  const span = cockpitLadderSpan(cockpit), center = cockpit.aiming.x + cockpit.aiming.width / 2;
  const columns = [-1, -0.65, -0.3, 0.3, 0.65, 1].map(offset => {
    const x = center + offset * span, ndcX = x * 2 / width - 1;
    // Each screen column lies in one plane through the eye, including camera bank and lens shift.
    const normal = new Vector3(ndcX, 1, 0).unproject(camera).sub(eye)
      .cross(new Vector3(ndcX, -1, 0).unproject(camera).sub(eye)).normalize();
    const horizontal = new Vector3().crossVectors(normal, WORLD_UP).normalize();
    if (horizontal.dot(gaze) < 0) horizontal.negate();
    const vertical = new Vector3().crossVectors(horizontal, normal).normalize();
    if (vertical.y < 0) vertical.negate();
    const elevation = terrainElevation(eye, horizontal, vertical, gaze, ground, camera.near, Math.min(visibleDepth, camera.far));
    return { x, horizontal, vertical, elevation };
  });
  if (columns.some(column => column.elevation === -Infinity)) return [];

  const marks: PitchMark[] = [], ray = new Vector3();
  const rungColumns = [columns[0], columns[2], columns[3], columns[5]];
  for (let angle = -90; angle <= 90; angle += 10) {
    // Sample the middle of each zero segment as well, so it can follow a turn in the terrain edge.
    const samples = angle === 0 ? columns : rungColumns;
    const points = samples.map(({ x, horizontal, vertical, elevation }): Point | null => {
      const radians = elevation + angle * Math.PI / 180;
      ray.copy(horizontal).multiplyScalar(Math.cos(radians)).addScaledVector(vertical, Math.sin(radians));
      if (ray.dot(gaze) <= 0.001) return null;
      ray.add(eye).project(camera);
      return { x, y: (1 - ray.y) * height / 2 };
    });
    if (!points.every((point): point is Point => point !== null)) continue;
    const middle = points.length / 2;
    const segments = (side: Point[]): Line[] => side.slice(1).map((to, i) => ({ from: side[i], to }));
    marks.push({ angle, left: segments(points.slice(0, middle)), right: segments(points.slice(middle)) });
  }
  return marks;
}
