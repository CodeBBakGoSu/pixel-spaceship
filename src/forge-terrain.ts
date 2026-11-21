import { Color, Vector3, type DataTexture, type WebGLProgramParametersWithUniforms } from 'three';
import { FORGE_GROUND as COLORS, SHADOW } from './data/palette.ts';
import { WORLD_TERRAIN } from './data/world.ts';
import { WorldPaletteMaterial } from './post.ts';
import type { CloudShadow } from './voxel-clouds.ts';
import { worldHash } from './world.ts';

const GROVE_SCALE = 56, CLEARING_SCALE = 19;
const GROVE_SALT = 719, CLEARING_SALT = 3023;
export const FOREST_THRESHOLD = 0.56;

function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const u = x / scale, v = z / scale, i = Math.floor(u), j = Math.floor(v);
  const fx = u - i, fz = v - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = worldHash(seed, i, j) >>> 8, b = worldHash(seed, i + 1, j) >>> 8;
  const c = worldHash(seed, i, j + 1) >>> 8, d = worldHash(seed, i + 1, j + 1) >>> 8;
  return ((a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz) / 16777216;
}

/** The same continuous grove field used by the shader and the near-field tree instances. */
export function forestCover(seed: number, x: number, z: number): number {
  return 0.74 * valueNoise(seed ^ GROVE_SALT, x, z, GROVE_SCALE)
    + 0.26 * valueNoise(seed ^ CLEARING_SALT, x, z, CLEARING_SCALE);
}

function swatch(hex: number): string {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(7)}, ${c.g.toFixed(7)}, ${c.b.toFixed(7)})`;
}

// Game coordinates are (+x, +z) on the map. Both heights vary on the actual streamed triangle.
const VARYING = 'varying vec4 vForgeSite;\nvarying vec2 vForgeSlope;';
const TERRAIN = /* glsl */`
  ${VARYING}
  uniform highp uint forgeSeed;
  uniform float forgeTime;
  uniform sampler2D forgeShadow;
  uniform vec3 forgeShadowMap; // minimum game x/z and inverse world width
  const vec3 shadeTint = vec3(${SHADOW.shade.join(', ')});

  // worldHash in world.ts, including its unsigned wrap for negative coordinates and high seeds.
  uint cellHash(ivec2 p, uint salt) {
    uint n = uint(p.x) * 374761393u + uint(p.y) * 668265263u + (forgeSeed ^ salt) * 1446999437u + 1442695041u;
    n = (n ^ (n >> 13u)) * 1274126177u;
    return n ^ (n >> 16u);
  }
  float randomCell(ivec2 p, uint salt) { return float(cellHash(p, salt) >> 8u) * (1.0 / 16777216.0); }
  float terrainNoise(vec2 p, float scale, uint salt) {
    vec2 g = p / scale;
    ivec2 i = ivec2(floor(g));
    vec2 f = fract(g);
    vec2 s = f * f * (3.0 - 2.0 * f);
    return mix(mix(randomCell(i, salt), randomCell(i + ivec2(1, 0), salt), s.x),
               mix(randomCell(i + ivec2(0, 1), salt), randomCell(i + ivec2(1, 1), salt), s.x), s.y);
  }
  const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  float bayer(ivec2 cell) { return (BAYER[(cell.y & 3) * 4 + (cell.x & 3)] + 0.5) / 16.; }

  float cloudCover(vec2 p, float height) {
    // The atlas was projected onto a 38 m plane. Lift that projection back up the local hillside.
    vec2 offset = vec2(${SHADOW.sunX}, ${SHADOW.sunZ}) * (height - ${SHADOW.cloudGround}.0);
    vec2 uv = (p + offset - forgeShadowMap.xy) * forgeShadowMap.z;
    if (forgeShadowMap.z == 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return 0.0;
    return texture2D(forgeShadow, uv).r;
  }

  vec3 waterColor(vec2 p, float depth, float dither, float grain, float footprint, float shadow) {
    // The interior of the strait has a level floor. Broad offshore shoals give it depth, too.
    depth += smoothstep(0.8, 3.5, depth) * (5.2 * terrainNoise(p, 77.0, 37u) - 0.7);
    float band = depth + (dither - 0.5) * 0.52 + (grain - 0.5) * 0.32;
    if (band < 0.70) {
      if (footprint > 8.0) return ${swatch(COLORS.lagoon)};
      float wash = fract(grain + floor(forgeTime * 6.0) / 16.0);
      return wash < 0.55 ? ${swatch(COLORS.foam)} : ${swatch(COLORS.lagoon)};
    }
    vec3 water = band < 1.35 ? ${swatch(COLORS.lagoon)} : band < 2.85 ? ${swatch(COLORS.shallow)}
      : band < 5.75 ? ${swatch(COLORS.mid)} : band < 9.5 ? ${swatch(COLORS.deep)} : ${swatch(COLORS.deepPatch)};
    if (footprint <= 4.0 && shadow < 0.5) {
      // Two trains of short crests pass one another. Their overlap twinkles without blinking whole rows.
      ivec2 wave = ivec2(floor(p / 2.0));
      int scroll = int(floor(forgeTime * 3.0));
      float crest = randomCell(ivec2((wave.x + scroll) >> 2, wave.y), 541u);
      int along = (wave.x + scroll) & 3;
      if (crest > 0.94 && float(along) < 1.0 + fract(crest * 253.0) * 2.2
          && randomCell(ivec2((wave.x - scroll / 2) >> 2, wave.y + 91), 541u) > 0.40) {
        water = crest > 0.983 ? ${swatch(COLORS.glint[1])} : ${swatch(COLORS.glint[0])};
      }
    }
    return water;
  }

  vec3 forestColor(vec3 grass, vec2 p, float footprint, float grain) {
    // Sample the grove at each crown centre so its boundary is made of whole trees.
    float stagger = mod(floor(p.y / 8.0), 2.0) * 4.0;
    vec2 tile = floor((p + vec2(stagger, 0.0)) / 8.0);
    vec2 center = (tile + 0.5) * 8.0 - vec2(stagger, 0.0);
    uint h = cellHash(ivec2(tile), 379u);
    center += vec2(float(h & 3u), float((h >> 2u) & 3u)) - 1.5;
    float cover = 0.74 * terrainNoise(center, ${GROVE_SCALE}.0, ${GROVE_SALT}u)
                + 0.26 * terrainNoise(center, ${CLEARING_SCALE}.0, ${CLEARING_SALT}u);
    if (cover < ${FOREST_THRESHOLD} - float((h >> 4u) & 15u) * 0.0025) return grass;
    if (footprint > 4.0) return ${swatch(COLORS.canopy[1])};
    vec2 leaf = p - center;
    float radius = 3.3 + float((h >> 9u) & 3u) * 0.35;
    if (dot(leaf, leaf) > radius * radius) return cover > 0.65 ? ${swatch(COLORS.canopy[0])} : grass;
    vec2 lit = leaf - vec2(-1.1, 1.2);
    if (dot(lit, lit) < 4.9) return grain < 0.30 ? ${swatch(COLORS.crown[0])} : ${swatch(COLORS.crown[1])};
    return dot(leaf, vec2(0.7, -0.7)) > 1.6 ? ${swatch(COLORS.canopy[0])} : ${swatch(COLORS.canopy[1])};
  }

  vec3 landColor(vec2 p, float shore, float h, vec2 gradient, float pitch, float footprint, float grain) {
    // Thin beaches on gently shelving ground, up to the 41.5 m tideline on steep banks.
    float slope = length(gradient);
    if (shore < ${WORLD_TERRAIN.shallows}.0 + clamp(slope * 11.0 + 0.3, 0.75, 2.5)) {
      return grain < 0.13 ? ${swatch(COLORS.sandSpeck)} : ${swatch(COLORS.sand)};
    }
    float terrace = max(0.0, min(h - 40.2, 12.0)) / 2.65 + max(0.0, h - 52.2) / 5.0;
    float level = floor(terrace);
    bool odd = mod(level, 2.0) > 0.5;
    float aspect = dot(gradient, vec2(${SHADOW.sunX}, ${SHADOW.sunZ}));
    vec3 top = (!odd && aspect > -0.014) || aspect > 0.085 ? ${swatch(COLORS.meadow)} : ${swatch(COLORS.grass)};
    if (grain < 0.085) top = odd ? ${swatch(COLORS.grassDark)} : ${swatch(COLORS.grass)};
    vec3 rim = ${swatch(COLORS.contour)};
    if (h >= 73.0) {
      float heath = terrainNoise(p, 26.0, 1163u) + (grain - 0.5) * 0.22;
      top = heath > 0.57 ? ${swatch(COLORS.grass)} : odd && heath < 0.42 ? ${swatch(COLORS.hill[1])} : ${swatch(COLORS.hill[0])};
      if (h >= 88.0) top = odd || heath < 0.35 ? ${swatch(COLORS.stone[0])} : ${swatch(COLORS.stone[1])};
      if (grain < 0.08) top *= 0.77;
      rim = top * 0.67;
    }
    // One ground cell across on gentle slopes. Limit coverage on a steep escarpment.
    float width = min(0.25, slope * pitch / (h < 52.2 ? 2.65 : 5.0));
    if (terrace > 0.0 && fract(terrace) < width) top = rim;
    if (h > 42.0 && h < 73.0) top = forestColor(top, p, footprint, grain);
    return top;
  }

  float slopeShade(vec2 litSlope, float dither) {
    vec3 normal = normalize(vec3(-litSlope.x, 1.0, -litSlope.y));
    vec3 sun = normalize(vec3(${-SHADOW.sunX}, 1.0, ${-SHADOW.sunZ}));
    float shade = clamp((sun.y - dot(normal, sun)) * 3.8, 0.0, 1.0);
    return floor(shade * 3.0 + 0.5 + (dither - 0.5) * 0.4) / 3.0;
  }

  vec3 forgeColor() {
    vec4 dx = dFdx(vForgeSite), dy = dFdy(vForgeSite);
    float footprint = max(length(dx.xy), length(dy.xy));
    float det = dx.x * dy.y - dx.y * dy.x;
    // A grazing ray covers a long, narrow piece of coast. Fit the square map cell to its
    // short axis; use the long axis to retire crowns, foam and glints before they shimmer.
    float across = abs(det) / max(footprint, 0.0001);
    float pitch = 2.0 * exp2(clamp(ceil(log2(max(1.0, across * 0.5))), 0.0, 5.0));
    ivec2 cell = ivec2(floor(vForgeSite.xy / pitch));
    vec2 p = (vec2(cell) + 0.5) * pitch;
    vec2 offset = p - vForgeSite.xy;
    float invDet = abs(det) > 0.0000001 ? 1.0 / det : 0.0;
    // Solve the triangle's screen-to-ground Jacobian once for both heights and the broad slope.
    vec2 at = vec2(offset.x * dy.y - offset.y * dy.x, dx.x * offset.y - dx.y * offset.x) * invDet;
    vec2 heights = vForgeSite.zw + dx.zw * at.x + dy.zw * at.y;
    vec2 slope = vForgeSlope + dFdx(vForgeSlope) * at.x + dFdy(vForgeSlope) * at.y;
    vec2 faceSlope = vec2(dx.z * dy.y - dy.z * dx.y, dx.x * dy.z - dy.x * dx.z) * invDet;
    float detail = 1.0 - smoothstep(2.0, 12.0, footprint);
    float dither = mix(0.5, bayer(cell), detail);
    float grain = mix(0.5, randomCell(cell, 139u), detail);
    float relief = (terrainNoise(p, 9.0, 59u) - 0.5) * detail;
    float shore = heights.y + relief * 1.35 + (terrainNoise(p, 3.5, 131u) - 0.5) * 0.55 * detail;
    float shadow = cloudCover(p, heights.x);
    vec3 surface;
    vec3 tint = mix(vec3(1.0), shadeTint, shadow);
    if (shore < ${WORLD_TERRAIN.shallows}.0) {
      surface = waterColor(p, ${WORLD_TERRAIN.shallows}.0 - shore, dither, grain, footprint, shadow);
    } else {
      surface = landColor(p, shore, heights.x + relief * 0.48, slope, pitch, footprint, grain);
      tint *= mix(vec3(1.0), shadeTint, slopeShade(mix(slope, faceSlope, 0.18), dither));
    }
    if (tint.r < 1.0) {
      // Forge multiplies the displayed palette channels. Return to linear RGB for Three's fog and composite.
      vec3 ink = sRGBTransferOETF(vec4(surface, 1.0)).rgb * tint;
      surface = sRGBTransferEOTF(vec4(ink, 1.0)).rgb;
    }
    float fleck = 0.965 + 0.023 * floor(grain * 4.0);
    return surface * fleck;
  }
`;

export class ForgeTerrainMaterial extends WorldPaletteMaterial {
  readonly seed = { value: 0 };
  readonly time = { value: 0 };
  private readonly shadow = { value: null as DataTexture | null };
  private readonly shadowMap = { value: new Vector3() };

  setCloudShadow(atlas: CloudShadow): void {
    this.shadow.value = atlas.texture;
    this.shadowMap.value.set(atlas.minX, atlas.minZ, 1 / atlas.size);
  }

  override customProgramCacheKey(): string { return 'forge-pixel-terrain'; }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    super.onBeforeCompile(shader);
    Object.assign(shader.uniforms, { forgeSeed: this.seed, forgeTime: this.time, forgeShadow: this.shadow,
      forgeShadowMap: this.shadowMap });
    shader.vertexShader = `attribute float aSeabed;\nattribute vec2 aSlope;\n${VARYING}\n${shader.vertexShader}`.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 site = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vForgeSite = vec4(site.x, -site.z, site.y, aSeabed);
       vForgeSlope = aSlope;`);
    shader.fragmentShader = `${TERRAIN}\n${shader.fragmentShader}`
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4(forgeColor(), opacity);');
  }
}
