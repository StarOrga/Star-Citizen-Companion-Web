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

// Scope (how much data to pull) is orthogonal to speed (live throttle
// priority) — feeding the scope id straight into the performance-profile
// estimate mixed the two up (minimal scope ≈ minimal speed's per-GB rate,
// which is the SLOW profile) and inverted the ETAs. Instead: estimate at the
// operator's current live speed profile, then scale by how much MORE or LESS
// data each scope actually pulls.
const SCOPE_ETA_FACTOR: Record<'minimal' | 'standard' | 'maximum', number> = {
  minimal: 0.3,
  standard: 1,
  maximum: 3.5,
};

/** Mirrors `estimateForSize`'s own formatting (not exported from lib/performance.ts). */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

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
  // Speed profile ETAs are per current live profile — the scope factor then
  // scales that same baseline, so switching the live speed profile (throttle
  // chip, mid-run) is reflected here too instead of a fixed guess.
  const speedProfile = state.profile === 'auto' ? 'standard' : state.profile;
  const baseSeconds = (await window.sc.estimate(speedProfile, selectedSize)).seconds;
  const entries = await Promise.all(
    EXTRACT_SCOPES.map(async (scope) => {
      const eta = formatDuration(Math.max(1, Math.round(baseSeconds * SCOPE_ETA_FACTOR[scope])));
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
