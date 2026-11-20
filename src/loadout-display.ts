import './loadout-display.css';
import { createGearIcon } from './gear-icons.ts';
import { createTranslator, type Language } from './i18n.ts';
import { buildDraftCardModel, buildSlotHudModel, levelPips, type DraftCardModel, type LevelPip, type SlotModel } from './loadout-model.ts';
import type { DraftCard, RunProgression } from './progression.ts';
import type { LegacyDraftId, StageState } from './stage-types.ts';

const legacyLevels = { 'twin-2': [1, 2], 'twin-3': [2, 3], 'pods-2': [1, 2] } as const;
const renderedLoadouts = new WeakMap<HTMLElement, { key: string; language: Language }>();

function span(className: string, label?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  if (label) element.textContent = label;
  return element;
}

function renderPips(pips: readonly LevelPip[]): HTMLElement {
  const row = span('gear-level-pips');
  row.setAttribute('aria-hidden', 'true');
  for (const pip of pips) row.append(span(`gear-level-pip gear-level-${pip}`));
  return row;
}

function legacyCard(id: LegacyDraftId, language: Language): DraftCardModel {
  const t = createTranslator(language);
  const level = id in legacyLevels ? legacyLevels[id as keyof typeof legacyLevels] : undefined;
  return {
    icon: id.startsWith('twin') ? 'twin' : 'pods', name: t(`draft.${id}.title`),
    effect: t(`draft.${id}.copy`), description: t(`draft.${id}.copy`), family: 'ballistic',
    familyLabel: t('loadout.family.ballistic'), pips: level ? levelPips(level[0], level[1], 3) : [],
    levelLabel: level ? t('draft.levels', { from: level[0], to: level[1] }) : '',
    variant: 'normal', variantLabel: '', cost: '',
  };
}

export function renderDraftCard(button: HTMLButtonElement, card: DraftCard | undefined, state: StageState,
  language: Language, index: number): void {
  const id = state.draft[index];
  button.hidden = id === undefined;
  if (!id) return;
  const model = card && state.run ? buildDraftCardModel(card, state.run, language) : legacyCard(id as LegacyDraftId, language);
  button.classList.add('loadout-draft-option');
  button.dataset.variant = model.variant;
  button.dataset.family = model.family;

  const surface = span('loadout-draft-surface');
  surface.style.setProperty('--card-delay', `${index * 35}ms`);
  const icon = span('loadout-draft-icon');
  icon.append(createGearIcon(model.icon, 64));
  const shortcut = document.createElement('kbd');
  shortcut.textContent = String(index + 1);
  shortcut.setAttribute('aria-hidden', 'true');

  const content = span('loadout-draft-content');
  const tags = span('loadout-draft-tags');
  tags.append(span('loadout-draft-family', model.familyLabel));
  if (model.variantLabel) tags.append(span('loadout-draft-rarity', model.variantLabel));
  if (model.evolution) tags.append(span('loadout-draft-evolution', model.evolution.badge));
  else if (model.pairHint) tags.append(span('loadout-draft-pair', `★ ${model.pairHint}`));
  const name = document.createElement('strong');
  name.className = 'loadout-draft-name';
  name.textContent = model.name;
  content.append(tags, name);

  if (model.levelLabel) {
    const level = span('loadout-draft-level');
    level.append(span('loadout-draft-level-label', model.levelLabel), renderPips(model.pips));
    content.append(level);
  }
  const effect = span('loadout-draft-effect', model.effect);
  effect.title = model.description;
  content.append(effect);
  if (model.cost) content.append(span('loadout-draft-cost', model.cost));
  if (model.evolution) content.append(span('loadout-draft-hint', model.evolution.hint));
  if (model.setPreview && model.family !== 'buff' && model.family !== 'supply') {
    const set = span('loadout-draft-set', model.setPreview.text);
    set.dataset.active = String(model.setPreview.tier > 0);
    set.prepend(createGearIcon(`set-${model.family}`, 14));
    content.append(set);
  }
  surface.append(icon, shortcut, content);
  button.replaceChildren(surface);
}

type Translator = ReturnType<typeof createTranslator>;

function slotRow(slots: SlotModel[], title: string, kind: 'weapon' | 'buff', t: Translator): HTMLElement {
  const row = document.createElement('div');
  row.className = `loadout-row loadout-row-${kind}`;
  const label = document.createElement('strong');
  label.textContent = title;
  const list = document.createElement('ul');
  list.setAttribute('aria-label', title);
  for (const slot of slots) {
    const cell = document.createElement('li');
    cell.className = `loadout-slot loadout-slot-${slot.kind}`;
    if (slot.kind === 'equipped') {
      cell.dataset.evolved = String(slot.evolved);
      cell.title = `${slot.name} · ${t('loadout.level', { level: slot.level, max: slot.maxLevel })}`;
      cell.append(createGearIcon(slot.icon, 32), renderPips(levelPips(slot.level, slot.level, slot.maxLevel)));
    } else if (slot.kind === 'locked') {
      cell.title = t('loadout.locked', { when: slot.hint });
      cell.append(createGearIcon('locked', 32));
    } else {
      cell.title = t('loadout.empty');
    }
    cell.setAttribute('aria-label', cell.title);
    list.append(cell);
  }
  row.append(label, list);
  return row;
}

export function renderLoadoutHud(root: HTMLElement, run: RunProgression | null, language: Language): void {
  if (root.hidden !== !run) root.hidden = !run;
  if (!run) return;
  // A frame sees the same loadout until a draft, chest, or slot unlock changes it.
  const key = `${run.weaponSlots}/${run.buffSlots}/${JSON.stringify(run.weaponLevels)}/${JSON.stringify(run.buffLevels)}/${JSON.stringify(run.evolutions)}`;
  const rendered = renderedLoadouts.get(root);
  if (rendered?.key === key && rendered.language === language) return;
  renderedLoadouts.set(root, { key, language });
  const t = createTranslator(language);
  const model = buildSlotHudModel(run, language);
  const weapons = slotRow(model.weapons, t('loadout.weapons'), 'weapon', t);
  const buffs = slotRow(model.buffs, t('loadout.buffs'), 'buff', t);
  const notes = document.createElement('div');
  notes.className = 'loadout-unlock-notes';
  for (const [kind, slots] of [['weapon', model.weapons], ['buff', model.buffs]] as const) {
    const locked = slots.find(slot => slot.kind === 'locked');
    if (!locked) continue;
    const note = span(`loadout-unlock-${kind}`, locked.hint);
    note.title = t('loadout.locked', { when: locked.hint });
    notes.append(note);
  }

  const sets = document.createElement('div');
  sets.className = 'loadout-families';
  sets.setAttribute('role', 'group');
  sets.setAttribute('aria-label', t('loadout.sets'));
  for (const family of model.families) {
    const badge = span('loadout-family-badge');
    badge.dataset.family = family.id;
    badge.dataset.active = String(family.active);
    badge.title = [family.name, t('loadout.familyCount', { count: family.count }), family.bonus].filter(Boolean).join(' · ');
    badge.setAttribute('aria-label', badge.title);
    const progress = family.nextThreshold ? `${family.count}/${family.nextThreshold}` : String(family.count);
    badge.append(createGearIcon(family.icon, 14), span('loadout-family-count', progress));
    sets.append(badge);
  }
  root.replaceChildren(weapons, buffs, sets);
  if (notes.hasChildNodes()) root.append(notes);
}
