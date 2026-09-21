/**
 * Step 1 — Install (the "launch pad"). Auto-scans on first mount; installs
 * render as single-select (radio) cards showing local version/path/size plus
 * the local↔server comparison from the last catalog snapshot and "zuletzt
 * hochgeladen" freshness. A resumable durable-upload job surfaces here as a
 * banner with a "Fortsetzen" action that jumps straight into the Upload step.
 * Not signed in: primary = connect, secondary = continue extract-only.
 */

import { t } from '../../lib/i18n.js';
import { $, escapeHtml } from '../dom.js';
import {
  state,
  setStatus,
  renderDiscoverUpdateBanner,
  wireDiscoverUpdateBanner,
  connectNow,
  isConnected,
  connSnapshotFor,
  goToSetup,
  jumpToResumeUpload,
} from '../main.js';

async function autoScan(): Promise<void> {
  state.scanning = true;
  paintChannels();
  setStatus(t('discover.scanning'));
  try {
    const found = await window.sc.discover();
    // Single-select: with exactly one install found it is preselected (the
    // run uses it); with more than one the operator must pick.
    state.channels = found.map((c, i) => ({ ...c, selected: found.length === 1 && i === 0 }));
  } catch {
    /* leave channels empty — the empty state below explains next steps */
  } finally {
    // The bottom strip only renders while it has content — clear the
    // "scanning…" status the moment the scan settles, or it sits there
    // forever (the spinner already disappears; nothing else invalidates it).
    setStatus('');
    state.scanning = false;
    state.scanned = true;
    paintChannels();
  }
}

async function addManualFolder(): Promise<void> {
  const folder = await window.sc.pickFolder();
  if (!folder) return;
  const ch = await window.sc.discoverManual(folder);
  if (!ch) return;
  if (state.channels.some((c) => c.dataP4kPath === ch.dataP4kPath)) return;
  state.channels.forEach((c) => (c.selected = false));
  state.channels.push({ ...ch, selected: true });
  paintChannels();
}

function comparisonLine(version: string | null, channel: string): string {
  if (!version) return '';
  const snap = connSnapshotFor(channel);
  if (!isConnected()) return `<span class="install-cmp install-cmp--unknown">${t('install.cmp.unknown')}</span>`;
  if (!snap) return `<span class="install-cmp install-cmp--unknown">${t('install.cmp.unknown')}</span>`;
  if (version === snap.patchVersion) {
    return `<span class="install-cmp install-cmp--same">${t('install.cmp.same', { version: snap.patchVersion })}</span>`;
  }
  return `<span class="install-cmp install-cmp--newer">${t('install.cmp.newer', { version: snap.patchVersion })}</span>`;
}

function lastUploadedLine(channel: string): string {
  const snap = connSnapshotFor(channel);
  if (!snap) return '';
  const when = new Date(snap.createdAt);
  const rel = Number.isNaN(when.getTime()) ? snap.createdAt : when.toLocaleString();
  return `<span class="install-last-upload">${t('install.lastUploaded', { when: rel })}</span>`;
}

function resumeBannerHtml(): string {
  const job = state.resumableJob;
  if (!job?.resumable) return '';
  const text = job.resumeHint
    ? t('upload.job.resumeBanner', { hint: job.resumeHint })
    : t('install.resumeGeneric');
  return `
    <div class="install-resume-banner">
      <span>${escapeHtml(text)}</span>
      <button type="button" id="install-resume-btn" class="btn btn-primary">${t('upload.job.resumeAction')}</button>
    </div>`;
}

export function renderInstall(): string {
  const updateBanner =
    state.manualUpdate && !state.manualUpdateDismissed ? renderDiscoverUpdateBanner() : '';
  const connected = isConnected();
  const primary = connected
    ? `<button id="btn-to-setup" type="button" class="btn btn-primary">${t('discover.next')} <kbd class="sc-kbd">Enter</kbd></button>`
    : `<button id="btn-connect-continue" type="button" class="btn btn-primary">${t('session.connect')} <kbd class="sc-kbd">Enter</kbd></button>
       <button id="btn-to-setup" type="button" class="btn">${t('install.extractOnly')}</button>`;
  return `
    <div class="view step-install">
      ${updateBanner}
      <h1>${t('discover.title')}</h1>
      <p class="view-intro">${t('discover.subtitle')}</p>
      ${resumeBannerHtml()}
      <div id="channels-mount" class="view-body"></div>
      <div class="btn-row view-footer" id="discover-next" style="display:none;">
        ${primary}
      </div>
    </div>
  `;
}

export function wireInstall(): void {
  wireDiscoverUpdateBanner();
  $('#install-resume-btn')?.addEventListener('click', () => void jumpToResumeUpload());
  $('#btn-to-setup')?.addEventListener('click', () => goToSetup());
  $('#btn-connect-continue')?.addEventListener('click', () => {
    void connectNow().then(() => goToSetup());
  });

  if (!state.scanned && !state.scanning) {
    void autoScan();
  } else {
    paintChannels();
  }
}

/** Primary action for the Enter shortcut on this step. */
export function primaryAction(): void {
  if (isConnected()) {
    goToSetup();
  } else {
    ($('#btn-connect-continue') as HTMLButtonElement | null)?.click();
  }
}

function paintChannels(): void {
  const mount = $('#channels-mount');
  const nextRow = $('#discover-next');
  if (!mount) return;

  if (state.scanning) {
    mount.innerHTML = `
      <div class="scan-loading">
        <span class="spinner" aria-hidden="true"></span>
        <span>${t('discover.scanning')}</span>
      </div>`;
    if (nextRow) nextRow.style.display = 'none';
    return;
  }

  const hasChannels = state.channels.length > 0;
  const cards = state.channels
    .map(
      (c, i) => `
      <label class="channel-card ${c.selected ? 'selected' : ''}" data-card="${i}">
        <div class="channel-card-top">
          <span class="channel-pill ${c.channel}">${c.channel}</span>
          <input type="radio" name="install-pick" data-idx="${i}" ${c.selected ? 'checked' : ''} />
        </div>
        <span class="channel-name">${c.version ? 'v' + c.version : c.channel + ' (no version)'}</span>
        <span class="channel-path" title="${escapeHtml(c.installPath)}">${escapeHtml(c.installPath)}</span>
        <span class="channel-size">${(c.sizeBytes / 1024 ** 3).toFixed(1)} GB</span>
        ${comparisonLine(c.version, c.channel)}
        ${lastUploadedLine(c.channel)}
      </label>
    `,
    )
    .join('');

  const empty = hasChannels ? '' : `<p class="discover-empty">${t('discover.none')}</p>`;

  mount.innerHTML = `
    <div class="channel-track">
      ${cards}
      ${empty}
      <button id="btn-manual" type="button" class="channel-add-card">＋ ${t('discover.addManual')}</button>
    </div>
  `;

  mount.querySelectorAll('input[type=radio]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number((e.target as HTMLInputElement).dataset['idx']);
      if (!Number.isInteger(idx)) return;
      state.channels.forEach((c, i) => (c.selected = i === idx));
      mount.querySelectorAll('.channel-card').forEach((el2, i) => el2.classList.toggle('selected', i === idx));
      syncNextButton();
    });
  });
  $('#btn-manual')?.addEventListener('click', () => void addManualFolder());

  if (nextRow) nextRow.style.display = hasChannels ? 'flex' : 'none';
  syncNextButton();
}

/** "Weiter" only makes sense with exactly one install picked — say so via the disabled state. */
function syncNextButton(): void {
  const next = $('#btn-to-setup') as HTMLButtonElement | null;
  if (!next) return;
  const picked = state.channels.some((c) => c.selected);
  next.disabled = !picked;
  next.title = picked ? '' : t('discover.pickOne');
}
