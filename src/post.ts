import {
  Camera, LinearFilter, Mesh, NoBlending, PlaneGeometry, Scene, ShaderChunk, ShaderMaterial, Vector2, WebGLRenderTarget,
  type Material, type Object3D, type Texture, type WebGLRenderer,
} from 'three';
import { POST } from './data/post.ts';

export type PostTier = 'off' | 'phone' | 'desktop';

export function choosePostTier(phone: boolean, enabled = true): PostTier {
  return !enabled ? 'off' : phone ? 'phone' : 'desktop';
}

const unit = (value: number) => Math.min(1, Math.max(0, value));
const response = (endpoints: readonly [number, number], boost: number) =>
  endpoints[0] + (endpoints[1] - endpoints[0]) * unit(boost);
export const vignetteAmount = (boost: number) => response(POST.vignette.strength, boost);
export const vignetteRadius = (boost: number) => response(POST.vignette.innerRadius, boost);

// Invert smoothstep at the start of the step rounded to full fog.
const fullFogFactor = 1 - 0.5 / POST.haze.steps;
const fullHazeDepth = 0.5 - Math.sin(Math.asin(1 - 2 * fullFogFactor) / 3);

export function visibleHazeCutoff(near: number, far: number, stepped = true): number {
  return near + (far - near) * (stepped ? fullHazeDepth : POST.haze.smoothVisibleFraction);
}

export const STEPPED_HAZE_GLSL = /* glsl */`
  float flightHazeStep(float amount) {
    return floor(amount * ${POST.haze.steps.toFixed(1)} + 0.5) / ${POST.haze.steps.toFixed(1)};
  }
`;

const FOG_FRAGMENT = ShaderChunk.fog_fragment.replace('gl_FragColor.rgb = mix',
  'fogFactor = flightHazeStep(fogFactor);\n\tgl_FragColor.rgb = mix');
const steppedMaterials = new WeakSet<Material>();

function stepMaterialFog(material: Material): void {
  if (!('fog' in material) || !material.fog || steppedMaterials.has(material)) return;
  if (material instanceof ShaderMaterial) {
    // Hostile projectiles consume this in their range fade instead of mixing the fog color.
    material.defines.FLIGHT_STEPPED_HAZE = 1;
  } else {
    const compile = material.onBeforeCompile;
    const key = `${material.customProgramCacheKey()}:flight-stepped-haze`;
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${STEPPED_HAZE_GLSL}`)
        .replace('#include <fog_fragment>', FOG_FRAGMENT);
    };
    material.customProgramCacheKey = () => key;
  }
  steppedMaterials.add(material);
  material.needsUpdate = true;
}

export function installSteppedHaze(scene: Object3D): void {
  scene.traverse(object => {
    if (!('material' in object)) return;
    const material = object.material as Material | Material[] | undefined;
    if (!material) return;
    if (Array.isArray(material)) material.forEach(stepMaterialFog);
    else stepMaterialFog(material);
  });
}

const VERTEX = /* glsl */`
  varying vec2 coords;
  void main() {
    coords = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const HORIZONTAL = /* glsl */`
  uniform sampler2D source;
  uniform vec2 sourceTexel;

  vec3 hot(vec2 at) {
    vec3 rgb = texture2D(source, at).rgb;
    float peak = max(max(rgb.r, rgb.g), rgb.b);
    float low = min(min(rgb.r, rgb.g), rgb.b);
    return rgb * smoothstep(${POST.bloom.peak.join(', ')}, peak) * smoothstep(${POST.bloom.chroma.join(', ')}, peak - low);
  }

  // Preserve single-pixel tracer cores in both rows and columns of the downsample.
  vec3 downsample(vec2 at) {
    vec2 dx = vec2(sourceTexel.x, 0.0);
    vec2 dy = vec2(0.0, sourceTexel.y);
    return 0.25 * (hot(at) + hot(at + dx) + hot(at + dy) + hot(at + sourceTexel));
  }

  void main() {
    vec2 at = (floor(gl_FragCoord.xy) * ${POST.bloom.downscale.toFixed(1)} + 0.5) * sourceTexel;
    vec2 dx = vec2(sourceTexel.x * ${POST.bloom.downscale.toFixed(1)}, 0.0);
    vec3 glow = 0.5 * downsample(at) + 0.25 * (downsample(at - dx) + downsample(at + dx));
    gl_FragColor = vec4(glow, 1.0);
  }
`;

const VERTICAL = /* glsl */`
  uniform sampler2D source;
  uniform vec2 sourceTexel;
  varying vec2 coords;
  void main() {
    vec2 dy = vec2(0.0, sourceTexel.y);
    vec3 glow = 0.5 * texture2D(source, coords).rgb
      + 0.25 * (texture2D(source, coords - dy).rgb + texture2D(source, coords + dy).rgb);
    gl_FragColor = vec4(glow, 1.0);
  }
`;

const COMPOSITE = /* glsl */`
  uniform sampler2D source;
  uniform sampler2D bloom;
  uniform float bloomAmount;
  uniform float vivid;
  uniform float vignette;
  uniform float innerRadius;
  uniform float cloudFlash;
  uniform float grainAmount;
  uniform float grainFrame;
  varying vec2 coords;

  void main() {
    vec3 rgb = texture2D(source, coords).rgb;
    if (bloomAmount > 0.0) rgb += texture2D(bloom, coords).rgb * bloomAmount;
    if (vivid > 0.0) {
      float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      rgb = mix(vec3(luma), rgb, 1.0 + vivid);
      rgb = (rgb - 0.18) * ${1 + POST.contrast} + 0.18;
    }
    if (vignette > 0.0) {
      float radius = length(coords * 2.0 - 1.0);
      rgb *= 1.0 - vignette * smoothstep(innerRadius, ${POST.vignette.outerRadius}, radius);
    }
    if (grainAmount > 0.0) {
      float noise = fract(sin(dot(gl_FragCoord.xy + grainFrame, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      rgb += noise * grainAmount;
    }
    gl_FragColor = vec4(mix(clamp(rgb, 0.0, 1.0), vec3(1.0), cloudFlash), 1.0);
    #include <colorspace_fragment>
  }
`;

const passMaterial = {
  vertexShader: VERTEX, depthTest: false, depthWrite: false, toneMapped: false, blending: NoBlending,
};

function blurTarget(): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, { magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: false });
}

class BloomPass {
  readonly horizontal = blurTarget();
  readonly vertical = blurTarget();
  private readonly scene = new Scene();
  private readonly camera = new Camera();
  private readonly sourceTexel = new Vector2();
  private readonly halfTexel = new Vector2();
  private readonly blurX: ShaderMaterial;
  private readonly blurY: ShaderMaterial;
  private readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor(geometry: PlaneGeometry, source: Texture) {
    this.blurX = new ShaderMaterial({ ...passMaterial, fragmentShader: HORIZONTAL,
      uniforms: { source: { value: source }, sourceTexel: { value: this.sourceTexel } } });
    this.blurY = new ShaderMaterial({ ...passMaterial, fragmentShader: VERTICAL,
      uniforms: { source: { value: this.horizontal.texture }, sourceTexel: { value: this.halfTexel } } });
    this.mesh = new Mesh(geometry, this.blurX);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.ceil(width / POST.bloom.downscale)), h = Math.max(1, Math.ceil(height / POST.bloom.downscale));
    this.horizontal.setSize(w, h);
    this.vertical.setSize(w, h);
    this.sourceTexel.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.halfTexel.set(1 / w, 1 / h);
  }

  draw(renderer: WebGLRenderer): void {
    this.mesh.material = this.blurX;
    renderer.setRenderTarget(this.horizontal);
    renderer.render(this.scene, this.camera);
    this.mesh.material = this.blurY;
    renderer.setRenderTarget(this.vertical);
    renderer.render(this.scene, this.camera);
  }
}

export class FlightPost {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly source: Texture;
  private readonly grain: boolean;
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly uniforms;
  private bloom: BloomPass | null = null;
  private tier: PostTier = 'off';

  constructor(source: Texture, grain: boolean = POST.grain.enabled) {
    this.source = source;
    this.grain = grain;
    this.uniforms = {
      source: { value: source }, bloom: { value: source }, bloomAmount: { value: 0 },
      vivid: { value: 0 }, vignette: { value: 0 }, innerRadius: { value: POST.vignette.innerRadius[0] as number },
      cloudFlash: { value: 0 }, grainAmount: { value: 0 }, grainFrame: { value: 0 },
    };
    const material = new ShaderMaterial({ ...passMaterial, fragmentShader: COMPOSITE, uniforms: this.uniforms });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  resize(width: number, height: number, tier: PostTier): void {
    this.tier = tier;
    if (tier === 'desktop') {
      this.bloom ??= new BloomPass(this.geometry, this.source);
      this.bloom.resize(width, height);
    }
    const uniforms = this.uniforms;
    uniforms.bloom.value = tier === 'desktop' ? this.bloom!.vertical.texture : this.source;
    uniforms.bloomAmount.value = tier === 'desktop' ? POST.bloom.amount : 0;
    uniforms.vivid.value = tier === 'desktop' ? POST.vivid : 0;
    uniforms.grainAmount.value = tier === 'desktop' && this.grain ? POST.grain.amount : 0;
  }

  // Draw optional blur targets before the caller composites the final screen and rear inset.
  prepare(renderer: WebGLRenderer, boost: number, cloudFlash = 0, grainFrame = 0): void {
    const enabled = this.tier !== 'off';
    this.uniforms.vignette.value = enabled ? vignetteAmount(boost) : 0;
    this.uniforms.innerRadius.value = vignetteRadius(boost);
    this.uniforms.cloudFlash.value = enabled ? POST.cloudFlash * unit(cloudFlash) : 0;
    this.uniforms.grainFrame.value = grainFrame;
    if (this.tier === 'desktop') this.bloom!.draw(renderer);
  }
}
