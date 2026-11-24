import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { createTranslator, detectLanguage, initialLanguage, saveLanguage, strings } from '../src/i18n.ts';
import { rosterThreatMessage } from '../src/roster-hud.ts';

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('every translation is nonempty and uses the same placeholders in both languages', () => {
  assert.deepEqual(Object.keys(strings.ko).sort(), Object.keys(strings.en).sort());
  for (const [key, en] of Object.entries(strings.en)) {
    assert.ok(en.trim(), `empty English translation for ${key}`);
    assert.ok(strings.ko[key].trim(), `empty Korean translation for ${key}`);
    assert.deepEqual(placeholders(strings.ko[key]), placeholders(en), key);
  }
});

test('translations format draft, Ace phases, and Ace arrival in both languages', () => {
  const en = createTranslator('en'), ko = createTranslator('ko');
  assert.equal(en('draft.detail', { level: 2 }), 'LEVEL 2 · CHOOSE ONE');
  assert.equal(ko('draft.detail', { level: 2 }), '레벨 2 · 하나 선택');
  assert.equal(en('ace.label', { phase: 2 }), 'ACE · RED KITE · P2');
  assert.equal(ko('ace.label', { phase: 2 }), '에이스 · 붉은 솔개 · 2단계');
  assert.equal(en('stageHud.aceEta', { time: '00:03' }), 'ACE IN 00:03');
  assert.equal(ko('stageHud.aceEta', { time: '00:03' }), '에이스까지 00:03');
});

test('the title and briefing give the Ace arrival and sortie deadline in both languages', () => {
  for (const language of ['en', 'ko']) {
    const t = createTranslator(language);
    for (const key of ['menu.survivors.copy', 'guide.sortieTiming']) {
      assert.match(t(key, { boss: '08:00', limit: '10:00' }), /08:00.*10:00/);
    }
  }
});

test('guidance separates maneuver selectors from the barrel roll shortcut', () => {
  for (const t of [createTranslator('en'), createTranslator('ko')]) {
    assert.match(t('guide.keysLoop'), /Space.*J/);
    assert.match(t('guide.touchLoop'), /LOOP|반전/);
    assert.match(t('help.keys'), /C (BARREL ROLL|배럴롤)/);
    assert.match(t('help.keys'), /Shift\+Space (ROLL|롤)/i);
    assert.ok(t('hud.rear')?.trim());
    assert.ok(t('hud.loopReady')?.trim());
  }
});

test('the credited reversal counter and rear response copy are localized', () => {
  const en = createTranslator('en'), ko = createTranslator('ko');
  assert.equal(en('hud.reversalKills', { count: 6 }), 'x6 REVERSAL!');
  assert.equal(ko('hud.reversalKills', { count: 6 }), 'x6 반전 격추!');
  assert.equal(en('hud.rearReverse'), 'REVERSE');
  assert.equal(ko('hud.rearReverse'), '반전');
  assert.equal(en('hud.rearEvade'), 'EVADE');
  assert.equal(ko('hud.rearEvade'), '회피');
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
    'aria.arenaMap', 'objective.beacon', 'objective.roster', 'phase.ace', 'menu.summary.ace',
    'hud.flakWarning', 'hud.spotterWarning', 'hud.aceGun', 'hud.aceMissile', 'hud.aceRoll', 'hud.aceTail', 'hud.rosterTail',
    ...['patrol', 'interceptor', 'skimmer', 'spotter', 'hound', 'flanker', 'harrier', 'diver', 'bomber', 'turret',
      'aegis', 'carrier', 'gnat'].map(kind => 'enemy.' + kind),
    ...['ridge', 'strait', 'stacks', 'atoll'].map(kind => 'landmark.' + kind),
  ];
  for (const key of keys) {
    assert.ok(strings.en[key], key);
    assert.match(strings.ko[key], /[가-힣]/, key);
  }
});

test('roster and Ace fixtures expose the active tell and paused sorties suppress it', () => {
  for (const [fixture, cue, key] of [
    ['ace', 'missile', 'hud.aceMissile'], ['roster', 'spotter', 'hud.spotterWarning'],
    ['roster', 'flak', 'hud.flakWarning'], ['roster', 'diver', 'hud.rosterDive'],
  ]) {
    const state = createStage(parseStageOptions(`?fixture=${fixture}&cue=${cue}`));
    assert.equal(rosterThreatMessage(state, 210), key);
    state.paused = true;
    assert.equal(rosterThreatMessage(state, 210), null);
  }
});
