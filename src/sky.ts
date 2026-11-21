import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, type Camera } from 'three';
import { SKY } from './data/palette.ts';

// The sky as a dome that follows the camera: haze at the horizon, then stepped bands up to a deep zenith,
// dithered at each step like the stepped distance haze. Render-only.
const VERTEX = /* glsl */`
  varying vec3 direction;
  void main() {
    direction = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 clip = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
    gl_Position = clip.xyww;
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 horizon;
  uniform vec3 middle;
  uniform vec3 zenith;
  uniform float span;
  varying vec3 direction;
  float bayer(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    float i = q.x + q.y * 4.0;
    // 4x4 ordered dither, written out to stay WebGL1-friendly.
    return i < 1.0 ? 0.0 : i < 2.0 ? 8.0 : i < 3.0 ? 2.0 : i < 4.0 ? 10.0 : i < 5.0 ? 12.0 : i < 6.0 ? 4.0 : i < 7.0 ? 14.0
      : i < 8.0 ? 6.0 : i < 9.0 ? 3.0 : i < 10.0 ? 11.0 : i < 11.0 ? 1.0 : i < 12.0 ? 9.0 : i < 13.0 ? 15.0 : i < 14.0 ? 7.0
      : i < 15.0 ? 13.0 : 5.0;
  }
  void main() {
    float rise = clamp(asin(clamp(direction.y, -1.0, 1.0)) / span, 0.0, 1.0);
    float bands = ${SKY.bands.toFixed(1)};
    float level = rise * (bands - 1.0);
    float band = floor(level) + step((bayer(gl_FragCoord.xy) + 0.5) / 16.0, fract(level));
    float f = band / (bands - 1.0);
    vec3 color = f < 0.5 ? mix(horizon, middle, f * 2.0) : mix(middle, zenith, f * 2.0 - 1.0);
    // Match the ground's horizon palette in the composite, including through the rear mirror.
    gl_FragColor = vec4(color, 0.0);
  }
`;

export function makeSky(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    uniforms: {
      horizon: { value: new Color(SKY.horizon) },
      middle: { value: new Color(SKY.middle) },
      zenith: { value: new Color(SKY.zenith) },
      span: { value: SKY.span },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    side: BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  });
  const sky = new Mesh(new SphereGeometry(1, 24, 12), material);
  sky.name = 'Sky dome';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_renderer, _scene, camera: Camera) => {
    sky.position.copy(camera.position);
    sky.scale.setScalar(10);
    sky.updateMatrixWorld();
  };
  return sky;
}
