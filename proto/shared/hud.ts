import type { ViewName } from './sim.ts';

export function mountHud(root: HTMLElement, rendererName: string): {
  set: (info: { fps: number; ms: number; n: number; view: ViewName }) => void;
} {
  const el = document.createElement('div');
  el.id = 'proto-hud';
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10;font:12px/1.4 ui-monospace,monospace;color:#d7efe8;background:rgba(8,12,20,.72);padding:8px 10px;border:1px solid #2a3a4a;pointer-events:none;white-space:pre;';
  root.appendChild(el);
  return {
    set({ fps, ms, n, view }) {
      el.textContent = `${rendererName}\n${view.toUpperCase()}  n=${n}\n${fps.toFixed(1)} fps  ${ms.toFixed(2)} ms\nV cycles view   ?n=500|2000|5000`;
      const prev = window.__protoStats;
      window.__protoStats = { fps, ms, n, view, frames: (prev?.frames ?? 0) + 1, renderer: rendererName };
    },
  };
}

export function bindViewToggle(get: () => ViewName, set: (v: ViewName) => void): void {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV') {
      const order: ViewName[] = ['top', 'chase', 'cockpit'];
      set(order[(order.indexOf(get()) + 1) % 3]);
    }
  });
}
