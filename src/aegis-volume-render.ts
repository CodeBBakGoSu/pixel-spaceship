import { TorusGeometry } from 'three';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { aegisVolumeOutline } from './aegis-volume.ts';

const { radius, halfWidth } = CLOSE_EVOLUTIONS.aegis;

export const AEGIS_VOLUME_OUTLINE = aegisVolumeOutline(radius, halfWidth);
export const AEGIS_INNER_RADIUS = radius - halfWidth;
export const AEGIS_OUTER_RADIUS = radius + halfWidth;
export const AEGIS_RING_TUBE_RADIUS = 0.15;

export function createAegisRingGeometry(boundaryRadius: number): TorusGeometry {
  return new TorusGeometry(boundaryRadius, AEGIS_RING_TUBE_RADIUS, 8, 40).rotateX(-Math.PI / 2);
}
