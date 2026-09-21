/**
 * "Laufoptionen" bottom sheet — the per-run knobs that live only for THIS
 * run: a quick "Ich schaue zu / Unbeaufsichtigt" segment (the unattended pick
 * sets upload-after ON + when-done=shutdown in one go), the upload-after
 * checkbox, the when-done segment, and a footer link into the ⚙ Settings
 * dialog for everything else. Auto-opens on the very first run of a freshly
 * selected install (see `steps/setup.ts`); otherwise Enter starts the run
 * directly.
 */

import { t } from '../lib/i18n.js';
import type { WhenDone } from '../lib/run-plan.js';

export interface OptionsSheetCtx {
  getUploadAfterExtract: () => boolean;
  setUploadAfterExtract: (v: boolean) => void;
  getWhenDone: () => WhenDone;
  setWhenDone: (v: WhenDone) => void;
  openSettings: () => void;
  /** Repaint the host step after a change (armed chip, checkbox states, …). */
  onChange: () => void;
}

let openClose: (() => void) | null = null;

export function isOptionsSheetOpen(): boolean {
  return openClose !== null;
}

export function closeOptionsSheetIfOpen(): boolean {
  if (!openClose) return false;
  openClose();
  return true;
}

const WHEN_DONE: WhenDone[] = ['nothing', 'quit', 'shutdown'];

export function openOptionsSheet(ctx: OptionsSheetCtx): void {
  closeOptionsSheetIfOpen();

  const overlay = document.createElement('div');
  overlay.id = 'sc-options-sheet-overlay';
  overlay.className = 'sc-modal-overlay sc-sheet-overlay sc-sheet-overlay--bottom';

  const paint = (): void => {
    const uploadAfter = ctx.getUploadAfterExtract();
    const whenDone = ctx.getWhenDone();
    const unattended = uploadAfter && whenDone === 'shutdown';
    overlay.innerHTML = `
      <div class="sc-modal sc-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <h2 class="sc-modal-title" id="sheet-title">${t('sheet.title')}</h2>

        <div class="segment-group sheet-mode" role="radiogroup" aria-label="${t('sheet.mode.label')}">
          <button type="button" class="segment ${!unattended ? 'active' : ''}" role="radio" aria-checked="${!unattended ? 'true' : 'false'}" data-mode="watch">${t('sheet.mode.watch')}</button>
          <button type="button" class="segment ${unattended ? 'active' : ''}" role="radio" aria-checked="${unattended ? 'true' : 'false'}" data-mode="unattended">${t('sheet.mode.unattended')}</button>
        </div>

        <label class="sc-toggle">
          <input type="checkbox" id="sheet-upload-after" ${uploadAfter ? 'checked' : ''} />
          <span>${t('configure.autoUpload')}</span>
        </label>

        <div class="settings-row">
          <div class="settings-row-main"><span class="settings-row-label">${t('run.whenDone.label')}</span></div>
          <div class="segment-group" id="sheet-whendone" role="radiogroup" aria-label="${t('run.whenDone.label')}">
            ${WHEN_DONE.map(
              (v) => `<button type="button" class="segment ${v === whenDone ? 'active' : ''}" role="radio" aria-checked="${v === whenDone ? 'true' : 'false'}" data-whendone="${v}">${t('run.whenDone.' + v)}</button>`,
            ).join('')}
          </div>
        </div>
        <p class="settings-row-hint sheet-whendone-hint">${t('sheet.whenDoneHint')}</p>

        <div class="sc-sheet-footer">
          <button type="button" class="btn-link" id="sheet-open-settings">⚙ ${t('sheet.moreSettings')}</button>
          <button type="button" class="btn btn-primary" id="sheet-done">${t('common.ok')}</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll<HTMLButtonElement>('.sheet-mode .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset['mode'] === 'unattended') {
          ctx.setUploadAfterExtract(true);
          ctx.setWhenDone('shutdown');
        } else {
          ctx.setWhenDone('nothing');
        }
        ctx.onChange();
        paint();
      });
    });
    (overlay.querySelector('#sheet-upload-after') as HTMLInputElement | null)?.addEventListener('change', (e) => {
      ctx.setUploadAfterExtract((e.target as HTMLInputElement).checked);
      ctx.onChange();
      paint();
    });
    overlay.querySelectorAll<HTMLButtonElement>('#sheet-whendone .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.setWhenDone(btn.dataset['whendone'] as WhenDone);
        ctx.onChange();
        paint();
      });
    });
    overlay.querySelector('#sheet-open-settings')?.addEventListener('click', () => {
      close();
      ctx.openSettings();
    });
    overlay.querySelector('#sheet-done')?.addEventListener('click', () => close());
  };

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    openClose = null;
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

  paint();
  document.body.appendChild(overlay);
  openClose = close;
}
