import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../src/combat-audio.ts';
import { FLIGHT_AUDIO } from '../src/data/flight-audio.ts';
import { mapFlightAudio } from '../src/flight-audio.ts';
import { mapSimulationStepTimesToAudioTicks, simulationStepTimesForFrame } from '../src/flight-chord.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const gesture = { isTrusted: true };
const sounds = ['hit', 'graze', 'warning', 'muzzle', 'roll', 'parry'];
const levelFlight = Object.freeze({
  phase: 'playing', paused: false, tick: 80, speed: 52, climbRate: 0, view: 'chase', boosting: false,
  player: Object.freeze({ x: 0, z: 0, altitude: 110, yaw: 0, bank: 0, vx: 0, vz: 52 }),
  enemies: Object.freeze([]),
});

function audioParam(value, currentTime = () => 0) {
  let initialValue = value;
  let scheduled = [];
  return Object.defineProperties({
    targets: [], values: [], cancellations: [],
    setTargetAtTime(target, now, timeConstant) {
      const event = { target, now, timeConstant };
      this.targets.push(event);
      scheduled.push(event);
    },
    cancelScheduledValues(now) {
      this.cancellations.push(now);
      scheduled = scheduled.filter(event => event.now < now);
    },
    setValueAtTime(target, now) {
      const event = { target, now };
      this.values.push(event);
      scheduled.push(event);
    },
  }, { value: {
    get() {
      let latest = { target: initialValue, now: -Infinity };
      for (const event of scheduled) {
        if (event.now <= currentTime() && event.now >= latest.now) latest = event;
      }
      return latest.target;
    },
    set(next) {
      initialValue = next;
      scheduled = [];
    },
  } });
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
        const context = this;
        const node = this.node('gain', { gain: audioParam(1, () => context.currentTime) });
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
const voicesAt = (context, buffer, time) => voicesFor(context, buffer)
  .filter(voice => voice.startTime >= time && voice.startTime < time + buffer.duration);
const ACE_LOCK_PULSE_HZ = 1125;

function aceLockBuffers(context) {
  const window = context.buffers.at(-1);
  const pulses = context.buffers.slice(-2, -1);
  assert.equal(pulses.length, 1);
  return { pulses, window };
}

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

function toneAmplitude(samples, sampleRate, frequency, startSeconds, endSeconds) {
  const start = Math.ceil(startSeconds * sampleRate), end = Math.floor(endSeconds * sampleRate);
  let real = 0, imaginary = 0;
  for (let i = start; i < end; i++) {
    const phase = 2 * Math.PI * frequency * i / sampleRate;
    real += samples[i] * Math.cos(phase);
    imaginary += samples[i] * Math.sin(phase);
  }
  return 2 * Math.hypot(real, imaginary) / (end - start);
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
  const { pulses: lockPulses, window: lockWindow } = aceLockBuffers(first);
  for (let i = 0; i < first.buffers.length; i++) {
    const buffer = first.buffers[i], samples = buffer.getChannelData(0);
    assert.deepEqual(samples, second.buffers[i].getChannelData(0));
    let peak = 0;
    for (const value of samples) {
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
    }
    assert.ok(peak > 0.01 && peak <= 1);
    if (buffer === noiseLoop || lockPulses.includes(buffer) || buffer === lockWindow) continue;
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    effectsCeiling += peak;
  }
  const loudest = mapFlightAudio(1000, 1, 1.6, -80, 0);
  const flightCeiling = loudest.engineGain * (1 + FLIGHT_AUDIO.engine.noiseMix)
    + loudest.afterburnerGain + loudest.windGain + loudest.rushGain;
  const lockCeiling = Math.max(
    ...lockPulses.map(pulse => Math.max(...pulse.getChannelData(0).map(Math.abs)) * 2.0),
    Math.max(...lockWindow.getChannelData(0).map(Math.abs)) * 2.4,
  );
  const [headroom] = first.master.outputs;
  const [limiter] = headroom.outputs;
  const effects = first.master.inputs.find(node => node.kind === 'gain');
  assert.equal(effects.outputs[0], first.master, 'the effects bus feeds the user-volume master');
  assert.equal(headroom.gain.value, 0.69);
  assert.ok(limiter.curve instanceof Float32Array, 'the mix needs a peak limiter before the destination');
  assert.deepEqual(limiter.outputs, [first.destination]);

  const { curve } = limiter;
  const fullPeak = Math.max(
    effectsCeiling + flightCeiling,
    effectsCeiling * 0.06 + flightCeiling + lockCeiling,
    effectsCeiling * 0.02 + flightCeiling + lockCeiling,
  )
    * headroom.gain.value;
  const defaultPeak = fullPeak * first.master.gain.value;
  assert.ok(fullPeak > 1, 'cover a mixed peak that would clip at full volume');
  for (const input of [-0.70, -defaultPeak, 0, defaultPeak, 0.70]) {
    assert.ok(Math.abs(shapeSample(curve, input) - input) < 1e-6, `keep ${input} at unity gain`);
  }
  assert.ok(curve.every((value, i) => i === 0 || value >= curve[i - 1]), 'the limiter is monotone');
  const limitedPeak = shapeSample(curve, fullPeak);
  assert.ok(limitedPeak > 0.70 && limitedPeak < 1);
  assert.ok(limitedPeak * first.master.gain.value < 10 ** (-1 / 20),
    'the worst-case conservative mix bound stays below -1 dBFS at the default master level');
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

test('Ace lock uses one steady-pitch band-limited radar beep and preserves the distinct window cue', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { pulses, window } = aceLockBuffers(context);
  assert.equal(pulses.length, 1);
  const pulse = pulses[0], samples = pulse.getChannelData(0);
  assert.ok(Math.abs(pulse.duration - 0.032) < 0.001);
  const measuredPulseHz = positiveCrossingHz(samples, pulse.sampleRate, 96, samples.length - 96);
  assert.ok(Math.abs(measuredPulseHz - ACE_LOCK_PULSE_HZ) <= 20,
    `pulse should remain at ${ACE_LOCK_PULSE_HZ} Hz, got ${measuredPulseHz}`);
  const peak = Math.max(...samples.map(Math.abs));
  assert.ok(peak >= 0.34 && peak <= 0.37, `pulse peak preserves prior level without clipping, got ${peak}`);
  const fundamental = toneAmplitude(samples, pulse.sampleRate, ACE_LOCK_PULSE_HZ, 0.004, 0.020);
  const thirdHarmonic = toneAmplitude(samples, pulse.sampleRate, ACE_LOCK_PULSE_HZ * 3, 0.004, 0.020);
  const fifthHarmonic = toneAmplitude(samples, pulse.sampleRate, ACE_LOCK_PULSE_HZ * 5, 0.004, 0.020);
  assert.ok(thirdHarmonic / fundamental > 0.30 && thirdHarmonic / fundamental < 0.37,
    'the third odd harmonic gives the pulse a square-like radar timbre');
  assert.ok(fifthHarmonic / fundamental > 0.17 && fifthHarmonic / fundamental < 0.23,
    'the fifth odd harmonic remains band-limited and controlled');
  assert.ok(window.duration >= 0.1 && window.duration <= 0.14);
  const windowSamples = window.getChannelData(0);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 120, 1080) >= 1550);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 120, 1080) <= 1750);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 1680, 2640) >= 2100);
  assert.ok(positiveCrossingHz(windowSamples, window.sampleRate, 1680, 2640) <= 2300);
  for (const pulse of pulses) {
    const samples = pulse.getChannelData(0);
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
  }
  assert.equal(Math.abs(windowSamples[0]), 0);
  assert.equal(Math.abs(windowSamples.at(-1)), 0);
});

test('Ace lock cue bank schedules pulse cadence and window onset at their exact tell ticks', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { pulses: pulseBank, window } = aceLockBuffers(context);
  const cachedBufferCount = context.buffers.length;
  const origin = 2.5;
  context.currentTime = origin;
  audio.updateAceLock(aceLockState(100), true);
  const pulseCues = context.nodes.filter(cue => cue.kind === 'buffer-source' && pulseBank.includes(cue.buffer));
  const pulseTicks = pulseCues.map(cue => Math.round(100 + (cue.startTime - origin) * 60));
  const pulseBankIndices = pulseCues.map(cue => pulseBank.indexOf(cue.buffer));
  const accents = voicesFor(context, window);
  assert.deepEqual(pulseTicks, [100, 110, 119, 127, 134, 140, 150, 156]);
  assert.deepEqual(pulseTicks.slice(1, 6).map((tick, index) => tick - pulseTicks[index]), [10, 9, 8, 7, 6],
    'pre-window beeps arrive with progressively shorter gaps');
  assert.deepEqual(pulseBankIndices, Array(pulseTicks.length).fill(0),
    'all warning pips reuse the same fixed-pitch buffer');
  assert.equal(accents.length, 1);
  assert.equal(accents[0].startTime, origin + 42 / 60, 'the accent is queued at windowTick, independent of render cadence');
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  assert.deepEqual(effects.gain.targets.slice(-2), [
    { target: 0.06, now: origin, timeConstant: 0.004 },
    { target: 0.02, now: origin + 42 / 60, timeConstant: 0.004 },
  ]);
  assert.equal(context.buffers.length, cachedBufferCount, 'scheduled pulses reuse the cached tone bank');
  const scheduledCount = context.started.length;
  for (const tick of [111, 122, 133, 153, 160]) {
    context.currentTime = origin + (tick - 100) / 60;
    audio.updateAceLock(aceLockState(tick), true);
  }
  assert.equal(context.started.length, scheduledCount, 'multi-tick frames do not duplicate or defer pre-scheduled cues');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.02,
    'the stronger warning duck begins at the same simulation tick as the window accent');

  const short = new CombatAudio();
  const other = browserAudio(t);
  other.userActivation.hasBeenActive = true;
  short.unlock(gesture);
  const [shortContext] = other.instances;
  const { pulses: shortPulses, window: shortWindow } = aceLockBuffers(shortContext);
  short.updateAceLock(aceLockState(100, { until: 119 }), true);
  const pulseVoice = voicesFor(shortContext, shortPulses[0])[0];
  const accentVoice = voicesFor(shortContext, shortWindow).at(-1);
  assert.equal(pulseVoice.outputs[0].gain.value, 2.0, 'pulse starts at its requested cue gain');
  assert.equal(accentVoice.startTime, 1 / 60 + 0.006, 'an overlapping short tell gets a six-millisecond replacement fade');
  shortContext.currentTime = 1 / 60;
  short.updateAceLock(aceLockState(101, { until: 119 }), true);
  assert.equal(accentVoice.outputs[0].gain.value, 2.4, 'window accent starts at its requested cue gain');
  assert.equal(pulseVoice.stopTime, accentVoice.startTime, 'accent replaces, rather than overlaps, the pulse');
  const count = shortContext.started.length;
  short.updateAceLock(aceLockState(101, { until: 119 }), true);
  assert.equal(shortContext.started.length, count, 'the same window edge cannot replay');
});

test('input step mapping follows the actual scheduled window source across double audio updates', t => {
  for (const renderCost of [4, 20, 40]) {
    const { instances, userActivation } = browserAudio(t);
    userActivation.hasBeenActive = true;
    const audio = new CombatAudio();
    audio.unlock(gesture);
    const [context] = instances;
    const { window } = aceLockBuffers(context);
    context.currentTime = 2.5;
    const state = aceLockState(100, { until: 129 });
    audio.updateAceLock(state, true, 5000);

    context.currentTime += renderCost / 1000;
    audio.updateAceLock(state, true, 5000 + renderCost);
    const voice = context.nodes.filter(node => node.kind === 'buffer-source' && node.buffer === window).at(-1);
    assert.ok(voice?.startTime !== undefined);
    const cuePerformanceTime = audio.aceLockPerformanceTimeForAudioTime(voice.startTime);
    assert.ok(cuePerformanceTime !== undefined);
    const eventTime = cuePerformanceTime + 2;
    const frameTimes = simulationStepTimesForFrame(5000 + renderCost, 0.2, 0, 1 / 60).times;
    const steps = mapSimulationStepTimesToAudioTicks(
      frameTimes, state.tick, tick => audio.aceLockPerformanceTimeForTick(tick),
    );
    const consumedStep = steps.findIndex(time => time >= eventTime);
    assert.ok(consumedStep >= 0, `${renderCost}ms render cost leaves C inside the accepted frame prefix`);
    assert.ok(state.tick + consumedStep + 1 >= 111,
      `${renderCost}ms render cost maps C after the scheduled dodge-window tick`);
    assert.equal(steps[consumedStep],
      audio.aceLockPerformanceTimeForTick(state.tick + consumedStep + 1));
  }
});

test('actual scheduled window source maps cue+2ms to the near-fire tick', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { window } = aceLockBuffers(context);
  context.currentTime = 3.5;
  const state = aceLockState(128, { since: 100, until: 129 });
  audio.updateAceLock(state, true, 7000);

  const voice = context.nodes.filter(node => node.kind === 'buffer-source' && node.buffer === window).at(-1);
  assert.ok(voice?.startTime !== undefined);
  const eventTime = audio.aceLockPerformanceTimeForAudioTime(voice.startTime) + 2;
  const frameTimes = simulationStepTimesForFrame(7000, 1 / 60, 0, 1 / 60).times;
  const steps = mapSimulationStepTimesToAudioTicks(
    frameTimes, state.tick, tick => audio.aceLockPerformanceTimeForTick(tick),
  );
  assert.equal(steps.length, 1);
  assert.ok(steps[0] >= eventTime);
  assert.equal(state.tick + 1, 129, 'the actual cue onset plus 2ms is consumed at the fire tick');
});

test('first audible tell emits one overdue low pip unless the dodge window already has priority', t => {
  const audible = browserAudio(t);
  audible.userActivation.hasBeenActive = true;
  const firstAudio = new CombatAudio();
  firstAudio.unlock(gesture);
  const [firstContext] = audible.instances;
  const { pulses: firstPulses } = aceLockBuffers(firstContext);
  firstContext.currentTime = 4;
  firstAudio.updateAceLock(aceLockState(101), true);
  const initialPips = voicesAt(firstContext, firstPulses[0], firstContext.currentTime);
  assert.equal(initialPips.length, 1);
  assert.equal(initialPips[0].startTime, firstContext.currentTime);

  const late = browserAudio(t);
  late.userActivation.hasBeenActive = true;
  const lateAudio = new CombatAudio();
  lateAudio.unlock(gesture);
  const [lateContext] = late.instances;
  const { pulses: latePulses, window } = aceLockBuffers(lateContext);
  lateContext.currentTime = 5;
  lateAudio.updateAceLock(aceLockState(142), true);
  assert.equal(voicesAt(lateContext, latePulses[0], lateContext.currentTime).length, 0);
  assert.equal(voicesFor(lateContext, window)[0].startTime, lateContext.currentTime,
    'an already-open window plays its distinct cue instead');

  const muted = browserAudio(t);
  muted.userActivation.hasBeenActive = true;
  const mutedAudio = new CombatAudio();
  mutedAudio.unlock(gesture);
  const [mutedContext] = muted.instances;
  const { pulses: mutedPulses } = aceLockBuffers(mutedContext);
  mutedAudio.updateAceLock(aceLockState(101), false);
  mutedAudio.updateAceLock(aceLockState(101), true);
  assert.equal(voicesAt(mutedContext, mutedPulses[0], mutedContext.currentTime).length, 0,
    'an initially inaudible tell never replays its missed pip');
});

test('Ace lock low-frame-rate catch-up retains exact window and pulse start times', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { pulses: pulseBank, window } = aceLockBuffers(context);
  const origin = 3;
  context.currentTime = origin;
  audio.updateAceLock(aceLockState(100), true);
  const before = context.started.length;
  const windowVoice = voicesFor(context, window)[0];
  assert.equal(windowVoice.startTime, origin + 42 / 60);
  context.currentTime = origin + 35 / 60;
  audio.updateAceLock(aceLockState(135), true);
  assert.equal(context.started.length, before, 'a multi-tick render does not emit late catch-up duplicates');
  context.currentTime = origin + 45 / 60;
  audio.updateAceLock(aceLockState(145), true);
  assert.equal(context.started.length, before, 'rendering after the window tick cannot delay or duplicate the accent');
  assert.equal(windowVoice.startTime, origin + (142 - 100) / 60);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.02);
});

test('Ace lock cue timing rebases when audio time outruns simulated ticks', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { pulses: pulseBank, window } = aceLockBuffers(context);
  const origin = 2;
  context.currentTime = origin;
  audio.updateAceLock(aceLockState(100), true);
  const staleWindow = voicesFor(context, window)[0];
  const oldWindowAt = origin + 42 / 60;
  assert.equal(staleWindow.startTime, oldWindowAt);

  context.currentTime = origin + 30 / 60;
  audio.updateAceLock(aceLockState(110), true);
  assert.equal(staleWindow.stopped, true, 'a delayed simulation cancels sources queued on the old clock');
  assert.equal(voicesAt(context, pulseBank[0], context.currentTime).length, 1,
    'rebasing schedules only the pulse due at the new tick');
  const currentWindow = voicesFor(context, window).at(-1);
  assert.notEqual(currentWindow, staleWindow);
  assert.equal(currentWindow.startTime, context.currentTime + (142 - 110) / 60);
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  context.currentTime = oldWindowAt;
  assert.equal(effects.gain.value, 0.06, 'the cancelled old duck target cannot fire');
  context.currentTime = currentWindow.startTime;
  assert.equal(effects.gain.value, 0.02, 'the re-based target follows the current simulation tick');
});

test('late onended callback from a canceled same-tell cue cannot poison its replacement', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { window } = aceLockBuffers(context);
  const origin = 2;
  context.currentTime = origin;
  audio.updateAceLock(aceLockState(100), true);
  const canceledWindow = voicesFor(context, window)[0];

  context.currentTime = origin + 12 / 60;
  audio.setMuted(true);
  audio.updateAceLock(aceLockState(109), true);
  audio.setMuted(false);
  audio.updateAceLock(aceLockState(109), true);
  const resumedWindow = voicesFor(context, window).at(-1);
  assert.notEqual(resumedWindow, canceledWindow);

  context.currentTime = origin + 42 / 60 + 0.01;
  canceledWindow.onended();
  context.currentTime += 0.01;
  audio.updateAceLock(aceLockState(112), true);
  const replacement = voicesFor(context, window).at(-1);
  assert.notEqual(replacement, resumedWindow, 'same-tell clock rebase keeps a future window queued');
  assert.equal(replacement.startTime, context.currentTime + (142 - 112) / 60);
});

test('late onended callback from a prior tell cannot mark the new tell window played', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { window } = aceLockBuffers(context);
  const origin = 3;
  context.currentTime = origin;
  audio.updateAceLock(aceLockState(100), true);
  const oldTellWindow = voicesFor(context, window)[0];

  context.currentTime = origin + 42 / 60 + 0.01;
  audio.updateAceLock(aceLockState(142, { id: 18, since: 142, until: 202 }), true);
  const newTellWindow = voicesFor(context, window).at(-1);
  assert.notEqual(newTellWindow, oldTellWindow);

  context.currentTime += 0.01;
  oldTellWindow.onended();
  context.currentTime = origin + 0.8;
  audio.updateAceLock(aceLockState(143, { id: 18, since: 142, until: 202 }), true);
  const replacement = voicesFor(context, window).at(-1);
  assert.notEqual(replacement, newTellWindow, 'the current tell window is re-queued after the old callback');
  assert.equal(replacement.startTime, context.currentTime + (184 - 143) / 60);
});

test('Ace lock cancellation stops future cues and cancels their window duck automation', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { window } = aceLockBuffers(context);
  audio.updateAceLock(aceLockState(100), true);
  const futureWindow = voicesFor(context, window)[0];
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  assert.ok(futureWindow.startTime > context.currentTime);
  assert.equal(effects.gain.value, 0.06);
  audio.updateAceLock(aceLockState(110, { active: false }), false);
  assert.equal(futureWindow.stopped, true);
  assert.equal(effects.gain.value, 1);
  context.currentTime = futureWindow.startTime;
  assert.equal(effects.gain.value, 1, 'a cancelled lock cannot re-apply the future warning duck');
});

test('Ace lock audio uses the direct master path, ducks effects and cleans up its voice', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { pulses: pulseBank } = aceLockBuffers(context);
  audio.updateAceLock(aceLockState(100), true);
  const lockVoice = voicesFor(context, pulseBank[0]).at(-1);
  assert.equal(lockVoice.outputs[0].outputs[0], context.master, 'the lock cue bypasses the effects bus only');
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  const lockGain = lockVoice.outputs[0];
  assert.equal(lockGain.gain.value, 2.0);
  assert.equal(effects.gain.value, 0.06);
  audio.play('hit');
  const hitVoice = context.nodes.filter(node => node.kind === 'buffer-source').at(-1);
  const hitEffects = hitVoice.outputs[0];
  assert.equal(hitEffects, effects, 'ordinary hit cues route through effects gain');
  assert.equal(hitEffects.outputs[0], context.master);

  lockVoice.onended();
  assert.equal(effects.gain.value, 0.06, 'the effects duck stays active after the pulse ends');
  const gapVoiceCount = context.started.length;
  audio.updateAceLock(aceLockState(101), true);
  assert.equal(context.started.length, gapVoiceCount, 'no cue is needed to keep the tell ducked between pulses');
  assert.equal(effects.gain.value, 0.06);
  const fired = aceLockState(160);
  audio.updateAceLock({ ...fired, boss: { ...fired.boss, tell: null } }, true);
  assert.equal(effects.gain.value, 1, 'the effects bus restores when the tell fires');
  assert.deepEqual(lockVoice.outputs, []);
  assert.deepEqual(lockGain.outputs, []);
});

test('the actual Ace fired observer restores effects before same-tick muzzle playback', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const ground = () => 0;
  const state = createStage(parseStageOptions('?fixture=ace&cue=duel&view=chase'), ground);
  for (let i = 0; i < 120 && !state.boss?.tell; i++) stepStage(state, {}, ground);
  const tell = state.boss?.tell;
  assert.equal(tell?.kind, 'missile');

  audio.updateAceLock(state, true);
  const effects = context.master.inputs.find(node => node.kind === 'gain');
  assert.equal(effects.gain.value, 0.06, 'the warning duck remains held until the fire observer');
  const order = [];
  let gainAtFire, muzzleVoice;
  const events = {
    aceTellFired(firedTell) {
      order.push('aceTellFired');
      assert.equal(firedTell, tell);
      gainAtFire = effects.gain.value;
      audio.finishAceLockFire();
    },
    muzzle(_shot, _shape, x, z) {
      order.push('muzzle');
      const inAudioRange = (x - state.player.x) ** 2 + (z - state.player.z) ** 2 < 180 ** 2;
      assert.ok(inAudioRange, 'the firing fixture reaches main.ts muzzle-audio range');
      assert.equal(effects.gain.value, 1, 'same-tick muzzle starts at full effects-bus gain');
      if (muzzleVoice) return;
      const sourcesBefore = context.nodes.filter(node => node.kind === 'buffer-source').length;
      audio.play('muzzle');
      const sources = context.nodes.filter(node => node.kind === 'buffer-source');
      assert.equal(sources.length, sourcesBefore + 1);
      muzzleVoice = sources.at(-1);
      assert.equal(muzzleVoice.startTime, context.currentTime);
      let route = muzzleVoice;
      while (route && route !== effects) route = route.outputs[0];
      assert.equal(route, effects, 'ordinary muzzle audio still routes through effects');
      assert.equal(effects.outputs[0], context.master);
      assert.deepEqual(effects.gain.values.at(-1), { target: 1, now: context.currentTime });
    },
  };
  while (state.tick < tell.until - 1) stepStage(state, {}, ground);
  stepStage(state, {}, ground, undefined, events);

  assert.equal(gainAtFire, 0.06);
  assert.deepEqual(order.slice(0, 2), ['aceTellFired', 'muzzle']);
  assert.deepEqual(effects.gain.cancellations.at(-1), context.currentTime);
  assert.equal(effects.gain.value, 1);
});

test('Ace lock scheduler keys tells and skips paused, muted, suspended and cancelled cues without replay', t => {
  const { instances, userActivation } = browserAudio(t);
  userActivation.hasBeenActive = true;
  const audio = new CombatAudio();
  audio.unlock(gesture);
  const [context] = instances;
  const { pulses: pulseBank } = aceLockBuffers(context);
  const snapshot = aceLockState(100);
  const before = JSON.stringify(snapshot);
  audio.updateAceLock(snapshot, true);
  audio.updateAceLock(aceLockState(100, { id: 18 }), true);
  audio.updateAceLock(aceLockState(100, { id: 18, kind: 'missile' }), true);
  audio.updateAceLock(aceLockState(101, { id: 18, kind: 'missile', since: 101 }), true);
  audio.updateAceLock(aceLockState(101, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.equal(voicesAt(context, pulseBank[0], context.currentTime).length, 5,
    'boss id, kind, since and until all identify a tell');
  assert.equal(JSON.stringify(snapshot), before, 'the presentation scheduler does not mutate StageState');

  const pausedVoice = voicesAt(context, pulseBank[0], context.currentTime).at(-1);
  audio.updateAceLock(aceLockState(102, { id: 18, kind: 'missile', since: 101, until: 161, paused: true }), false);
  assert.equal(pausedVoice.stopped, true, 'pause stops the active lock voice');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'pause restores the effects bus');
  const resumedCount = context.started.length;
  audio.updateAceLock(aceLockState(102, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.ok(context.started.length > resumedCount, 'resume schedules only future cues');
  assert.equal(voicesAt(context, pulseBank[0], context.currentTime).length, 5,
    'resume does not replay the already-passed first pulse');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.06, 'the active tell re-ducks effects on resume');

  audio.setMuted(true);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'mute restores effects even between pulses');
  const mutedCount = context.started.length;
  audio.updateAceLock(aceLockState(113, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  audio.setMuted(false);
  audio.updateAceLock(aceLockState(113, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.ok(context.started.length > mutedCount, 'unmute schedules cues that are still ahead');
  assert.equal(voicesAt(context, pulseBank[0], context.currentTime).length, 5,
    'unmute skips pulses that became due while muted');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.06);
  audio.setVolume(0);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'zero volume restores effects');
  audio.setVolume(0.30);
  audio.updateAceLock(aceLockState(113, { id: 18, kind: 'missile', since: 101, until: 161 }), true);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.06);

  audio.updateAceLock(aceLockState(200, { since: 200, until: 260 }), true);
  const suspendedCount = context.started.length;
  const firstPulseCount = voicesAt(context, pulseBank[0], context.currentTime).length;
  audio.setSuspended(true);
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'suspension restores effects');
  audio.updateAceLock(aceLockState(212, { since: 200, until: 260 }), false);
  audio.setSuspended(false);
  audio.updateAceLock(aceLockState(212, { since: 200, until: 260 }), true);
  assert.ok(context.started.length > suspendedCount, 'resume schedules later simulation cues');
  assert.equal(voicesAt(context, pulseBank[0], context.currentTime).length, firstPulseCount,
    'resume does not replay the suspended pulse at tick 212');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 0.06);

  audio.updateAceLock(aceLockState(300, { since: 300, until: 360 }), true);
  const activeVoice = voicesAt(context, pulseBank[0], context.currentTime).at(-1);
  const activeGain = activeVoice.outputs[0];
  audio.updateAceLock(aceLockState(301, { active: false }), false);
  assert.equal(activeVoice.stopped, true, 'tell cancellation promptly stops the active voice');
  assert.equal(context.master.inputs.find(node => node.kind === 'gain').gain.value, 1, 'cancellation promptly restores effects');
  activeVoice.onended();
  assert.deepEqual(activeVoice.outputs, []);
  assert.deepEqual(activeGain.outputs, []);
});
