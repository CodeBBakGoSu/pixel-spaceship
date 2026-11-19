import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { createTranslator, detectLanguage, initialLanguage, saveLanguage, strings } from '../src/i18n.ts';

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('every translation is nonempty and uses the same placeholders in both languages', () => {
  assert.deepEqual(Object.keys(strings.ko).sort(), Object.keys(strings.en).sort());
  for (const [key, en] of Object.entries(strings.en)) {
    assert.ok(en.trim(), `empty English translation for ${key}`);
    assert.ok(strings.ko[key].trim(), `empty Korean translation for ${key}`);
    assert.deepEqual(placeholders(strings.ko[key]), placeholders(en), key);
  }
});

test('translations format draft and weak-point countdowns in both languages', () => {
  const en = createTranslator('en'), ko = createTranslator('ko');
  assert.equal(en('draft.detail', { level: 2 }), 'LEVEL 2 · CHOOSE ONE');
  assert.equal(ko('draft.detail', { level: 2 }), '레벨 2 · 하나 선택');
  assert.equal(en('objective.bandSignal', { part: en('boss.low'), seconds: 3 }), 'LOW POD OPENS IN 3s');
  assert.equal(ko('objective.bandSignal', { part: ko('boss.low'), seconds: 3 }), '3초 후 저고도 포드 노출');
});

test('guidance separates maneuver selectors from the flare key and touch control', () => {
  for (const t of [createTranslator('en'), createTranslator('ko')]) {
    assert.match(t('guide.keysLoop'), /Space.*J/);
    assert.match(t('guide.touchLoop'), /LOOP|반전/);
    assert.match(t('help.keys'), /C (FLARE|플레어)/);
    assert.equal(t('control.flareShort'), 'FLR');
    assert.equal(t('cockpit.flares', { count: 2, max: 3 }), 'FLR 2/3');
    assert.ok(t('hud.rear')?.trim());
    assert.ok(t('hud.loopReady')?.trim());
  }
});

test('language defaults to Korean for Korean browser locales', () => {
  for (const locale of ['ko', 'ko-KR', 'KO-kr']) assert.equal(detectLanguage(locale), 'ko');
  for (const locale of ['', 'en-US', 'ja-JP']) assert.equal(detectLanguage(locale), 'en');
});

test('a valid URL override takes priority over a persisted language and the browser default', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(initialLanguage('', 'ko-KR', storage), 'ko');
  saveLanguage('en', storage);
  assert.equal(values.get('aster.lang'), 'en');
  assert.equal(initialLanguage('', 'ko-KR', storage), 'en');
  assert.equal(initialLanguage('?lang=ko', 'en-US', storage), 'ko');
  assert.equal(initialLanguage('?lang=es', 'ko-KR', storage), 'en');
  assert.equal(initialLanguage('', 'ko-KR', storage), 'en');
  values.set('aster.lang', 'invalid');
  assert.equal(initialLanguage('', 'ko-KR', storage), 'ko');
});

test('unavailable storage leaves the browser default usable', () => {
  const denied = () => { throw new Error('storage denied'); };
  const storage = { getItem: denied, setItem: denied };
  assert.equal(initialLanguage('', 'en-US', storage), 'en');
  assert.doesNotThrow(() => saveLanguage('ko', storage));
});

test('every upgrade offered by either draft has a translated title and detail', () => {
  const checks = new Set();
  for (let pick = 0; pick < 3; pick++) {
    const state = createStage(parseStageOptions('?fixture=draft'));
    for (const id of state.draft) checks.add(id);
    stepStage(state, { pick: state.draft[pick] });
    state.xp = 10;
    stepStage(state);
    for (const id of state.draft) checks.add(id);
  }
  assert.equal(checks.size, 5);
  for (const id of checks) {
    for (const language of ['en', 'ko']) {
      assert.ok(strings[language][`draft.${id}.title`]?.trim());
      assert.ok(strings[language][`draft.${id}.copy`]?.trim());
    }
  }
});

test('review fixtures and navigation warnings have English and Korean names', () => {
  const keys = [
    'aria.arenaMap', 'objective.beacon', 'hud.flakWarning', 'hud.spotterWarning',
    ...['skimmer', 'spotter', 'hound', 'flanker', 'harrier', 'diver', 'bomber', 'turret'].map(kind => 'enemy.' + kind),
    ...['ridge', 'strait', 'stacks', 'atoll'].map(kind => 'landmark.' + kind),
  ];
  for (const key of keys) {
    assert.ok(strings.en[key], key);
    assert.match(strings.ko[key], /[가-힣]/, key);
  }
});
