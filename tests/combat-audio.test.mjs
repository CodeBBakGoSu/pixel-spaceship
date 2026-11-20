import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../src/combat-audio.ts';
import { FLIGHT_AUDIO } from '../src/data/flight-audio.ts';
import { mapFlightAudio } from '../src/flight-audio.ts';

const gesture = { isTrusted: true };
const sounds = ['hit', 'graze', 'warning', 'muzzle', 'roll', 'parry'];
const levelFlight = Object.freeze({
  phase: 'playing', paused: false, tick: 80, speed: 52, climbRate: 0,
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

      node(kind, fields) {
        const node = {
          kind, outputs: [], inputs: [], ...fields,
          connect(target) {
            this.outputs.push(target);
            target.inputs?.push(this);
          },
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
        const buffer = { duration: length / sampleRate, getChannelData: () => samples };
        this.buffers.push(buffer);
        return buffer;
      }

      createBufferSource() {
        const context = this;
        return this.node('buffer-source', {
          buffer: null, loop: false,
          start() { context.started.push(this.buffer); },
        });
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
  const bed = context.master.inputs.find(node => node.kind === 'gain');
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
  let ceiling = 0;
  for (let i = 0; i < first.buffers.length; i++) {
    const buffer = first.buffers[i], samples = buffer.getChannelData(0);
    assert.deepEqual(samples, second.buffers[i].getChannelData(0));
    let peak = 0;
    for (const value of samples) {
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
    }
    assert.ok(peak > 0.01 && peak <= 1);
    if (buffer === noiseLoop) continue;
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    ceiling += peak;
  }
  const loudest = mapFlightAudio(1000, 1, 1.6, -80, 0);
  ceiling += loudest.engineGain * (1 + FLIGHT_AUDIO.engine.noiseMix)
    + loudest.afterburnerGain + loudest.windGain + loudest.rushGain;
  const [headroom] = first.master.outputs;
  const [limiter] = headroom.outputs;
  assert.equal(headroom.gain.value, 0.69);
  assert.ok(limiter.curve instanceof Float32Array, 'the mix needs a peak limiter before the destination');
  assert.deepEqual(limiter.outputs, [first.destination]);

  const { curve } = limiter;
  const fullPeak = ceiling * headroom.gain.value;
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
