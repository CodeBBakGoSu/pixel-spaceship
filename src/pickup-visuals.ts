import {
  BoxGeometry, Color, DataTexture, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, InstancedInterleavedBuffer, InstancedMesh, InterleavedBufferAttribute, Mesh,
  MeshBasicMaterial, NearestFilter, Object3D, ShaderMaterial, SRGBColorSpace, UniformsLib, UniformsUtils,
} from 'three';
import { PICKUP_LIMIT } from './data/run-balance.ts';
import type { Pickup, StageState } from './stage-types.ts';

const SPRITE_SIZE = 12;
const SPRITE_STRIDE = 7;
const SHINE_PERIOD = 84;
const SHINE_FRAME_TICKS = 4;
const SHINE_POINTS = [[4, 3], [6, 5], [8, 7]] as const;
const ATLAS_FRAMES = 3 + SHINE_POINTS.length;
const TOP_COIN_DEPTH_BIAS = 0.0625;

const ORB_PIXELS = [
  '....oooo....',
  '..ooiiiioo..',
  '.oiiddddiio.',
  '.oidttttdio.',
  'oidtggggtdio',
  'oidtgwwgtdio',
  'oidtgggttdio',
  'oidttggttdio',
  '.oidttttdio.',
  '.oiiddddiio.',
  '..ooiiiioo..',
  '....oooo....',
];

const COIN_PIXELS = [
  '............',
  '...hhhrrs...',
  '..hhbbbbrr..',
  '.hrblbbbdss.',
  '.hrbllbddrs.',
  '.hrblldddrs.',
  '.hrblloddrs.',
  '.rrbloddrrs.',
  '.rrbdoddrrs.',
  '..rrdddrss..',
  '...rsssss...',
  '............',
];

const MAGNET_PIXELS = [
  '............',
  '...rr..bb...',
  '..rr....bb..',
  '.rr......bb.',
  '.rr......bb.',
  '.rr......bb.',
  '.rr......bb.',
  '.rr......bb.',
  '.rr......bb.',
  '.rr......bb.',
  '.rrr....bbb.',
  '.rrr....bbb.',
];

type Palette = Record<string, readonly [color: number, alpha?: number]>;
const ORB_PALETTE: Palette = {
  o: [0x4299a9, 63], i: [0x58e9d2, 148], d: [0x226a76],
  t: [0x4bd6c8], g: [0x9ef9de], w: [0xeaffeb],
};
const COIN_PALETTE: Palette = {
  s: [0x633825], r: [0xc77a36], h: [0xffda86], b: [0xf4b75c],
  o: [0xe69442], d: [0xae6032], l: [0xffe88b],
};
const MAGNET_PALETTE: Palette = { r: [0xff607a], b: [0x65d4ff] };

function pickupAtlas(): DataTexture {
  const width = SPRITE_SIZE * ATLAS_FRAMES;
  const data = new Uint8Array(width * SPRITE_SIZE * 4);
  for (let frame = 0; frame < ATLAS_FRAMES; frame++) {
    const magnet = frame === 2;
    const pixels = frame === 0 ? ORB_PIXELS : magnet ? MAGNET_PIXELS : COIN_PIXELS;
    const palette = frame === 0 ? ORB_PALETTE : magnet ? MAGNET_PALETTE : COIN_PALETTE;
    const shine = frame >= 3 ? SHINE_POINTS[frame - 3] : undefined;
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const paint = palette[pixels[y][x]];
        if (!paint) continue;
        const distance = shine ? Math.abs(shine[0] - x) + Math.abs(shine[1] - y) : Infinity;
        const color = distance === 0 ? 0xffffec : distance === 1 ? 0xffefad : paint[0];
        const offset = (y * width + frame * SPRITE_SIZE + x) * 4;
        data[offset] = color >> 16;
        data[offset + 1] = (color >> 8) & 255;
        data[offset + 2] = color & 255;
        data[offset + 3] = paint[1] ?? 255;
      }
    }
  }
  const texture = new DataTexture(data, width, SPRITE_SIZE);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function spriteGeometry(data: InstancedInterleavedBuffer): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('spriteCenter', new InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('spriteStyle', new InterleavedBufferAttribute(data, 4, 3));
  geometry.instanceCount = 0;
  return geometry;
}

function spriteMaterial(atlas: DataTexture, core: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), atlas: { value: atlas } },
    defines: { CORE_PASS: Number(core) }, fog: true, transparent: !core, depthWrite: core, toneMapped: false,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute vec3 spriteCenter;
      attribute vec4 spriteStyle;
      varying vec2 spriteUv;
      varying vec2 frameAndPull;

      void main() {
        // View-space offsets face the camera drawing this pass, including the rear mirror.
        vec4 mvPosition = modelViewMatrix * vec4(spriteCenter, 1.0);
        mvPosition.xy += position.xy * spriteStyle.xy;
        gl_Position = projectionMatrix * mvPosition;
        spriteUv = vec2(uv.x, 1.0 - uv.y);
        frameAndPull = spriteStyle.zw;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform sampler2D atlas;
      varying vec2 spriteUv;
      varying vec2 frameAndPull;

      void main() {
        float u = (frameAndPull.x + clamp(spriteUv.x, 0.001, 0.999)) / ${ATLAS_FRAMES.toFixed(1)};
        vec4 color = texture2D(atlas, vec2(u, spriteUv.y));
        #if CORE_PASS
          if (color.a < 1.0) discard;
          vec3 pullTint = frameAndPull.y < 0.0 ? vec3(0.67, 1.0, 0.97) : vec3(1.0, 0.88, 0.51);
          color.rgb = mix(color.rgb, pullTint, abs(frameAndPull.y) * 0.24);
        #else
          if (color.a <= 0.0 || color.a >= 1.0) discard;
        #endif
        gl_FragColor = color;
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function upload(attribute: InstancedInterleavedBuffer | InstancedBufferAttribute,
  range: { start: number; count: number }, count: number): void {
  if (!count) return;
  range.count = count;
  attribute.clearUpdateRanges();
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}

export class PickupVisuals {
  readonly group = new Group();
  private readonly spriteData = new InstancedInterleavedBuffer(new Float32Array(PICKUP_LIMIT * SPRITE_STRIDE), SPRITE_STRIDE)
    .setUsage(DynamicDrawUsage);
  private readonly geometry = spriteGeometry(this.spriteData);
  private readonly atlas = pickupAtlas();
  private readonly cores = new Mesh(this.geometry, spriteMaterial(this.atlas, true));
  private readonly halos = new Mesh(this.geometry, spriteMaterial(this.atlas, false));
  private readonly trails = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({
    transparent: true, opacity: 0.58, depthWrite: false,
  }), PICKUP_LIMIT);
  private readonly trailColors = new InstancedBufferAttribute(new Float32Array(PICKUP_LIMIT * 3), 3).setUsage(DynamicDrawUsage);
  private readonly spriteRange = { start: 0, count: 0 };
  private readonly trailMatrixRange = { start: 0, count: 0 };
  private readonly trailColorRange = { start: 0, count: 0 };
  private readonly trailPose = new Object3D();
  private readonly trailColor = new Color();

  constructor() {
    this.cores.name = 'XP orbs and salvage coins';
    this.halos.name = 'XP orb halos';
    this.cores.frustumCulled = this.halos.frustumCulled = false;
    this.halos.renderOrder = 1;
    this.trails.name = 'Salvage magnet trails';
    this.trails.instanceMatrix.setUsage(DynamicDrawUsage);
    this.trails.instanceColor = this.trailColors;
    this.trails.frustumCulled = false;
    this.trails.count = 0;
    this.group.add(this.trails, this.cores, this.halos);
  }

  update({ tick, pickups, player }: Pick<StageState, 'tick' | 'pickups' | 'player'>,
    flatAltitude?: number, reducedMotion = false): void {
    const count = Math.min(pickups.length, PICKUP_LIMIT);
    let trailCount = 0;
    for (let i = 0; i < count; i++) {
      const pickup = pickups[i];
      const { pulling, reversal, xp } = pickup;
      const magnet = pickup.kind === 'magnet';
      const pulse = pulling && !reducedMotion ? 0.4 * Math.sin(tick * 0.36 + i) : 0;
      const size = magnet ? 7 + pulse : 3 + Math.min(xp, 5) * 0.8 + pulse;
      const altitude = flatAltitude ?? pickup.alt;
      // The amber XP tier uses a coin face. Its ten-texel diameter fits the same world size as the orb core.
      const coin = !magnet && xp >= 2;
      const phase = tick + pickup.id * 11;
      const shineStep = Math.floor((phase % SHINE_PERIOD) / SHINE_FRAME_TICKS);
      const frame = magnet ? 2 : coin ? (reducedMotion || shineStep >= SHINE_POINTS.length ? 1 : 3 + shineStep) : 0;
      const width = coin && !reducedMotion ? 0.74 + 0.26 * Math.abs(Math.cos(phase / 19)) : 1;
      const extent = size * (coin ? SPRITE_SIZE / 10 : SPRITE_SIZE / 8);
      const offset = i * SPRITE_STRIDE;
      const data = this.spriteData.array;
      data[offset] = pickup.x;
      // TOP flattens height. Keep the face of a coin visible when it shares pixels with an orb.
      data[offset + 1] = flatAltitude !== undefined && coin ? altitude + TOP_COIN_DEPTH_BIAS : altitude;
      data[offset + 2] = -pickup.z;
      data[offset + 3] = extent * width;
      data[offset + 4] = extent;
      data[offset + 5] = frame;
      data[offset + 6] = pulling ? reversal ? -1 : 1 : 0;
      if (pulling) {
        this.writeTrail(trailCount++, pickup, altitude, size, player.x, player.z);
      }
    }
    this.geometry.instanceCount = count;
    this.cores.visible = this.halos.visible = count > 0;
    this.trails.count = trailCount;
    this.trails.visible = trailCount > 0;
    upload(this.spriteData, this.spriteRange, count * SPRITE_STRIDE);
    upload(this.trails.instanceMatrix, this.trailMatrixRange, trailCount * 16);
    upload(this.trailColors, this.trailColorRange, trailCount * 3);
  }

  private writeTrail(index: number, pickup: Pickup, altitude: number, size: number, playerX: number, playerZ: number): void {
    const yaw = Math.atan2(playerX - pickup.x, playerZ - pickup.z);
    const length = pickup.capture ? 5 : pickup.reversal ? 9 : 6;
    const offset = (size + length) / 2;
    this.trailPose.position.set(pickup.x - Math.sin(yaw) * offset, altitude, -pickup.z + Math.cos(yaw) * offset);
    this.trailPose.rotation.y = -yaw;
    this.trailPose.scale.set(size * 0.3, size * 0.3, length);
    this.trailPose.updateMatrix();
    this.trails.setMatrixAt(index, this.trailPose.matrix);
    this.trails.setColorAt(index, this.trailColor.setHex(pickup.reversal ? 0xd6fffc : 0xfff1b4));
  }
}
