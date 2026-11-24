export function stageRenderTick(state: { tick: number; pendingFinish?: { settlementTick: number } }): number {
  return state.pendingFinish?.settlementTick ?? state.tick;
}
