/**
 * Content script for the user's own RSI hangar page
 * (robertsspaceindustries.com/…/account/pledges).
 *
 * What it does: reads the ship names already rendered in the page the user is
 * looking at, decides — using the fingerprint rule in hangar-core.js — whether
 * that fleet is new information, and if so offers a one-click handover to
 * Star Citizen Companion.
 *
 * What it never does: read, store or transmit credentials, cookies, session
 * tokens, the account handle, e-mail, pledge value or order data. It opens no
 * connection to any server other than robertsspaceindustries.com itself (the
 * same pagination requests the page makes when you click "next page"), and
 * nothing is sent anywhere until the user clicks Import — at which point the
 * data travels through chrome.storage.local into a Companion tab in the same
 * browser, never over the network from here.
 */
(async () => {
  const FLAG = '__scCompanionHangarImport';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const STATE_KEY = 'nudgeState';
  const SCAN_KEY = 'lastScan';
  const PENDING_KEY = 'pendingImport';
  const COMMAND_KEY = 'uiCommand';
  /** Re-crawling the pledge pages on every visit would be rude; 15 min is plenty. */
  const SCAN_TTL_MS = 15 * 60 * 1000;

  let core;
  try {
    core = await import(chrome.runtime.getURL('src/lib/hangar-core.js'));
  } catch {
    return; // extension reloading / resource unavailable — stay invisible
  }

  if (!core.isLoggedInHangar(document, location.href)) return;

  /** @type {{name: string, pledgeName: string|null}[] | null} */
  let cachedShips = null;

  // ── data ───────────────────────────────────────────────────────────────────

  /**
   * Collect the complete fleet. Page 1 comes from the DOM already in front of
   * the user; further pages are fetched same-origin exactly like clicking the
   * site's own pagination, with pagesize forced up so most hangars need one
   * extra request at most.
   */
  async function collectShips() {
    const visible = core.parseHangarDocument(document);
    if (visible.pagination.last <= 1) return visible.ships;

    const parser = new DOMParser();
    const load = async (url) => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return parser.parseFromString(await res.text(), 'text/html');
      } catch {
        // A failed page just means a shorter list; the review screen shows the
        // count so the user can spot an incomplete crawl before confirming.
        return null;
      }
    };

    // Re-read page 1 with the large pagesize first: it usually swallows the
    // whole hangar, and its pagination tells us how many pages are really left
    // (the visible page's pagination counts 10-item pages).
    const urls = core.buildPageUrls(location.href, core.MAX_PAGES);
    const firstDoc = await load(urls[0]);
    if (!firstDoc) return visible.ships;

    const first = core.parseHangarDocument(firstDoc);
    /** @type {{name: string, pledgeName: string|null}[]} */
    const all = [...first.ships];
    for (let page = 2; page <= first.pagination.last; page++) {
      const doc = await load(urls[page - 1]);
      if (doc) all.push(...core.parseHangarDocument(doc).ships);
    }
    return all.length > 0 ? all : visible.ships;
  }

  async function readState() {
    const bag = await chrome.storage.local.get([STATE_KEY]);
    return core.normalizeState(bag[STATE_KEY]);
  }

  async function writeState(state) {
    await chrome.storage.local.set({ [STATE_KEY]: state });
  }

  // ── banner ─────────────────────────────────────────────────────────────────

  let host = null;

  /** All banner copy comes from _locales (en/de) — no hardcoded UI strings. */
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

  function removeBanner() {
    host?.remove();
    host = null;
  }

  /**
   * The offer UI lives in a closed-off shadow root so neither RSI's CSS nor
   * ours can leak into the other, and so the page cannot read our markup.
   */
  function showBanner(shipCount, fingerprint, reason) {
    removeBanner();
    host = document.createElement('div');
    host.id = 'sc-companion-hangar-import';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
          width: 340px; max-width: calc(100vw - 32px);
          font-family: "Segoe UI", system-ui, sans-serif; color: #e6edf3;
          background: #0d1b26; border: 1px solid #1f6f8b; border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 14px 16px;
        }
        h2 { margin: 0 0 6px; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; color: #4fd3ff; }
        p { margin: 0 0 10px; font-size: 13px; line-height: 1.5; color: #c2d1dc; }
        .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        button { font: inherit; font-size: 13px; border-radius: 6px; cursor: pointer; padding: 7px 12px; border: 1px solid #2a4b5e; background: transparent; color: #c2d1dc; }
        button.primary { background: #4fd3ff; border-color: #4fd3ff; color: #06141d; font-weight: 600; }
        button:disabled { opacity: .6; cursor: default; }
        .link { background: none; border: 0; color: #7fbfd8; padding: 4px 0; text-decoration: underline; font-size: 12px; }
        .privacy { margin-top: 10px; font-size: 12px; line-height: 1.5; color: #9fb3c1; border-top: 1px solid #1c3341; padding-top: 8px; }
        .privacy ul { margin: 6px 0 0; padding-left: 16px; }
        .close { position: absolute; top: 8px; right: 10px; border: 0; background: none; color: #7f95a5; font-size: 15px; padding: 2px 6px; }
        [hidden] { display: none !important; }
      </style>
      <div class="card" role="dialog" data-el="dialog">
        <button class="close" data-act="dismiss" data-t-title="bannerNotNow">✕</button>
        <h2 data-t="bannerTitle"></h2>
        <p data-el="lead"></p>
        <div class="row">
          <button class="primary" data-act="import" data-t="bannerImport"></button>
          <button data-act="dismiss" data-t="bannerNotNow"></button>
        </div>
        <button class="link" data-act="toggle-privacy" data-t="bannerPrivacyToggle"></button>
        <div class="privacy" hidden data-el="privacy">
          <span data-t="bannerPrivacyIntro"></span>
          <ul>
            <li data-t="privacyNoCredentials"></li>
            <li data-t="privacyNoPersonalData"></li>
            <li data-t="privacyNoUpload"></li>
          </ul>
        </div>
      </div>`;

    for (const el of root.querySelectorAll('[data-t]')) {
      el.textContent = t(el.getAttribute('data-t'));
    }
    for (const el of root.querySelectorAll('[data-t-title]')) {
      el.setAttribute('title', t(el.getAttribute('data-t-title')));
    }
    root.querySelector('[data-el="dialog"]').setAttribute('aria-label', t('bannerTitle'));
    root.querySelector('[data-el="lead"]').textContent =
      reason === 'changed' ? t('bannerLeadChanged', shipCount) : t('bannerLeadNew', shipCount);

    root.addEventListener('click', async (ev) => {
      const act = ev.target?.getAttribute?.('data-act');
      if (!act) return;
      if (act === 'toggle-privacy') {
        const box = root.querySelector('[data-el="privacy"]');
        box.hidden = !box.hidden;
        return;
      }
      if (act === 'dismiss') {
        await writeState(core.recordDismissal(await readState(), fingerprint, Date.now()));
        removeBanner();
        return;
      }
      if (act === 'import') {
        const btn = root.querySelector('[data-act="import"]');
        btn.disabled = true;
        btn.textContent = t('bannerPreparing');
        await handOver();
      }
    });

    document.documentElement.appendChild(host);
  }

  // ── handover ───────────────────────────────────────────────────────────────

  /**
   * Stash the payload for the Companion bridge script and open the review tab.
   * `window.open` under a user gesture keeps the extension free of the `tabs`
   * permission, and chrome.storage.local keeps the data inside the browser —
   * there is no endpoint, no token and no server call in this path.
   */
  async function handOver() {
    const ships = cachedShips ?? (await collectShips());
    const payload = core.toCompanionPayload(ships, Date.now());
    await chrome.storage.local.set({ [PENDING_KEY]: payload });
    window.open(core.companionImportUrl(core.COMPANION_ORIGINS[0]), '_blank', 'noopener');
    removeBanner();
  }

  // ── entry ──────────────────────────────────────────────────────────────────

  /**
   * @param {boolean} force bypass the nudge rule (explicit request from the popup)
   */
  async function evaluate(force) {
    const now = Date.now();
    const bag = await chrome.storage.local.get([SCAN_KEY]);
    const scan = bag[SCAN_KEY];
    const fresh =
      !force &&
      scan &&
      typeof scan.fingerprint === 'string' &&
      typeof scan.at === 'number' &&
      now - scan.at < SCAN_TTL_MS;

    let fingerprint;
    let count;
    if (fresh) {
      fingerprint = scan.fingerprint;
      count = scan.count ?? 0;
    } else {
      cachedShips = await collectShips();
      if (cachedShips.length === 0) return;
      fingerprint = core.fingerprintShips(cachedShips);
      count = cachedShips.length;
      // Only the fingerprint and the count are persisted between visits —
      // never the ship list itself.
      await chrome.storage.local.set({ [SCAN_KEY]: { fingerprint, count, at: now } });
    }
    if (count === 0) return;

    const state = await readState();
    const verdict = force
      ? { offer: true, reason: 'changed' }
      : core.shouldOfferImport(state, fingerprint, now);
    if (!verdict.offer) return;
    showBanner(count, fingerprint, verdict.reason);
  }

  // The popup can re-open an offer the user dismissed. Piggybacking on
  // storage.onChanged avoids the `tabs` and `scripting` permissions entirely.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[COMMAND_KEY]) return;
    const cmd = changes[COMMAND_KEY].newValue;
    if (cmd?.name === 'offer') void evaluate(true);
  });

  void evaluate(false);
})();
