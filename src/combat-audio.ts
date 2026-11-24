import { FLIGHT_AUDIO } from './data/flight-audio.ts';
import { ACE } from './data/ace.ts';
import { FlightAudio, type FlightAudioState, type FlightSound } from './flight-audio.ts';
import { ROSTER_CUE_COOLDOWN, synthesizeRosterCues, type RosterSound } from './roster-audio.ts';
import { loadSfx, SFX_CUE_GAIN, type SfxCue, type SfxSamples } from './sfx-samples.ts';
import type { AceTell, StageState } from './stage-types.ts';

const MUTE_KEY = 'aster-wing.sfx-muted.v1';
const DEFAULT_VOLUME = 0.30;
const CUE_HEADROOM = 0.85;
const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;
const EXPLOSION_VOICES = 4;
const ACE_LOCK_PULSE_TICKS = 12;
const ACE_LOCK_WINDOW_TICKS = 6;
const ACE_LOCK_WINDOW_PULSE_DELAY_TICKS = ACE_LOCK_WINDOW_TICKS + 2;
const ACE_LOCK_TICK_SECONDS = 1 / 60;
const ACE_LOCK_EFFECTS_DUCK = 0.06;
const ACE_LOCK_WINDOW_EFFECTS_DUCK = 0.02;
const ACE_LOCK_PULSE_GAIN = 2.0;
const ACE_LOCK_WINDOW_GAIN = 2.4;
const ACE_LOCK_PULSE_FREQUENCIES = [640, 850, 1125, 1490, 1980] as const;

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
  aceLockCues: { pulses: readonly AudioBuffer[]; window: AudioBuffer };
  samples: SfxSamples;
  flight?: FlightAudio;
}

type AceLockCueKind = 'pulse' | 'window';
type AceLockVoice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  kind: AceLockCueKind;
  startAt: number;
  endAt: number;
};
type AceLockCueEvent = { tick: number; kind: AceLockCueKind; progress: number };

function lockPulseCues(context: AudioContext): AudioOutput['aceLockCues'] {
  const pulses = ACE_LOCK_PULSE_FREQUENCIES.map(frequency => synthesize(context, 0.04, (elapsed, progress) => {
    const envelope = Math.max(0, Math.min(1, elapsed / 0.004, (1 - progress) / 0.2));
    return 0.42 * Math.sin(TAU * frequency * elapsed) * envelope;
  }));
  const window = synthesize(context, 0.13, elapsed => {
    const second = elapsed >= 0.065;
    const noteTime = second ? elapsed - 0.065 : elapsed;
    if (!second && elapsed >= 0.05 || second && noteTime >= 0.05) return 0;
    const envelope = Math.max(0, Math.min(1, noteTime / 0.004, (0.05 - noteTime) / 0.008));
    return 0.46 * Math.sin(TAU * (second ? 2_200 : 1_650) * noteTime) * envelope;
  });
  return { pulses, window };
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
  private aceLockWindowPlayed = false;
  private aceLockWindowScheduled = false;
  private aceLockCueSchedulePending = false;
  private aceLockInitialPulsePending = false;
  private aceLockSuppressedThroughTick = -1;
  private aceLockScheduleAnchorTick = 0;
  private aceLockScheduleAnchorTime = 0;
  private readonly aceLockVoices: AceLockVoice[] = [];
  private aceLockEffectsDucked = false;

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
      this.stopAceLockVoice();
      this.aceLockKey = null;
      this.aceLockWindowPlayed = false;
      this.aceLockWindowScheduled = false;
      this.aceLockCueSchedulePending = false;
      this.aceLockInitialPulsePending = false;
      this.aceLockSuppressedThroughTick = -1;
      return;
    }

    const key = `${boss.id}:${tell.kind}:${tell.since}:${tell.until}`;
    const windowTick = tell.until - ACE.lock.dodgeTicks;
    const audible = active && !this.isMuted && this.level > 0 && !this.suspended
      && !!this.output && this.output.context.state === 'running';
    const keyChanged = key !== this.aceLockKey;
    if (keyChanged) {
      this.stopAceLockVoice(false);
      this.aceLockKey = key;
      this.aceLockWindowPlayed = false;
      this.aceLockWindowScheduled = false;
      this.aceLockCueSchedulePending = true;
      this.aceLockInitialPulsePending = true;
      this.aceLockSuppressedThroughTick = tell.since - 1;
    }

    if (!audible) {
      this.aceLockSuppressedThroughTick = Math.max(this.aceLockSuppressedThroughTick, state.tick);
      this.stopAceLockVoice();
      return;
    }
    this.setAceLockEffectsDuck(true, false, keyChanged);
    const now = this.output?.context.currentTime;
    if (!this.aceLockCueSchedulePending && now !== undefined) {
      const predictedTick = this.aceLockScheduleAnchorTick
        + (now - this.aceLockScheduleAnchorTime) / ACE_LOCK_TICK_SECONDS;
      if (Math.abs(state.tick - predictedTick) > 1.5) {
        this.cancelFutureAceLockCues(now);
        this.setAceLockEffectsDuck(true, false, true);
        this.aceLockCueSchedulePending = true;
      }
    }
    if (this.aceLockCueSchedulePending) this.scheduleAceLockCues(tell, state.tick, windowTick);
  }

  finishAceLockFire(): void {
    this.stopAceLockVoice(false);
    this.setAceLockEffectsDuck(false, true);
  }

  private aceLockInterval(progress: number): number {
    return Math.round(ACE_LOCK_PULSE_TICKS - (ACE_LOCK_PULSE_TICKS - ACE_LOCK_WINDOW_TICKS) * progress);
  }

  private aceLockCueTimeline(tell: AceTell, windowTick: number): AceLockCueEvent[] {
    const cues: AceLockCueEvent[] = [];
    const span = Math.max(1, windowTick - tell.since);
    let tick = tell.since;
    while (tick < windowTick) {
      const progress = Math.max(0, Math.min(1, (tick - tell.since) / span));
      cues.push({ tick, kind: 'pulse', progress });
      tick += this.aceLockInterval(progress);
    }
    cues.push({ tick: windowTick, kind: 'window', progress: 1 });
    for (tick = windowTick + ACE_LOCK_WINDOW_PULSE_DELAY_TICKS; tick <= tell.until; tick += ACE_LOCK_WINDOW_TICKS) {
      cues.push({ tick, kind: 'pulse', progress: 1 });
    }
    return cues;
  }

  private scheduleAceLockCues(tell: AceTell, stateTick: number, windowTick: number): void {
    const output = this.output;
    if (!output) return;
    const now = output.context.currentTime;
    this.aceLockScheduleAnchorTick = stateTick;
    this.aceLockScheduleAnchorTime = now;
    if (stateTick <= tell.until) {
      const windowAt = now + Math.max(0, windowTick - stateTick) * ACE_LOCK_TICK_SECONDS;
      output.effects.gain.setTargetAtTime(ACE_LOCK_WINDOW_EFFECTS_DUCK, windowAt, 0.004);
    }
    let previous = this.aceLockVoices.filter(voice => voice.endAt > now).pop();
    for (const cue of this.aceLockCueTimeline(tell, windowTick)) {
      if (cue.tick <= this.aceLockSuppressedThroughTick) {
        if (cue.kind === 'window') this.aceLockWindowPlayed = true;
        continue;
      }
      const missedInitialPulse = cue.kind === 'pulse' && cue.tick === tell.since
        && this.aceLockInitialPulsePending && stateTick < windowTick;
      if (cue.tick < stateTick && !missedInitialPulse && (cue.kind !== 'window' || stateTick > tell.until)) continue;
      if (cue.kind === 'window' && (this.aceLockWindowPlayed || this.aceLockWindowScheduled)) continue;
      const when = now + Math.max(0, cue.tick - stateTick) * ACE_LOCK_TICK_SECONDS;
      let startAt = when;
      if (previous && previous.endAt > when) {
        previous.gain.gain.setTargetAtTime(0, when, 0.002);
        previous.source.stop(when + 0.006);
        previous.endAt = when + 0.006;
        startAt += 0.006;
      }
      const voice = this.playAceLockCue(cue.kind, cue.progress, startAt);
      if (!voice) continue;
      if (cue.kind === 'window') this.aceLockWindowScheduled = true;
      previous = voice;
    }
    this.aceLockCueSchedulePending = false;
    this.aceLockInitialPulsePending = false;
  }

  private cancelFutureAceLockCues(now: number): void {
    for (let index = this.aceLockVoices.length - 1; index >= 0; index--) {
      const voice = this.aceLockVoices[index];
      if (voice.startAt <= now) continue;
      this.aceLockVoices.splice(index, 1);
      if (voice.kind === 'window') this.aceLockWindowScheduled = false;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.002);
      voice.source.stop(now + 0.006);
    }
  }

  private playAceLockCue(kind: AceLockCueKind, progress: number, startAt: number): AceLockVoice | undefined {
    const output = this.output;
    if (!output || output.context.state !== 'running') return undefined;
    const source = output.context.createBufferSource();
    const gain = output.context.createGain();
    const buffer = kind === 'window'
      ? output.aceLockCues.window
      : output.aceLockCues.pulses[Math.round(progress * (output.aceLockCues.pulses.length - 1))];
    const voice: AceLockVoice = { source, gain, kind, startAt, endAt: startAt + buffer.duration };
    source.buffer = buffer;
    gain.gain.value = kind === 'window' ? ACE_LOCK_WINDOW_GAIN : ACE_LOCK_PULSE_GAIN;
    source.connect(gain);
    gain.connect(output.master);
    source.onended = () => {
      const index = this.aceLockVoices.indexOf(voice);
      if (index >= 0) {
        this.aceLockVoices.splice(index, 1);
        if (voice.kind === 'window') {
          this.aceLockWindowScheduled = false;
          if (output.context.currentTime >= voice.startAt) this.aceLockWindowPlayed = true;
        }
      }
      source.disconnect();
      gain.disconnect();
    };
    this.aceLockVoices.push(voice);
    source.start(startAt);
    return voice;
  }

  private stopAceLockVoice(restoreEffects = true): void {
    const voices = this.aceLockVoices.splice(0);
    const output = this.output;
    this.aceLockCueSchedulePending = true;
    this.aceLockInitialPulsePending = false;
    if (output) {
      const now = output.context.currentTime;
      for (const voice of voices) {
        if (voice.kind === 'window') {
          this.aceLockWindowScheduled = false;
          if (voice.startAt <= now) this.aceLockWindowPlayed = true;
        }
        voice.gain.gain.setTargetAtTime(0, now, 0.002);
        voice.source.stop(now + 0.006);
      }
    }
    if (restoreEffects) this.setAceLockEffectsDuck(false);
  }

  private setAceLockEffectsDuck(ducked: boolean, immediate = false, force = false): void {
    if (this.aceLockEffectsDucked === ducked && !(immediate && !ducked) && !force) return;
    this.aceLockEffectsDucked = ducked;
    const output = this.output;
    if (!output) return;
    const now = output.context.currentTime;
    output.effects.gain.cancelScheduledValues(now);
    if (ducked) output.effects.gain.setTargetAtTime(ACE_LOCK_EFFECTS_DUCK, now, 0.004);
    else if (immediate) {
      output.effects.gain.setValueAtTime(1, now);
    } else this.restoreEffects(output, now);
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
