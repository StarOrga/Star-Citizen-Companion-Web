/**
 * "⏻ Wenn fertig: Nichts ▾" chip — the per-run "when done" pick, mounted next
 * to the ⚡ tempo chip on the Extract and Upload cards. Both chips are the run's
 * only knobs, and both stay changeable while it runs; nothing here is persisted
 * (the unattended auto-run has its own "after" setting in ⚙ Settings).
 * An armed choice (quit / shutdown) shows in the warning tone.
 */

import { t } from '../lib/i18n.js';
import type { WhenDone } from '../lib/run-plan.js';

const OPTIONS: WhenDone[] = ['nothing', 'quit', 'shutdown'];

export interface WhenDoneChipCtx {
  get: () => WhenDone;
  set: (next: WhenDone) => void;
}

export function whenDoneChipHtml(current: WhenDone): string {
  const armed = current !== 'nothing' ? ' throttle-chip--armed' : '';
  return `<button type="button" id="when-done-chip" class="throttle-chip${armed}" data-tip="${t('run.whenDone.hint')}">⏻ ${t('run.whenDone.label')}: ${t('run.whenDone.' + current)} ▾</button>`;
}

let openPanel: HTMLElement | null = null;
let offDocClick: (() => void) | null = null;

function closePopover(): void {
  openPanel?.remove();
  openPanel = null;
  offDocClick?.();
  offDocClick = null;
}

export function wireWhenDoneChip(ctx: WhenDoneChipCtx): void {
  const chip = document.getElementById('when-done-chip');
  chip?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPanel) {
      closePopover();
      return;
    }
    openPopover(chip, ctx);
  });
}

function openPopover(anchor: HTMLElement, ctx: WhenDoneChipCtx): void {
  const cur = ctx.get();
  const panel = document.createElement('div');
  panel.className = 'sc-popover throttle-popover';
  panel.setAttribute('role', 'radiogroup');
  panel.setAttribute('aria-label', t('run.whenDone.label'));
  panel.innerHTML = `${OPTIONS.map(
    (v) =>
      `<button type="button" class="profile-pill compact ${v === cur ? 'active' : ''}" role="radio" aria-checked="${v === cur ? 'true' : 'false'}" data-whendone="${v}">${t('run.whenDone.' + v)}</button>`,
  ).join('')}<p class="throttle-popover-hint">${t('run.whenDone.hint')}</p>`;
  document.body.appendChild(panel);
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
  openPanel = panel;

  panel.querySelectorAll<HTMLButtonElement>('[data-whendone]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset['whendone'] as WhenDone | undefined;
      closePopover();
      if (!next) return;
      ctx.set(next);
      anchor.outerHTML = whenDoneChipHtml(next);
      wireWhenDoneChip(ctx);
    });
  });

  const onDocClick = (e: MouseEvent): void => {
    if (panel.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    closePopover();
  };
  document.addEventListener('mousedown', onDocClick, true);
  offDocClick = () => document.removeEventListener('mousedown', onDocClick, true);
}

/** Esc handler: closes an open popover, reports whether it did. */
export function closeWhenDonePopoverIfOpen(): boolean {
  if (!openPanel) return false;
  closePopover();
  return true;
}
