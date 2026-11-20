import { billDefinition } from './bills.ts';
import { BILL_UNPAID_XP_SCALE } from './data/items.ts';
import { createGearIcon } from './gear-icons.ts';
import type { createTranslator } from './i18n.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';
import './bill-display.css';

const NOTICE_TICKS = 3 * TICKS_PER_SECOND;
const INTEREST_PERCENT = Math.round(100 * (1 - BILL_UNPAID_XP_SCALE));
type Translate = ReturnType<typeof createTranslator>;
type BillDisplay = {
  panel: HTMLElement; title: HTMLElement; timer: HTMLTimeElement;
  body: HTMLElement; demand: HTMLElement; detail: HTMLElement;
  progress: HTMLProgressElement; safe: HTMLProgressElement; pay: HTMLElement; ignore: HTMLElement;
};
let display: BillDisplay | undefined;

function mount(): BillDisplay {
  const panel = document.createElement('aside');
  panel.className = 'bill-display';
  const header = document.createElement('div');
  header.className = 'bill-display-header';
  const title = document.createElement('strong');
  title.setAttribute('role', 'status');
  const timer = document.createElement('time');
  header.append(createGearIcon('bill', 24), title, timer);
  const body = document.createElement('div');
  body.className = 'bill-display-body';
  const demand = document.createElement('span');
  const progress = document.createElement('progress'), safe = document.createElement('progress');
  progress.setAttribute('aria-hidden', 'true');
  safe.setAttribute('aria-hidden', 'true');
  const detail = document.createElement('div');
  detail.className = 'bill-display-detail';
  const pay = document.createElement('div'), ignore = document.createElement('div');
  pay.className = 'bill-pay';
  ignore.className = 'bill-ignore';
  body.append(demand, progress, safe, detail, pay, ignore);
  panel.append(header, body);
  document.querySelector('.experience')!.append(panel);
  return { panel, title, timer, body, demand, detail, progress, safe, pay, ignore };
}

function setText(element: HTMLElement, copy: string): void {
  if (element.textContent !== copy) element.textContent = copy;
}

export function updateBillDisplay(state: StageState, t: Translate): void {
  const { active, last, interest } = state.bills;
  const recent = last && state.tick < last.tick + NOTICE_TICKS ? last : null;
  const visible = !!state.run && state.phase === 'playing' && !state.paused && !!(active || recent || interest);
  if (!visible) {
    if (display) display.panel.hidden = true;
    return;
  }
  const { panel, title, timer, body, demand: copy, detail, progress, safe, pay, ignore } = display ??= mount();
  panel.hidden = false;
  const appearance = active ? 'due' : recent ? recent.paid ? 'paid' : 'expired' : 'interest';
  if (panel.dataset.bill !== appearance) panel.dataset.bill = appearance;
  timer.hidden = !active;
  if (!active) {
    setText(title, recent ? t(recent.paid ? 'bill.paid' : 'bill.expired') : t('bill.interest', { percent: INTEREST_PERCENT }));
    body.hidden = !recent || recent.paid;
    copy.hidden = detail.hidden = progress.hidden = safe.hidden = pay.hidden = true;
    ignore.hidden = false;
    setText(ignore, t('bill.interest', { percent: INTEREST_PERCENT }));
    return;
  }

  const { demand, reward } = billDefinition(active.id);
  const seconds = Math.max(0, Math.ceil((active.deadline - state.tick) / TICKS_PER_SECOND));
  setText(title, t(`bill.${demand.kind}`));
  setText(timer, t('bill.seconds', { seconds }));
  timer.dateTime = `PT${seconds}S`;
  body.hidden = copy.hidden = detail.hidden = progress.hidden = pay.hidden = ignore.hidden = false;
  safe.hidden = demand.kind !== 'full-repayment';
  setText(copy, t(`bill.demand.${demand.kind}`));
  const rewards = [
    reward.upgrades && t('bill.reward.upgrades', { count: reward.upgrades }),
    reward.rerolls && t('bill.reward.rerolls', { count: reward.rerolls }),
    reward.chestPicks && t('bill.reward.chest', { count: reward.chestPicks }),
    reward.repair === 'full' ? t('bill.reward.fullRepair') : reward.repair && t('bill.reward.repair', { count: reward.repair }),
  ].filter(Boolean).join(' · ');
  setText(pay, t('bill.pay', { reward: rewards }));
  setText(ignore, t('bill.ignore', { percent: INTEREST_PERCENT }));
  const goal = demand.kind === 'full-repayment' ? demand.kills : demand.count;
  progress.max = goal;
  progress.value = Math.min(active.progress, goal);
  if (demand.kind === 'full-repayment') {
    const safeSeconds = Math.floor(active.unharmedTicks / TICKS_PER_SECOND);
    safe.max = demand.unharmedSeconds * TICKS_PER_SECOND;
    safe.value = Math.min(active.unharmedTicks, safe.max);
    setText(detail, t('bill.fullProgress', { current: Math.min(active.progress, demand.kills), target: demand.kills,
      safe: Math.min(safeSeconds, demand.unharmedSeconds), duration: demand.unharmedSeconds }));
  } else {
    setText(detail, t('bill.progress', { current: Math.min(active.progress, demand.count), target: demand.count }));
  }
}
