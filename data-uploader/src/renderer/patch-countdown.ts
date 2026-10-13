/**
 * Game-patch countdown banner (`#patch-banner`) — a launch the operator opened
 * found a NEW STAR CITIZEN PATCH the server does not have yet, so the upload
 * starts on its own after {@link AUTO_RUN_COUNTDOWN_S} seconds ("Jetzt
 * hochladen" starts it at once, "Abbrechen" drops it until the next app start).
 *
 * Deliberately not the `#update-banner` (a new UPLOADER version): its own
 * element under that one, the channel shown as a pill, wording that names the
 * game patch, and a thin line draining towards the start. Both may show at once.
 *
 * The decision itself is pure (`launchAction` in `lib/auto-run.ts`); this only
 * paints and ticks. Every tick re-checks `isBusy` — the moment the operator
 * starts something themselves, the banner goes away without starting anything.
 */

import { t } from '../lib/i18n.js';
import { AUTO_RUN_COUNTDOWN_S, formatCountdown } from '../lib/auto-run.js';
import { escapeHtml } from './dom.js';
import { isSettingsDialogOpen } from './settings-dialog.js';

export interface PatchCountdownCtx {
  channel: string;
  version: string;
  /** The operator left the Install step or started a run. */
  isBusy: () => boolean;
  /** Start the run exactly like the unattended auto-run would. */
  onStart: () => void;
  /** "Abbrechen" — suppress until the next app start. */
  onCancel: () => void;
}

let timer: number | null = null;
let active: (PatchCountdownCtx & { endsAt: number }) | null = null;

function banner(): HTMLElement | null {
  return document.getElementById('patch-banner');
}

export function isPatchCountdownActive(): boolean {
  return active !== null;
}

/** Hide the banner and stop the clock without starting or cancelling anything. */
export function stopPatchCountdown(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  active = null;
  const el = banner();
  if (el) {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function paint(): void {
  const el = banner();
  if (!el || !active) return;
  const left = Math.max(0, (active.endsAt - Date.now()) / 1000);
  const count = el.querySelector('#patch-banner-count');
  const fill = el.querySelector<HTMLElement>('#patch-banner-fill');
  if (count) count.textContent = formatCountdown(left);
  if (fill) fill.style.transform = `scaleX(${(left / AUTO_RUN_COUNTDOWN_S).toFixed(4)})`;
}

/** Full paint — also the language-change repaint. */
export function repaintPatchCountdown(): void {
  const el = banner();
  if (!el || !active) return;
  el.setAttribute('aria-label', t('autorun.banner.aria'));
  el.innerHTML = `
    <span class="patch-banner-text" aria-live="polite">${t('autorun.banner.text', {
      patch: `<span class="patch-banner-pill">${escapeHtml(active.channel)} ${escapeHtml(active.version)}</span>`,
    })}</span>
    <span class="patch-banner-count" id="patch-banner-count"></span>
    <span class="patch-banner-grow"></span>
    <button type="button" class="btn btn-primary" id="patch-banner-now">${t('autorun.banner.now')}</button>
    <button type="button" class="btn" id="patch-banner-cancel">${t('autorun.banner.cancel')}</button>
    <span class="patch-banner-line" aria-hidden="true"><i id="patch-banner-fill"></i></span>`;
  el.querySelector('#patch-banner-now')?.addEventListener('click', () => fire('start'));
  el.querySelector('#patch-banner-cancel')?.addEventListener('click', () => fire('cancel'));
  paint();
}

function fire(what: 'start' | 'cancel'): void {
  const ctx = active;
  stopPatchCountdown();
  if (!ctx) return;
  if (what === 'cancel') ctx.onCancel();
  else if (!ctx.isBusy()) ctx.onStart();
}

export function startPatchCountdown(ctx: PatchCountdownCtx): void {
  stopPatchCountdown();
  const el = banner();
  if (!el) return;
  active = { ...ctx, endsAt: Date.now() + AUTO_RUN_COUNTDOWN_S * 1000 };
  el.hidden = false;
  repaintPatchCountdown();
  let lastTick = Date.now();
  timer = window.setInterval(() => {
    if (!active) return;
    if (active.isBusy()) {
      stopPatchCountdown();
      return;
    }
    const now = Date.now();
    // An open ⚙ dialog freezes the clock — the upload never starts behind the modal.
    if (isSettingsDialogOpen()) active.endsAt += now - lastTick;
    lastTick = now;
    if (now >= active.endsAt) fire('start');
    else paint();
  }, 250);
}
