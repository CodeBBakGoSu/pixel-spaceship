import type { StageState } from './stage-types.ts';

type PauseState = Pick<StageState, 'phase' | 'paused'>;
type GraphicsStatus = 'ready' | 'lost' | 'restoring';

export class GraphicsRecovery {
  private phase: GraphicsStatus = 'ready';
  private ownsPause = false;

  get status(): GraphicsStatus { return this.phase; }
  get recovering(): boolean { return this.phase !== 'ready'; }
  get canAdvance(): boolean { return !this.recovering && !this.ownsPause; }

  lose(): boolean {
    if (this.phase === 'lost') return false;
    this.phase = 'lost';
    return true;
  }

  restore(): boolean {
    if (this.phase !== 'lost') return false;
    this.phase = 'restoring';
    return true;
  }

  frameReady(): boolean {
    if (this.phase !== 'restoring') return false;
    this.phase = 'ready';
    return true;
  }

  pauseFlight(state: PauseState): boolean {
    if (!this.recovering || state.phase !== 'playing' || state.paused) return false;
    // A graphics interruption suspends the current input stream, including boost.
    this.ownsPause = true;
    state.paused = true;
    return true;
  }

  resumeFlight(state: PauseState): boolean {
    if (this.recovering || !this.ownsPause) return false;
    this.ownsPause = false;
    state.paused = false;
    return true;
  }
}
