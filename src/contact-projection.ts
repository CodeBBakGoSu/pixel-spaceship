import type { Camera, Vector3 } from 'three';
import type { Position } from './stage-types.ts';

export type ContactProjection = { x: number; y: number; depth: number };

// Only the marker layer needs unclipped coordinates or an explicit rear depth.
export function projectCameraContact(camera: Camera, frame: { width: number; height: number },
  target: Position, out: ContactProjection, vector: Vector3): void {
  const view = vector.set(target.x, target.alt, -target.z).applyMatrix4(camera.matrixWorldInverse);
  out.depth = -view.z;
  if (out.depth <= 0.05) {
    out.x = frame.width / 2;
    out.y = frame.height / 2;
    return;
  }
  view.applyMatrix4(camera.projectionMatrix);
  out.x = (view.x + 1) * frame.width / 2;
  out.y = (1 - view.y) * frame.height / 2;
}
