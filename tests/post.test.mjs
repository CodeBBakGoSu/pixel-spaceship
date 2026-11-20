import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene, ShaderChunk, ShaderLib, Texture } from 'three';
import { HostileVisuals } from '../src/hostile-visuals.ts';
import { choosePostTier, FlightPost, installSteppedHaze, vignetteAmount, vignetteRadius, visibleHazeCutoff } from '../src/post.ts';

test('phone post omits desktop effects and disabling flight effects selects the off tier', () => {
  assert.equal(choosePostTier(false, true), 'desktop');
  assert.equal(choosePostTier(true, true), 'phone');
  assert.equal(choosePostTier(false, false), 'off');
  assert.equal(choosePostTier(true, false), 'off');
});

test('boost strengthens the vignette and brings its inner edge closer to the center', () => {
  assert.equal(vignetteAmount(-1), 0.25);
  assert.equal(vignetteAmount(0.5), 0.325);
  assert.equal(vignetteAmount(2), 0.4);
  assert.ok(vignetteRadius(0) > vignetteRadius(0.5));
  assert.ok(vignetteRadius(0.5) > vignetteRadius(1));
  assert.equal(vignetteRadius(1), vignetteRadius(2));
});

test('the terrain projection ends where stepped haze first reaches full sky color', () => {
  const cutoff = visibleHazeCutoff(245, 875, true);
  assert.ok(Math.abs(cutoff - 789.729215) < 0.01);
  assert.equal(visibleHazeCutoff(245, 875, false), 789.95);
  assert.ok(visibleHazeCutoff(245, 640, true) < cutoff);
});

test('stepped haze is local to the attached scene and uses the projectile material define', () => {
  const scene = new Scene();
  const material = new MeshBasicMaterial(), noFog = new MeshBasicMaterial({ fog: false });
  const untouched = new MeshBasicMaterial(), original = ShaderChunk.fog_fragment;
  const hostile = new HostileVisuals(() => 35);
  scene.add(new Mesh(new PlaneGeometry(1, 1), [material, noFog]), hostile.group);

  installSteppedHaze(scene);
  installSteppedHaze(scene);
  const compile = mat => {
    const shader = { fragmentShader: ShaderLib.basic.fragmentShader };
    mat.onBeforeCompile(shader);
    return shader.fragmentShader;
  };
  assert.match(compile(material), /fogFactor = flightHazeStep\(fogFactor\)/);
  assert.equal(compile(material).match(/float flightHazeStep\(/g).length, 1);
  assert.match(compile(noFog), /#include <fog_fragment>/);
  assert.match(compile(untouched), /#include <fog_fragment>/);
  assert.notEqual(material.customProgramCacheKey(), untouched.customProgramCacheKey());
  assert.equal(ShaderChunk.fog_fragment, original);
  for (const { material: bolt } of hostile.group.children) {
    assert.equal(bolt.defines.FLIGHT_STEPPED_HAZE, 1);
    assert.match(bolt.fragmentShader, /flightHazeStep\(amount\)/);
  }
});

test('only desktop issues the pair of half-resolution blur passes and reuses their targets', () => {
  const renderer = {
    activeTarget: null,
    drawnTargets: [],
    setRenderTarget(target) { this.activeTarget = target; },
    render() { this.drawnTargets.push(this.activeTarget); },
  };
  const post = new FlightPost(new Texture());
  post.resize(961, 541, 'phone');
  post.prepare(renderer, 1);
  assert.deepEqual(renderer.drawnTargets, []);
  assert.equal(post.mesh.material.uniforms.vivid.value, 0);
  assert.equal(post.mesh.material.uniforms.vignette.value, 0.4);

  post.resize(961, 541, 'desktop');
  post.prepare(renderer, 0.5);
  const [horizontal, vertical] = renderer.drawnTargets;
  assert.deepEqual(renderer.drawnTargets.map(({ width, height }) => [width, height]), [[481, 271], [481, 271]]);
  assert.notEqual(horizontal, vertical);
  assert.equal(post.mesh.material.uniforms.grainAmount.value, 0);
  assert.equal(post.mesh.material.uniforms.vivid.value, 0.2);
  assert.equal(post.mesh.material.uniforms.bloom.value, vertical.texture);

  post.resize(1024, 640, 'desktop');
  post.prepare(renderer, 0.5);
  assert.equal(renderer.drawnTargets[2], horizontal);
  assert.equal(renderer.drawnTargets[3], vertical);
  assert.deepEqual([horizontal.width, horizontal.height], [512, 320]);

  post.resize(1024, 640, 'off');
  post.prepare(renderer, 1, 1, 60);
  assert.equal(renderer.drawnTargets.length, 4);
  assert.equal(post.mesh.material.uniforms.vivid.value, 0);
  assert.equal(post.mesh.material.uniforms.bloomAmount.value, 0);
  assert.equal(post.mesh.material.uniforms.vignette.value, 0);
  assert.equal(post.mesh.material.uniforms.cloudFlash.value, 0);
});
