import { FLIGHT_AUDIO } from './data/flight-audio.ts';
import { FlightAudio, type FlightAudioState, type FlightSound } from './flight-audio.ts';

const MUTE_KEY = 'aster-wing.sfx-muted.v1';
const DEFAULT_VOLUME = 0.30;
const CUE_HEADROOM = 0.85;
const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;

const COOLDOWN_SECONDS = {
  hit: 0.20, graze: 0.15, warning: 0.45, muzzle: 0.09, roll: 0.21, parry: 0.12,
  flyby: FLIGHT_AUDIO.cues.flyby.cooldown, cloud: FLIGHT_AUDIO.cues.cloud.cooldown,
};
export type CombatSound = keyof typeof COOLDOWN_SECONDS;

interface AudioOutput {
  context: AudioContext;
  master: GainNode;
  buffers: Record<CombatSound, AudioBuffer>;
  flight?: FlightAudio;
}

function storedMute(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(MUTE_KEY) === '1'; }
  catch { return false; }
}

function attackDecay(elapsed: number, progress: number, attack: number): number {
  const tail = 1 - progress;
  return Math.min(1, elapsed / attack) * tail * tail;
}

function synthesize(
  context: AudioContext,
  seconds: number,
  sample: (elapsed: number, progress: number) => number,
): AudioBuffer {
  const buffer = context.createBuffer(1, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = CUE_HEADROOM * sample(i / SAMPLE_RATE, i / (data.length - 1));
  return buffer;
}

function synthesizeWhoosh(context: AudioContext, sound: FlightSound): AudioBuffer {
  const { seconds, attack, filter, sweep, gain, seed } = FLIGHT_AUDIO.cues[sound];
  let noiseSeed: number = seed;
  let lowPass = 0;
  return synthesize(context, seconds, (elapsed, progress) => {
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
    const noise = noiseSeed / 0x80000000 - 1;
    lowPass += (filter + sweep * (1 - progress)) * (noise - lowPass);
    return gain * lowPass * attackDecay(elapsed, progress, attack);
  });
}

function synthesizeCues(context: AudioContext): AudioOutput['buffers'] {
  // The cue generator has its own noise and filter state.
  let noiseSeed = 0x5fe4a91b;
  let lowPass = 0;
  let bass = 0;
  return {
    hit: synthesize(context, 0.18, (elapsed, progress) => {
      const phase = TAU * elapsed * (120 - 36 * progress);
      const tone = 0.40 * Math.sin(phase) + 0.10 * Math.sin(2 * phase);
      return tone * attackDecay(elapsed, progress, 0.004);
    }),
    graze: synthesize(context, 0.135, (elapsed, progress) => {
      noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
      const noise = noiseSeed / 0x80000000 - 1;
      lowPass += (0.10 + 0.37 * (1 - progress)) * (noise - lowPass);
      bass += 0.035 * (lowPass - bass);
      return 0.45 * (lowPass - bass) * attackDecay(elapsed, progress, 0.024);
    }),
    warning: synthesize(context, 0.15, elapsed => {
      const second = elapsed >= 0.082;
      const pulseTime = second ? elapsed - 0.082 : elapsed;
      const frequency = second ? 860 : 680;
      const envelope = Math.max(0, Math.min(1, pulseTime / 0.004, (0.056 - pulseTime) / 0.012));
      return 0.22 * Math.sin(TAU * frequency * pulseTime) * envelope;
    }),
    muzzle: synthesize(context, 0.025, (elapsed, progress) => {
      const phase = TAU * elapsed * (1600 - 500 * progress);
      return 0.05 * Math.sin(phase) * attackDecay(elapsed, progress, 0.0015);
    }),
    roll: synthesize(context, 0.195, (elapsed, progress) => {
      noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
      const noise = noiseSeed / 0x80000000 - 1;
      lowPass += (0.13 + Math.sin(progress * Math.PI) * 0.34) * (noise - lowPass);
      return 0.135 * lowPass * attackDecay(elapsed, progress, 0.043);
    }),
    parry: synthesize(context, 0.115, (elapsed, progress) => {
      const tone = Math.sin(TAU * 760 * elapsed) + 0.51 * Math.sin(TAU * 1340 * elapsed);
      return 0.073 * tone * attackDecay(elapsed, progress, 0.002);
    }),
    flyby: synthesizeWhoosh(context, 'flyby'),
    cloud: synthesizeWhoosh(context, 'cloud'),
  };
}

export class CombatAudio {
  private output: AudioOutput | undefined;
  private isMuted = storedMute();
  private level = DEFAULT_VOLUME;
  private readonly nextPlayAt: Partial<Record<CombatSound, number>> = {};

  get muted(): boolean { return this.isMuted; }
  get volume(): number { return this.level; }

  setMuted(muted: boolean): void {
    if (this.isMuted === muted) return;
    this.isMuted = muted;
    this.updateGain();
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
      catch { /* Keep the preference in memory when storage is unavailable. */ }
    }
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.level = Math.max(0, Math.min(1, volume));
    this.updateGain();
  }

  // Call synchronously from a user gesture so browsers can allow playback.
  unlock(event: Event): void {
    if (!event.isTrusted || typeof window === 'undefined') return;
    if (window.navigator?.userActivation?.hasBeenActive === false) return;
    let context = this.output?.context;
    if (!context) {
      const Context = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      try {
        context = new Context();
        const master = context.createGain();
        master.gain.value = this.isMuted ? 0 : this.level;
        const headroom = context.createGain();
        headroom.gain.value = FLIGHT_AUDIO.mixHeadroom;
        master.connect(headroom);
        headroom.connect(context.destination);
        this.output = { context, master, buffers: synthesizeCues(context) };
      } catch {
        void context?.close().catch(() => {});
        return;
      }
    }
    if (context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch(() => {});
    }
  }

  play(sound: CombatSound): void {
    if (this.isMuted || this.level === 0 || !this.output) return;
    const { context, master, buffers } = this.output;
    if (context.state !== 'running') return;
    const now = context.currentTime;
    if (now < (this.nextPlayAt[sound] ?? 0)) return;
    const destination = sound === 'flyby' || sound === 'cloud' ? this.output.flight?.bus : master;
    if (!destination) return;

    const buffer = buffers[sound];
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    source.start(now);
    // Each cue gets one voice, so frequent muzzle ticks cannot crowd out the hit or warning.
    this.nextPlayAt[sound] = now + Math.max(COOLDOWN_SECONDS[sound], buffer.duration);
  }

  updateFlight(state: FlightAudioState, boostAmount: number, clearance: number, cloudPass: number, active: boolean): void {
    const output = this.output;
    if (!output) return;
    const audible = active && state.phase === 'playing' && !state.paused && !this.isMuted && this.level > 0
      && output.context.state === 'running';
    if (audible && !output.flight) output.flight = new FlightAudio(output.context, output.master, this.play.bind(this));
    output.flight?.update(state, boostAmount, clearance, cloudPass, audible);
  }

  private updateGain(): void {
    const output = this.output;
    if (output) output.master.gain.setTargetAtTime(this.isMuted ? 0 : this.level, output.context.currentTime, 0.006);
  }
}
