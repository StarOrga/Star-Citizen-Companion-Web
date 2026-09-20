/**
 * Step 5 — Done. Big confirmation, a one-line summary (game version ·
 * completeness · per-category counts · skins · duration), an optional
 * shutdown/quit countdown when the run was armed (Esc cancels), and two
 * actions: open the web app, or start a new run (resets back to Install).
 */

import { t } from '../../lib/i18n.js';
import { $, escapeHtml } from '../dom.js';
import { orderedCounts, state, resetForNewRun, SHUTDOWN_DELAY_SECS } from '../main.js';

export function renderDone(): string {
  const result = state.lastResult;
  const wd = state.runPlan?.whenDone ?? 'nothing';
  const countdown =
    wd === 'shutdown' || wd === 'quit'
      ? `<div class="done-countdown" id="done-shutdown-notice"></div>`
      : '';
  const counts = result
    ? orderedCounts(result.entity_counts)
        .filter(([k]) => k !== 'records_total')
        .map(([k, v]) => `${t('run.counter.' + k, {}) === 'run.counter.' + k ? k : t('run.counter.' + k)}: ${v.toLocaleString()}`)
        .join(' · ')
    : '';
  const summary = result
    ? `${result.channel} v${result.patch_version} · ${t('upload.completeness', { pct: result.quality_score.toFixed(0) })} · ${counts}`
    : '';

  return `
    <div class="view step-done">
      <div class="done-hero">
        <span class="done-check">✓</span>
        <h1>${t('done.title')}</h1>
      </div>
      <p class="done-summary">${escapeHtml(summary)}</p>
      ${countdown}
      <div class="btn-row view-footer">
        <button type="button" id="done-open-web" class="btn">${t('done.openWeb')} ↗</button>
        <button type="button" id="done-new-run" class="btn btn-primary">${t('done.newRun')} <kbd class="sc-kbd">Enter</kbd></button>
      </div>
    </div>
  `;
}

export function wireDone(): void {
  $('#done-open-web')?.addEventListener('click', () => {
    void window.sc.env().then((env) => window.open(env.webBase));
  });
  $('#done-new-run')?.addEventListener('click', () => primaryAction());
  paintCountdownPlaceholder();
}

export function primaryAction(): void {
  resetForNewRun();
}

/** Esc while on Done cancels an active shutdown/quit countdown. */
export function cancelCountdown(): boolean {
  const notice = $('#done-shutdown-notice');
  if (!notice || !notice.textContent) return false;
  void window.sc.system.abortShutdown();
  notice.textContent = t('upload.shutdownCancelled');
  return true;
}

function paintCountdownPlaceholder(): void {
  const notice = $('#done-shutdown-notice');
  if (!notice) return;
  notice.textContent = t('done.countingDown', { secs: String(SHUTDOWN_DELAY_SECS) });
}
