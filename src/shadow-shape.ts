import { DataTexture, NearestFilter } from 'three';
import { SHADOW } from './data/palette.ts';

/** A delta-wing silhouette seen from above: u across (-1..1), w from the tail (0) to the nose (1). */
export function jetShadowCovers(u: number, w: number): boolean {
  const a = Math.abs(u);
  if (w < 0 || w > 1) return false;
  if (a < 0.13 && w < 0.97) return true; // fuselage
  if (a < 0.07) return true; // nose
  if (w >= 0.16 && w <= 0.62 && a <= (0.62 - w) / 0.46) return true; // swept wings
  return w < 0.17 && a < 0.42; // tailplanes
}

let shared: DataTexture | null = null;

/** Hard-edged white mask (alpha) shared by every aircraft's ground shadow; the material tints it. */
export function jetShadowTexture(): DataTexture {
  if (shared) return shared;
  const size = SHADOW.textureSize, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = jetShadowCovers(((x + 0.5) / size) * 2 - 1, (y + 0.5) / size) ? 255 : 0;
  }
  shared = new DataTexture(pixels, size, size);
  shared.magFilter = shared.minFilter = NearestFilter;
  shared.needsUpdate = true;
  return shared;
}

/** Where a shadow falls: offset away from the sun by the height above the ground. */
export function shadowOffset(clearance: number): { x: number; z: number } {
  const lift = Math.max(0, clearance);
  return { x: SHADOW.sunX * lift, z: SHADOW.sunZ * lift };
}
