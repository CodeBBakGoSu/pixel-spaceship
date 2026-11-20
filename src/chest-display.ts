import { CHESTS, EVOLUTIONS } from './data/items.ts';
import { createGearIcon, type GearIconId } from './gear-icons.ts';
import type { createTranslator } from './i18n.ts';
import { chestEvolutions } from './stage.ts';
import type { ChestReward, StageInput, StageState } from './stage-types.ts';

type Translate = ReturnType<typeof createTranslator>;
const REEL_SYMBOLS = ['credits', 'repair', 'set-ballistic', 'chest', 'set-energy', 'bill'] as const;

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

export function createChestDisplay(root: HTMLElement, pick: (action: StageInput['chestPick']) => void) {
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#chest-${id}`)!;
  const heading = find('heading'), detail = find('detail'), kicker = find('kicker');
  const choices = find('choices'), reels = find('reels'), extra = find('extra');
  const action = find<HTMLButtonElement>('action'), skip = find<HTMLButtonElement>('skip');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reward: ChestReward[] | null = null;

  function settle(): void {
    if (!root.classList.replace('rolling', 'settled')) return;
    reels.removeAttribute('aria-busy');
    skip.hidden = true;
    action.hidden = false;
    extra.hidden = extra.childElementCount === 0;
    action.focus({ preventScroll: true });
  }

  action.addEventListener('click', () => pick(reward ? 'continue' : 'open'));
  skip.addEventListener('click', settle);
  reels.addEventListener('animationend', event => {
    if (event.animationName === 'cache-reel-spin' && (event.target as HTMLElement).dataset.lastReel) settle();
  });
  motion.addEventListener('change', event => { if (event.matches) settle(); });

  return {
    update(state: StageState, t: Translate): void {
      const chest = CHESTS.find(chest => chest.id === state.chests.offer);
      const evolving = chest?.kind === 'evolution';
      reward = state.chestReveal;
      const candidates = reward ? [] : chestEvolutions(state);
      const title = reward ? 'chest.rewards' : evolving ? 'chest.evolution' : 'chest.supply';
      heading.replaceChildren(createGearIcon(!chest ? 'bill' : 'chest', 48), document.createTextNode(t(title)));
      kicker.textContent = t(!chest ? 'bill.cache' : evolving ? 'chest.evolution' : 'chest.supply');
      kicker.hidden = !reward;
      detail.textContent = reward ? '' : t(candidates.length ? 'chest.pick' : evolving ? 'chest.fallback' : 'chest.supplyCopy');
      detail.hidden = !!reward;
      choices.replaceChildren(...candidates.map(weapon => {
        const button = document.createElement('button');
        const id = EVOLUTIONS[weapon].id;
        button.type = 'button';
        button.append(createGearIcon(id, 32), document.createTextNode(t(`item.${id}.title`)));
        button.addEventListener('click', () => pick(weapon));
        return button;
      }));
      const rolling = !!reward && !motion.matches;
      root.classList.toggle('rolling', rolling);
      root.classList.toggle('settled', !!reward && !rolling);
      root.classList.toggle('evolution-reveal', !!reward?.some(item => item.kind === 'evolution'));
      reels.hidden = !reward;
      reels.setAttribute('aria-busy', String(rolling));
      reels.replaceChildren(...(reward ? [0, 1, 2].map(i => {
        const item = reward?.[i];
        const reel = document.createElement('li'), strip = document.createElement('div');
        reel.className = item?.kind === 'evolution' ? 'chest-reel evolution' : 'chest-reel';
        strip.className = 'chest-reel-strip';
        strip.style.setProperty('--reel-order', String(i));
        if (i === 2) strip.dataset.lastReel = 'true';
        for (let frame = 0; frame < REEL_SYMBOLS.length; frame++) {
          strip.append(symbolFace(REEL_SYMBOLS[(frame + i * 2) % REEL_SYMBOLS.length], 32));
        }
        strip.append(item ? rewardFace(item, t, 48) : symbolFace('chest', 32));
        reel.append(strip);
        return reel;
      }) : []));
      extra.replaceChildren(...(reward?.slice(3) ?? []).map(item => {
        const li = document.createElement('li');
        li.append(rewardFace(item, t, 32));
        return li;
      }));
      extra.hidden = rolling || extra.childElementCount === 0;
      skip.hidden = !rolling;
      action.hidden = rolling || candidates.length > 0;
      action.textContent = t(reward ? 'chest.continue' : 'chest.open');
      (choices.querySelector('button') ?? (rolling ? skip : action)).focus({ preventScroll: true });
    },
  };
}
