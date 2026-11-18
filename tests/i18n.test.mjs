import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, parseGameOptions, SCRIPT, stepGame } from '../src/game.ts';
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

test('translations format mission progress in either language', () => {
  const progress = { cleared: 2, total: 3 };
  assert.equal(createTranslator('en')('objective.doors', progress), 'BLAST DOORS // SHOOT THE LOCKS  2/3');
  assert.equal(createTranslator('ko')('objective.doors', progress), '방폭문 잠금장치 파괴  2/3');
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

test('scripted and event-driven mission messages have translations', () => {
  const keys = new Set();
  for (const segment of SCRIPT) {
    keys.add(`segment.${segment.id}`);
    for (const beat of segment.beats) {
      keys.add(beat.key);
      keys.add(`speaker.${beat.speaker}`);
    }
    keys.add(createGame(parseGameOptions(`?segment=${segment.id}`)).objective);
  }
  let game = createGame(parseGameOptions('?segment=reach&autoplay=1'));
  const idle = { moveX: 0, moveY: 0, fire: false };
  for (let i = 0; i < 360 * 60 && (game.phase === 'playing' || game.phase === 'transition'); i++) {
    keys.add(game.objective);
    if (game.dialogue) keys.add(game.dialogue.key);
    game = stepGame(game, idle, 1 / 60);
  }
  assert.equal(game.phase, 'win');
  for (const key of ['objective.exit', 'objective.doorOpen', 'objective.pods', 'objective.core', 'dialogue.pylonsDown']) {
    assert.ok(keys.has(key), `run did not exercise ${key}`);
  }
  for (const key of keys) {
    assert.ok(strings.en[key]?.trim(), `missing English mission message ${key}`);
    assert.ok(strings.ko[key]?.trim(), `missing Korean mission message ${key}`);
  }
});
