import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, NearestFilter, Vector3 } from 'three';
import { PICKUP_LIMIT } from '../src/data/run-balance.ts';
import { PickupVisuals } from '../src/pickup-visuals.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';

function pickup(id, xp, alt = 110) {
  return { id, xp, alt, x: 14, z: 30, born: 0 };
}

function pixel(texture, frame, x, y) {
  const { width, height, data } = texture.image;
  const offset = (y * width + frame * height + x) * 4;
  return [...data.slice(offset, offset + 4)];
}

test('mint salvage has an opaque core and two halo steps in the nearest-sampled atlas', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.pickups = [pickup(1, 1)];
  const visuals = new PickupVisuals();
  visuals.update(state);
  const sprites = visuals.group.getObjectByName('XP orbs and salvage coins');
  const texture = sprites.material.uniforms.atlas.value;
  const frame = sprites.geometry.attributes.spriteStyle.getZ(0);
  assert.equal(texture.image.height, 12);
  assert.equal(texture.magFilter, NearestFilter);
  assert.equal(texture.minFilter, NearestFilter);
  assert.equal(pixel(texture, frame, 0, 0)[3], 0);
  const outer = pixel(texture, frame, 0, 5);
  const inner = pixel(texture, frame, 1, 5);
  const core = pixel(texture, frame, 5, 5);
  assert.ok(outer[3] > 0 && outer[3] < inner[3] && inner[3] < core[3]);
  assert.equal(core[3], 255);
  assert.ok(core[1] > core[0], 'the core retains a mint cast');
});

test('high-value salvage keeps its coin rim as an intermittent glint crosses the face', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.pickups = [pickup(1, 3)];
  const visuals = new PickupVisuals();
  const sprites = visuals.group.getObjectByName('XP orbs and salvage coins');
  const texture = sprites.material.uniforms.atlas.value;
  const style = sprites.geometry.attributes.spriteStyle;
  visuals.update(state, undefined, true);
  const restingFrame = style.getZ(0);
  const restingWidth = style.getX(0);
  const rim = pixel(texture, restingFrame, 1, 5);
  assert.equal(rim[3], 255);
  assert.ok(rim[0] > rim[1] && rim[1] > rim[2], 'the rim is amber');
  assert.notDeepEqual(pixel(texture, restingFrame, 5, 5), rim);

  const glintFrames = new Set();
  for (state.tick = 0; state.tick < 100; state.tick++) {
    visuals.update(state);
    const frame = style.getZ(0);
    if (frame !== restingFrame) glintFrames.add(frame);
  }
  assert.ok(glintFrames.size >= 2);
  for (const frame of glintFrames) {
    assert.deepEqual(pixel(texture, frame, 1, 5), rim);
    let brightened = 0;
    for (let y = 2; y < 10; y++) {
      for (let x = 2; x < 10; x++) {
        const before = pixel(texture, restingFrame, x, y);
        const during = pixel(texture, frame, x, y);
        if (during[0] === 255 && during[1] > before[1]) brightened++;
      }
    }
    assert.ok(brightened > 0, 'each glint brightens a visible point on the coin');
  }
  visuals.update(state, undefined, true);
  assert.equal(style.getZ(0), restingFrame);
  assert.equal(style.getX(0), restingWidth);
});

test('TOP and rear passes publish the correct altitude and preserve the magnet trail', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.player.x = 14;
  state.player.z = 25;
  state.pickups = [pickup(1, 1, 78), { ...pickup(2, 3, 115), pulling: true, reversal: true }];
  const before = structuredClone(state);
  const visuals = new PickupVisuals();
  const sprites = visuals.group.getObjectByName('XP orbs and salvage coins');
  const trails = visuals.group.getObjectByName('Salvage magnet trails');
  const center = sprites.geometry.attributes.spriteCenter;
  const trailPosition = new Vector3();
  const matrix = new Matrix4();

  visuals.update(state, 157, true);
  assert.deepEqual([center.getX(0), center.getY(0), center.getZ(0)], [14, 157, -30]);
  assert.ok(center.getY(1) > center.getY(0), 'a coin over an orb on the TOP plane keeps its face visible');
  assert.equal(trails.count, 1);
  trails.getMatrixAt(0, matrix);
  assert.equal(trailPosition.setFromMatrixPosition(matrix).y, 157);
  assert.ok(trailPosition.z < -30, 'the magnet trail extends away from the player');

  visuals.update(state, undefined, true);
  assert.deepEqual([center.getY(0), center.getY(1)], [78, 115]);
  trails.getMatrixAt(0, matrix);
  assert.equal(trailPosition.setFromMatrixPosition(matrix).y, 115);
  assert.deepEqual(state, before);
});

test('salvage faces write depth separately from their blended halos', () => {
  const { group } = new PickupVisuals();
  const cores = group.getObjectByName('XP orbs and salvage coins');
  const halos = group.getObjectByName('XP orb halos');
  assert.equal(cores.material.transparent, false);
  assert.equal(cores.material.depthWrite, true);
  assert.equal(halos.material.transparent, true);
  assert.equal(halos.material.depthWrite, false);
  assert.equal(halos.material.depthTest, true);
  assert.equal(halos.geometry, cores.geometry);
  assert.equal(halos.material.uniforms.atlas.value, cores.material.uniforms.atlas.value);
});

test('pickup rendering stays within three fixed-capacity instance batches', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.pickups = Array.from({ length: PICKUP_LIMIT + 8 }, (_, i) => ({
    ...pickup(i + 1, i % 2 ? 1 : 3), pulling: true,
  }));
  const visuals = new PickupVisuals();
  const sprites = visuals.group.getObjectByName('XP orbs and salvage coins');
  const trails = visuals.group.getObjectByName('Salvage magnet trails');
  visuals.update(state);
  assert.equal(visuals.group.children.length, 3);
  assert.equal(sprites.geometry.index.count / 3, 2);
  assert.equal(sprites.geometry.instanceCount, PICKUP_LIMIT);
  assert.equal(sprites.geometry.attributes.spriteCenter.count, PICKUP_LIMIT);
  assert.equal(trails.count, PICKUP_LIMIT);
  assert.equal(trails.instanceMatrix.count, PICKUP_LIMIT);

  state.pickups.length = 0;
  visuals.update(state);
  assert.equal(sprites.geometry.instanceCount, 0);
  assert.equal(trails.count, 0);
});
