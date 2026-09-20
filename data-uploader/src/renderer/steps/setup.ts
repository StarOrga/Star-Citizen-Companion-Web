/**
 * Step 2 — Setup. Scope pills (minimal/standard/maximum, persisted
 * `extractScope`, "standard" marked recommended) with a per-pill ETA, and a
 * "Laufoptionen" button opening the options sheet (per-run upload-after +
 * when-done). The sheet auto-opens on the very first run of a freshly
 * selected install; otherwise Enter starts the run directly.
 */

import { t } from '../../lib/i18n.js';
import { $ } from '../dom.js';
import { openOptionsSheet } from '../options-sheet.js';
import { buildRunPlan } from '../../lib/run-plan.js';
import { state, startRun, openAppSettingsDialog, armedChipHtml, wireArmedChip } from '../main.js';

const EXTRACT_SCOPES: Array<'minimal' | 'standard' | 'maximum'> = ['minimal', 'standard', 'maximum'];

/** Installs the operator has already seen the options sheet for this session. */
const seenInstalls = new Set<string>();

function installKey(): string {
  const ch = state.channels.find((c) => c.selected);
  return ch ? `${ch.channel}:${ch.dataP4kPath}` : '';
}

export function renderSetup(): string {
  return `
    <div class="view step-setup">
      <h1>${t('configure.title')} ${armedChipHtml()}</h1>
      <p class="view-intro">${t('configure.subtitle')}</p>
      <div class="scope-pills view-body" id="scope-pills-mount"></div>
      <div class="btn-row view-footer">
        <button id="btn-run-options" type="button" class="btn">${t('sheet.title')}</button>
        <button id="btn-open-settings" class="btn" title="${t('settings.title')} (Ctrl+,)">⚙ ${t('settings.title')}</button>
        <button id="btn-start-run" class="btn btn-primary">${t('configure.start')} <kbd class="sc-kbd">Enter</kbd></button>
      </div>
    </div>
  `;
}

export function wireSetup(): void {
  void paintScopePills();
  wireArmedChip();
  $('#btn-run-options')?.addEventListener('click', () => openSheet());
  $('#btn-open-settings')?.addEventListener('click', () => openAppSettingsDialog());
  $('#btn-start-run')?.addEventListener('click', () => void beginRun());

  // Auto-open the sheet on the very first run of this install this session.
  const key = installKey();
  if (key && !seenInstalls.has(key)) {
    seenInstalls.add(key);
    openSheet();
  }
}

/** Enter on this step: open the sheet if unseen, otherwise start straight away. */
export function primaryAction(): void {
  const key = installKey();
  if (key && !seenInstalls.has(key)) {
    seenInstalls.add(key);
    openSheet();
    return;
  }
  void beginRun();
}

function openSheet(): void {
  openOptionsSheet({
    getUploadAfterExtract: () => Boolean(state.settings?.uploadAfterExtract),
    setUploadAfterExtract: (v) => {
      void window.sc.settings.patch({ uploadAfterExtract: v }).then((s) => {
        state.settings = s;
      });
    },
    getWhenDone: () => state.whenDone,
    setWhenDone: (v) => {
      state.whenDone = v;
    },
    openSettings: () => openAppSettingsDialog(),
    onChange: () => {
      const h1 = document.querySelector('.step-setup h1');
      if (h1) {
        h1.innerHTML = `${t('configure.title')} ${armedChipHtml()}`;
        wireArmedChip();
      }
    },
  });
}

async function beginRun(): Promise<void> {
  const channel = state.channels.find((c) => c.selected);
  if (!channel || !state.settings) return;
  const plan = buildRunPlan({
    channel: channel.channel as 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW',
    settings: state.settings,
    signedIn: Boolean(state.authToken),
    whenDone: state.whenDone,
  });
  await startRun(plan);
}

async function paintScopePills(): Promise<void> {
  const mount = $('#scope-pills-mount');
  if (!mount || !state.settings) return;
  const selectedSize = state.channels.filter((c) => c.selected).reduce((sum, c) => sum + c.sizeBytes, 0);
  const cur = state.settings.extractScope;
  const entries = await Promise.all(
    EXTRACT_SCOPES.map(async (scope) => {
      const eta = (await window.sc.estimate(scope, selectedSize)).formatted;
      const active = scope === cur ? 'active' : '';
      const recommended = scope === 'standard' ? `<span class="scope-recommended">${t('scope.recommended')}</span>` : '';
      return `
        <div class="profile-pill ${active}" data-scope="${scope}" tabindex="0" role="button" aria-pressed="${active ? 'true' : 'false'}">
          <span class="name">${t('scope.' + scope)} ${recommended}</span>
          <span class="eta">~ ${eta}</span>
        </div>`;
    }),
  );
  mount.innerHTML = entries.join('');
  mount.querySelectorAll('.profile-pill').forEach((el) => {
    const pick = (): void => {
      const scope = (el as HTMLElement).dataset['scope'] as 'minimal' | 'standard' | 'maximum' | undefined;
      if (!scope) return;
      void window.sc.settings.patch({ extractScope: scope }).then((s) => {
        state.settings = s;
        void paintScopePills();
      });
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        if (ke.key === ' ') ke.preventDefault();
        pick();
      }
    });
  });
}
