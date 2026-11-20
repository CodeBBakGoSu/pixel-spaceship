import {
  CustomBlending, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferGeometry,
  InstancedInterleavedBuffer, InterleavedBufferAttribute, LineSegments, Mesh,
  OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, UniformsLib, UniformsUtils,
  type IUniform,
} from 'three';
import { HOSTILE_HIT_RADIUS, type HostileShape } from './data/hostile-fire.ts';
import { hostileCanHit, inBand, SHOT_LIMIT, STEP } from './stage-combat.ts';
import type { Ground, Shot, StageState } from './stage-types.ts';

const SHAPE = { orb: 0, needle: 1, diamond: 2 } as const satisfies Record<HostileShape, number>;
const DANGER = 0, ABOVE = 1, BELOW = 2, SHIELDED = 3;
const MUZZLE = 4, IMPACT = 5, GRAZE = 6;
const DROP_LIMIT = 48;
const TRAIL_SAMPLES = 4;
const TRAIL_INTERVAL = 2;
const BURST_LIMIT = 24;
const SPARKS_PER_BURST = 5;
const GLYPH_LIMIT = SHOT_LIMIT * (1 + TRAIL_SAMPLES) + BURST_LIMIT * SPARKS_PER_BURST;
const GLYPH_STRIDE = 9, DROP_STRIDE = 5;
const BULLET_RADIUS = HOSTILE_HIT_RADIUS * 0.49;

const BAND_FRAGMENT = /* glsl */`
  #include <fog_pars_fragment>
  vec3 bandColor(float tone) {
    if (tone < 0.5) return vec3(1.0, 0.095, 0.054);
    if (tone < 1.5) return vec3(0.15, 0.27, 0.41);
    if (tone < 2.5) return vec3(0.25, 0.15, 0.34);
    return vec3(0.18, 0.27, 0.29);
  }
  float rangeFade() {
    #ifdef FOG_EXP2
      return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #elif defined(USE_FOG)
      return 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #else
      return 1.0;
    #endif
  }
`;

function glyphBatch(data: InstancedInterleavedBuffer, topPlane: IUniform<number>, bufferHeight: IUniform<number>) {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('glyphCenter', new InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('glyphMotion', new InterleavedBufferAttribute(data, 2, 3));
  geometry.setAttribute('glyphStyle', new InterleavedBufferAttribute(data, 4, 5));
  geometry.instanceCount = 0;
  const material = new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), topPlane, bufferHeight },
    fog: true,
    transparent: true, depthWrite: false, toneMapped: false,
    // A premultiplied core and outline can share a draw with additive, zero-alpha halos.
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      uniform float topPlane;
      uniform float bufferHeight;
      attribute vec3 glyphCenter;
      attribute vec2 glyphMotion;
      attribute vec4 glyphStyle;
      varying vec2 local;
      varying vec3 style;

      void main() {
        bool top = topPlane >= 0.0;
        vec3 center = vec3(glyphCenter.x, top ? topPlane : glyphCenter.y, glyphCenter.z);
        vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
        float depth = max(1.0, -mvPosition.z);
        float pixel = 2.0 * (top ? 1.0 : depth) / (bufferHeight * projectionMatrix[1][1]);
        float radius = clamp(glyphStyle.z, pixel * (glyphStyle.w > 0.85 ? 2.2 : 0.9), pixel * 12.0);
        local = position.xy * 1.52;
        vec2 offset = local;
        if (glyphStyle.x > 0.5 && glyphStyle.x < 1.5) {
          vec3 course = mat3(modelViewMatrix) * vec3(glyphMotion.x, 0.0, -glyphMotion.y);
          vec2 axis = course.xy;
          if (!top) axis += mvPosition.xy * course.z / depth;
          // End-on needles retain a narrow silhouette even at the center of the view.
          axis = dot(axis, axis) > max(0.001, 0.018 * dot(course, course))
            ? normalize(axis) : vec2(0.8, 0.6);
          offset = axis * (local.x * 1.72) + vec2(-axis.y, axis.x) * (local.y * 0.63);
        }
        gl_Position = projectionMatrix * vec4(mvPosition.xy + radius * offset, mvPosition.zw);
        style = glyphStyle.xyw;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      ${BAND_FRAGMENT}
      varying vec2 local;
      varying vec3 style;

      void main() {
        vec2 p = abs(local);
        float distanceToEdge;
        if (style.x < 0.5) distanceToEdge = max(max(p.x, p.y), (p.x + p.y) * 0.73);
        else if (style.x < 1.5) distanceToEdge = max(p.x, p.y + 0.59 * p.x);
        else if (style.x < 2.5) distanceToEdge = p.x + p.y;
        else distanceToEdge = min(p.x + 3.4 * p.y, p.y + 3.4 * p.x);

        float tone = style.y;
        float power = style.z * rangeFade();
        vec3 color = bandColor(tone);
        float opacity = 0.0;
        float light = 0.0;
        if (tone > 0.5 && tone < 3.5) {
          if (distanceToEdge < 0.54 || distanceToEdge > 1.0) discard;
          color *= distanceToEdge > 0.84 ? 0.55 : 1.0;
          opacity = 0.89 * power;
        } else {
          if (distanceToEdge > 1.48) discard;
          vec3 outer = tone < 0.5 ? color : tone < 4.5 ? vec3(1.0, 0.34, 0.07)
            : tone < 5.5 ? vec3(1.0, 0.16, 0.068) : vec3(0.32, 0.75, 0.91);
          if (distanceToEdge > 1.0) {
            color = outer;
            light = (distanceToEdge < 1.19 ? 0.24 : 0.089) * power;
          } else {
            vec3 ember = tone < 0.5 ? vec3(1.0, 0.26, 0.18) : mix(outer, vec3(1.0), 0.42);
            color = distanceToEdge < 0.35 ? vec3(1.0, 0.80, 0.64)
              : distanceToEdge < 0.6 ? ember : outer * (distanceToEdge > 0.87 ? 0.69 : 1.0);
            opacity = power;
          }
        }
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= opacity + light;
      }
    `,
  });
  const glyphs = new Mesh(geometry, material);
  glyphs.name = 'Hostile projectile glyphs';
  glyphs.frustumCulled = false;
  glyphs.renderOrder = 3;
  return glyphs;
}

function dropBatch(data: InstancedInterleavedBuffer) {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('dropCenter', new InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('dropEnd', new InterleavedBufferAttribute(data, 2, 3));
  geometry.instanceCount = 0;
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.clone(UniformsLib.fog),
    fog: true, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute vec3 dropCenter;
      attribute vec2 dropEnd;
      varying float tone;
      varying float rise;
      void main() {
        vec3 point = dropCenter;
        point.y = mix(dropEnd.x, point.y, position.y);
        vec4 mvPosition = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        tone = dropEnd.y;
        rise = position.y;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      ${BAND_FRAGMENT}
      varying float tone;
      varying float rise;
      void main() {
        float opacity = mix(0.22, 0.82, rise) * (tone < 0.5 ? 1.0 : 0.55);
        gl_FragColor = vec4(bandColor(tone), opacity * rangeFade());
        #include <colorspace_fragment>
      }
    `,
  });
  const drops = new LineSegments(geometry, material);
  drops.name = 'Hostile projectile drop lines';
  drops.frustumCulled = false;
  drops.renderOrder = 2;
  return drops;
}

function publish(geometry: InstancedBufferGeometry, data: InstancedInterleavedBuffer, range: { start: number; count: number },
  count: number): void {
  geometry.instanceCount = count;
  if (!count) return;
  range.count = count * data.stride;
  data.clearUpdateRanges();
  data.updateRanges.push(range);
  data.needsUpdate = true;
}

function bandTone(alt: number, state: StageState): number {
  if (hostileCanHit(alt, state)) return DANGER;
  const playerAltitude = state.player.altitude;
  if (inBand(alt, playerAltitude)) return SHIELDED;
  return alt > playerAltitude ? ABOVE : BELOW;
}

export class HostileVisuals {
  readonly group = new Group();
  private readonly topPlane = { value: -1 };
  private readonly bufferHeight = { value: 1 };
  private readonly glyphData = new InstancedInterleavedBuffer(new Float32Array(GLYPH_LIMIT * GLYPH_STRIDE), GLYPH_STRIDE)
    .setUsage(DynamicDrawUsage);
  private readonly dropData = new InstancedInterleavedBuffer(new Float32Array(DROP_LIMIT * DROP_STRIDE), DROP_STRIDE)
    .setUsage(DynamicDrawUsage);
  private readonly glyphs = glyphBatch(this.glyphData, this.topPlane, this.bufferHeight);
  private readonly drops = dropBatch(this.dropData);
  private readonly glyphRange = { start: 0, count: 0 };
  private readonly dropRange = { start: 0, count: 0 };
  private glyphCount = 0;
  private dropCount = 0;

  private readonly tracked = new Array<Shot | null>(SHOT_LIMIT).fill(null);
  private readonly activeIndices = new Uint16Array(SHOT_LIMIT);
  private readonly slots = new Int16Array(SHOT_LIMIT);
  private readonly liveSlots = new Uint8Array(SHOT_LIMIT);
  private readonly shapes = new Uint8Array(SHOT_LIMIT);
  private readonly tones = new Int8Array(SHOT_LIMIT);
  private readonly history = new Float32Array(SHOT_LIMIT * TRAIL_SAMPLES * 3);
  private readonly sampleCursor = new Uint8Array(SHOT_LIMIT);
  private readonly sampleCount = new Uint8Array(SHOT_LIMIT);
  private readonly sampleTick = new Int32Array(SHOT_LIMIT);
  private readonly dropSlots = new Uint16Array(DROP_LIMIT);
  private readonly dropDistances = new Float64Array(DROP_LIMIT);
  private lastTick = -1;

  private readonly burstKind = new Uint8Array(BURST_LIMIT);
  private readonly burstTick = new Int32Array(BURST_LIMIT);
  private readonly burstPose = new Float32Array(BURST_LIMIT * 4);
  private nextBurst = 0;
  private readonly ground: Ground;

  constructor(ground: Ground) {
    this.ground = ground;
    this.group.add(this.drops, this.glyphs);
  }

  setView(bufferHeight: number, topPlane = -1): void {
    this.topPlane.value = topPlane;
    this.bufferHeight.value = bufferHeight;
    // A vertical drop viewed directly from above has no visible length.
    this.drops.visible = topPlane < 0 && this.drops.geometry.instanceCount > 0;
  }

  muzzle(shot: Shot, shape: HostileShape, x: number, z: number, alt: number, tick: number): void {
    let slot = this.tracked.indexOf(shot);
    if (slot < 0) slot = this.tracked.findIndex(availableShotSlot);
    if (slot >= 0) {
      this.startTracking(slot, shot, SHAPE[shape], tick);
      this.storeSample(slot, x, z, alt);
    }
    const length = Math.hypot(shot.vx, shot.vz);
    // Place the flash on the forward face of the voxel airframe.
    const lead = (shape === 'diamond' ? 7.5 : 5) / Math.max(1, length);
    this.addBurst(MUZZLE, shot, x + shot.vx * lead, z + shot.vz * lead, alt + 1.7, tick);
  }

  impact(shot: Shot, x: number, z: number, alt: number, tick: number): void {
    this.addBurst(IMPACT, shot, x, z, alt, tick);
  }

  graze(shot: Shot, x: number, z: number, alt: number, tick: number): void {
    this.addBurst(GRAZE, shot, x, z, alt, tick);
  }

  update(state: StageState): boolean {
    const { tick, shots, player } = state;
    if (tick < this.lastTick) {
      this.tracked.fill(null);
      this.burstKind.fill(0);
      this.nextBurst = 0;
    }
    this.lastTick = tick;
    this.liveSlots.fill(0);
    let count = 0;
    for (let i = 0; i < shots.length && count < SHOT_LIMIT; i++) {
      const shot = shots[i];
      if (shot.kind !== 'hostile' || shot.life <= 0) continue;
      const slot = this.tracked.indexOf(shot);
      this.activeIndices[count] = i;
      this.slots[count++] = slot;
      if (slot >= 0) this.liveSlots[slot] = 1;
    }
    for (let slot = 0; slot < SHOT_LIMIT; slot++) {
      if (!this.liveSlots[slot]) this.tracked[slot] = null;
    }

    this.glyphCount = this.dropCount = 0;
    let colorsChanged = false, nextFree = 0;
    for (let i = 0; i < count; i++) {
      const shot = shots[this.activeIndices[i]];
      let slot = this.slots[i];
      if (slot < 0) {
        while (this.tracked[nextFree]) nextFree++;
        slot = this.slots[i] = nextFree++;
        // A seek restores shots without the original muzzle events.
        const shape = shot.vx ** 2 + shot.vz ** 2 >= 90 ** 2 ? SHAPE.needle : SHAPE.orb;
        this.startTracking(slot, shot, shape, tick - TRAIL_SAMPLES * TRAIL_INTERVAL);
      }
      const tone = bandTone(shot.alt, state);
      colorsChanged ||= this.tones[slot] >= 0 && this.tones[slot] !== tone;
      this.tones[slot] = tone;
      this.drawTrail(shot, slot, tick);
      const dx = shot.x - player.x, dz = shot.z - player.z, dy = shot.alt - player.altitude;
      this.considerDrop(slot, dx * dx + dz * dz + dy * dy);
    }

    for (let i = 0; i < count; i++) {
      const slot = this.slots[i], shot = shots[this.activeIndices[i]];
      const shape = this.shapes[slot];
      const radius = shape === SHAPE.diamond ? BULLET_RADIUS * 1.21 : BULLET_RADIUS;
      this.writeGlyph(shot.x, shot.z, shot.alt, shot.vx, shot.vz, shape, this.tones[slot], radius, 1);
    }
    this.drawBursts(tick);
    this.publishDrops();
    publish(this.glyphs.geometry, this.glyphData, this.glyphRange, this.glyphCount);
    this.glyphs.visible = this.glyphCount > 0;
    return colorsChanged;
  }

  private startTracking(slot: number, shot: Shot, shape: number, tick: number): void {
    this.tracked[slot] = shot;
    this.shapes[slot] = shape;
    this.tones[slot] = -1;
    this.sampleCursor[slot] = this.sampleCount[slot] = 0;
    this.sampleTick[slot] = tick;
  }

  private storeSample(slot: number, x: number, z: number, alt: number): void {
    const cursor = this.sampleCursor[slot];
    const offset = (slot * TRAIL_SAMPLES + cursor) * 3;
    this.history[offset] = x;
    this.history[offset + 1] = z;
    this.history[offset + 2] = alt;
    this.sampleCursor[slot] = (cursor + 1) % TRAIL_SAMPLES;
    this.sampleCount[slot] = Math.min(TRAIL_SAMPLES, this.sampleCount[slot] + 1);
  }

  private drawTrail(shot: Shot, slot: number, tick: number): void {
    const last = this.sampleTick[slot];
    const intervals = Math.floor((tick - last) / TRAIL_INTERVAL);
    if (intervals > 0) {
      const next = last + intervals * TRAIL_INTERVAL;
      // Hostile bolts travel linearly. Recover intermediate ticks if a frame was skipped.
      for (let i = Math.min(intervals, TRAIL_SAMPLES) - 1; i >= 0; i--) {
        const delay = (tick - next + i * TRAIL_INTERVAL) * STEP;
        this.storeSample(slot, shot.x - shot.vx * delay, shot.z - shot.vz * delay, shot.alt);
      }
      this.sampleTick[slot] = next;
    }
    for (let i = this.sampleCount[slot] - 1; i >= 0; i--) {
      const age = tick - this.sampleTick[slot] + i * TRAIL_INTERVAL;
      if (age <= 0) continue;
      const sample = (this.sampleCursor[slot] + TRAIL_SAMPLES - 1 - i) % TRAIL_SAMPLES;
      const offset = (slot * TRAIL_SAMPLES + sample) * 3;
      this.writeGlyph(this.history[offset], this.history[offset + 1], this.history[offset + 2], shot.vx, shot.vz,
        this.shapes[slot], this.tones[slot], BULLET_RADIUS * (0.78 - age * 0.041), 0.52 - age * 0.055);
    }
  }

  private considerDrop(slot: number, distance: number): void {
    let i = this.dropCount;
    if (i < DROP_LIMIT) this.dropCount++;
    else if (distance >= this.dropDistances[--i]) return;
    while (i > 0 && distance < this.dropDistances[i - 1]) {
      this.dropDistances[i] = this.dropDistances[i - 1];
      this.dropSlots[i] = this.dropSlots[i - 1];
      i--;
    }
    this.dropDistances[i] = distance;
    this.dropSlots[i] = slot;
  }

  private publishDrops(): void {
    const data = this.dropData.array;
    let offset = 0;
    for (let i = 0; i < this.dropCount; i++) {
      const slot = this.dropSlots[i], shot = this.tracked[slot]!;
      const floor = this.ground(shot.x, shot.z) + 0.35;
      if (floor >= shot.alt) continue;
      data[offset++] = shot.x;
      data[offset++] = shot.alt;
      data[offset++] = -shot.z;
      data[offset++] = floor;
      data[offset++] = this.tones[slot];
    }
    publish(this.drops.geometry, this.dropData, this.dropRange, offset / DROP_STRIDE);
  }

  private addBurst(kind: number, shot: Shot, x: number, z: number, alt: number, tick: number): void {
    const index = this.nextBurst;
    this.nextBurst = (index + 1) % BURST_LIMIT;
    this.burstKind[index] = kind;
    this.burstTick[index] = tick;
    const offset = index * 4;
    this.burstPose[offset] = x;
    this.burstPose[offset + 1] = z;
    this.burstPose[offset + 2] = alt;
    this.burstPose[offset + 3] = Math.atan2(shot.vz, shot.vx);
  }

  private drawBursts(tick: number): void {
    for (let i = 0; i < BURST_LIMIT; i++) {
      const kind = this.burstKind[i];
      if (!kind) continue;
      const age = tick - this.burstTick[i], life = kind === MUZZLE ? 6 : kind === GRAZE ? 12 : 16;
      if (age < 0) continue;
      if (age >= life) {
        this.burstKind[i] = 0;
        continue;
      }
      const offset = i * 4, power = 1 - age / life;
      const x = this.burstPose[offset], z = this.burstPose[offset + 1], alt = this.burstPose[offset + 2];
      if (kind === MUZZLE) {
        this.writeGlyph(x, z, alt, 0, 0, 3, kind, 3.3 + age * 0.31, power);
        continue;
      }
      for (let spark = 0; spark < (kind === GRAZE ? 3 : SPARKS_PER_BURST); spark++) {
        // Fixed angles and speed offsets keep effects independent of the gameplay RNG.
        const angle = this.burstPose[offset + 3] + spark * 2.4 + (kind === GRAZE ? 1.3 : 0);
        const dx = Math.cos(angle), dz = Math.sin(angle);
        const spread = 0.95 + age * (0.25 + spark * 0.085);
        const radius = (spark === 0 ? 2.3 : 1.35) * (0.38 + 0.62 * power);
        this.writeGlyph(x + dx * spread, z + dz * spread, alt + (spark % 3 - 0.5) * spread * 0.65,
          dx, dz, spark === 0 ? 3 : SHAPE.needle, kind, radius, power);
      }
    }
  }

  private writeGlyph(x: number, z: number, alt: number, vx: number, vz: number, shape: number, tone: number,
    radius: number, power: number): void {
    const data = this.glyphData.array;
    let offset = this.glyphCount++ * GLYPH_STRIDE;
    data[offset++] = x;
    data[offset++] = alt;
    data[offset++] = -z;
    data[offset++] = vx;
    data[offset++] = vz;
    data[offset++] = shape;
    data[offset++] = tone;
    data[offset++] = radius;
    data[offset] = power;
  }
}

function availableShotSlot(shot: Shot | null): boolean {
  return !shot || shot.life <= 0;
}
