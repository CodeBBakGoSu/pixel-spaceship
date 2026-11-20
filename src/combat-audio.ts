const MUTE_KEY = 'aster-wing.sfx-muted.v1';
const DEFAULT_VOLUME = 0.30;
const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;

const COOLDOWN_SECONDS = { hit: 0.20, graze: 0.15, warning: 0.45, muzzle: 0.09 };
export type CombatSound = keyof typeof COOLDOWN_SECONDS;

interface AudioOutput {
  context: AudioContext;
  master: GainNode;
  buffers: Record<CombatSound, AudioBuffer>;
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
  for (let i = 0; i < data.length; i++) data[i] = sample(i / SAMPLE_RATE, i / (data.length - 1));
  return buffer;
}

function synthesizeCues(context: AudioContext): AudioOutput['buffers'] {
  // Only the graze buffer uses noise. This generator belongs to the synth alone.
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
  };
}

export class CombatAudio {
  private output: AudioOutput | undefined;
  private isMuted = storedMute();
  private level = DEFAULT_VOLUME;
  private readonly nextPlayAt: Record<CombatSound, number> = { hit: 0, graze: 0, warning: 0, muzzle: 0 };

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
        master.connect(context.destination);
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
    if (now < this.nextPlayAt[sound]) return;

    const buffer = buffers[sound];
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start(now);
    // Each cue gets one voice, so frequent muzzle ticks cannot crowd out the hit or warning.
    this.nextPlayAt[sound] = now + Math.max(COOLDOWN_SECONDS[sound], buffer.duration);
  }

  private updateGain(): void {
    const output = this.output;
    if (output) output.master.gain.setTargetAtTime(this.isMuted ? 0 : this.level, output.context.currentTime, 0.006);
  }
}
