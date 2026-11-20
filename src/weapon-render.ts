import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { EVOLUTIONS, WEAPON_IDS, type WeaponId } from './data/items.ts';
import type { RunProgression } from './progression.ts';

// Ship-local meters, with the nose toward -Z. Dark sockets reach into the hull or spar.
type Block = readonly [x: number, y: number, z: number, width: number, height: number, length: number, color: number];
const steel = 0xa9b6b8, gunmetal = 0x394a57, lightAlloy = 0xd8e3df;
const brass = 0xffbd72, green = 0x81ebaf, red = 0xf67867;
const blue = 0x69bdf4, aqua = 0x64eedc, violet = 0xbba0ff;
const gold = 0xffcf69, whiteGold = 0xfff3b6;

function paired(blocks: readonly Block[]): Block[] {
  return [...blocks, ...blocks.map(([x, ...rest]): Block => [-x, ...rest])];
}

const MOUNTS: Record<WeaponId, readonly Block[]> = {
  twin: paired([
    [1.52, 0.19, -10.10, 1.42, 1.39, 4.26, gunmetal],
    [1.52, 0.73, -11.88, 0.91, 1.02, 2.7, steel],
    [1.52, 0.74, -13.08, 1.14, 1.16, 0.69, brass],
  ]),
  pods: paired([
    [9.35, 0.43, 4.96, 2.94, 1.32, 4.72, gunmetal],
    [9.42, 1.22, 4.78, 2.36, 1.02, 3.66, steel],
    [9.58, 1.58, 6.26, 2.25, 0.83, 1.14, green],
  ]),
  seeker: paired([
    [6.62, 0.37, 3.23, 2.28, 1.32, 4.38, gunmetal],
    [6.62, 1.14, 3.08, 2.16, 1.32, 3.45, red],
    [6.62, 1.59, 1.12, 1.43, 0.9, 1.24, lightAlloy],
  ]),
  rail: [
    [2.98, 0.3, -6.3, 2.19, 1.51, 8.12, gunmetal],
    [2.45, 1.37, -6.78, 0.68, 1.12, 8.05, steel],
    [3.54, 1.37, -6.78, 0.68, 1.12, 8.05, steel],
    [2.45, 1.98, -6.7, 0.68, 0.42, 5.92, blue],
    [3.54, 1.98, -6.7, 0.68, 0.42, 5.92, blue],
  ],
  flak: [
    [-4.44, 0.39, -0.06, 2.78, 1.42, 3.12, gunmetal],
    [-4.44, 1.22, -0.06, 2.42, 1.22, 1.97, steel],
    [-4.44, 1.49, -1.67, 1.64, 1.09, 2.12, brass],
    [-4.44, 1.63, 0.73, 1.96, 0.95, 0.91, red],
  ],
  ion: [
    [0, 1.66, 9.16, 2.39, 1.12, 3.54, gunmetal],
    [0, 2.46, 9.57, 2.09, 1.02, 3.51, steel],
    [0, 2.54, 10.98, 1.51, 0.87, 1.99, aqua],
  ],
  drones: paired([
    [7.16, 0.18, 6.82, 1.82, 1.09, 1.97, gunmetal],
    [7.16, 0.79, 7.24, 1.64, 0.78, 1.85, lightAlloy],
    [7.16, 1.23, 7.82, 1.3, 0.74, 1.27, blue],
  ]),
  phoenix: [
    [2.04, 1.13, 8.82, 1.68, 1.27, 2.77, gunmetal],
    [2.04, 1.75, 9.47, 1.74, 0.85, 1.83, steel],
    [1.58, 1.82, 10.32, 0.75, 0.8, 1.37, red],
    [2.51, 1.82, 10.32, 0.75, 0.8, 1.37, brass],
  ],
  'bomb-bay': [
    [0, 2.61, 4.4, 2.93, 1.37, 4.21, gunmetal],
    ...paired([
      [0.69, 3.39, 4.4, 1.31, 0.82, 3.58, steel],
      [0.69, 3.68, 5.46, 1.26, 0.73, 1.5, red],
    ]),
  ],
  arc: [
    [4.44, 0.42, -0.05, 2.65, 1.14, 3.41, gunmetal],
    [4.44, 1.05, 0.67, 2.49, 1.3, 1.58, steel],
    [3.62, 1.44, -0.89, 0.83, 1.5, 2.24, violet],
    [5.26, 1.44, -0.89, 0.83, 1.5, 2.24, violet],
  ],
};

// Each upgrade keeps the same hardpoint. Wider casings and bright rails carry the silhouette
// through the low-resolution scene without adding a pass or a separate glow mesh.
const EVOLVED_MOUNTS: Record<WeaponId, readonly Block[]> = {
  twin: paired([
    [1.68, 0.70, -10.65, 1.91, 1.9, 4.42, gunmetal],
    [1.24, 0.68, -13.27, 0.82, 0.83, 3.75, lightAlloy],
    [2.12, 0.68, -13.27, 0.82, 0.83, 3.75, lightAlloy],
    [1.68, 1.47, -12.91, 0.86, 0.88, 3.92, brass],
    [1.68, 1.02, -13.57, 1.98, 1.54, 0.76, gold],
  ]),
  pods: paired([
    [9.45, 0.39, 5.11, 3.43, 1.6, 5.22, gunmetal],
    [10.62, 1.39, 5.05, 1.22, 1.32, 5.32, aqua],
    [8.31, 1.35, 5.48, 1.02, 1.34, 4.36, blue],
    [9.48, 2.06, 5.71, 2.67, 0.60, 1.40, gold],
  ]),
  seeker: paired([
    [6.63, 0.48, 2.82, 2.95, 1.54, 5.08, gunmetal],
    [5.67, 1.48, 2.52, 0.87, 1.13, 3.97, red],
    [6.63, 1.74, 2.32, 0.98, 1.40, 4.73, brass],
    [7.59, 1.48, 2.52, 0.87, 1.13, 3.97, red],
    [6.63, 2.12, 0.44, 1.24, 0.53, 1.52, whiteGold],
  ]),
  rail: [
    [3.37, 0.43, -6.42, 2.71, 1.62, 8.18, gunmetal],
    [2.45, 1.41, -7.61, 0.73, 1.17, 9.72, lightAlloy],
    [4.29, 1.41, -7.61, 0.73, 1.17, 9.72, lightAlloy],
    [3.37, 1.91, -7.07, 1.02, 0.97, 8.72, violet],
    [3.37, 2.39, -7.68, 0.55, 0.24, 6.96, aqua],
    [3.37, 1.98, -10.84, 2.71, 0.66, 0.75, gold],
    [3.37, 1.78, -4.29, 2.68, 0.39, 0.79, gold],
  ],
  flak: [
    [-4.52, 0.47, -0.34, 3.22, 1.53, 3.8, gunmetal],
    [-4.52, 1.31, -0.2, 2.76, 1.33, 2.81, steel],
    [-4.52, 1.71, -1.71, 2.95, 1.31, 1.60, gold],
    [-5.53, 2.21, -0.93, 0.55, 0.74, 2.87, brass],
    [-4.52, 2.22, -1.10, 0.66, 0.93, 2.55, red],
    [-3.51, 2.21, -0.93, 0.55, 0.74, 2.87, brass],
    [-4.52, 1.84, 1.13, 2.14, 0.78, 0.74, red],
  ],
  ion: [
    [0, 1.77, 9.51, 2.95, 1.43, 4.1, gunmetal],
    [-1.09, 2.67, 10.44, 0.89, 1.21, 4.14, violet],
    [1.09, 2.67, 10.44, 0.89, 1.21, 4.14, violet],
    [0, 2.60, 10.76, 1.52, 1.10, 3.60, aqua],
    [0, 3.14, 11.62, 1.39, 0.35, 2.05, lightAlloy],
    [0, 3.11, 9.62, 2.98, 0.58, 0.73, gold],
  ],
  drones: paired([
    [7.15, 0.22, 7.05, 2.49, 1.40, 2.81, gunmetal],
    [6.22, 1.06, 7.43, 0.73, 1.22, 2.72, gold],
    [8.08, 1.06, 7.43, 0.73, 1.22, 2.72, gold],
    [7.15, 1.24, 8.38, 1.42, 0.96, 1.36, green],
  ]),
  phoenix: [
    [2.60, 1.11, 8.94, 1.85, 1.38, 3.37, gunmetal],
    [2.60, 1.90, 9.38, 1.48, 1.08, 2.49, gold],
    [2.60, 1.97, 11.05, 1.45, 0.90, 2.02, brass],
    [1.88, 2.26, 10.02, 0.55, 1.32, 2.06, red],
    [3.32, 2.26, 10.02, 0.55, 1.32, 2.06, red],
    [2.60, 2.56, 9.88, 0.70, 0.52, 1.89, whiteGold],
  ],
  'bomb-bay': [
    [0, 2.61, 4.42, 3.45, 1.44, 4.78, gunmetal],
    [0, 3.44, 4.31, 3.26, 0.93, 4.47, steel],
    [-1.08, 3.99, 4.37, 0.91, 0.83, 3.65, red],
    [0, 4.17, 4.44, 0.92, 0.79, 4, red],
    [1.08, 3.99, 4.37, 0.91, 0.83, 3.65, red],
    [0, 4.20, 5.53, 3.36, 0.52, 0.73, gold],
    [0, 4.05, 3.13, 3.30, 0.51, 0.73, brass],
  ],
  arc: [
    [4.50, 0.43, -0.10, 2.94, 1.42, 3.98, gunmetal],
    [4.50, 1.28, 0.18, 2.66, 1.42, 2.47, violet],
    [3.44, 1.93, -0.67, 0.69, 1.83, 1.83, gold],
    [5.56, 1.93, -0.67, 0.69, 1.83, 1.83, gold],
    [4.50, 2.30, -0.98, 0.83, 2.31, 1.09, whiteGold],
    [4.50, 2.07, 0.60, 2.66, 0.54, 0.73, brass],
  ],
};

const UNIT = new BoxGeometry();
const UNIT_POSITIONS = UNIT.getAttribute('position');
const FACE_SHADE = [0.72, 0.55, 1, 0.48, 0.8, 0.66];

function meshBlocks(blocks: readonly Block[]): BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const tint = new Color();
  for (const [x, y, z, width, height, length, color] of blocks) {
    const base = positions.length / 3;
    tint.setHex(color);
    for (let i = 0; i < UNIT_POSITIONS.count; i++) {
      positions.push(x + UNIT_POSITIONS.getX(i) * width, y + UNIT_POSITIONS.getY(i) * height,
        z + UNIT_POSITIONS.getZ(i) * length);
      const shade = FACE_SHADE[Math.floor(i / 4)];
      colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
    }
    for (const index of UNIT.index!.array) indices.push(base + index);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export class WeaponMounts {
  private readonly mounts: { id: WeaponId; mesh: Mesh; normal: BufferGeometry; evolved: BufferGeometry }[];

  constructor(ship: Object3D) {
    const material = new MeshBasicMaterial({ vertexColors: true });
    this.mounts = WEAPON_IDS.map(id => {
      const normal = meshBlocks(MOUNTS[id]);
      const evolved = meshBlocks(EVOLVED_MOUNTS[id]);
      const mesh = new Mesh(normal, material);
      mesh.name = `Weapon mount ${id}`;
      mesh.visible = false;
      ship.add(mesh);
      return { id, mesh, normal, evolved };
    });
  }

  update(levels: RunProgression['weaponLevels'] | undefined, evolutions?: RunProgression['evolutions']): void {
    for (const { id, mesh, normal, evolved } of this.mounts) {
      mesh.visible = !!levels?.[id];
      if (mesh.visible) mesh.geometry = evolutions?.[id] === EVOLUTIONS[id].id ? evolved : normal;
    }
  }
}

export function orbitDroneGeometry(): BufferGeometry {
  return meshBlocks([
    [0, 0, -0.34, 2.2, 1.01, 4.7, lightAlloy],
    [0, 0.21, 0.9, 5.4, 0.86, 2.24, steel],
    [0, 0.72, -0.31, 1.52, 0.75, 2.78, blue],
  ]);
}
