import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { projectCameraContact } from '../src/contact-projection.ts';

function projector(width, height, roll = 0) {
  const camera = new PerspectiveCamera(60, width / height, 0.65, 875);
  camera.position.set(20, 110, -10);
  camera.lookAt(20, 110, -110);
  camera.rotateZ(roll);
  camera.updateMatrixWorld();
  const frame = { width, height }, vector = new Vector3();
  const out = { x: 0, y: 0, depth: 0 };
  return point => {
    projectCameraContact(camera, frame, point, out, vector);
    return { ...out };
  };
}

test('contact projection keeps offscreen coordinates and distinguishes a rear contact', () => {
  const project = projector(390, 844);
  assert.deepEqual(project({ x: 20, z: 60, alt: 110 }), { x: 195, y: 422, depth: 50 });
  const offscreen = project({ x: 85, z: 60, alt: 110 });
  assert.ok(offscreen.x > 390);
  assert.equal(offscreen.depth, 50);
  assert.ok(project({ x: 20, z: -50, alt: 110 }).depth < 0);
});

test('contact projection follows the same upside-down camera as the scene', () => {
  const width = 1280, height = 800;
  const target = { x: 34, z: 75, alt: 131 };
  const upright = projector(width, height)(target);
  const inverted = projector(width, height, Math.PI)(target);
  assert.ok(Math.abs(inverted.x + upright.x - width) < 1e-9);
  assert.ok(Math.abs(inverted.y + upright.y - height) < 1e-9);
  assert.equal(inverted.depth, upright.depth);
});
