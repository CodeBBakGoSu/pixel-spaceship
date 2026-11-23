import { FLIGHT_AUDIO } from './data/flight-audio.ts';
import { ACE } from './data/ace.ts';
import { FlightAudio, type FlightAudioState, type FlightSound } from './flight-audio.ts';
import { ROSTER_CUE_COOLDOWN, synthesizeRosterCues, type RosterSound } from './roster-audio.ts';
import { loadSfx, SFX_CUE_GAIN, type SfxCue, type SfxSamples } from './sfx-samples.ts';
import { aceDodgeWindow } from './ace.ts';
import type { AceTell, StageState } from './stage-types.ts';

const MUTE_KEY = 'aster-wing.sfx-muted.v1';
const DEFAULT_VOLUME = 0.30;
const CUE_HEADROOM = 0.85;
const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;
const EXPLOSION_VOICES = 4;
const ACE_LOCK_PULSE_TICKS = 12;
const ACE_LOCK_WINDOW_TICKS = 6;
const ACE_LOCK_EFFECTS_DUCK = 0.38;

const COOLDOWN_SECONDS = {
  hit: 0.20, graze: 0.08, warning: 1.5, muzzle: 0.09, roll: 0.21, parry: 0.12, ace_alert: 1.5,
  flyby: FLIGHT_AUDIO.cues.flyby.cooldown, cloud: FLIGHT_AUDIO.cues.cloud.cooldown,
};
type SynthSound = Exclude<keyof typeof COOLDOWN_SECONDS, 'ace_alert'> | RosterSound;
export type CombatSound = SynthSound | 'ace_alert' | 'explosion';
type ExplosionVoice = { source: AudioBufferSourceNode; strength: number };

interface AudioOutput {
  context: AudioContext;
  master: GainNode;
  effects: GainNode;
  buffers: Record<SynthSound, AudioBuffer>;
  aceLockCues: { pulse: AudioBuffer; window: AudioBuffer };
  samples: SfxSamples;
  flight?: FlightAudio;
}

type AceLockVoice = { source: AudioBufferSourceNode; gain: GainNode };

function lockPulseCues(context: AudioContext): AudioOutput['aceLockCues'] {
  const pulse = synthesize(context, 0.04, (elapsed, progress) => {
    const envelope = Math.max(0, Math.min(1, elapsed / 0.004, (1 - progress) / 0.2));
    return 0.42 * Math.sin(TAU * 1_250 * elapsed) * envelope;
  });
  const window = synthesize(context, 0.13, elapsed => {
    const second = elapsed >= 0.065;
    const noteTime = second ? elapsed - 0.065 : elapsed;
    if (!second && elapsed >= 0.05 || second && noteTime >= 0.05) return 0;
    const envelope = Math.max(0, Math.min(1, noteTime / 0.004, (0.05 - noteTime) / 0.008));
    return 0.46 * Math.sin(TAU * (second ? 1_450 : 1_050) * noteTime) * envelope;
  });
  return { pulse, window };
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
  private readonly debugSamples: boolean;
  private detuneSeed = 0x3aa1197b;
  private aceLockKey: string | null = null;
  private aceLockLastTick = -1;
  private aceLockNextPulseTick = -1;
  private aceLockWindowPlayed = false;
  private aceLockVoice: AceLockVoice | undefined;

  constructor(debugSamples = false) {
    this.debugSamples = debugSamples;
  }

  get muted(): boolean { return this.isMuted; }
  get volume(): number { return this.level; }

  setMuted(muted: boolean): void {
    if (this.isMuted === muted) return;
    this.isMuted = muted;
    this.updateGain();
    if (muted) this.stopAceLockVoice();
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
      catch { /* Keep the preference in memory when storage is unavailable. */ }
    }
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.level = Math.max(0, Math.min(1, volume));
    this.updateGain();
    if (this.level === 0) this.stopAceLockVoice();
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
        const effects = context.createGain();
        effects.gain.value = 1;
        effects.connect(master);
        const headroom = context.createGain();
        headroom.gain.value = FLIGHT_AUDIO.mixHeadroom;
        const limiter = context.createWaveShaper();
        limiter.curve = mixLimiterCurve(FLIGHT_AUDIO.mixLimiterKnee);
        master.connect(headroom);
        headroom.connect(limiter);
        limiter.connect(context.destination);
        const samples: SfxSamples = {};
        this.output = { context, master, effects, buffers: synthesizeCues(context), aceLockCues: lockPulseCues(context), samples };
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
    if (suspended) this.stopAceLockVoice();
    const context = this.output?.context;
    if (!context || context.state === 'closed') return;
    // Submit both requests, even if a quick visibility reversal races the state change.
    void (suspended ? context.suspend() : context.resume()).catch(() => {});
  }

  play(sound: CombatSound, strength = 1): void {
    if (this.isMuted || this.level === 0 || this.suspended || !this.output) return;
    const { context, buffers, samples } = this.output;
    if (context.state !== 'running') return;
    const now = context.currentTime;
    const sampleCue = sound === 'tell:missile' ? 'warning' : sound as SfxCue;
    const decoded = samples[sampleCue];
    const voice = decoded && sound === 'tell:missile' ? 'warning' : sound;
    if (now < (this.nextPlayAt[voice] ?? 0)) return;
    const destination = sound === 'flyby' || sound === 'cloud' ? this.output.flight?.bus : this.output.effects;
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
    if (sound === 'explosion') return;
    const cooldown = COOLDOWN_SECONDS[voice as keyof typeof COOLDOWN_SECONDS] ?? ROSTER_CUE_COOLDOWN;
    this.nextPlayAt[voice] = now + (voice === 'graze' || voice === 'hit' ? cooldown : Math.max(cooldown, buffer.duration));
  }

  updateAceLock(state: StageState, active: boolean): void {
    const boss = state.boss;
    const tell = boss?.tell;
    if (!boss || boss.hp <= 0 || boss.entry || boss.defeatedAt != null || state.phase !== 'playing'
      || !tell || tell.kind === 'roll') {
      this.aceLockKey = null;
      this.aceLockNextPulseTick = -1;
      this.aceLockWindowPlayed = false;
      this.aceLockLastTick = state.tick;
      this.stopAceLockVoice();
      return;
    }

    const key = `${boss.id}:${tell.kind}:${tell.since}:${tell.until}`;
    const windowTick = tell.until - ACE.lock.dodgeTicks;
    if (key !== this.aceLockKey) {
      this.stopAceLockVoice();
      this.aceLockKey = key;
      this.aceLockLastTick = tell.since - 1;
      this.aceLockWindowPlayed = aceDodgeWindow(tell, state.tick);
      this.aceLockNextPulseTick = this.aceLockWindowPlayed ? state.tick + ACE_LOCK_WINDOW_TICKS : tell.since;
    }

    const enteredWindow = !this.aceLockWindowPlayed && this.aceLockLastTick < windowTick && state.tick >= windowTick;
    const interval = this.aceLockInterval(tell, state.tick);
    const audible = active && !this.isMuted && this.level > 0 && !this.suspended
      && !!this.output && this.output.context.state === 'running';
    if (enteredWindow) {
      this.aceLockWindowPlayed = true;
      this.aceLockNextPulseTick = state.tick + ACE_LOCK_WINDOW_TICKS + 2;
      if (audible) this.playAceLockCue('window');
      else this.stopAceLockVoice();
    } else if (state.tick >= this.aceLockNextPulseTick) {
      this.aceLockNextPulseTick = state.tick + interval;
      if (audible) this.playAceLockCue('pulse');
      else this.stopAceLockVoice();
    } else if (!audible) this.stopAceLockVoice();

    this.aceLockLastTick = state.tick;
  }

  private aceLockInterval(tell: AceTell, tick: number): number {
    const windowTick = tell.until - ACE.lock.dodgeTicks;
    const span = Math.max(1, windowTick - tell.since);
    const progress = Math.max(0, Math.min(1, (tick - tell.since) / span));
    return Math.round(ACE_LOCK_PULSE_TICKS - (ACE_LOCK_PULSE_TICKS - ACE_LOCK_WINDOW_TICKS) * progress);
  }

  private playAceLockCue(kind: 'pulse' | 'window'): void {
    const output = this.output;
    if (!output || output.context.state !== 'running') return;
    const now = output.context.currentTime;
    const replaced = this.stopAceLockVoice(false);
    const source = output.context.createBufferSource();
    const gain = output.context.createGain();
    const voice: AceLockVoice = { source, gain };
    source.buffer = output.aceLockCues[kind];
    gain.gain.value = kind === 'window' ? 1.35 : 1.15;
    source.connect(gain);
    gain.connect(output.master);
    source.onended = () => {
      if (this.aceLockVoice === voice) {
        this.aceLockVoice = undefined;
        this.restoreEffects(output, output.context.currentTime);
      }
      source.disconnect();
      gain.disconnect();
    };
    output.effects.gain.setTargetAtTime(ACE_LOCK_EFFECTS_DUCK, now, 0.004);
    this.aceLockVoice = voice;
    source.start(now + (replaced ? 0.006 : 0));
  }

  private stopAceLockVoice(restoreEffects = true): boolean {
    const voice = this.aceLockVoice;
    const output = this.output;
    if (!voice || !output) return false;
    this.aceLockVoice = undefined;
    const now = output.context.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, 0.002);
    voice.source.stop(now + 0.006);
    if (restoreEffects) this.restoreEffects(output, now);
    return true;
  }

  private restoreEffects(output: AudioOutput, now: number): void {
    output.effects.gain.setTargetAtTime(1, now, 0.018);
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
