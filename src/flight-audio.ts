import { FLIGHT_AUDIO } from './data/flight-audio.ts';
import { BOOST_IGNITION_SPEED, CRUISE_SPEED } from './flight.ts';
import type { SfxLoop, SfxSamples } from './sfx-samples.ts';
import { STEP } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';

export type FlightAudioState = Pick<StageState, 'tick' | 'phase' | 'paused' | 'player' | 'speed' | 'climbRate' | 'enemies'
  | 'boosting' | 'view'>;
export type FlightSound = keyof typeof FLIGHT_AUDIO.cues;

type FlightAudioParams = {
  engineHz: number;
  engineGain: number;
  afterburnerHz: number;
  afterburnerGain: number;
  windGain: number;
  rushHz: number;
  rushGain: number;
};

const unit = (value: number): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function mapFlightAudio(speed: number, boost: number, bank: number, climbRate: number, clearance: number,
  output?: FlightAudioParams): FlightAudioParams {
  const params = output ?? {
    engineHz: 0, engineGain: 0, afterburnerHz: 0, afterburnerGain: 0, windGain: 0, rushHz: 0, rushGain: 0,
  };
  const { engine, afterburner, wind, rush } = FLIGHT_AUDIO;
  const velocity = unit(speed / BOOST_IGNITION_SPEED);
  const throttle = unit(boost);
  const lean = unit((Math.abs(bank) - rush.bankStart) / (rush.bankFull - rush.bankStart));
  const dive = unit((-climbRate - rush.diveStart) / (rush.diveFull - rush.diveStart));
  const low = unit((rush.lowStart - clearance) / (rush.lowStart - rush.lowFull));
  params.engineHz = engine.idleHz + engine.speedHz * velocity;
  params.engineGain = engine.idleGain + engine.speedGain * velocity;
  params.afterburnerHz = afterburner.cutoffHz + afterburner.boostHz * throttle;
  params.afterburnerGain = afterburner.gain * throttle;
  params.windGain = wind.gain * velocity ** 2;
  params.rushHz = rush.cutoffHz + rush.diveHz * dive + rush.lowHz * low;
  params.rushGain = rush.bankGain * lean + rush.diveGain * dive + rush.lowGain * low;
  return params;
}

export function hasCloseFlyby(state: Pick<FlightAudioState, 'player' | 'speed' | 'enemies'>, ticks: number): boolean {
  if (ticks <= 0) return false;
  const { radius, altitudeWindow, minRelativeSpeed, maxTickGap } = FLIGHT_AUDIO.flyby;
  const elapsed = Math.min(ticks, maxTickGap) * STEP;
  const p = state.player;
  const vx = p.vx ?? Math.sin(p.yaw) * state.speed;
  const vz = p.vz ?? Math.cos(p.yaw) * state.speed;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'turret' || Math.abs(enemy.alt - p.altitude) > altitudeWindow) continue;
    const x = enemy.x - p.x, z = enemy.z - p.z;
    if (x * x + z * z > radius * radius) continue;
    const dx = enemy.vx - vx, dz = enemy.vz - vz;
    const speedSquared = dx * dx + dz * dz;
    if (speedSquared < minRelativeSpeed * minRelativeSpeed) continue;
    // Along the current relative trajectory, closest approach was inside the last rendered interval.
    const opening = x * dx + z * dz;
    if (opening >= 0 && opening <= elapsed * speedSquared) return true;
  }
  return false;
}

function noiseLoop(context: AudioContext): AudioBuffer {
  const { sampleRate, seconds, seed } = FLIGHT_AUDIO.noise;
  const buffer = context.createBuffer(1, Math.round(seconds * sampleRate), sampleRate);
  const samples = buffer.getChannelData(0);
  let noise: number = seed;
  for (let i = 0; i < samples.length; i++) {
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    samples[i] = noise / 0x80000000 - 1;
  }
  return buffer;
}

function layer(context: AudioContext, source: AudioNode, destination: AudioNode, type: BiquadFilterType,
  frequency: number, amplitude: number) {
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = FLIGHT_AUDIO.filterQ;
  const gain = context.createGain();
  gain.gain.value = amplitude;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  return { filter, gain: gain.gain };
}

type LoopVoice = {
  source: AudioBufferSourceNode;
  volume: AudioParam;
  filter?: BiquadFilterNode;
  level: number;
  rate: number;
  cutoff?: number;
};

/** Produces presentation audio from the current flight pose. The flight clock remains independent. */
export class FlightAudio {
  readonly bus: GainNode;
  private readonly context: AudioContext;
  private readonly cue: (sound: FlightSound) => void;
  private readonly samples: SfxSamples;
  private readonly rotor: OscillatorNode;
  private readonly engine: ReturnType<typeof layer>;
  private readonly afterburner: ReturnType<typeof layer>;
  private readonly wind: ReturnType<typeof layer>;
  private readonly rush: ReturnType<typeof layer>;
  private readonly requested = mapFlightAudio(0, 0, 0, 0, Infinity);
  private readonly current = { ...this.requested };
  private engineLoop?: LoopVoice;
  private afterburnerLoop?: LoopVoice;
  private windLoop?: LoopVoice;
  private lastTick: number | undefined;
  private cloudPass = 0;
  private active = false;

  constructor(context: AudioContext, master: GainNode, cue: (sound: FlightSound) => void, samples: SfxSamples) {
    this.context = context;
    this.cue = cue;
    this.samples = samples;
    this.bus = context.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(master);

    // One looping noise source feeds all four filters, plus the engine's pitched oscillator.
    const noise = context.createBufferSource();
    noise.buffer = noiseLoop(context);
    noise.loop = true;
    this.rotor = context.createOscillator();
    this.rotor.type = 'sawtooth';
    const initial = this.current;
    this.rotor.frequency.value = initial.engineHz;
    this.engine = layer(context, this.rotor, this.bus, 'lowpass', FLIGHT_AUDIO.engine.cutoffHz, initial.engineGain);
    const engineNoise = context.createGain();
    engineNoise.gain.value = FLIGHT_AUDIO.engine.noiseMix;
    noise.connect(engineNoise);
    engineNoise.connect(this.engine.filter);
    this.afterburner = layer(context, noise, this.bus, 'lowpass', initial.afterburnerHz, initial.afterburnerGain);
    this.wind = layer(context, noise, this.bus, 'highpass', FLIGHT_AUDIO.wind.cutoffHz, initial.windGain);
    this.rush = layer(context, noise, this.bus, 'bandpass', initial.rushHz, initial.rushGain);
    this.rotor.start();
    noise.start();
  }

  update(state: FlightAudioState, boost: number, clearance: number, cloudPass: number, active: boolean): void {
    const now = this.context.currentTime;
    if (this.active !== active) {
      this.active = active;
      this.bus.gain.setTargetAtTime(active ? 1 : 0, now, active ? FLIGHT_AUDIO.fadeInSeconds : FLIGHT_AUDIO.fadeOutSeconds);
    }
    const previousTick = this.lastTick;
    const cloudChanged = cloudPass > 0 && cloudPass !== this.cloudPass;
    this.lastTick = active ? state.tick : undefined;
    this.cloudPass = cloudPass;
    if (!active) return;

    mapFlightAudio(state.speed, boost, state.player.bank, state.climbRate, clearance, this.requested);
    this.updateSampleBeds(state, now);
    const { minFrequencyChange: hz, minGainChange: gain } = FLIGHT_AUDIO;
    this.glide(this.rotor.frequency, 'engineHz', hz, now);
    this.glide(this.engine.gain, 'engineGain', gain, now);
    this.glide(this.afterburner.filter.frequency, 'afterburnerHz', hz, now);
    this.glide(this.afterburner.gain, 'afterburnerGain', gain, now);
    this.glide(this.wind.gain, 'windGain', gain, now);
    this.glide(this.rush.filter.frequency, 'rushHz', hz, now);
    this.glide(this.rush.gain, 'rushGain', gain, now);

    if (previousTick === undefined || state.tick < previousTick) return;
    if (cloudChanged) this.cue('cloud');
    if (hasCloseFlyby(state, state.tick - previousTick)) this.cue('flyby');
  }

  private createSampleLoop(name: SfxLoop, now: number, cutoff?: number): LoopVoice | undefined {
    const sample = this.samples[name];
    if (!sample?.loop) return;
    const source = this.context.createBufferSource();
    source.buffer = sample.buffer;
    source.loop = true;
    source.loopStart = sample.loop.start;
    source.loopEnd = sample.loop.end;
    let volume: AudioParam, filter: BiquadFilterNode | undefined;
    if (cutoff !== undefined) {
      const signal = layer(this.context, source, this.bus, 'lowpass', cutoff, 0);
      ({ gain: volume, filter } = signal);
    } else {
      const gain = this.context.createGain();
      volume = gain.gain;
      volume.value = 0;
      source.connect(gain);
      gain.connect(this.bus);
    }
    source.start(now, source.loopStart);
    return { source, volume, filter, level: 0, rate: 1, cutoff };
  }

  private updateSampleBeds(state: FlightAudioState, now: number): void {
    const { engine, afterburner, wind } = FLIGHT_AUDIO.samples;
    const velocity = unit(state.speed / BOOST_IGNITION_SPEED);
    const engineLoop = this.engineLoop ??= this.createSampleLoop('engine_loop', now);
    if (engineLoop) {
      const speed = unit((state.speed - CRUISE_SPEED) / (BOOST_IGNITION_SPEED - CRUISE_SPEED));
      const rate = engine.minRate + (engine.maxRate - engine.minRate) * speed;
      if (Math.abs(rate - engineLoop.rate) >= 0.001) {
        engineLoop.rate = rate;
        engineLoop.source.playbackRate.setTargetAtTime(rate, now, FLIGHT_AUDIO.glideSeconds);
      }
      this.loopGain(engineLoop, engine.idleGain + engine.velocityGain * velocity, now);
      this.requested.engineGain = 0;
    }
    const afterburnerLoop = this.afterburnerLoop ??= this.createSampleLoop('afterburner_loop', now);
    if (afterburnerLoop) {
      // An exponential glide reaches about 95% of the new level in three time constants.
      this.loopGain(afterburnerLoop, state.boosting ? afterburner.gain : 0, now, afterburner.fadeSeconds / 3);
      this.requested.afterburnerGain = 0;
    }
    const cutoff = state.view === 'overhead' ? wind.topCutoffHz : wind.cutoffHz;
    const windLoop = this.windLoop ??= this.createSampleLoop('wind_loop', now, cutoff);
    if (windLoop?.filter) {
      const scale = state.view === 'cockpit' ? wind.cockpitScale : state.view === 'overhead' ? wind.topScale : 1;
      this.loopGain(windLoop, wind.gain * velocity ** 2 * scale, now);
      if (cutoff !== windLoop.cutoff) {
        windLoop.cutoff = cutoff;
        windLoop.filter.frequency.setTargetAtTime(cutoff, now, FLIGHT_AUDIO.glideSeconds);
      }
      this.requested.windGain = 0;
    }
  }

  private loopGain(voice: LoopVoice, level: number, now: number, glide: number = FLIGHT_AUDIO.glideSeconds): void {
    const change = Math.abs(level - voice.level);
    if (change === 0 || (change < FLIGHT_AUDIO.minGainChange && level !== 0)) return;
    voice.level = level;
    voice.volume.setTargetAtTime(level, now, glide);
  }

  private glide(param: AudioParam, key: keyof FlightAudioParams, threshold: number, now: number): void {
    const value = this.requested[key];
    const change = Math.abs(value - this.current[key]);
    if (change === 0 || (change < threshold && value !== 0)) return;
    this.current[key] = value;
    param.setTargetAtTime(value, now, FLIGHT_AUDIO.glideSeconds);
  }
}
