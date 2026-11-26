const HORIZON_LOCK_KEY = 'aster.cockpitHorizonLock';
const SCREEN_SHAKE_KEY = 'aster.screenShake';
const DEFAULT_SCREEN_SHAKE = 50;

export function normalizeScreenShake(value: string | null): number | undefined {
  if (value === null) return undefined;
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : undefined;
}

export function initialScreenShake(storage: Pick<Storage, 'getItem'>, reducedMotion: boolean): number {
  try {
    const stored = normalizeScreenShake(storage.getItem(SCREEN_SHAKE_KEY));
    if (stored !== undefined) return stored;
  } catch { /* In-memory setting. */ }
  return reducedMotion ? 0 : DEFAULT_SCREEN_SHAKE;
}

export function saveScreenShake(percent: number, storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(SCREEN_SHAKE_KEY, String(normalizeScreenShake(String(percent)) ?? DEFAULT_SCREEN_SHAKE)); }
  catch { /* In-memory setting. */ }
}

export function initialCockpitHorizonLock(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(HORIZON_LOCK_KEY) !== '0'; } catch { return true; }
}

export function saveCockpitHorizonLock(enabled: boolean, storage: Pick<Storage, 'setItem'>): void {
  try { storage.setItem(HORIZON_LOCK_KEY, enabled ? '1' : '0'); } catch { /* In-memory setting. */ }
}
