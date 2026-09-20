/**
 * App-behaviour Settings dialog (⚙, Ctrl+,).
 *
 * Everything that used to live scattered across the Configure checkboxes and
 * the topbar/statusbar now lives here: the "Unbeaufsichtigt" master toggle
 * (autoStart + autoRunOnNewVersion, coherently), the after-auto-run choice,
 * minimize-to-tray, the role-gated update ring, language and telemetry.
 *
 * Per-run choices (game version, scope, upload-after, when-done) are NOT
 * here — those live on the Setup step / options sheet, see `options-sheet.ts`.
 */

import { t, setLocale, getLocale, LOCALES, type LocaleId } from '../lib/i18n.js';
import type { PublicSettings } from './main.js';

export interface SettingsDialogCtx {
  getSettings: () => PublicSettings | null;
  patch: (partial: Partial<Omit<PublicSettings, 'telemetryEnabled'>>) => Promise<PublicSettings>;
  setTelemetry: (enabled: boolean) => Promise<PublicSettings>;
  getRole: () => 'admin' | 'collaborator' | 'viewer' | null;
  allowedChannels: () => Array<'alpha' | 'beta' | 'stable'>;
  onSettingsChanged: (next: PublicSettings) => void;
  onLocaleChanged: () => void;
}

let openInstance: (() => void) | null = null;

export function isSettingsDialogOpen(): boolean {
  return document.getElementById('sc-settings-overlay') !== null;
}

export function closeSettingsDialog(): void {
  document.getElementById('sc-settings-overlay')?.remove();
}

/** Global entry point — Ctrl+, and the gear button both call this. */
export function openSettingsDialog(ctx: SettingsDialogCtx): void {
  closeSettingsDialog();
  const s = ctx.getSettings();
  if (!s) return;

  const overlay = document.createElement('div');
  overlay.id = 'sc-settings-overlay';
  overlay.className = 'sc-modal-overlay sc-sheet-overlay';

  const rings = ctx.allowedChannels();
  const ringRow =
    rings.length >= 2
      ? `
      <div class="settings-row settings-row--hot">
        <div class="settings-row-main">
          <span class="settings-row-label">${t('settings.updateChannel.label')}</span>
          <span class="settings-row-hint">${t('settings.updateChannel.hint')} — ${t('settings.adminOnly')}</span>
        </div>
        <select id="set-ring" aria-label="${t('settings.updateChannel.label')}">
          ${rings.map((c) => `<option value="${c}" ${c === s.updateChannel ? 'selected' : ''}>${t('settings.updateChannel.' + c)}</option>`).join('')}
        </select>
      </div>`
      : '';

  const langOptions = LOCALES.map(
    (l) => `<option value="${l}" ${l === getLocale() ? 'selected' : ''}>${l.toUpperCase()}</option>`,
  ).join('');

  overlay.innerHTML = `
    <div class="sc-modal sc-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-settings-title">
      <div class="sc-settings-head">
        <h2 class="sc-modal-title" id="sc-settings-title">${t('settings.title')}</h2>
        <button type="button" class="sc-icon-btn" id="set-close" title="${t('common.dismiss')} (Esc)" aria-label="${t('common.dismiss')}">✕</button>
      </div>

      <label class="sc-toggle settings-master" title="${t('settings.unattended.hint')}">
        <input type="checkbox" id="set-unattended" ${s.autoStart && s.autoRunOnNewVersion ? 'checked' : ''} />
        <span>${t('settings.unattended.label')}</span>
      </label>

      <div class="settings-group">
        <label class="sc-toggle settings-row" title="${t('tray.autoStartHint')}">
          <input type="checkbox" id="set-autostart" ${s.autoStart ? 'checked' : ''} />
          <span>${t('tray.autoStart')}</span>
        </label>
        <label class="sc-toggle settings-row" title="${t('autorun.hint')}">
          <input type="checkbox" id="set-autorun" ${s.autoRunOnNewVersion ? 'checked' : ''} />
          <span>${t('autorun.toggle')}</span>
        </label>
        <label class="sc-toggle settings-row" title="${t('tray.quitAfterAutoRunHint')}">
          <input type="checkbox" id="set-quitafter" ${s.quitAfterAutoRun ? 'checked' : ''} />
          <span>${t('tray.quitAfterAutoRun')}</span>
        </label>
        <div class="settings-row">
          <div class="settings-row-main">
            <span class="settings-row-label">${t('settings.afterAutoRun.label')}</span>
            <span class="settings-row-hint">${t('settings.afterAutoRun.hint')}</span>
          </div>
          <select id="set-after-autorun" aria-label="${t('settings.afterAutoRun.label')}">
            <option value="keep" ${s.afterAutoRun === 'keep' ? 'selected' : ''}>${t('settings.afterAutoRun.keep')}</option>
            <option value="quit" ${s.afterAutoRun === 'quit' ? 'selected' : ''}>${t('settings.afterAutoRun.quit')}</option>
            <option value="shutdown" ${s.afterAutoRun === 'shutdown' ? 'selected' : ''}>${t('settings.afterAutoRun.shutdown')}</option>
          </select>
        </div>
      </div>

      <label class="sc-toggle settings-row" title="${t('tray.minimizeHint')}">
        <input type="checkbox" id="set-minimize" ${s.minimizeToTray ? 'checked' : ''} />
        <span>${t('tray.minimize')}</span>
      </label>

      ${ringRow}

      <div class="settings-row">
        <div class="settings-row-main"><span class="settings-row-label">${t('settings.language')}</span></div>
        <select id="set-lang" aria-label="${t('settings.language')}">${langOptions}</select>
      </div>

      <label class="sc-toggle settings-row" title="${t('telemetry.hint')}">
        <input type="checkbox" id="set-telemetry" ${s.telemetryEnabled ? 'checked' : ''} />
        <span>${t('telemetry.toggle')}</span>
      </label>

      <p class="settings-diag">${t('settings.diagnostics.hint')}</p>
    </div>
  `;

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    openInstance = null;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#set-close')?.addEventListener('click', close);

  const patch = async (partial: Partial<Omit<PublicSettings, 'telemetryEnabled'>>): Promise<void> => {
    const next = await ctx.patch(partial);
    ctx.onSettingsChanged(next);
  };

  overlay.querySelector('#set-unattended')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    void patch({ autoStart: on, autoRunOnNewVersion: on }).then(() => {
      close();
      openSettingsDialog(ctx); // repaint sub-rows in sync
    });
  });
  overlay.querySelector('#set-autostart')?.addEventListener('change', (e) => {
    void patch({ autoStart: (e.target as HTMLInputElement).checked });
  });
  overlay.querySelector('#set-autorun')?.addEventListener('change', (e) => {
    void patch({ autoRunOnNewVersion: (e.target as HTMLInputElement).checked });
  });
  overlay.querySelector('#set-quitafter')?.addEventListener('change', (e) => {
    void patch({ quitAfterAutoRun: (e.target as HTMLInputElement).checked });
  });
  (overlay.querySelector('#set-after-autorun') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
    void patch({ afterAutoRun: (e.target as HTMLSelectElement).value as PublicSettings['afterAutoRun'] });
  });
  overlay.querySelector('#set-minimize')?.addEventListener('change', (e) => {
    void patch({ minimizeToTray: (e.target as HTMLInputElement).checked });
  });
  (overlay.querySelector('#set-ring') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
    void patch({ updateChannel: (e.target as HTMLSelectElement).value as PublicSettings['updateChannel'] });
  });
  (overlay.querySelector('#set-lang') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
    const loc = (e.target as HTMLSelectElement).value as LocaleId;
    void setLocale(loc).then(() => {
      void patch({ language: loc });
      ctx.onLocaleChanged();
      close();
    });
  });
  overlay.querySelector('#set-telemetry')?.addEventListener('change', (e) => {
    void ctx.setTelemetry((e.target as HTMLInputElement).checked).then((next) => ctx.onSettingsChanged(next));
  });

  document.body.appendChild(overlay);
  openInstance = close;
  (overlay.querySelector('#set-close') as HTMLButtonElement | null)?.focus();
}

/** Used by the keymap (Esc) so it doesn't need to know the DOM id. */
export function closeSettingsDialogIfOpen(): boolean {
  if (!openInstance) return false;
  openInstance();
  return true;
}
