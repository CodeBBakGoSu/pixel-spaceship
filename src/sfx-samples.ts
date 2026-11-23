const SAMPLE_PATH = './audio/sfx/';

export const SFX_CUE_GAIN = {
  hit: 0.55, explosion: 1, graze: 0.32, parry: 0.50, roll: 0.44, warning: 0.48, ace_alert: 0.72,
  impact_tick: 0.27, impact_body: 0.24, impact_spark: 0.23,
  cache_single: 0.53, cache_triple: 0.55, cache_jackpot: 0.64, cache_evolution: 0.64,
} as const;
export type SfxCue = keyof typeof SFX_CUE_GAIN;

const LOOPS = ['engine_loop', 'afterburner_loop', 'wind_loop'] as const;
export type SfxLoop = typeof LOOPS[number];
const FILES = [...LOOPS, ...Object.keys(SFX_CUE_GAIN) as SfxCue[]];

type ManifestEntry = { loop: boolean; samples: number; sampleRate: number };
type LoopRange = { start: number; end: number };
type SfxSample = { buffer: AudioBuffer; loop?: LoopRange };
export type SfxSamples = Partial<Record<SfxLoop | SfxCue, SfxSample>>;

function sampleLoopRange(buffer: AudioBuffer, entry: ManifestEntry): LoopRange {
  const duration = entry.samples / entry.sampleRate;
  const pcm = buffer.getChannelData(0);
  const first = pcm.findIndex(value => Math.abs(value) > 1e-4);
  // Gapless decoders can already return the exact source length, at the context's sample rate.
  const contentFrames = Math.round(duration * buffer.sampleRate);
  const maxPad = Math.max(0, buffer.length - contentFrames);
  const start = Math.min(Math.max(0, first), maxPad) / buffer.sampleRate;
  return { start, end: Math.min(buffer.duration, start + duration) };
}

/** Loads each voice independently so a missing file doesn't affect the other cues. */
export async function loadSfx(context: AudioContext, ready: SfxSamples): Promise<void> {
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    console.warn('[audio] Some SFX samples are unavailable. Built-in fallbacks will be used where available.');
  };
  try {
    const response = await fetch(`${SAMPLE_PATH}manifest.json`);
    if (!response.ok) throw new Error('SFX manifest unavailable');
    const manifest = await response.json() as Partial<Record<SfxLoop | SfxCue, ManifestEntry>>;
    await Promise.all(FILES.map(async name => {
      try {
        const entry = manifest[name];
        if (!entry || !Number.isSafeInteger(entry.samples) || entry.samples <= 0
          || !Number.isSafeInteger(entry.sampleRate) || entry.sampleRate <= 0
          || entry.loop !== LOOPS.some(loop => loop === name)) throw new Error('Invalid SFX manifest entry');
        const response = await fetch(`${SAMPLE_PATH}${name}.mp3`);
        if (!response.ok) throw new Error('SFX file unavailable');
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!(buffer.duration > 0)) throw new Error('Empty SFX buffer');
        ready[name] = entry.loop ? { buffer, loop: sampleLoopRange(buffer, entry) } : { buffer };
      } catch {
        warn();
      }
    }));
  } catch {
    warn();
  }
}
