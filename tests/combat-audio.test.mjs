import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../src/combat-audio.ts';

const gesture = { isTrusted: true };
const sounds = ['hit', 'graze', 'warning', 'muzzle', 'roll', 'parry'];

function browserAudio(t) {
  const storage = new Map();
  const instances = [];
  const userActivation = { hasBeenActive: false };
  globalThis.window = {
    navigator: { userActivation },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    AudioContext: class {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      started = [];
      rejectResume = false;

      constructor() {
        instances.push(this);
      }

      resume() {
        if (this.rejectResume) return Promise.reject(new Error('audio unavailable'));
        this.state = 'running';
        return Promise.resolve();
      }

      createGain() {
        const gain = {
          value: 1,
          setTargetAtTime(value) { this.value = value; },
        };
        this.master = { gain, connect() {} };
        return this.master;
      }

      createBuffer(channels, length, sampleRate) {
        assert.equal(channels, 1);
        const samples = new Float32Array(length);
        return { duration: length / sampleRate, getChannelData: () => samples };
      }

      createBufferSource() {
        const context = this;
        return {
          buffer: null,
          connect: node => assert.equal(node, context.master),
          start() { context.started.push(this.buffer); },
        };
      }
    },
  };
  t.after(() => { delete globalThis.window; });
  return { instances, userActivation };
}

test('combat audio works as a no-op without a browser', () => {
  const audio = new CombatAudio();
  assert.doesNotThrow(() => {
    audio.unlock(gesture);
    audio.setMuted(true);
    audio.setVolume(0.5);
    for (const sound of sounds) audio.play(sound);
  });
});

test('unavailable WebAudio and storage leave the mute control usable', t => {
  globalThis.window = {
    get localStorage() { throw new Error('storage is disabled'); },
  };
  t.after(() => { delete globalThis.window; });
  const audio = new CombatAudio();
  assert.equal(audio.muted, false);
  audio.unlock(gesture);
  audio.play('hit');
  audio.setMuted(true);
  assert.equal(audio.muted, true);
});

test('playback waits for a trusted gesture and reuses the context after suspension', async t => {
  const { instances, userActivation } = browserAudio(t);
  const audio = new CombatAudio();
  audio.play('hit');
  audio.unlock(gesture);
  userActivation.hasBeenActive = true;
  audio.unlock({ isTrusted: false });
  assert.equal(instances.length, 0);

  audio.unlock(gesture);
  const [context] = instances;
  audio.play('hit');
  assert.equal(context.started.length, 1);

  context.state = 'suspended';
  context.rejectResume = true;
  audio.unlock(gesture);
  await Promise.resolve();
  audio.play('warning');
  assert.equal(context.started.length, 1);

  context.rejectResume = false;
  audio.unlock(gesture);
  audio.play('warning');
  assert.equal(instances.length, 1);
  assert.equal(context.started.length, 2);
});

test('bursts play at most one voice per cue and reuse its audio buffer', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;

  for (let burst = 0; burst < 100; burst++) {
    for (const sound of sounds) audio.play(sound);
  }
  assert.equal(context.started.length, sounds.length);
  assert.equal(new Set(context.started).size, sounds.length);

  context.currentTime = 0.040;
  for (const sound of sounds) audio.play(sound);
  assert.equal(context.started.length, sounds.length);

  const firstBuffers = context.started.slice();
  context.currentTime = 1;
  for (const sound of sounds) audio.play(sound);
  assert.equal(context.started.length, sounds.length * 2);
  for (let i = 0; i < sounds.length; i++) {
    assert.equal(context.started[sounds.length + i], firstBuffers[i]);
  }
});

test('mute persists, suppresses new playback, and restores the selected volume', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  assert.ok(context.master.gain.value > 0 && context.master.gain.value <= 0.5);

  audio.setVolume(0.45);
  audio.setMuted(true);
  audio.play('hit');
  assert.equal(context.master.gain.value, 0);
  assert.equal(context.started.length, 0);

  const next = new CombatAudio();
  assert.equal(next.muted, true);
  next.unlock(gesture);
  assert.equal(instances[1].master.gain.value, 0);

  audio.setMuted(false);
  audio.play('hit');
  assert.equal(context.master.gain.value, 0.45);
  assert.equal(context.started.length, 1);
  assert.equal(new CombatAudio().muted, false);

  audio.setVolume(-1);
  context.currentTime = 1;
  audio.play('hit');
  assert.equal(context.started.length, 1);
  assert.equal(context.master.gain.value, 0);
  audio.setVolume(3);
  audio.setVolume(NaN);
  assert.equal(context.master.gain.value, 1);
});

test('cue buffers are deterministic, brief, and keep the muzzle tick quiet', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  for (let run = 0; run < 2; run++) {
    const audio = new CombatAudio();
    audio.unlock(gesture);
    for (const sound of sounds) audio.play(sound);
  }

  const peaks = [];
  for (let i = 0; i < sounds.length; i++) {
    const buffer = instances[0].started[i];
    const samples = buffer.getChannelData(0);
    assert.ok(buffer.duration > 0 && buffer.duration <= 0.2, sounds[i]);
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    assert.deepEqual(samples, instances[1].started[i].getChannelData(0));
    const peak = Math.max(...samples.map(Math.abs));
    assert.ok(peak > 0.02 && peak < 0.8, sounds[i]);
    peaks.push(peak);
  }
  assert.ok(peaks[3] < peaks[0] / 4);
  assert.ok(peaks.reduce((total, peak) => total + peak, 0) < 1);
});
