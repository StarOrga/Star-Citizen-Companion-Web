/**
 * Content script for the Star Citizen Companion origin.
 *
 * It is the only path by which a hangar payload reaches the web app, and it is
 * deliberately dumb: it hands over what the RSI script already stored in
 * chrome.storage.local, and it writes back the "this fleet state is now
 * imported" marker that keeps the update nudge quiet. It performs no network
 * request of any kind and reads nothing from the page except the four messages
 * of the protocol below.
 *
 *   page → extension  hangar-import:request     "do you have a payload for me?"
 *   extension → page  hangar-import:payload     the parsed ship list (or null)
 *   page → extension  hangar-import:committed   user confirmed; remember fingerprint
 *   page → extension  hangar-import:discard     user cancelled; drop the payload
 */
(() => {
  const APP = 'sc-companion-app';
  const EXT = 'sc-companion-extension';
  const STATE_KEY = 'nudgeState';
  const PENDING_KEY = 'pendingImport';
  /** A payload nobody picked up expires rather than lingering in storage. */
  const PENDING_TTL_MS = 30 * 60 * 1000;

  const version = chrome.runtime.getManifest().version;

  // Presence marker: lets the app hide the "install the extension" promo for
  // users who already have it. Nothing but the version is exposed.
  const mark = () => {
    if (document.documentElement) {
      document.documentElement.setAttribute('data-sc-companion-extension', version);
    }
  };
  mark();
  document.addEventListener('DOMContentLoaded', mark, { once: true });

  const reply = (message) => window.postMessage({ ...message, source: EXT, version }, location.origin);

  async function loadCore() {
    return import(chrome.runtime.getURL('src/lib/hangar-core.js'));
  }

  async function sendPending() {
    let payload = null;
    try {
      const bag = await chrome.storage.local.get([PENDING_KEY]);
      const candidate = bag[PENDING_KEY];
      if (
        candidate &&
        typeof candidate === 'object' &&
        typeof candidate.capturedAt === 'number' &&
        Date.now() - candidate.capturedAt < PENDING_TTL_MS &&
        Array.isArray(candidate.ships)
      ) {
        payload = candidate;
      } else if (candidate) {
        await chrome.storage.local.remove(PENDING_KEY);
      }
    } catch {
      payload = null;
    }
    reply({ type: 'hangar-import:payload', payload });
  }

  async function commit(fingerprint) {
    try {
      const core = await loadCore();
      const bag = await chrome.storage.local.get([STATE_KEY]);
      const next = core.recordImport(core.normalizeState(bag[STATE_KEY]), fingerprint, Date.now());
      await chrome.storage.local.set({ [STATE_KEY]: next });
      await chrome.storage.local.remove(PENDING_KEY);
    } catch {
      /* storage unavailable — worst case the user is offered the import again */
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.source !== APP) return;

    if (data.type === 'hangar-import:request') {
      void sendPending();
      return;
    }
    if (data.type === 'hangar-import:committed' && typeof data.fingerprint === 'string') {
      void commit(data.fingerprint);
      return;
    }
    if (data.type === 'hangar-import:discard') {
      void chrome.storage.local.remove(PENDING_KEY);
    }
  });
})();
