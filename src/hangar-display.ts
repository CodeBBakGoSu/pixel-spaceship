import './hangar-display.css';
import { HANGAR_IDS, HEAT_LEVELS, HEAT_TIERS, UNLOCK_QUESTS, type HangarUpgradeId, type Heat } from './data/meta.ts';
import type { createTranslator } from './i18n.ts';
import { aceRank, hangarOffer, isHeat, questProgress, type Profile, type RunMetrics } from './meta.ts';

type Translate = ReturnType<typeof createTranslator>;
type Handlers = {
  onPurchase: (id: HangarUpgradeId) => void;
  onHeat: (heat: Heat) => void;
  onDaily: (enabled: boolean) => void;
};

const heatDescriptions = ['armor', 'fire', 'magnet', 'weakPoint', 'escort'] as const;

export function createHangarDisplay(container: HTMLElement, handlers: Handlers) {
  container.classList.add('hangar-panel');
  const mode = document.createElement('div');
  mode.className = 'hangar-mode';
  const heatLabel = document.createElement('label'), heatText = document.createElement('span');
  const heatSelect = document.createElement('select');
  const heatOptions = HEAT_LEVELS.map(level => {
    const option = document.createElement('option');
    option.value = String(level);
    heatSelect.append(option);
    return option;
  });
  heatLabel.append(heatText, heatSelect);
  const dailyLabel = document.createElement('label'), dailyText = document.createElement('span');
  const dailyInput = document.createElement('input');
  dailyInput.type = 'checkbox';
  dailyLabel.append(dailyInput, dailyText);
  const pressure = document.createElement('p');
  pressure.className = 'hangar-pressure';
  mode.append(heatLabel, dailyLabel, pressure);
  heatSelect.addEventListener('change', () => {
    const heat = Number(heatSelect.value);
    if (isHeat(heat)) handlers.onHeat(heat);
  });
  dailyInput.addEventListener('change', () => handlers.onDaily(dailyInput.checked));
  container.addEventListener('keydown', event => {
    // Native buttons, select and disclosures should handle keys before flight controls.
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space'
      || event.code.startsWith('Arrow')) event.stopPropagation();
  });

  const shop = section(container), quests = section(container);
  const shopRows = HANGAR_IDS.map(id => {
    const row = document.createElement('li'), label = document.createElement('div');
    const title = document.createElement('strong'), effect = document.createElement('small');
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.addEventListener('click', () => handlers.onPurchase(id));
    label.append(title, effect);
    row.append(label, buy);
    shop.rows.append(row);
    return { id, title, effect, buy };
  });
  const questRows = UNLOCK_QUESTS.map(({ target }) => {
    const row = document.createElement('li'), label = document.createElement('div');
    const title = document.createElement('strong'), detail = document.createElement('small');
    const measure = document.createElement('div'), value = document.createElement('small');
    const meter = document.createElement('progress');
    meter.max = target;
    measure.className = 'hangar-progress';
    label.append(title, detail);
    measure.append(value, meter);
    row.append(label, measure);
    quests.rows.append(row);
    return { title, detail, meter, value };
  });
  container.prepend(mode);

  return {
    update(profile: Profile, heat: Heat, daily: boolean, t: Translate, current?: RunMetrics): void {
      const selected = daily ? 0 : heat;
      heatText.textContent = t('hangar.heat');
      dailyText.textContent = t('hangar.daily');
      dailyInput.checked = daily;
      dailyInput.disabled = current !== undefined;
      heatSelect.disabled = current !== undefined || daily;
      for (const level of HEAT_LEVELS) {
        const option = heatOptions[level];
        option.disabled = level > profile.maxHeat && level !== selected;
        option.textContent = t(option.disabled ? 'hangar.heatLocked' : 'hangar.heatLevel', { level });
      }
      heatSelect.value = String(selected);
      const reward = Math.round((HEAT_TIERS[selected].rewardScale - 1) * 100);
      const modifiers = heatDescriptions.slice(0, selected).map(key => t(`hangar.pressure.${key}`));
      if (selected > 0) modifiers.push(t('hangar.heatReward', { percent: reward }));
      pressure.textContent = daily ? t('hangar.dailyRules') : modifiers.join(' · ');
      pressure.hidden = !pressure.textContent;

      const rank = aceRank(profile);
      shop.title.textContent = t('hangar.title');
      shop.status.textContent = t('hangar.inventory', { credits: profile.credits, rank });
      for (const { id, title, effect, buy } of shopRows) {
        const offer = hangarOffer(profile, id);
        const name = t(`hangar.upgrade.${id}.title`);
        title.textContent = t('hangar.upgradeLevel', { name, level: offer.level, max: offer.maxLevel });
        effect.textContent = t(`hangar.upgrade.${id}.effect`);
        const action = offer.cost === null ? t('hangar.max')
          : rank < offer.requiredRank ? t('hangar.rankNeeded', { rank: offer.requiredRank })
            : t('hangar.price', { credits: offer.cost });
        buy.textContent = action;
        buy.setAttribute('aria-label', t('hangar.buy', { name, action }));
        buy.disabled = current !== undefined || !offer.canPurchase;
      }

      const progress = questProgress(profile, current);
      const unlocked = progress.filter(quest => quest.unlocked).length;
      quests.title.textContent = t('hangar.quests');
      quests.status.textContent = t('hangar.questCount', { unlocked, total: progress.length });
      for (const [index, quest] of progress.entries()) {
        const { title, detail, meter, value } = questRows[index];
        const name = t(`item.${quest.id}.title`);
        title.textContent = name;
        detail.textContent = t(`hangar.quest.${quest.id}`);
        const ticks = quest.id === 'vector-thrusters';
        value.textContent = quest.unlocked ? t('hangar.unlocked') : t('hangar.questCount', {
          unlocked: ticks ? Math.floor(quest.progress / 60) : quest.progress,
          total: ticks ? quest.target / 60 : quest.target,
        });
        meter.value = quest.progress;
        meter.setAttribute('aria-label', name);
      }
    },
  };
}

function section(container: HTMLElement) {
  const details = document.createElement('details'), summary = document.createElement('summary');
  const title = document.createElement('strong'), status = document.createElement('small');
  const rows = document.createElement('ul');
  summary.append(title, status);
  details.append(summary, rows);
  container.append(details);
  return { title, status, rows };
}
