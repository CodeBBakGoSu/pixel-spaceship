import { billDefinition } from './bills.ts';
import { BILL_UNPAID_XP_SCALE } from './data/items.ts';
import type { createTranslator } from './i18n.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';
import './bill-display.css';

const NOTICE_TICKS = 3 * TICKS_PER_SECOND;
const INTEREST_PERCENT = Math.round(100 * (1 - BILL_UNPAID_XP_SCALE));
type BillDisplay = { panel: HTMLElement; title: HTMLElement; timer: HTMLTimeElement; detail: HTMLElement };
let display: BillDisplay | undefined;

function mount(): BillDisplay {
  const panel = document.createElement('aside');
  panel.className = 'bill-display';
  const header = document.createElement('div');
  header.className = 'bill-display-header';
  const title = document.createElement('strong');
  const timer = document.createElement('time');
  header.append(title, timer);
  const detail = document.createElement('div');
  detail.className = 'bill-display-detail';
  panel.append(header, detail);
  document.querySelector('.experience')!.append(panel);
  return { panel, title, timer, detail };
}

function setText(element: HTMLElement, copy: string): void {
  if (element.textContent !== copy) element.textContent = copy;
}

export function updateBillDisplay(state: StageState, t: ReturnType<typeof createTranslator>): void {
  const { active, last, interest } = state.bills;
  const recent = last && state.tick < last.tick + NOTICE_TICKS ? last : null;
  const visible = !!state.run && state.phase === 'playing' && !state.paused && !!(active || recent || interest);
  if (!visible) {
    if (display) display.panel.hidden = true;
    return;
  }
  const { panel, title, timer, detail } = display ??= mount();
  panel.hidden = false;
  const appearance = active ? 'due' : recent?.paid ? 'paid' : 'interest';
  if (panel.dataset.bill !== appearance) panel.dataset.bill = appearance;
  timer.hidden = !active;
  if (!active) {
    const penalty = t('bill.interest', { percent: INTEREST_PERCENT });
    setText(title, recent ? t(recent.paid ? 'bill.paid' : 'bill.expired') : penalty);
    setText(detail, recent && !recent.paid ? penalty : '');
    detail.hidden = !recent || recent.paid;
    return;
  }

  const demand = billDefinition(active.id).demand;
  const seconds = Math.max(0, Math.ceil((active.deadline - state.tick) / TICKS_PER_SECOND));
  setText(title, t(`bill.${demand.kind}`));
  setText(timer, t('bill.seconds', { seconds }));
  timer.dateTime = `PT${seconds}S`;
  detail.hidden = false;
  if (demand.kind === 'full-repayment') {
    const safe = Math.floor(active.unharmedTicks / TICKS_PER_SECOND);
    setText(detail, t('bill.fullProgress', { current: Math.min(active.progress, demand.kills), target: demand.kills,
      safe: Math.min(safe, demand.unharmedSeconds), duration: demand.unharmedSeconds }));
  } else {
    setText(detail, t('bill.progress', { current: Math.min(active.progress, demand.count), target: demand.count }));
  }
}
