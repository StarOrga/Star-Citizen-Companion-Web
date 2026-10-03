/**
 * App-behaviour Settings dialog (⚙, Ctrl+,), in two sections:
 *
 * - "Automatik": the one switch for runs nobody starts by hand (autoStart +
 *   autoRunOnNewVersion, always together), plus what such a run does once it
 *   is through and whether a launch with nothing to do quits again.
 * - "Allgemein": minimize-to-tray, the role-gated update ring, language,
 *   telemetry, diagnostics.
 *
 * A run started by hand has its own two knobs (⚡ tempo, ⏻ when done) as chips
 * on the Extract/Upload cards — they never live here, so "automatic" and
 * "this run" cannot be confused.
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
        <div class="segment-group" id="set-ring" role="radiogroup" aria-label="${t('settings.updateChannel.label')}">
          ${rings.map((c) => `<button type="button" class="segment ${c === s.updateChannel ? 'active' : ''}" role="radio" aria-checked="${c === s.updateChannel ? 'true' : 'false'}" data-ring="${c}">${t('settings.updateChannel.' + c)}</button>`).join('')}
        </div>
      </div>`
      : '';

  const afterAutoRunOptions: PublicSettings['afterAutoRun'][] = ['keep', 'quit', 'shutdown'];
  const autoOn = s.autoStart && s.autoRunOnNewVersion;
  const langSegment = LOCALES.map(
    (l) => `<button type="button" class="segment ${l === getLocale() ? 'active' : ''}" role="radio" aria-checked="${l === getLocale() ? 'true' : 'false'}" data-lang="${l}">${l.toUpperCase()}</button>`,
  ).join('');

  overlay.innerHTML = `
    <div class="sc-modal sc-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-settings-title">
      <div class="sc-settings-head">
        <h2 class="sc-modal-title" id="sc-settings-title">${t('settings.title')}</h2>
        <button type="button" class="sc-icon-btn" id="set-close" data-tip="${t('common.dismiss')}" data-tip-key="Esc" data-tip-tier="label" aria-label="${t('common.dismiss')}">✕</button>
      </div>

      <section class="settings-section">
        <h3 class="settings-section-title">${t('settings.auto.title')}</h3>
        <label class="sc-toggle settings-master">
          <input type="checkbox" id="set-unattended" ${autoOn ? 'checked' : ''} />
          <span>${t('settings.auto.label')}</span>
        </label>
        <p class="settings-row-hint">${t('settings.auto.hint')}</p>
        <div class="settings-group ${autoOn ? '' : 'settings-group--off'}">
          <div class="settings-row">
            <div class="settings-row-main">
              <span class="settings-row-label">${t('settings.afterAutoRun.label')}</span>
            </div>
            <div class="segment-group" id="set-after-autorun" role="radiogroup" aria-label="${t('settings.afterAutoRun.label')}">
              ${afterAutoRunOptions.map((v) => `<button type="button" class="segment ${v === s.afterAutoRun ? 'active' : ''}" role="radio" aria-checked="${v === s.afterAutoRun ? 'true' : 'false'}" data-value="${v}" ${autoOn ? '' : 'disabled'}>${t('settings.afterAutoRun.' + v)}</button>`).join('')}
            </div>
          </div>
          <label class="sc-toggle" data-tip="${t('settings.quitIfNothing.hint')}">
            <input type="checkbox" id="set-quitafter" ${s.quitAfterAutoRun ? 'checked' : ''} ${autoOn ? '' : 'disabled'} />
            <span>${t('settings.quitIfNothing.label')}</span>
          </label>
        </div>
        <p class="settings-row-hint">${t('settings.auto.manualNote')}</p>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">${t('settings.general.title')}</h3>
      <label class="sc-toggle" data-tip="${t('tray.minimizeHint')}">
        <input type="checkbox" id="set-minimize" ${s.minimizeToTray ? 'checked' : ''} />
        <span>${t('tray.minimize')}</span>
      </label>

      ${ringRow}

      <div class="settings-row">
        <div class="settings-row-main"><span class="settings-row-label">${t('settings.language')}</span></div>
        <div class="segment-group" id="set-lang" role="radiogroup" aria-label="${t('settings.language')}">${langSegment}</div>
      </div>

      <label class="sc-toggle" data-tip="${t('telemetry.hint')}">
        <input type="checkbox" id="set-telemetry" ${s.telemetryEnabled ? 'checked' : ''} />
        <span>${t('telemetry.toggle')}</span>
      </label>

      <div class="settings-group">
        <span class="settings-row-label">${t('settings.diagnostics.title')}</span>
        <p class="settings-diag" id="set-diag">…</p>
      </div>
      </section>
    </div>
  `;

  void window.sc.env().then((env) => {
    const diag = overlay.querySelector('#set-diag');
    if (diag) diag.textContent = `v${env.toolVersion} · ${env.platform} · ${env.releaseTokenFingerprint}`;
  });

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
  overlay.querySelector('#set-quitafter')?.addEventListener('change', (e) => {
    void patch({ quitAfterAutoRun: (e.target as HTMLInputElement).checked });
  });
  overlay.querySelectorAll<HTMLButtonElement>('#set-after-autorun .segment').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('#set-after-autorun .segment').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
      });
      void patch({ afterAutoRun: btn.dataset['value'] as PublicSettings['afterAutoRun'] });
    });
  });
  overlay.querySelector('#set-minimize')?.addEventListener('change', (e) => {
    void patch({ minimizeToTray: (e.target as HTMLInputElement).checked });
  });
  overlay.querySelectorAll<HTMLButtonElement>('#set-ring .segment').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('#set-ring .segment').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
      });
      void patch({ updateChannel: btn.dataset['ring'] as PublicSettings['updateChannel'] });
    });
  });
  overlay.querySelectorAll<HTMLButtonElement>('#set-lang .segment').forEach((btn) => {
    btn.addEventListener('click', () => {
      const loc = btn.dataset['lang'] as LocaleId;
      void setLocale(loc).then(() => {
        void patch({ language: loc });
        ctx.onLocaleChanged();
        close();
      });
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
