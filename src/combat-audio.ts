import { FLIGHT_AUDIO } from './data/flight-audio.ts';
import { FlightAudio, type FlightAudioState, type FlightSound } from './flight-audio.ts';
import { IMPACT_LAYERS, type ImpactCue } from './impact-audio.ts';
import { ROSTER_CUE_COOLDOWN, synthesizeRosterCues, type RosterSound } from './roster-audio.ts';
import { loadSfx, SFX_CUE_GAIN, type SfxCue, type SfxSamples } from './sfx-samples.ts';

const MUTE_KEY = 'aster-wing.sfx-muted.v1';
const DEFAULT_VOLUME = 0.30;
const CUE_HEADROOM = 0.85;
const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;
const EXPLOSION_VOICES = 4;

const COOLDOWN_SECONDS = {
  hit: 0.20, graze: 0.08, warning: 1.5, muzzle: 0.09, roll: 0.21, parry: 0.12, ace_alert: 1.5,
  flyby: FLIGHT_AUDIO.cues.flyby.cooldown, cloud: FLIGHT_AUDIO.cues.cloud.cooldown,
};
type SynthSound = Exclude<keyof typeof COOLDOWN_SECONDS, 'ace_alert'> | RosterSound;
export type CombatSound = SynthSound | 'ace_alert' | 'explosion';
type ExplosionVoice = { source: AudioBufferSourceNode; strength: number };
export type CacheCue = Extract<SfxCue, `cache_${string}`>;

interface AudioOutput {
  context: AudioContext;
  master: GainNode;
  rewards: GainNode;
  buffers: Record<SynthSound, AudioBuffer>;
  samples: SfxSamples;
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
    ...synthesizeRosterCues(context, synthesize),
  };
}

function mixLimiterCurve(knee: number) {
  // The odd sample count places a curve point at silence.
  const curve = new Float32Array(1025);
  const span = 1 - knee;
  for (let i = 0; i < curve.length; i++) {
    const input = 2 * i / (curve.length - 1) - 1;
    const magnitude = Math.abs(input);
    const aboveKnee = Math.max(0, magnitude - knee) / span;
    // Keep unity below the knee and ease the slope to zero at the ends of the curve.
    curve[i] = Math.sign(input) * (magnitude - span * aboveKnee ** 5 / 5);
  }
  return curve;
}

export class CombatAudio {
  private output: AudioOutput | undefined;
  private suspended = false;
  private isMuted = storedMute();
  private level = DEFAULT_VOLUME;
  private readonly nextPlayAt: Partial<Record<CombatSound, number>> = {};
  private readonly explosions: ExplosionVoice[] = [];
  private readonly impactVoices: Partial<Record<ImpactCue, AudioBufferSourceNode>> = {};
  private cacheVoice: AudioBufferSourceNode | undefined;
  private warningUntil = 0;
  private readonly debugSamples: boolean;
  private detuneSeed = 0x3aa1197b;

  constructor(debugSamples = false) {
    this.debugSamples = debugSamples;
  }

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
    if (!event.isTrusted || typeof window === 'undefined' || this.suspended) return;
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
        const rewards = context.createGain();
        rewards.connect(master);
        const headroom = context.createGain();
        headroom.gain.value = FLIGHT_AUDIO.mixHeadroom;
        const limiter = context.createWaveShaper();
        limiter.curve = mixLimiterCurve(FLIGHT_AUDIO.mixLimiterKnee);
        master.connect(headroom);
        headroom.connect(limiter);
        limiter.connect(context.destination);
        const samples: SfxSamples = {};
        this.output = { context, master, rewards, buffers: synthesizeCues(context), samples };
        if (typeof context.decodeAudioData === 'function') {
          void loadSfx(context, samples).then(() => {
            if (this.debugSamples) console.info('[audio] Decoded SFX', Object.keys(samples).sort().join(', '));
          });
        }
      } catch {
        void context?.close().catch(() => {});
        return;
      }
    }
    if (context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch(() => {});
    }
  }

  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    const context = this.output?.context;
    if (!context || context.state === 'closed') return;
    // Submit both requests, even if a quick visibility reversal races the state change.
    void (suspended ? context.suspend() : context.resume()).catch(() => {});
  }

  play(sound: CombatSound, strength = 1): void {
    if (this.isMuted || this.level === 0 || this.suspended || !this.output) return;
    const { context, master, buffers, samples } = this.output;
    if (context.state !== 'running') return;
    const now = context.currentTime;
    const sampleCue = sound === 'tell:missile' ? 'warning' : sound as SfxCue;
    const decoded = samples[sampleCue];
    const voice = decoded && sound === 'tell:missile' ? 'warning' : sound;
    if (now < (this.nextPlayAt[voice] ?? 0)) return;
    const destination = sound === 'flyby' || sound === 'cloud' ? this.output.flight?.bus : master;
    if (!destination) return;

    if (sound === 'explosion' && this.explosions.length === EXPLOSION_VOICES) {
      let quietest = 0;
      for (let i = 1; i < this.explosions.length; i++) {
        if (this.explosions[i].strength < this.explosions[quietest].strength) quietest = i;
      }
      if (strength <= this.explosions[quietest].strength) return;
      const [replaced] = this.explosions.splice(quietest, 1);
      replaced.source.stop(now);
    }

    const fallback = sound === 'explosion' ? buffers.hit : sound === 'ace_alert' ? buffers.warning : buffers[sound];
    const buffer = decoded?.buffer ?? fallback;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = decoded || sound === 'explosion' ? context.createGain() : undefined;
    if (gain) {
      gain.gain.value = (decoded ? SFX_CUE_GAIN[sampleCue] : 1) * strength;
      source.connect(gain);
      gain.connect(destination);
    } else source.connect(destination);

    if (sound === 'explosion') {
      // This generator belongs exclusively to the audio mixer.
      this.detuneSeed = (Math.imul(this.detuneSeed, 1664525) + 1013904223) >>> 0;
      source.detune.value = (this.detuneSeed / 0x1_0000_0000 - 0.5) * 160;
      this.explosions.push({ source, strength });
    }
    source.onended = () => {
      if (sound === 'explosion') {
        const index = this.explosions.findIndex(voice => voice.source === source);
        if (index >= 0) this.explosions.splice(index, 1);
      }
      source.disconnect();
      gain?.disconnect();
    };
    source.start(now);
    if (sound === 'warning' || sound === 'ace_alert' || (sound.startsWith('tell:') && sound !== 'tell:ace-down')) {
      this.warningUntil = Math.max(this.warningUntil, now + buffer.duration);
      const rewardGain = this.output.rewards.gain;
      rewardGain.cancelScheduledValues(now);
      rewardGain.setTargetAtTime(0.29, now, 0.012);
      rewardGain.setTargetAtTime(1, this.warningUntil, 0.06);
    }
    if (sound === 'explosion') return;
    const cooldown = COOLDOWN_SECONDS[voice as keyof typeof COOLDOWN_SECONDS] ?? ROSTER_CUE_COOLDOWN;
    this.nextPlayAt[voice] = now + (voice === 'graze' || voice === 'hit' ? cooldown : Math.max(cooldown, buffer.duration));
  }

  playImpacts(layers: number): void {
    for (const [i, cue] of IMPACT_LAYERS.entries()) {
      if (!(layers & (1 << i))) continue;
      const source = this.playReward(cue, this.impactVoices[cue], () => {
        if (this.impactVoices[cue] === source) delete this.impactVoices[cue];
      });
      if (source) this.impactVoices[cue] = source;
    }
  }

  playCache(cue: CacheCue): void {
    this.stopCache();
    const source = this.playReward(cue, undefined, () => {
      if (this.cacheVoice === source) this.cacheVoice = undefined;
    });
    this.cacheVoice = source;
  }

  stopCache(): void {
    this.cacheVoice?.stop();
    this.cacheVoice = undefined;
  }

  private playReward(cue: ImpactCue | CacheCue, previous: AudioBufferSourceNode | undefined,
    ended: () => void): AudioBufferSourceNode | undefined {
    const output = this.output;
    if (!output || this.isMuted || this.level === 0 || this.suspended || output.context.state !== 'running') return;
    const buffer = output.samples[cue]?.buffer;
    if (!buffer) return;
    previous?.stop();
    const source = output.context.createBufferSource();
    const gain = output.context.createGain();
    gain.gain.value = SFX_CUE_GAIN[cue];
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(output.rewards);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      ended();
    };
    source.start();
    return source;
  }

  updateFlight(state: FlightAudioState, boostAmount: number, clearance: number, cloudPass: number, active: boolean): void {
    const output = this.output;
    if (!output) return;
    const audible = active && state.phase === 'playing' && !state.paused && !this.isMuted && this.level > 0 && !this.suspended
      && output.context.state === 'running';
    if (audible && !output.flight) output.flight = new FlightAudio(output.context, output.master, this.play.bind(this), output.samples);
    output.flight?.update(state, boostAmount, clearance, cloudPass, audible);
  }

  private updateGain(): void {
    const output = this.output;
    if (output) output.master.gain.setTargetAtTime(this.isMuted ? 0 : this.level, output.context.currentTime, 0.006);
  }
}
