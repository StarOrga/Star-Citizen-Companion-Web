/**
 * Extension popup: status, the privacy notice, and the two escape hatches the
 * fingerprint-based nudge needs — "offer it again" (for a dismissal the user
 * regrets) and "forget stored data".
 *
 * Reads and writes chrome.storage.local only. No network access whatsoever.
 */
import {
  clearDismissal,
  normalizeState,
  COMPANION_ORIGINS,
} from '../lib/hangar-core.js';

const STATE_KEY = 'nudgeState';
const SCAN_KEY = 'lastScan';
const COMMAND_KEY = 'uiCommand';
const PENDING_KEY = 'pendingImport';

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

for (const el of document.querySelectorAll('[data-t]')) {
  el.textContent = t(el.getAttribute('data-t'));
}
document.getElementById('open-app').href = `${COMPANION_ORIGINS[0]}/hangar`;

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
}

async function render() {
  const bag = await chrome.storage.local.get([STATE_KEY, SCAN_KEY]);
  const state = normalizeState(bag[STATE_KEY]);
  const scan = bag[SCAN_KEY];

  document.getElementById('import-status').textContent = state.lastImport
    ? t('popupStatusLast', new Date(state.lastImport.at).toLocaleString())
    : t('popupStatusNever');

  document.getElementById('scan-status').textContent =
    scan && typeof scan.count === 'number' ? t('popupScan', scan.count) : t('popupScanNone');
}

document.getElementById('offer-again').addEventListener('click', async () => {
  const bag = await chrome.storage.local.get([STATE_KEY, SCAN_KEY]);
  const fingerprint = bag[SCAN_KEY]?.fingerprint;
  const state = normalizeState(bag[STATE_KEY]);
  const next = fingerprint ? clearDismissal(state, fingerprint) : state;
  // The RSI content script listens on storage.onChanged, which spares the
  // extension the `tabs`/`scripting` permissions just to re-show a banner.
  await chrome.storage.local.set({
    [STATE_KEY]: next,
    [COMMAND_KEY]: { name: 'offer', at: Date.now() },
  });
  toast(t('popupOfferAgainDone'));
});

document.getElementById('forget').addEventListener('click', async () => {
  await chrome.storage.local.remove([STATE_KEY, SCAN_KEY, PENDING_KEY, COMMAND_KEY]);
  toast(t('popupForgetDone'));
  await render();
});

void render();
