import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../src/combat-audio.ts';
import { FLIGHT_AUDIO } from '../src/data/flight-audio.ts';
import { mapFlightAudio } from '../src/flight-audio.ts';

const gesture = { isTrusted: true };
const sounds = ['hit', 'graze', 'warning', 'muzzle', 'roll', 'parry'];
const levelFlight = Object.freeze({
  phase: 'playing', paused: false, tick: 80, speed: 52, climbRate: 0, view: 'chase', boosting: false,
  player: Object.freeze({ x: 0, z: 0, altitude: 110, yaw: 0, bank: 0, vx: 0, vz: 52 }),
  enemies: Object.freeze([]),
});

function audioParam(value) {
  return {
    value, targets: [],
    setTargetAtTime(target, now, timeConstant) {
      this.value = target;
      this.targets.push({ target, now, timeConstant });
    },
  };
}

function shapeSample(curve, input) {
  const sample = Math.max(-1, Math.min(1, input));
  const index = (sample + 1) * (curve.length - 1) / 2;
  const low = Math.floor(index);
  const fraction = index - low;
  return curve[low] * (1 - fraction) + curve[Math.ceil(index)] * fraction;
}

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
      nodes = [];
      buffers = [];
      rejectResume = false;

      constructor() {
        instances.push(this);
      }

      resume() {
        if (this.rejectResume) return Promise.reject(new Error('audio unavailable'));
        this.state = 'running';
        return Promise.resolve();
      }

      suspend() {
        this.state = 'suspended';
        return Promise.resolve();
      }

      node(kind, fields) {
        const node = {
          kind, outputs: [], inputs: [], ...fields,
          connect(target) {
            this.outputs.push(target);
            target.inputs?.push(this);
          },
          disconnect() { this.outputs.length = 0; },
        };
        this.nodes.push(node);
        return node;
      }

      createGain() {
        const node = this.node('gain', { gain: audioParam(1) });
        this.master ??= node;
        return node;
      }

      createOscillator() {
        return this.node('oscillator', {
          frequency: audioParam(440),
          starts: 0,
          start() { this.starts++; },
        });
      }

      createBiquadFilter() {
        return this.node('filter', { frequency: audioParam(350), Q: audioParam(1) });
      }

      createWaveShaper() {
        return this.node('wave-shaper', { curve: null });
      }

      createBuffer(channels, length, sampleRate) {
        assert.equal(channels, 1);
        const samples = new Float32Array(length);
        const buffer = { length, sampleRate, duration: length / sampleRate, getChannelData: () => samples };
        this.buffers.push(buffer);
        return buffer;
      }

      createBufferSource() {
        const context = this;
        return this.node('buffer-source', {
          buffer: null, loop: false, playbackRate: audioParam(1), detune: audioParam(0),
          start(now, offset) { this.startTime = now; this.offset = offset; context.started.push(this.buffer); },
          stop(when) { this.stopTime = when; this.stopped = true; },
        });
      }
    },
  };
  t.after(() => { delete globalThis.window; });
  return { instances, userActivation };
}

function sampleBrowser(t, { missing = [], corrupt = [], gapless = false } = {}) {
  const { instances, userActivation } = browserAudio(t);
  const shotKeys = ['hit', 'explosion', 'graze', 'parry', 'roll', 'warning', 'ace_alert'];
  const loopKeys = ['engine_loop', 'afterburner_loop', 'wind_loop'];
  const keys = [...loopKeys, ...shotKeys];
  const manifest = Object.fromEntries(keys.map(key => [key, {
    samples: loopKeys.includes(key) ? 4410 : 22050, sampleRate: 44100, loop: loopKeys.includes(key),
  }]));
  const requests = [];
  const decoded = {};
  t.mock.method(globalThis, 'fetch', async url => {
    const name = String(url).split('/').at(-1);
    requests.push(name);
    if (name === 'manifest.json') return { ok: true, json: async () => manifest };
    const key = name.replace(/\.mp3$/, '');
    assert.ok(keys.includes(key), name);
    return { ok: !missing.includes(key), arrayBuffer: async () => Uint8Array.of(keys.indexOf(key)).buffer };
  });
  window.AudioContext.prototype.decodeAudioData = async bytes => {
    const key = keys[new Uint8Array(bytes)[0]];
    if (corrupt.includes(key)) throw new Error('corrupt MP3');
    // Simulate decoding at 48 kHz with 240 leading and 480 trailing frames on each loop.
    const pcm = new Float32Array(loopKeys.includes(key) ? gapless ? 4800 : 5520 : 24000);
    pcm.fill(0.1, 240, gapless ? pcm.length : pcm.length - 480);
    return decoded[key] = { length: pcm.length, sampleRate: 48000, duration: pcm.length / 48000, getChannelData: () => pcm };
  };
  userActivation.hasBeenActive = true;
  return { instances, requests, decoded };
}

async function finishDecoding() {
  await new Promise(resolve => setImmediate(resolve));
}

const voicesFor = (context, buffer) => context.nodes.filter(node => node.kind === 'buffer-source' && node.buffer === buffer);

function aceLockState(tick, { id = 17, kind = 'gun', since = 100, until = 160, active = true, paused = false } = {}) {
  const tell = active ? Object.freeze({ kind, since, until }) : null;
  return Object.freeze({ tick, phase: 'playing', paused,
    boss: Object.freeze({ id, hp: 100, entry: null, defeatedAt: null, tell }) });
}

function positiveCrossingHz(samples, sampleRate, start, end) {
  let crossings = 0;
  for (let i = start + 1; i < end; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return crossings * sampleRate / (end - start);
}

test('approved sounds load once after activation and use the mixer, with a synth fallback per missing sample', async t => {
  const { instances, requests, decoded } = sampleBrowser(t, { missing: ['hit'], corrupt: ['parry'] });
  const warning = t.mock.method(console, 'warn', () => {});
  const audio = new CombatAudio();
  audio.unlock({ isTrusted: false });
  assert.deepEqual(requests, []);
  audio.unlock(gesture);
  audio.unlock(gesture);
  await finishDecoding();
  assert.equal(requests.length, 11);
  assert.equal(new Set(requests).size, 11);
  assert.equal(warning.mock.callCount(), 1);
  const [context] = instances;
  audio.play('hit');
  audio.play('parry');
  assert.equal(context.started.length, 2);
  assert.ok(context.started.every(buffer => context.buffers.includes(buffer)));
  audio.play('warning');
  const [source] = voicesFor(context, decoded.warning);
  assert.ok(source);
  const effects = source.outputs[0].outputs[0];
  assert.equal(effects.outputs[0], context.master, 'ordinary combat cues pass through effects gain into master');
  assert.equal(context.master.outputs[0].outputs[0].kind, 'wave-shaper');
});

test('graze retriggers after 80 ms and warning waits at least 1.5 seconds', async t => {
  const { instances, decoded } = sampleBrowser(t);
  const audio = new CombatAudio();
  audio.unlock(gesture);
  await finishDecoding();
  const [context] = instances;
  audio.play('graze');
  audio.play('warning');
  context.currentTime = 0.079;
  audio.play('graze');
  assert.equal(voicesFor(context, decoded.graze).length, 1);
  context.currentTime = 0.080;
  audio.play('graze');
  assert.equal(voicesFor(context, decoded.graze).length, 2);
  context.currentTime = 1.499;
  audio.play('warning');
  assert.equal(voicesFor(context, decoded.warning).length, 1);
  context.currentTime = 1.5;
  audio.play('tell:missile');
  audio.play('warning');
  assert.equal(voicesFor(context, decoded.warning).length, 2);
  assert.equal(context.started.length, 4);
});

test('explosions cap at four and an elite blast can replace a quieter Gnat voice', async t => {
  const { instances, decoded } = sampleBrowser(t);
  const audio = new CombatAudio();
  audio.unlock(gesture);
  await finishDecoding();
  const [context] = instances;
  for (let i = 0; i < 8; i++) audio.play('explosion', 0.25);
  const explosions = () => voicesFor(context, decoded.explosion);
  assert.equal(explosions().length, 4);
  const [fodder] = explosions();
  audio.play('explosion', 1);
  const loud = explosions().at(-1);
  assert.equal(explosions().filter(voice => !voice.stopped).length, 4);
  assert.ok(fodder.stopped);
  assert.ok(loud.outputs[0].gain.value > fodder.outputs[0].gain.value);
  assert.ok(explosions().every(voice => Math.abs(voice.detune.value) <= 80));
  assert.ok(new Set(explosions().map(voice => voice.detune.value)).size > 1);
  loud.onended();
  audio.play('explosion', 1);
  assert.equal(explosions().length, 6);
});

test('sample beds crop encoder padding and respond to boost, airspeed, and view', async t => {
  const { instances, decoded } = sampleBrowser(t);
  const audio = new CombatAudio();
  audio.unlock(gesture);
  await finishDecoding();
  const [context] = instances;
  const cruise = { ...levelFlight, speed: 104 };
  audio.updateFlight(cruise, 0, 60, 0, true);
  const [engine] = voicesFor(context, decoded.engine_loop);
  const [afterburner] = voicesFor(context, decoded.afterburner_loop);
  const [wind] = voicesFor(context, decoded.wind_loop);
  for (const source of [engine, afterburner, wind]) {
    assert.equal(source.loop, true);
    assert.equal(source.loopStart, 0.005);
    assert.ok(Math.abs(source.loopEnd - 0.105) < 1e-9);
    assert.equal(source.offset, 0.005);
  }
  const engineGain = engine.outputs[0].gain;
  const boostGain = afterburner.outputs[0].gain;
  const windFilter = wind.outputs[0];
  const windGain = windFilter.outputs[0].gain;
  const cruiseEngine = engineGain.value;
  const cruiseWind = windGain.value;
  assert.equal(engine.playbackRate.value, 0.85);
  assert.equal(boostGain.value, 0);
  audio.updateFlight({ ...cruise, view: 'cockpit' }, 0, 60, 0, true);
  assert.ok(windGain.value > cruiseWind);
  audio.updateFlight({ ...cruise, view: 'overhead' }, 0, 60, 0, true);
  assert.ok(windGain.value < cruiseWind);
  assert.equal(windFilter.type, 'lowpass');
  const topCutoff = windFilter.frequency.value;
  audio.updateFlight({ ...cruise, speed: 202, boosting: true }, 1, 60, 0, true);
  assert.equal(engine.playbackRate.value, 1.25);
  assert.ok(engineGain.value > cruiseEngine);
  assert.ok(windGain.value > cruiseWind * 3);
  assert.ok(windFilter.frequency.value > topCutoff);
  assert.ok(boostGain.value > 0);
  assert.ok(Math.abs(boostGain.targets.at(-1).timeConstant * 3 - 0.12) < 1e-9);
  audio.updateFlight(cruise, 0, 60, 0, true);
  assert.equal(boostGain.value, 0);
});

test('loops that decode to the full gapless length keep their complete source audio', async t => {
  const { instances, decoded } = sampleBrowser(t, { gapless: true });
  const audio = new CombatAudio();
  audio.unlock(gesture);
  await finishDecoding();
  const [context] = instances;
  audio.updateFlight(levelFlight, 0, 60, 0, true);
  const [engine] = voicesFor(context, decoded.engine_loop);
  assert.equal(engine.offset, 0);
  assert.equal(engine.loopStart, 0);
  assert.equal(engine.loopEnd, 0.1);
});

test('app suspension blocks new voices and gestures until the app resumes audio', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  audio.setSuspended(true);
  audio.unlock(gesture);
  audio.play('hit');
  assert.equal(context.state, 'suspended');
  assert.equal(context.started.length, 0);
  audio.setSuspended(false);
  audio.play('hit');
  assert.equal(context.state, 'running');
  assert.equal(context.started.length, 1);
});

test('combat audio works as a no-op without a browser', () => {
  const audio = new CombatAudio();
  assert.doesNotThrow(() => {
    audio.unlock(gesture);
    audio.setMuted(true);
    audio.setVolume(0.5);
    audio.updateFlight(levelFlight, 0, 60, 0, true);
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
  context.currentTime = 1.5;
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

test('flight audio uses one silent-until-active bed that fades through pause and resumes in place', t => {
  const { instances, userActivation } = browserAudio(t);
  const audio = new CombatAudio();
  audio.updateFlight(levelFlight, 0.45, 32, 0, true);
  assert.equal(instances.length, 0);

  userActivation.hasBeenActive = true;
  audio.unlock(gesture);
  const [context] = instances;
  const originalCount = context.nodes.length;
  audio.updateFlight(levelFlight, 0.45, 32, 0, false);
  assert.equal(context.nodes.length, originalCount);
  audio.updateFlight(levelFlight, 0.45, 32, 0, true);
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  const bed = context.master.inputs.find(node => node.kind === 'gain' && node !== effects);
  const oscillator = context.nodes.find(node => node.kind === 'oscillator');
  assert.equal(bed.gain.value, 1);
  assert.equal(oscillator.type, 'sawtooth');
  assert.equal(oscillator.starts, 1);
  assert.equal(context.nodes.filter(node => node.loop).length, 1);
  assert.equal(context.nodes.filter(node => node.kind === 'filter').length, 4);
  assert.equal(oscillator.frequency.value, mapFlightAudio(52, 0.45, 0, 0, 32).engineHz);

  const graphSize = context.nodes.length;
  const pitchEvents = oscillator.frequency.targets.length;
  for (let i = 1; i < 10; i++) audio.updateFlight({ ...levelFlight, tick: 80 + i }, 0.45, 32, 0, true);
  assert.equal(oscillator.frequency.targets.length, pitchEvents);
  audio.updateFlight({ ...levelFlight, paused: true }, 0.45, 32, 0, true);
  assert.equal(bed.gain.value, 0);
  assert.ok(bed.gain.targets.at(-1).timeConstant > 0);
  audio.updateFlight(levelFlight, 0, 80, 0, true);
  assert.equal(bed.gain.value, 1);
  assert.equal(context.nodes.length, graphSize);
  assert.equal(oscillator.starts, 1);

  context.state = 'suspended';
  audio.updateFlight(levelFlight, 0, 80, 0, true);
  assert.equal(bed.gain.value, 0);
  audio.unlock(gesture);
  audio.updateFlight(levelFlight, 0, 80, 0, true);
  assert.equal(instances.length, 1);
  assert.equal(bed.gain.value, 1);
  assert.equal(context.nodes.length, graphSize);
});

test('flyby and cloud cues play once, respect cooldown and ignore passes while inactive', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const voices = () => context.nodes.filter(node => node.kind === 'buffer-source' && !node.loop);
  audio.updateFlight(levelFlight, 0, 65, 5, true);
  assert.equal(voices().length, 0, 'an earlier cloud is silent on activation');

  const enemy = Object.freeze({ x: 17, z: -1, alt: 110, vx: 0, vz: -48, hp: 2, kind: 'patrol' });
  const passing = Object.freeze({ ...levelFlight, tick: 81, enemies: Object.freeze([enemy]) });
  const snapshot = JSON.stringify(passing);
  audio.updateFlight(passing, 0, 65, 6, true);
  assert.equal(voices().length, 2);
  assert.equal(voices()[0].outputs[0], voices()[1].outputs[0]);
  assert.equal(voices()[0].outputs[0].outputs[0], context.master);
  assert.equal(JSON.stringify(passing), snapshot);

  context.currentTime = 0.05;
  audio.updateFlight({ ...passing, tick: 82 }, 0, 65, 6, true);
  assert.equal(voices().length, 2);
  context.currentTime = 1;
  audio.updateFlight({ ...passing, tick: 83 }, 0, 65, 7, false);
  audio.updateFlight({ ...passing, tick: 84 }, 0, 65, 7, true);
  assert.equal(voices().length, 2);

  audio.setMuted(true);
  audio.updateFlight({ ...passing, tick: 85 }, 0, 65, 8, true);
  assert.equal(context.master.gain.value, 0);
  audio.setMuted(false);
  audio.updateFlight({ ...passing, tick: 86 }, 0, 65, 8, true);
  assert.equal(voices().length, 2);
  audio.updateFlight({ ...passing, tick: 87 }, 0, 65, 9, true);
  assert.equal(voices().length, 4);
});

test('flight and roster buffers are repeatable and the combined mix stays below full scale', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  for (let i = 0; i < 2; i++) {
    const audio = new CombatAudio();
    audio.unlock(gesture);
    audio.updateFlight(levelFlight, 1, 22, 0, true);
  }
  const [first, second] = instances;
  const noiseLoop = first.nodes.find(node => node.loop).buffer;
  assert.ok(noiseLoop.duration >= 1);
  let effectsCeiling = 0;
  const lockPulse = first.buffers.at(-2), lockWindow = first.buffers.at(-1);
  for (let i = 0; i < first.buffers.length; i++) {
    const buffer = first.buffers[i], samples = buffer.getChannelData(0);
    assert.deepEqual(samples, second.buffers[i].getChannelData(0));
    let peak = 0;
    for (const value of samples) {
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
    }
    assert.ok(peak > 0.01 && peak <= 1);
    if (buffer === noiseLoop || buffer === lockPulse || buffer === lockWindow) continue;
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    effectsCeiling += peak;
  }
  const loudest = mapFlightAudio(1000, 1, 1.6, -80, 0);
  const flightCeiling = loudest.engineGain * (1 + FLIGHT_AUDIO.engine.noiseMix)
    + loudest.afterburnerGain + loudest.windGain + loudest.rushGain;
  const lockCeiling = Math.max(
    Math.max(...lockPulse.getChannelData(0).map(Math.abs)) * 1.15,
    Math.max(...lockWindow.getChannelData(0).map(Math.abs)) * 1.35,
  );
  const [headroom] = first.master.outputs;
  const [limiter] = headroom.outputs;
  const effects = first.master.inputs.find(node => node.kind === 'gain');
  assert.equal(effects.outputs[0], first.master, 'the effects bus feeds the user-volume master');
  assert.equal(headroom.gain.value, 0.69);
  assert.ok(limiter.curve instanceof Float32Array, 'the mix needs a peak limiter before the destination');
  assert.deepEqual(limiter.outputs, [first.destination]);

  const { curve } = limiter;
  const fullPeak = Math.max(effectsCeiling + flightCeiling, effectsCeiling * 0.15 + flightCeiling + lockCeiling)
    * headroom.gain.value;
  const defaultPeak = fullPeak * first.master.gain.value;
  assert.ok(fullPeak > 1, 'cover a mixed peak that would clip at full volume');
  for (const input of [-0.70, -defaultPeak, 0, defaultPeak, 0.70]) {
    assert.ok(Math.abs(shapeSample(curve, input) - input) < 1e-6, `keep ${input} at unity gain`);
  }
  assert.ok(curve.every((value, i) => i === 0 || value >= curve[i - 1]), 'the limiter is monotone');
  const limitedPeak = shapeSample(curve, fullPeak);
  assert.ok(limitedPeak > 0.70 && limitedPeak < 1);
  assert.equal(shapeSample(curve, -fullPeak), -limitedPeak);
});

test('tail, missile lock and roster alerts play distinct cues with independent cooldowns', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const cues = ['snipe', 'flak', 'dive', 'tail', 'strafe', 'mine', 'aegis', 'carrier', 'gnat', 'gun', 'missile', 'roll', 'ace-down']
    .map(kind => `tell:${kind}`);
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  for (const cue of cues) {
    audio.play(cue);
    audio.play(cue);
  }
  assert.equal(context.started.length, cues.length);
  assert.equal(new Set(context.started).size, cues.length);
  const sampleData = context.started.map(buffer => buffer.getChannelData(0));
  for (const samples of sampleData) {
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    assert.ok(samples.some(value => Math.abs(value) > 0.05));
  }
  context.currentTime += 0.5;
  audio.play('tell:missile');
  assert.equal(context.started.at(-1), context.started[cues.indexOf('tell:missile')]);
});

test('Ace lock cue synthesis is short, enveloped and distinct from low generic warnings', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const pulse = context.buffers.at(-2), window = context.buffers.at(-1);
  assert.ok(Math.abs(pulse.duration - 0.04) < 0.001);
  assert.ok(window.duration >= 0.1 && window.duration <= 0.14);
  const pulseSamples = pulse.getChannelData(0);
  const windowSamples = window.getChannelData(0);
  assert.ok(positiveCrossingHz(pulseSamples, pulse.sampleRate, 96, 864) >= 1100);
  assert.ok(positiveCrossingHz(pulseSamples, pulse.sampleRate, 96, 864) <= 1400);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 120, 1080) >= 950);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 120, 1080) <= 1150);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 1680, 2640) >= 1350);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 1680, 2640) <= 1550);
  assert.equal(Math.abs(pulseSamples[0]), 0);
  assert.equal(Math.abs(pulseSamples.at(-1)), 0);
  assert.equal(Math.abs(windowSamples[0]), 0);
  assert.equal(Math.abs(windowSamples.at(-1)), 0);
});

test('Ace lock pulses accelerate by tell tick and window entry replaces the pulse exactly once', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const pulse = context.buffers.at(-2), window = context.buffers.at(-1);
  const cues = [];
  let started = context.started.length;
  for (let tick = 100; tick <= 160; tick++) {
    context.currentTime = (tick - 100) / 60;
    audio.updateAceLock(aceLockState(tick), true);
    for (const buffer of context.started.slice(started)) cues.push({ tick, buffer });
    started = context.started.length;
  }
  const pulses = cues.filter(cue => cue.buffer === pulse).map(cue => cue.tick);
  const accents = cues.filter(cue => cue.buffer === window).map(cue => cue.tick);
  assert.deepEqual(pulses, [100, 112, 122, 131, 139, 150, 156]);
  assert.deepEqual(accents, [142], 'the one-shot accent lands at the exact dodge-window edge');

  const short = new CombatAudio();
  const other = browserAudio(t);
  other.userActivation.hasBeenActive = true;
  short.unlock(gesture);
  const [shortContext] = other.instances;
  const shortPulse = shortContext.buffers.at(-2), shortWindow = shortContext.buffers.at(-1);
  short.updateAceLock(aceLockState(100, { until: 119 }), true);
  const pulseVoice = voicesFor(shortContext, shortPulse).at(-1);
  shortContext.currentTime = 1 / 60;
  short.updateAceLock(aceLockState(101, { until: 119 }), true);
  const accentVoice = voicesFor(shortContext, shortWindow).at(-1);
  assert.equal(pulseVoice.stopTime, accentVoice.startTime, 'accent replaces, rather than overlaps, the pulse');
  const count = shortContext.started.length;
  short.updateAceLock(aceLockState(101, { until: 119 }), true);
  assert.equal(shortContext.started.length, count, 'the same window edge cannot replay');
});

test('Ace lock catch-up collapses missed pulses and gives a crossed window accent priority', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const pulse = context.buffers.at(-2), window = context.buffers.at(-1);
  audio.updateAceLock(aceLockState(100), true);
  const before = context.started.length;
  context.currentTime = 35 / 60;
  audio.updateAceLock(aceLockState(135), true);
  assert.equal(context.started.length, before + 1, 'a multi-interval catch-up emits at most one cue');
  assert.equal(context.started.at(-1), pulse);
  const afterPulse = context.started.length;
  audio.updateAceLock(aceLockState(135), true);
  assert.equal(context.started.length, afterPulse, 'rendering the same post-step tick cannot duplicate a pulse');
  context.currentTime = 45 / 60;
  audio.updateAceLock(aceLockState(145), true);
  assert.equal(context.started.length, afterPulse + 1);
  assert.equal(context.started.at(-1), window, 'the crossed entry accent overrides a due ordinary pulse');
  audio.updateAceLock(aceLockState(145), true);
  assert.equal(context.started.length, afterPulse + 1, 'a same-frame render cannot duplicate the accent');
});

test('Ace lock audio uses the direct master path, ducks effects and cleans up its voice', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const pulse = context.buffers.at(-2);
  audio.updateAceLock(aceLockState(100), true);
  const lockVoice = voicesFor(context, pulse).at(-1);
  assert.equal(lockVoice.outputs[0].outputs[0], context.master, 'the lock cue bypasses the effects bus only');
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  assert.equal(effects.gain.value, 0.15);
  const lockGain = lockVoice.outputs[0];
  audio.play('hit');
  const hitVoice = context.nodes.filter(node => node.kind === 'buffer-source').at(-1);
  const hitEffects = hitVoice.outputs[0];
  assert.equal(hitEffects, effects, 'ordinary hit cues route through effects gain');
  assert.equal(hitEffects.outputs[0], context.master);

  lockVoice.onended();
  assert.equal(effects.gain.value, 0.15, 'the effects duck stays active after the pulse ends');
  const gapVoiceCount = context.started.length;
  audio.updateAceLock(aceLockState(101), true);
  assert.equal(context.started.length, gapVoiceCount, 'no cue is needed to keep the tell ducked between pulses');
  assert.equal(effects.gain.value, 0.15);
  const fired = aceLockState(160);
  audio.updateAceLock({ ...fired, boss: { ...fired.boss, tell: null } }, true);
  assert.equal(effects.gain.value, 1, 'the effects bus restores when the tell fires');
  assert.deepEqual(lockVoice.outputs, []);
  assert.deepEqual(lockGain.outputs, []);
});

test('Ace lock scheduler keys tells and skips paused, muted, suspended and cancelled cues without replay', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const pulse = context.buffers.at(-2);
  const snapshot = aceLockState(100);
  const before = JSON.stringify(snapshot);
  audio.updateAceLock(snapshot, true);
  audio.updateAceLock(aceLockState(100, { id: 18 }), true);
  audio.updateAceLock(aceLockState(100, { id: 18, kind: 'missile' }), true);
  audio.updateAceLock(aceLockState(101, { id: 18, kind: 'missile', since: 101 }), true);
  audio.updateAceLock(aceLockState(101, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.equal(voicesFor(context, pulse).length, 5, 'boss id, kind, since and until all identify a tell');
  assert.equal(JSON.stringify(snapshot), before, 'the presentation scheduler does not mutate StageState');

  const pausedVoice = voicesFor(context, pulse).at(-1);
  audio.updateAceLock(aceLockState(102, { id: 18, kind: 'missile', since: 101, until: 161, paused: true }), false);
  assert.equal(pausedVoice.stopped, true, 'pause stops the active lock voice');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'pause restores the effects bus');
  const resumedCount = context.started.length;
  audio.updateAceLock(aceLockState(102, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.equal(context.started.length, resumedCount, 'resume does not replay the paused pulse');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.15, 'the active tell re-ducks effects on resume');

  audio.setMuted(true);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'mute restores effects even between pulses');
  const mutedCount = context.started.length;
  audio.updateAceLock(aceLockState(113, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  audio.setMuted(false);
  audio.updateAceLock(aceLockState(113, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.equal(context.started.length, mutedCount, 'unmute skips pulses that became due while muted');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.15);
  audio.setVolume(0);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'zero volume restores effects');
  audio.setVolume(0.30);
  audio.updateAceLock(aceLockState(113, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.15);

  audio.updateAceLock(aceLockState(200, { since: 200, until: 260 }), true);
  const suspendedCount = context.started.length;
  audio.setSuspended(true);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'suspension restores effects');
  audio.updateAceLock(aceLockState(212, { since: 200, until: 260 }), false);
  audio.setSuspended(false);
  audio.updateAceLock(aceLockState(212, { since: 200, until: 260 }), true);
  assert.equal(context.started.length, suspendedCount, 'resume does not replay a suspended cue');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.15);

  audio.updateAceLock(aceLockState(300, { since: 300, until: 360 }), true);
  const activeVoice = voicesFor(context, pulse).at(-1);
  const activeGain = activeVoice.outputs[0];
  audio.updateAceLock(aceLockState(301, { active: false }), false);
  assert.equal(activeVoice.stopped, true, 'tell cancellation promptly stops the active voice');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'cancellation promptly restores effects');
  activeVoice.onended();
  assert.deepEqual(activeVoice.outputs, []);
  assert.deepEqual(activeGain.outputs, []);
});
