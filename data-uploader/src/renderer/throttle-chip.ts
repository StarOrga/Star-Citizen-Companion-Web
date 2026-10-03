/**
 * Compact "⚡ Standard ▾" tempo chip in the Extract/Upload card heads — the
 * only place the speed is picked (it is persisted by main).
 * Click opens a small popover with the profile picker (same `applyProfile`
 * write path main.ts already owns) — the applied/armed/unsupported outcome is
 * reported to the caller so it can be routed to the bottom-strip snackbar.
 */

import { t } from '../lib/i18n.js';
import { escapeHtml } from './dom.js';

export type LiveProfile = 'minimal' | 'standard' | 'maximum' | 'auto';

/** The speed modes the operator can pick; `auto` stays internal. */
const SPEED_PROFILES: Array<Exclude<LiveProfile, 'auto'>> = ['minimal', 'standard', 'maximum'];

export interface ThrottleChipCtx {
  getProfile: () => LiveProfile;
  applyProfile: (next: LiveProfile) => Promise<{ message: string } | null>;
  onMessage: (msg: string) => void;
}

function chipLabel(profile: LiveProfile): string {
  return `⚡ ${t('run.tempo')}: ${t('speed.' + (profile === 'auto' ? 'standard' : profile))} ▾`;
}

export function throttleChipHtml(profile: LiveProfile): string {
  return `<button type="button" id="throttle-chip" class="throttle-chip" data-tip="${escapeHtml(t('run.tempoHint'))}" data-tip-key="T">${chipLabel(profile)}</button>`;
}

/** Repaint a mounted chip after the profile changed (here, from the tray, or another window). */
export function refreshThrottleChip(profile: LiveProfile): void {
  const chip = document.getElementById('throttle-chip');
  if (chip) chip.textContent = chipLabel(profile);
}

/** Esc handler: closes an open tempo popover, reports whether it did. */
export function closeThrottlePopoverIfOpen(): boolean {
  if (!openPanel) return false;
  closePopover();
  return true;
}

/** Hotkey entry point (T): same as clicking the chip; no-op when no chip is mounted. */
export function toggleThrottlePopover(): void {
  (document.getElementById('throttle-chip') as HTMLButtonElement | null)?.click();
}

export function wireThrottleChip(ctx: ThrottleChipCtx): void {
  const chip = document.getElementById('throttle-chip');
  chip?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPopover(chip as HTMLElement, ctx);
  });
}

let openPanel: HTMLElement | null = null;

function closePopover(): void {
  openPanel?.remove();
  openPanel = null;
}

function openPopover(anchor: HTMLElement, ctx: ThrottleChipCtx): void {
  if (openPanel) {
    closePopover();
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'sc-popover throttle-popover';
  // The chip is the only place the speed is picked, so each mode carries its
  // one-line meaning — the Setup step that used to explain them is gone.
  panel.innerHTML = SPEED_PROFILES.map((id) => {
    const active = id === ctx.getProfile() ? 'active' : '';
    return `<button type="button" class="profile-pill compact ${active}" data-profile="${id}">
        <span class="name">${t('speed.' + id)}</span>
        <span class="desc">${t('speed.' + id + 'Desc')}</span>
      </button>`;
  }).join('');
  document.body.appendChild(panel);
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  // The chips sit at the card's right edge — keep the panel inside the window.
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
  openPanel = panel;
  // Keyboard users land on the current mode; Esc closes (main's keymap).
  panel.querySelector<HTMLButtonElement>('.profile-pill.active')?.focus();

  panel.querySelectorAll<HTMLButtonElement>('.profile-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['profile'] as LiveProfile | undefined;
      closePopover();
      if (!id) return;
      void ctx.applyProfile(id).then((r) => {
        if (r) ctx.onMessage(r.message);
      });
    });
  });

  const onDocClick = (e: MouseEvent): void => {
    if (panel.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    closePopover();
    document.removeEventListener('mousedown', onDocClick, true);
  };
  document.addEventListener('mousedown', onDocClick, true);
}
