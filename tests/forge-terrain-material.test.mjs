import assert from 'node:assert/strict';
import test from 'node:test';
import { DataTexture, Mesh, Object3D, PerspectiveCamera, PlaneGeometry, Scene, ShaderLib } from 'three';
import { FlightSurface } from '../src/flight-surface.ts';
import { forestCover, ForgeTerrainMaterial } from '../src/forge-terrain.ts';
import { installSteppedHaze } from '../src/post.ts';
import { jetShadowTexture, shadowOffset } from '../src/shadow-shape.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { worldHash } from '../src/world.ts';

test('the forest lattice hash wraps signed cells and the full uint seed range', () => {
  for (const [seed, x, z, hash, cover] of [
    [0, 0, 0, 0x0d228e2d, 0.5384202123],
    [11, -45, 149, 0xdae341ae, 0.3263390231],
    [0xdeadbeef, -2026, 1320, 0xae4a9f19, 0.7664764451],
    [0xffffffff, 244121, -109803, 0xc028dd7d, 0.3335477631],
  ]) {
    assert.equal(worldHash(seed, x, z), hash);
    assert.ok(Math.abs(forestCover(seed, x, z) - cover) < 1e-8);
  }
});

test('the terrain program keeps stepped haze and shares live uniforms across compiles', () => {
  const material = new ForgeTerrainMaterial(), texture = new DataTexture();
  const scene = new Scene().add(new Mesh(new PlaneGeometry(), material));
  installSteppedHaze(scene);
  const compile = () => {
    const shader = { ...ShaderLib.basic, uniforms: {} };
    material.onBeforeCompile(shader);
    return shader;
  };
  const first = compile();
  material.setCloudShadow({ texture, minX: -512, minZ: 64, size: 1024 });
  material.time.value = 7.25;
  material.seed.value = 0xffffffff;
  const second = compile();
  assert.match(second.vertexShader, /attribute float aSeabed;/);
  assert.match(second.fragmentShader, /vec4\(forgeColor\(\), opacity\)/);
  assert.match(second.fragmentShader, /fogFactor = flightHazeStep\(fogFactor\)/);
  assert.match(second.fragmentShader, /gl_FragColor\.a = 0\.0;/);
  assert.equal(first.uniforms.forgeSeed.value, 0xffffffff);
  assert.equal(first.uniforms.forgeTime.value, 7.25);
  assert.equal(first.uniforms.forgeShadow.value, texture);
  assert.deepEqual(second.uniforms.forgeShadowMap.value.toArray(), [-512, 64, 1 / 1024]);
});

test('the high-altitude jet shadow survives its opacity fade at the projected position', () => {
  const ground = () => 35;
  const stage = createStage(parseStageOptions('?t=0'), ground);
  Object.assign(stage.player, { x: 120, z: -90, altitude: 155 });
  const surface = new FlightSurface(ground);
  surface.update(stage, new Object3D(), new PerspectiveCamera(), undefined, 1, 0, false);
  const shadow = surface.group.getObjectByName('Ship ground shadow');
  const offset = shadowOffset(120);
  assert.equal(shadow.material.map, jetShadowTexture());
  assert.ok(shadow.material.opacity < 0.5 && shadow.material.opacity > shadow.material.alphaTest);
  assert.equal(shadow.position.x, 120 + offset.x);
  assert.equal(shadow.position.z, -(-90 + offset.z));
});
