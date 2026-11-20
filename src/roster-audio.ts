import type { CombatTell } from './hostile-events.ts';

export type RosterSound = `tell:${CombatTell}`;

// Duration in seconds, start/end frequency in Hz, pulse count, amplitude.
const TONES = {
  snipe: [0.34, 470, 1110, 1, 0.16],
  flak: [0.33, 283, 220, 2, 0.17],
  dive: [0.27, 690, 265, 1, 0.12],
  tail: [0.27, 625, 449, 2, 0.18],
  strafe: [0.24, 460, 615, 2, 0.10],
  mine: [0.23, 320, 215, 3, 0.12],
  aegis: [0.21, 755, 552, 1, 0.11],
  carrier: [0.30, 355, 505, 2, 0.10],
  gnat: [0.19, 290, 315, 3, 0.09],
  gun: [0.23, 465, 734, 2, 0.15],
  missile: [0.36, 1120, 864, 3, 0.20],
  roll: [0.22, 574, 244, 1, 0.11],
  'ace-down': [0.45, 490, 169, 2, 0.18],
} as const satisfies Record<CombatTell, readonly [number, number, number, number, number]>;

const TAU = Math.PI * 2;
export const ROSTER_CUE_COOLDOWN = 0.48;

type Synth = (context: AudioContext, seconds: number, sample: (elapsed: number, progress: number) => number) => AudioBuffer;

export function synthesizeRosterCues(context: AudioContext, synthesize: Synth): Record<RosterSound, AudioBuffer> {
  const cues = {} as Record<RosterSound, AudioBuffer>;
  for (const kind of Object.keys(TONES) as CombatTell[]) {
    const [duration, from, to, pulses, gain] = TONES[kind];
    cues[`tell:${kind}`] = synthesize(context, duration, (elapsed, progress) => {
      const cycle = (progress * pulses) % 1;
      const edge = Math.min(1, cycle * 30, (1 - cycle) * 14);
      const envelope = edge * (1 - cycle) * (1 - progress * 0.38);
      const phase = TAU * elapsed * (from + (to - from) * progress / 2);
      return gain * envelope * (Math.sin(phase) + 0.23 * Math.sin(2 * phase));
    });
  }
  return cues;
}
