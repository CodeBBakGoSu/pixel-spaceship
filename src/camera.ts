import { Vector3, type PerspectiveCamera } from 'three';
import type { CockpitLayout } from './layout.ts';
import { clamp } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';
import { terrainElevation } from './terrain-horizon.ts';

export type Segment = 'overhead' | 'chase' | 'cockpit';
export type Point = { x: number; y: number };
export type Line = { from: Point; to: Point };
export type PitchMark = { angle: number; left: Line[]; right: Line[] };
type CockpitFraming = { width: number; height: number; cockpit: CockpitLayout | null };
type CockpitAttitude = { cameraPitch: number; cameraBank: number; fovPitch?: number };
type CockpitLens = { widening: number; pullback: number; shake: number; shakeVertical?: number };

const WORLD_UP = new Vector3(0, 1, 0);

export function cockpitFov(aspect: number, pitch: number, widening = 0): number {
  const minimum = 2 * Math.atan(Math.tan(20 * Math.PI / 180) / aspect) * 180 / Math.PI;
  return Math.max(60 + Math.abs(pitch) * 18, minimum) + widening;
}

export function frameCockpit(camera: PerspectiveCamera, player: StageState['player'], frame: CockpitFraming,
  attitude: CockpitAttitude | null, ground: Ground, visibleDepth: number, yaw = player.yaw,
  lens?: CockpitLens): PitchMark[] {
  const { width, height, cockpit } = frame;
  const pitch = attitude?.cameraPitch ?? 0, bank = attitude?.cameraBank ?? 0;
  const bankCos = Math.cos(bank);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const center = cockpit ? (cockpit.aiming.y + cockpit.aiming.height * 0.48) / height : 0.45;
  camera.fov = cockpitFov(width / height, attitude?.fovPitch ?? pitch, lens?.widening);
  // Keep the projection anchored to the cockpit glass. Pitch-dependent view-offset
  // correction made the fixed reticle slide across the world while the player aimed.
  const shift = clamp(center, 0.29, 0.64);
  const viewOffset = Math.round(height * (0.5 - shift));
  camera.setViewOffset(width, height, 0, viewOffset, width, height);
  const reach = 5 - (lens?.pullback ?? 0), shake = lens?.shake ?? 0;
  camera.position.set(player.x + fx * reach + fz * shake, player.altitude + 2.7 + (lens?.shakeVertical ?? 0),
    -(player.z + fz * reach - fx * shake));
  camera.lookAt(camera.position.x + fx * 100, camera.position.y + Math.tan(pitch) * 100, camera.position.z - fz * 100);
  camera.rotateZ(bank);
  camera.updateMatrixWorld();
  if (!cockpit || cockpit.aiming.height < 20) return [];

  const columns = pitchColumns(camera, frame, ground, visibleDepth);
  if (bankCos < 0) columns.reverse();
  const marks = projectPitchLadder(camera, width, height, columns);
  return marks;
}

export const cockpitLadderSpan = (layout: CockpitLayout): number =>
  Math.min(layout.compact ? 51 : 105, layout.aiming.width * 0.31);

function pitchColumns(camera: PerspectiveCamera, frame: CockpitFraming, ground: Ground, visibleDepth: number) {
  const { width, cockpit } = frame;
  if (!cockpit) return [];
  const eye = camera.position, gaze = camera.getWorldDirection(new Vector3());
  const right = new Vector3().crossVectors(gaze, WORLD_UP).normalize();
  const span = cockpitLadderSpan(cockpit), center = cockpit.aiming.x + cockpit.aiming.width / 2;
  return [-1, -0.65, -0.3, 0.3, 0.65, 1].map(offset => {
    const ndcX = (center + offset * span) * 2 / width - 1;
    // Slice in an unrolled frame, then project the resulting skyline through the rolled camera.
    const normal = right.clone().addScaledVector(gaze, -ndcX / camera.projectionMatrix.elements[0]).normalize();
    const horizontal = new Vector3().crossVectors(normal, WORLD_UP).normalize();
    if (horizontal.dot(gaze) < 0) horizontal.negate();
    const vertical = new Vector3().crossVectors(horizontal, normal).normalize();
    if (vertical.y < 0) vertical.negate();
    const elevation = terrainElevation(eye, horizontal, vertical, normal, gaze, ground, camera.near, Math.min(visibleDepth, camera.far));
    return { horizontal, vertical, elevation };
  });
}

function projectPitchLadder(camera: PerspectiveCamera, width: number, height: number, columns: ReturnType<typeof pitchColumns>): PitchMark[] {
  if (!columns.length || columns.some(column => column.elevation === -Infinity)) return [];
  const eye = camera.position, gaze = camera.getWorldDirection(new Vector3());

  const marks: PitchMark[] = [], ray = new Vector3();
  const rungColumns = [columns[0], columns[2], columns[3], columns[5]];
  for (let angle = -90; angle <= 90; angle += 10) {
    // Sample the middle of each zero segment as well, so it can follow a turn in the terrain edge.
    const samples = angle === 0 ? columns : rungColumns;
    const points = samples.map(({ horizontal, vertical, elevation }): Point | null => {
      const radians = elevation + angle * Math.PI / 180;
      ray.copy(horizontal).multiplyScalar(Math.cos(radians)).addScaledVector(vertical, Math.sin(radians));
      if (ray.dot(gaze) <= 0.001) return null;
      ray.add(eye).project(camera);
      return { x: (1 + ray.x) * width / 2, y: (1 - ray.y) * height / 2 };
    });
    if (!points.every((point): point is Point => point !== null)) continue;
    const middle = points.length / 2;
    const segments = (side: Point[]): Line[] => side.slice(1).map((to, i) => ({ from: side[i], to }));
    marks.push({ angle, left: segments(points.slice(0, middle)), right: segments(points.slice(middle)) });
  }
  return marks;
}
