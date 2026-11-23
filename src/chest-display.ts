import type { CacheCue } from './combat-audio.ts';
import { CHESTS, EVOLUTIONS } from './data/items.ts';
import { createGearIcon, type GearIconId } from './gear-icons.ts';
import type { createTranslator } from './i18n.ts';
import { chestEvolutions } from './stage.ts';
import type { ChestReward, StageInput, StageState } from './stage-types.ts';

type Translate = ReturnType<typeof createTranslator>;
const REEL_SYMBOLS = ['credits', 'repair', 'set-ballistic', 'chest', 'set-energy', 'bill'] as const;

const REVEALS = {
  single: { ms: 320, cue: 'cache_single' },
  triple: { ms: 540, cue: 'cache_triple' },
  jackpot: { ms: 940, cue: 'cache_jackpot' },
  evolution: { ms: 960, cue: 'cache_evolution' },
} as const;

export function chestPresentation(rewards: readonly ChestReward[], carrier: boolean): keyof typeof REVEALS | 'summary' {
  if (!carrier) return 'summary';
  if (rewards.some(item => item.kind === 'evolution')) return 'evolution';
  return rewards.length === 5 ? 'jackpot' : rewards.length === 3 ? 'triple' : rewards.length === 1 ? 'single' : 'summary';
}

function rewardFace(item: ChestReward, t: Translate, size: number): HTMLElement {
  const face = document.createElement('div');
  face.className = 'chest-reel-label';
  const title = document.createElement('strong');
  title.textContent = t(`item.${item.id}.title`);
  const level = document.createElement('small');
  level.textContent = item.kind === 'evolution' ? t('chest.evolved') : item.level ? t('chest.level', { level: item.level }) : '';
  level.hidden = !level.textContent;
  face.append(createGearIcon(item.id, size), title, level);
  return face;
}

function symbolFace(id: GearIconId, size: number): HTMLElement {
  const face = document.createElement('span');
  face.className = 'chest-reel-symbol';
  face.setAttribute('aria-hidden', 'true');
  face.append(createGearIcon(id, size));
  return face;
}

export function createChestDisplay(root: HTMLElement, pick: (action: StageInput['chestPick']) => void, effects: {
  enabled: boolean;
  play(cue: CacheCue): void;
  stop(): void;
}) {
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#chest-${id}`)!;
  const heading = find('heading'), detail = find('detail'), kicker = find('kicker');
  const choices = find('choices'), reels = find('reels'), extra = find('extra');
  const action = find<HTMLButtonElement>('action'), skip = find<HTMLButtonElement>('skip');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reward: ChestReward[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function settle(interrupted = false): void {
    if (!root.classList.replace('rolling', 'settled')) return;
    clearTimeout(timer);
    if (interrupted) effects.stop();
    reels.removeAttribute('aria-busy');
    skip.hidden = true;
    action.hidden = false;
    extra.hidden = extra.childElementCount === 0;
    action.focus({ preventScroll: true });
  }

  action.addEventListener('click', () => {
    if (action.hidden) return;
    effects.stop();
    pick(reward ? 'continue' : 'open');
  });
  skip.addEventListener('click', () => settle(true));
  motion.addEventListener('change', event => { if (event.matches) settle(true); });

  return {
    close(): void {
      clearTimeout(timer);
      root.classList.remove('rolling');
      if (reward) effects.stop();
      reward = null;
    },
    update(state: StageState, t: Translate): void {
      clearTimeout(timer);
      const chest = CHESTS.find(chest => chest.id === state.chests.offer);
      const evolving = chest?.kind === 'evolution';
      const fresh = reward !== state.chestReveal;
      reward = state.chestReveal;
      const candidates = reward ? [] : chestEvolutions(state);
      const presentation = reward ? chestPresentation(reward, !!chest) : 'summary';
      const reveal = presentation === 'summary' ? undefined : REVEALS[presentation];
      const evolution = reward?.find(item => item.kind === 'evolution');
      const base = evolution && (Object.keys(EVOLUTIONS) as (keyof typeof EVOLUTIONS)[]).find(id => EVOLUTIONS[id].id === evolution.id);
      const title = reward ? 'chest.rewards' : evolving ? 'chest.evolution' : 'chest.supply';
      heading.replaceChildren(createGearIcon(!chest ? 'bill' : 'chest', 48), document.createTextNode(t(title)));
      kicker.textContent = presentation === 'jackpot' ? t('chest.jackpot')
        : t(!chest ? 'bill.cache' : presentation === 'evolution' ? 'chest.evolution' : 'chest.supply');
      kicker.hidden = !reward;
      detail.textContent = reward ? reward.length ? '' : t('chest.noUpgrades')
        : t(candidates.length ? 'chest.pick' : evolving ? 'chest.fallback' : 'chest.supplyCopy');
      detail.hidden = !detail.textContent;
      choices.replaceChildren(...candidates.map(weapon => {
        const button = document.createElement('button');
        const id = EVOLUTIONS[weapon].id;
        button.type = 'button';
        button.append(createGearIcon(id, 32), document.createTextNode(t(`item.${id}.title`)));
        button.addEventListener('click', () => pick(weapon));
        return button;
      }));
      const rolling = !!reveal && fresh && effects.enabled && !motion.matches;
      root.classList.toggle('rolling', rolling);
      root.classList.toggle('settled', !!reward && !rolling);
      root.dataset.reveal = presentation;
      const main = reward?.slice(0, evolution ? 1 : 3) ?? [];
      reels.hidden = main.length === 0;
      reels.style.setProperty('--reel-count', String(main.length));
      if (rolling) reels.setAttribute('aria-busy', 'true');
      else reels.removeAttribute('aria-busy');
      reels.replaceChildren(...main.map((item, i) => {
        const reel = document.createElement('li'), strip = document.createElement('div');
        reel.className = item.kind === 'evolution' ? 'chest-reel evolution' : 'chest-reel';
        strip.className = 'chest-reel-strip';
        strip.style.setProperty('--reel-order', String(i));
        if (rolling) {
          for (let frame = 0; frame < REEL_SYMBOLS.length; frame++) {
            strip.append(symbolFace(base ?? REEL_SYMBOLS[(frame + i * 2) % REEL_SYMBOLS.length], base ? 48 : 32));
          }
          strip.style.setProperty('--reel-frames', String(REEL_SYMBOLS.length));
        }
        strip.append(rewardFace(item, t, 48));
        reel.append(strip);
        return reel;
      }));
      extra.replaceChildren(...(reward?.slice(main.length) ?? []).map(item => {
        const li = document.createElement('li');
        li.append(rewardFace(item, t, 32));
        return li;
      }));
      extra.hidden = rolling || extra.childElementCount === 0;
      skip.hidden = !rolling;
      action.hidden = rolling || candidates.length > 0;
      action.textContent = t(reward ? 'chest.continue' : 'chest.open');
      if (reveal && fresh && effects.enabled) effects.play(reveal.cue);
      if (rolling) timer = setTimeout(settle, reveal.ms);
      (choices.querySelector('button') ?? (rolling ? skip : action)).focus({ preventScroll: true });
    },
  };
}
