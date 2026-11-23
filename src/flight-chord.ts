import { ROLL_CHORD_MS } from './data/roll.ts';

export { ROLL_CHORD_MS } from './data/roll.ts';
export type SpaceAction = 'roll' | 'reversal';

export function barrelRollForKey(code: string, turn: number, lastTurn = 1): number | undefined {
  return code === 'KeyC' ? turn || lastTurn : undefined;
}

/** Resolves physical key timing before a single deterministic flight input is queued. */
export class FlightChord {
  private deadline: number | undefined;

  pressSpace(now: number, shiftHeld: boolean): SpaceAction | undefined {
    this.deadline = shiftHeld ? undefined : now + ROLL_CHORD_MS;
    return shiftHeld ? 'roll' : undefined;
  }

  pressShift(now: number): SpaceAction | undefined {
    if (this.deadline === undefined) return;
    const action = now <= this.deadline ? 'roll' : 'reversal';
    this.reset();
    return action;
  }

  flush(now: number): SpaceAction | undefined {
    if (this.deadline === undefined || now < this.deadline) return;
    this.reset();
    return 'reversal';
  }

  reset(): void {
    this.deadline = undefined;
  }
}
