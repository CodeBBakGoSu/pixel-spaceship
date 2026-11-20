import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../src/i18n.ts';
import { altitudeBandKey, hudBoostTone, hudHullTone, hudPhaseKey, hudTimer } from '../src/numeric-hud.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';

test('the HUD distinguishes low and critical hull and warns below thirty percent boost', () => {
  assert.deepEqual([10, 4, 3, 2, 1, 0].map(hudHullTone), [
    'normal', 'normal', 'low', 'critical', 'critical', 'critical',
  ]);
  assert.deepEqual([0, 0.299, 0.3, 1].map(hudBoostTone), ['low', 'low', 'normal', 'normal']);
});

test('the HUD names the current altitude band in English and Korean', () => {
  const keys = [75, 92.5, 92.6, 110, 127.5, 127.6, 145].map(altitude => altitudeBandKey({ altitude }));
  assert.deepEqual(keys.map(key => createTranslator('en')(key)), ['LOW', 'LOW', 'MID', 'MID', 'MID', 'HIGH', 'HIGH']);
  assert.deepEqual(keys.map(key => createTranslator('ko')(key)), ['저', '저', '중', '중', '중', '고', '고']);
});

test('the HUD reports terrain-following SKIM even at the altitude of a fixed band', () => {
  const en = createTranslator('en'), ko = createTranslator('ko');
  assert.equal(en(altitudeBandKey({ altitude: 32, skim: 'water' })), 'SKIM');
  assert.equal(en(altitudeBandKey({ altitude: 110, skim: 'land' })), 'SKIM');
  assert.equal(ko(altitudeBandKey({ altitude: 110, skim: 'land' })), '초저');
  assert.equal(en(altitudeBandKey({ altitude: 110 })), 'MID');
});

test('the sortie clock counts elapsed seconds up to the correct mode duration', () => {
  const survivors = createStage(parseStageOptions('?mode=survivors'));
  survivors.tick = 19_079;
  assert.equal(hudTimer(survivors), '05:17 / 10:00');
  assert.equal(createTranslator('en')(hudPhaseKey(survivors)), 'SIEGE');
  survivors.tick = 36_001;
  assert.equal(hudTimer(survivors), '10:00 / 10:00');
  assert.equal(createTranslator('ko')(hudPhaseKey(survivors)), '에이스 결투');

  const legacy = createStage(parseStageOptions(''));
  assert.equal(hudTimer(legacy), '00:00 / 03:00');
  assert.equal(createTranslator('en')(hudPhaseKey(legacy)), 'KESTREL REACH');
});
