import { ROLL_CHORD_MS } from './data/roll.ts';

export { ROLL_CHORD_MS } from './data/roll.ts';
export type SpaceAction = 'roll' | 'reversal';
export type TimedAction<T> = { action: T; at: number };

export function simulationStepTime(frameTime: number, carry: number, step: number): number {
  return frameTime - (carry - step) * 1000;
}

export function actionDueAt<T>(pending: TimedAction<T> | undefined, tickTime: number): boolean {
  return pending !== undefined && pending.at <= tickTime;
}

export function takeActionAtTick<T>(pending: TimedAction<T> | undefined, tickTime: number): {
  action: T | undefined;
  pending: TimedAction<T> | undefined;
} {
  if (!pending || pending.at > tickTime) return { action: undefined, pending };
  return { action: pending.action, pending: undefined };
}

export function barrelRollForKey(code: string, turn: number, lastTurn = 1): number | undefined {
  if (code !== 'KeyC') return undefined;
  return Math.sign(turn) || Math.sign(lastTurn) || 1;
}

/** Resolves physical key timing before a single deterministic flight input is queued. */
export class FlightChord {
  private deadline: number | undefined;

  pressSpace(now: number, shiftHeld: boolean): TimedAction<SpaceAction> | undefined {
    this.deadline = shiftHeld ? undefined : now + ROLL_CHORD_MS;
    return shiftHeld ? { action: 'roll', at: now } : undefined;
  }

  pressShift(now: number): TimedAction<SpaceAction> | undefined {
    if (this.deadline === undefined) return;
    const action = now <= this.deadline ? 'roll' : 'reversal';
    this.reset();
    return { action, at: now };
  }

  flush(now: number): TimedAction<SpaceAction> | undefined {
    if (this.deadline === undefined || now < this.deadline) return;
    const at = this.deadline;
    this.reset();
    return { action: 'reversal', at };
  }

  reset(): void {
    this.deadline = undefined;
  }
}
