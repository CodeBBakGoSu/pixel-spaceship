import { createGearIcon, type GearIconId } from './gear-icons.ts';
import { createTranslator, type Language } from './i18n.ts';
import { buildSlotHudModel } from './loadout-model.ts';
import type { StageState } from './stage-types.ts';

function iconItem(icon: GearIconId, name: string, detail?: string, evolved = false): HTMLLIElement {
  const item = document.createElement('li');
  item.className = evolved ? 'summary-gear evolved' : 'summary-gear';
  const text = document.createElement('div'), title = document.createElement('strong');
  title.textContent = name;
  text.append(title);
  if (detail) {
    const caption = document.createElement('small');
    caption.textContent = detail;
    text.append(caption);
  }
  item.append(createGearIcon(icon, 32), text);
  return item;
}

function summarySection(title: string, items: HTMLElement[], empty: string, className = ''): HTMLElement {
  const section = document.createElement('section'), heading = document.createElement('h2');
  section.className = className;
  heading.textContent = title;
  section.append(heading);
  if (items.length) {
    const list = document.createElement('ul');
    list.className = 'summary-loadout';
    list.append(...items);
    section.append(list);
  } else {
    const notice = document.createElement('p');
    notice.textContent = empty;
    section.append(notice);
  }
  return section;
}

export function renderRunSummary(panel: HTMLElement, state: StageState, language: Language, time: string): void {
  const { run, summary } = state;
  if (!run || !summary) return;
  const t = createTranslator(language), model = buildSlotHudModel(run, language);
  const stats = document.createElement('dl');
  stats.className = 'summary-stats';
  const values = {
    time, kills: state.kills, level: state.level, bills: `${state.bills.paid}/${state.bills.offered}`,
  };
  for (const key of ['time', 'kills', 'level', 'bills'] as const) {
    const cell = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
    label.textContent = t(`menu.summary.${key}`);
    value.textContent = String(values[key]);
    cell.append(label, value);
    stats.append(cell);
  }
  const loadout = (slots: typeof model.weapons) => slots.flatMap(slot => {
    if (slot.kind !== 'equipped') return [];
    const level = t('chest.level', { level: slot.level });
    const detail = slot.evolved ? `${level} · ${t('chest.evolved')}` : level;
    return [iconItem(slot.icon, slot.name, detail, slot.evolved)];
  });
  const bonuses = model.families.filter(family => family.active).map(family => iconItem(family.icon, family.name, family.bonus));
  const unlocks = summary.unlocked.map(id => iconItem(id, t(`item.${id}.title`)));
  const reward = document.createElement('p');
  reward.className = 'summary-credits';
  reward.textContent = [
    t('menu.summary.credits', { credits: summary.credits }),
    state.daily ? t('menu.summary.daily', { seed: state.seed }) : '',
    summary.aceCache ? t('menu.summary.ace') : '',
  ].filter(Boolean).join(' · ');
  const empty = t('menu.summary.none');
  panel.replaceChildren(stats, reward,
    summarySection(t('menu.summary.weapons'), loadout(model.weapons), empty),
    summarySection(t('menu.summary.buffs'), loadout(model.buffs), empty),
    summarySection(t('menu.summary.sets'), bonuses, empty),
    summarySection(t('menu.summary.unlocks'), unlocks, empty, 'summary-unlocks'),
  );
}
