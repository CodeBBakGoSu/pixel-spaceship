import test from 'node:test';
import assert from 'node:assert/strict';
import { GrazePopup, hitDirection } from '../src/hostile-feedback-state.ts';

test('TOP damage bearings stay north-up while chase and cockpit follow the player heading', () => {
  const east = Math.PI / 2;
  assert.equal(hitDirection('overhead', east, 30, 0, 0), east);
  assert.equal(hitDirection('chase', east, 30, 0, 0), 0);
  assert.equal(hitDirection('cockpit', east, 0, 40, 0), -east);
  assert.equal(hitDirection('cockpit', 0, 0, -40, 0), Math.PI);
  assert.equal(hitDirection('cockpit', east, 0, 0, 20), 0);
  assert.equal(hitDirection('chase', east, 0, 0, -20), Math.PI);
});

test('grazes within 150 ms refresh together without losing their count', () => {
  const popup = new GrazePopup();
  popup.add(100);
  assert.equal(popup.take(100), 1);
  popup.add(130);
  popup.add(220);
  assert.equal(popup.take(249), 0);
  assert.equal(popup.take(250), 3);
  assert.equal(popup.take(400), 0);
});

test('expired or reset grazes do not carry their count into the next popup', () => {
  const popup = new GrazePopup();
  popup.add(100);
  assert.equal(popup.take(100), 1);
  popup.add(220);
  assert.equal(popup.active(1000), false);
  assert.equal(popup.take(1000), 0);
  popup.add(1000);
  assert.equal(popup.take(1000), 1);
  popup.reset();
  assert.equal(popup.active(1010), false);
  popup.add(1010);
  assert.equal(popup.take(1010), 1);
});
