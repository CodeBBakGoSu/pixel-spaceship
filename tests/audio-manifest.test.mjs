import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const directory = new URL('../public/audio/sfx/', import.meta.url);
const expected = {
  engine_loop: { loop: true, samples: 253575 },
  afterburner_loop: { loop: true, samples: 165375 },
  wind_loop: { loop: true, samples: 196245 },
  hit: { loop: false, samples: 28953 },
  explosion: { loop: false, samples: 74472 },
  graze: { loop: false, samples: 12533 },
  parry: { loop: false, samples: 19957 },
  roll: { loop: false, samples: 30777 },
  warning: { loop: false, samples: 39929 },
  ace_alert: { loop: false, samples: 88309 },
};

test('the shipped SFX match the ten entries in the playback manifest', () => {
  const files = readdirSync(directory).filter(name => name.endsWith('.mp3')).sort();
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  const keys = Object.keys(expected).sort();

  assert.deepEqual(files, keys.map(key => `${key}.mp3`));
  assert.deepEqual(Object.keys(manifest).sort(), keys);

  for (const [key, { loop, samples }] of Object.entries(expected)) {
    const entry = manifest[key];
    const file = statSync(new URL(`${key}.mp3`, directory));
    assert.equal(entry.loop, loop, key);
    assert.equal(entry.samples, samples, key);
    assert.equal(entry.sampleRate, 44100, key);
    assert.equal(file.isFile(), true, key);
    assert.equal(entry.bytes, file.size, key);
    assert.ok(file.size > 0, key);
  }
});
