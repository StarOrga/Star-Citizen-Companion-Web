/**
 * Pure, dependency-free core of the SC Companion hangar-import extension.
 *
 * Everything in this module is a plain function over data or over a `Document`
 * handed in by the caller. It touches NO chrome.* API, no globals, no network.
 * That is deliberate: the whole risky surface (permissions, storage, tab
 * opening, UI injection) lives in the thin content scripts, while the parts
 * that are easy to get wrong (DOM parsing, fingerprinting, the nudge policy)
 * stay testable. The web app's Karma suite imports this file directly
 * (src/app/hangar/rsi-hangar-core.spec.ts), so it is covered by `npm test`.
 *
 * It is loaded by the content script via a dynamic `import()` of the
 * web-accessible URL, which is why it may use ESM syntax even though MV3
 * content scripts themselves are classic scripts.
 */

// Keep this list to origins that actually exist. `star-citizen-companion-web`
// was listed here until 2026-08-02 on the assumption that renaming the repo
// renamed Vercel's auto-domain too — it did not (the Vercel project is still
// `star-citizen-companion-website`, which 307s to the alias below). An
// unclaimed *.vercel.app subdomain is registrable by anyone, so leaving a
// non-existent origin in a hand-off allow-list is a standing hijack target.
/** Origins the extension is allowed to hand a payload to. First = default. */
export const COMPANION_ORIGINS = Object.freeze(['https://sc-companion.vercel.app']);

/** Route on the companion app that renders the review/confirm screen. */
export const COMPANION_IMPORT_PATH = '/hangar/import';

/** A dismissal silences THIS exact fleet state for a week. */
export const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bounds — a hangar page crawl must never turn into a crawler. */
export const MAX_PAGES = 10;
export const MAX_SHIPS = 500;

/** Payload schema version handed to the web app (bump on breaking changes). */
export const PAYLOAD_VERSION = 1;

/**
 * Item-kind labels RSI renders for a spaceship, across the locales the site
 * ships. The parser is an ALLOW-list on purpose: a deny-list would let a new
 * cosmetic item type slip through and fuzzy-match a real ship name in the
 * codex, which would silently pollute someone's hangar.
 */
const SHIP_KIND_LABELS = [
  'ship',
  'ships',
  'schiff',
  'schiffe',
  'vaisseau',
  'vaisseaux',
  'nave',
  'naves',
  'navio',
  'nave espacial',
  'statek',
  'statki',
  'корабль',
  'корабли',
  '飞船',
  '船',
  '우주선',
  '宇宙船',
];

/** Container candidates for one pledge row, most specific first. */
const PLEDGE_ROW_SELECTORS = [
  '.pledges .list-items > li',
  '.list-items > li.raw-item',
  '.list-items > li',
  'li.raw-item',
];

/** Where the pledge's own title lives inside a row. */
const PLEDGE_TITLE_SELECTORS = ['.information .title', '.js-pledge-name', '.title'];

/** Where the contained items (ship / skin / decoration / …) live. */
const ITEM_LIST_SELECTORS = ['.items .js-items > li', '.items ul > li', 'ul.js-items > li'];

// ── login detection ──────────────────────────────────────────────────────────

/**
 * Conservative "is this an authenticated hangar page?" check.
 *
 * RSI bounces signed-out visitors from /account/* to /connect, so the strongest
 * signal is simply: we are on an account URL, there is no sign-in form, and the
 * pledge list markup is present. Every ambiguity resolves to `false` — the
 * extension must stay completely invisible when it is not sure.
 *
 * @param {Document} doc
 * @param {string} url
 * @returns {boolean}
 */
export function isLoggedInHangar(doc, url) {
  if (!doc || typeof url !== 'string') return false;
  let path;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (!path.includes('/account/pledges')) return false;

  // A rendered sign-in form means the session expired mid-session.
  if (doc.querySelector('form[action*="/connect"], .signin-form, #signin, .js-signin')) {
    return false;
  }
  // The account shell only renders for a logged-in session.
  const shell = doc.querySelector(
    '.account-content, .sidebar-nav, .account-nav, #account-menu, .pledges, .list-items',
  );
  return !!shell;
}

// ── parsing ──────────────────────────────────────────────────────────────────

function firstMatch(root, selectors) {
  for (const sel of selectors) {
    const hit = root.querySelector(sel);
    if (hit) return hit;
  }
  return null;
}

function allMatches(root, selectors) {
  for (const sel of selectors) {
    const hits = root.querySelectorAll(sel);
    if (hits.length > 0) return Array.from(hits);
  }
  return [];
}

function text(node) {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isShipKind(label) {
  const norm = label.toLowerCase().replace(/[:：]\s*$/, '').trim();
  return SHIP_KIND_LABELS.includes(norm);
}

/**
 * Strip the noise RSI wraps around a ship name in the item list.
 * "Ship  Aurora MR" → "Aurora MR"; "Anvil Carrack - LTI" → "Anvil Carrack".
 * @param {string} raw
 * @returns {string}
 */
export function cleanShipName(raw) {
  let name = raw.replace(/\s+/g, ' ').trim();
  name = name.replace(/\s*[-–—|]\s*(LTI|lti|\d+\s*(months?|monate|mois|meses)\b.*)$/i, '');
  name = name.replace(/^\s*(ship|schiff|vaisseau|nave|statek)\s*[:\-]\s*/i, '');
  return name.trim();
}

/**
 * Extract the ship entries from one rendered RSI pledges page.
 *
 * Tolerant by design: RSI's markup is not a contract and will drift. Anything
 * this parser is unsure about it simply drops — combined with the web app's
 * per-row confirm screen, a partial parse degrades to "import fewer ships",
 * never to "import something wrong".
 *
 * @param {Document} doc a pledges page document
 * @returns {{ships: {name: string, pledgeName: string|null, pledgeId: string|null}[],
 *            pagination: {current: number, last: number}}}
 */
export function parseHangarDocument(doc) {
  const ships = [];
  if (!doc) return { ships, pagination: { current: 1, last: 1 } };

  const rows = allMatches(doc, PLEDGE_ROW_SELECTORS);
  for (const row of rows) {
    const pledgeName = text(firstMatch(row, PLEDGE_TITLE_SELECTORS)) || null;
    const pledgeId =
      row.getAttribute?.('data-pledge-id') ??
      row.querySelector?.('[data-pledge-id]')?.getAttribute('data-pledge-id') ??
      null;

    for (const item of allMatches(row, ITEM_LIST_SELECTORS)) {
      const kind = text(item.querySelector('.kind'));
      if (!kind || !isShipKind(kind)) continue;
      const name = cleanShipName(text(item.querySelector('.title')));
      if (!name) continue;
      ships.push({ name, pledgeName, pledgeId });
      if (ships.length >= MAX_SHIPS) return { ships, pagination: readPagination(doc) };
    }
  }
  return { ships, pagination: readPagination(doc) };
}

/**
 * Read the pledges pagination state. Missing pagination = a single page.
 * @param {Document} doc
 * @returns {{current: number, last: number}}
 */
export function readPagination(doc) {
  let current = 1;
  let last = 1;
  const links = doc?.querySelectorAll?.('.pagination a[href], .pager a[href]') ?? [];
  for (const a of Array.from(links)) {
    const href = a.getAttribute('href') ?? '';
    const m = /[?&]page=(\d+)/.exec(href);
    if (m) last = Math.max(last, Number(m[1]));
  }
  const active = doc?.querySelector?.('.pagination .active, .pagination [aria-current]');
  const activeNum = Number(text(active));
  if (Number.isFinite(activeNum) && activeNum > 0) current = activeNum;
  last = Math.max(last, current);
  return { current, last: Math.min(last, MAX_PAGES) };
}

/**
 * Build the page URLs to crawl for a complete fleet, capped at MAX_PAGES.
 * `pagesize` is forced high so most hangars resolve in a single request.
 *
 * @param {string} baseUrl the current pledges URL
 * @param {number} lastPage
 * @returns {string[]}
 */
export function buildPageUrls(baseUrl, lastPage) {
  const urls = [];
  const pages = Math.min(Math.max(1, lastPage | 0), MAX_PAGES);
  for (let p = 1; p <= pages; p++) {
    const u = new URL(baseUrl);
    u.searchParams.set('page', String(p));
    u.searchParams.set('pagesize', '100');
    urls.push(u.toString());
  }
  return urls;
}

/**
 * Collapse duplicates into counted entries, sorted by name.
 * Two identical ships in the hangar stay two entries in the payload, but the
 * fingerprint below folds them into one `name#count` token.
 *
 * @param {{name: string}[]} ships
 * @returns {{name: string, count: number}[]}
 */
export function countShips(ships) {
  const counts = new Map();
  for (const s of ships) {
    const key = s.name.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { name: s.name, count: 1 });
  }
  return Array.from(counts.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Stable 32-bit FNV-1a over the counted, sorted ship list.
 *
 * Not a security primitive and not meant to be one — it answers exactly one
 * question ("did this fleet change since the last import?") and is chosen over
 * crypto.subtle purely because it is synchronous and trivially testable. A
 * collision costs a missed nudge, nothing else.
 *
 * @param {{name: string}[]} ships
 * @returns {string} 8-char hex
 */
export function fingerprintShips(ships) {
  const canonical = countShips(ships)
    .map((s) => `${s.name.toLowerCase()}#${s.count}`)
    .join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ── the nudge policy ─────────────────────────────────────────────────────────

/**
 * @typedef {{lastImport: {fingerprint: string, at: number}|null,
 *            dismissals: Record<string, number>}} NudgeState
 */

/** @returns {NudgeState} */
export function emptyState() {
  return { lastImport: null, dismissals: {} };
}

/**
 * Normalize whatever came out of chrome.storage.local into a NudgeState.
 * @param {unknown} raw
 * @returns {NudgeState}
 */
export function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const li = obj['lastImport'];
  if (li && typeof li === 'object') {
    const fp = /** @type {Record<string, unknown>} */ (li)['fingerprint'];
    const at = /** @type {Record<string, unknown>} */ (li)['at'];
    if (typeof fp === 'string' && typeof at === 'number') state.lastImport = { fingerprint: fp, at };
  }
  const dis = obj['dismissals'];
  if (dis && typeof dis === 'object') {
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (dis))) {
      if (typeof v === 'number') state.dismissals[k] = v;
    }
  }
  return state;
}

/**
 * The anti-nagging rule, in one place.
 *
 * Offer the import when the fleet is genuinely new information:
 *   - never imported before          → 'first-import'
 *   - fingerprint ≠ last imported    → 'changed'
 * Stay silent when:
 *   - the fingerprint is unchanged   → 'unchanged'  (the "10x a day" complaint)
 *   - this exact fingerprint was dismissed < 7 days ago → 'dismissed'
 *
 * Because the cooldown is keyed by fingerprint, dismissing today does NOT
 * suppress tomorrow's genuinely new ship, while an untouched hangar never
 * asks again after a single "not now".
 *
 * @param {NudgeState} state
 * @param {string} fingerprint
 * @param {number} now epoch ms
 * @returns {{offer: boolean, reason: 'first-import'|'changed'|'unchanged'|'dismissed'}}
 */
export function shouldOfferImport(state, fingerprint, now) {
  const s = normalizeState(state);
  const dismissedAt = s.dismissals[fingerprint];
  if (typeof dismissedAt === 'number' && now - dismissedAt < DISMISS_COOLDOWN_MS) {
    return { offer: false, reason: 'dismissed' };
  }
  if (!s.lastImport) return { offer: true, reason: 'first-import' };
  if (s.lastImport.fingerprint !== fingerprint) return { offer: true, reason: 'changed' };
  return { offer: false, reason: 'unchanged' };
}

/**
 * Record a dismissal and prune expired/overflowing entries so the stored map
 * cannot grow without bound.
 * @param {NudgeState} state
 * @param {string} fingerprint
 * @param {number} now
 * @returns {NudgeState}
 */
export function recordDismissal(state, fingerprint, now) {
  const s = normalizeState(state);
  const dismissals = {};
  for (const [fp, at] of Object.entries(s.dismissals)) {
    if (now - at < DISMISS_COOLDOWN_MS) dismissals[fp] = at;
  }
  dismissals[fingerprint] = now;
  const entries = Object.entries(dismissals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  return { lastImport: s.lastImport, dismissals: Object.fromEntries(entries) };
}

/**
 * Record a completed import. Drops the dismissal for that fingerprint — the
 * fleet state is now "known", the cooldown has nothing left to suppress.
 * @param {NudgeState} state
 * @param {string} fingerprint
 * @param {number} now
 * @returns {NudgeState}
 */
export function recordImport(state, fingerprint, now) {
  const s = normalizeState(state);
  const dismissals = { ...s.dismissals };
  delete dismissals[fingerprint];
  return { lastImport: { fingerprint, at: now }, dismissals };
}

/**
 * Clear the cooldown for a fingerprint so the popup can re-open an offer the
 * user dismissed earlier.
 * @param {NudgeState} state
 * @param {string} fingerprint
 * @returns {NudgeState}
 */
export function clearDismissal(state, fingerprint) {
  const s = normalizeState(state);
  const dismissals = { ...s.dismissals };
  delete dismissals[fingerprint];
  return { lastImport: s.lastImport, dismissals };
}

// ── handover payload ─────────────────────────────────────────────────────────

/**
 * Shape the parsed fleet into the payload the web app reviews.
 *
 * Field names mirror the Hangar Transfer Format the app's file importer
 * already understands (`name` / `ship_name` / `ship_code` / `entity_type`), so
 * the extension reuses the existing matching + confirm UI instead of adding a
 * second code path. `ship_code` is always null: RSI's hangar page shows display
 * names only, never our catalog class names.
 *
 * Note what is NOT in here: no account name, no handle, no e-mail, no pledge
 * value, no order id, no cookie, no token. Only ship names and the pledge
 * label they came from, which is what the user asked to import.
 *
 * @param {{name: string, pledgeName: string|null}[]} ships
 * @param {number} capturedAt
 * @returns {{version: number, source: string, capturedAt: number, fingerprint: string,
 *            ships: {name: string, ship_name: string|null, ship_code: null, entity_type: 'ship'}[]}}
 */
export function toCompanionPayload(ships, capturedAt) {
  return {
    version: PAYLOAD_VERSION,
    source: 'rsi-hangar',
    capturedAt,
    fingerprint: fingerprintShips(ships),
    ships: ships.slice(0, MAX_SHIPS).map((s) => ({
      name: s.name,
      ship_name: s.pledgeName ?? null,
      ship_code: null,
      entity_type: /** @type {'ship'} */ ('ship'),
    })),
  };
}

/**
 * Build the companion URL the extension opens after a confirmed import click.
 * @param {string} origin must be one of COMPANION_ORIGINS
 * @returns {string}
 */
export function companionImportUrl(origin) {
  const base = COMPANION_ORIGINS.includes(origin) ? origin : COMPANION_ORIGINS[0];
  return `${base}${COMPANION_IMPORT_PATH}?src=extension`;
}
