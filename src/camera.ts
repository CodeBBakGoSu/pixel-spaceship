import { Vector3, type PerspectiveCamera } from 'three';
import type { CockpitLayout } from './layout.ts';
import type { maneuverAttitude } from './maneuvers.ts';
import { clamp } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';
import { terrainElevation } from './terrain-horizon.ts';

export type Segment = 'overhead' | 'chase' | 'cockpit';
export type Point = { x: number; y: number };
export type Line = { from: Point; to: Point };
export type PitchMark = { angle: number; left: Line[]; right: Line[] };
type CockpitFraming = { width: number; height: number; cockpit: CockpitLayout | null };

const WORLD_UP = new Vector3(0, 1, 0);

export function cockpitFov(aspect: number, pitch: number): number {
  const minimum = 2 * Math.atan(Math.tan(20 * Math.PI / 180) / aspect) * 180 / Math.PI;
  return Math.max(60 + Math.abs(pitch) * 66, minimum);
}

function lensAdjustment(first: number, last: number, min: number, max: number, sweep = 0): number {
  const low = last - max, high = first - min;
  return Math.round(low <= high ? clamp(sweep, low, high) : (low + high) / 2);
}

export function frameCockpit(camera: PerspectiveCamera, player: StageState['player'], frame: CockpitFraming,
  attitude: ReturnType<typeof maneuverAttitude> | null, ground: Ground, visibleDepth: number, yaw = player.yaw): PitchMark[] {
  const { width, height, cockpit } = frame;
  const pitch = attitude?.cameraPitch ?? 0, bank = attitude?.cameraBank ?? 0;
  const bankCos = Math.cos(bank), visualPitch = pitch * bankCos;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const center = cockpit ? (cockpit.aiming.y + cockpit.aiming.height * 0.48) / height : 0.45;
  camera.fov = cockpitFov(width / height, pitch);
  let shift = clamp(center, 0.29, 0.64);
  if (cockpit && Math.abs(visualPitch) > 0.001) {
    const { y, height: glassHeight } = cockpit.aiming;
    const margin = Math.min(0.19, glassHeight / height * 0.42);
    const horizonOffset = bankCos * Math.tan(pitch) / (2 * Math.tan(camera.fov * Math.PI / 360));
    const edge = visualPitch > 0 ? (y + glassHeight) / height - margin : y / height + margin;
    shift = clamp(visualPitch > 0 ? Math.min(shift, edge - horizonOffset) : Math.max(shift, edge - horizonOffset), 0.14, 0.82);
  }
  const viewOffset = Math.round(height * (0.5 - shift));
  camera.setViewOffset(width, height, 0, viewOffset, width, height);
  camera.position.set(player.x + fx * 5, player.altitude + 2.7, -(player.z + fz * 5));
  camera.lookAt(player.x + fx * 105, camera.position.y + Math.tan(pitch) * 100, -(player.z + fz * 105));
  camera.rotateZ(bank);
  camera.updateMatrixWorld();
  if (!cockpit || cockpit.aiming.height < 20) return [];

  const columns = pitchColumns(camera, frame, ground, visibleDepth);
  if (bankCos < 0) columns.reverse();
  const marks = projectPitchLadder(camera, width, height, columns);
  const zero = marks.find(mark => mark.angle === 0);
  if (!zero) return marks;
  const area = cockpit.aiming;
  const points = [...zero.left, ...zero.right].flatMap(line => [line.from, line.to]);
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const strength = Math.min(1, Math.abs(visualPitch) / (24 * Math.PI / 180));
  const desired = area.y + area.height * (visualPitch > 0 ? 0.78 : 0.22);
  const adjustY = lensAdjustment(top, bottom, area.y + 6, area.y + area.height - 6, ((top + bottom) / 2 - desired) * strength);
  const adjustX = Math.abs(Math.sin(bank)) > 0.001
    ? lensAdjustment(Math.min(...xs), Math.max(...xs), area.x + 6, area.x + area.width - 6) : 0;
  if (!adjustY && !adjustX) return marks;

  // Move the lens rather than clamping the bar, so both scene and HUD keep the same skyline.
  camera.setViewOffset(width, height, adjustX, viewOffset + adjustY, width, height);
  return projectPitchLadder(camera, width, height, columns);
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
