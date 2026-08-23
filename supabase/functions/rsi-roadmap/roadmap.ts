// RSI Roadmap "Release View" → the trimmed payload the patch board renders.
//
// Source: https://robertsspaceindustries.com/api/roadmap/v1/boards/1
// Public, unauthenticated JSON. It is the REST API the roadmap SPA itself uses
// (`/api/roadmap/v1` is hardcoded in RSI's own roadmap/main.js); the GraphQL
// endpoint behind the Progress Tracker answers `CFUException / Internal server
// error` to every un-whitelisted operation and is therefore NOT usable from a
// server. Verified 2026-08-23: `GET /api/roadmap/v1/boards/1` → 200, no cookie,
// no token, no Cloudflare challenge.
//
// The upstream document is ~800 KB: 39 releases back to Alpha 3.1, each with
// its full card list and a derivative map per thumbnail. We keep only the
// releases the reader asked about — the one that is live and the ones that come
// next — and one thumbnail url per card. That is the difference between a
// 3 KB response and a 800 KB one.
//
// Nothing here is hardcoded to a version. "Current" and "next" are derived from
// the board itself, so 4.11 becomes the next patch the day RSI moves it without
// a code change.

export type RoadmapStatus = 'released' | 'committed' | 'tentative' | 'unknown';

export interface RoadmapCard {
  id: string;
  /** RSI's own card slug — stable, and the natural `@for` track key. */
  slug: string;
  name: string;
  /** One-line teaser RSI shows on the card front. */
  description: string;
  /** The longer explanation behind the card. Empty when RSI wrote none. */
  body: string;
  status: RoadmapStatus;
  /** Discipline the card belongs to ("Gameplay", "Ships and Vehicles", …). */
  category: string;
  /** Small RSI-hosted render, or null. Never a non-RSI host. */
  thumbnail: string | null;
}

export interface RoadmapRelease {
  id: string;
  /** As published: `4.9`, `4.10`, `Star Citizen 1.0`. */
  name: string;
  /** RSI's own scheduling note, usually a quarter (`Q3 2026`). */
  quarter: string;
  status: RoadmapStatus;
  /**
   * The patch line this release maps onto (`4.10`), or '' when the name carries
   * no version. It is what ties a roadmap panel to the patch-note history —
   * both sides derive their line from a version string, never from a list.
   */
  patchLine: string;
  cards: RoadmapCard[];
}

export interface RoadmapPayload {
  /** The release that is live right now — see `pickCurrent` for how it is chosen. */
  current: RoadmapRelease | null;
  /** The release right after `current` in the board's own order. */
  next: RoadmapRelease | null;
  /** The two after that, names + status only — a "what comes later" footnote. */
  later: { name: string; quarter: string; status: RoadmapStatus }[];
  /** Live build RSI names in the board description, e.g. `4.9.0`. '' when absent. */
  liveVersion: string;
  /** PTU build RSI names in the board description, e.g. `4.10`. '' when absent. */
  ptuVersion: string;
  /** Deep link to the board this came from. */
  boardUrl: string;
  /** RSI's own `last_updated` for the board, ISO. '' when absent. */
  updatedAt: string;
}

const RSI_BASE = 'https://robertsspaceindustries.com';
export const ROADMAP_BOARD_ID = 1;
export const ROADMAP_BOARD_URL = `${RSI_BASE}/roadmap/board/1-Release-View`;

/** Cards are what makes the payload big; a release never realistically has more. */
const MAX_CARDS_PER_RELEASE = 60;
const MAX_DESCRIPTION = 400;
const MAX_BODY = 900;
/** How many "and after that" releases the footnote names. */
const MAX_LATER = 2;

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Ids as strings, whatever RSI sent.
 *
 * The board mixes both forms in the SAME document — `categories[].id` and
 * `cards[].category_id` are numbers, `releases[].id` is a number, and older
 * records carry strings. A string-only reader silently resolved every card's
 * category to '' (caught by the roadmap tests), which would have shipped a
 * roadmap panel with no discipline labels at all.
 */
function idStr(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  // Cut on a word boundary when there is one close enough to the limit.
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/** RSI's free-text status column → a closed set the UI can style. */
export function normalizeStatus(raw: unknown): RoadmapStatus {
  const v = str(raw).toLowerCase();
  if (v === 'released') return 'released';
  if (v === 'committed') return 'committed';
  if (v === 'tentative') return 'tentative';
  return 'unknown';
}

/**
 * The patch line a roadmap release maps onto.
 *
 * `4.10` → `4.10`, `4.9.1` → `4.9`, `Star Citizen 1.0` → `1.0`, and a name with
 * no version at all → ''. Two segments, because that is the granularity the
 * patch-note history groups by (`patchLineOf` in src/app/news/patch-notes.ts).
 */
export function releasePatchLine(name: string): string {
  const m = /(?:^|[^\d.])(\d{1,2}(?:\.\d{1,2}){0,2})(?![\d.])/.exec(name);
  if (!m) return '';
  const segs = m[1].split('.');
  if (segs.length < 2) return '';
  return segs.slice(0, 2).join('.');
}

/**
 * Only RSI-hosted image urls survive; the board is untrusted content and its
 * thumbnail map is the one field that carries a url we would put in an <img>.
 * Relative paths (older cards store `/media/…`) are resolved against RSI.
 */
export function resolveMediaUrl(raw: unknown): string | null {
  const v = str(raw);
  if (!v) return null;
  try {
    const u = new URL(v.startsWith('//') ? 'https:' + v : v, RSI_BASE);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname;
    if (host !== 'robertsspaceindustries.com' && !host.endsWith('.robertsspaceindustries.com')) return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Card thumbnail, smallest useful variant first.
 *
 * `square` is the ~200 px infobox crop and `rect` the card render; `source` is
 * the full-resolution upload and is deliberately last — a roadmap panel showing
 * twenty 3 MB originals would cost more than the rest of the page together.
 */
function cardThumbnail(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const urls = (raw as Record<string, unknown>)['urls'];
  if (!urls || typeof urls !== 'object') return null;
  const map = urls as Record<string, unknown>;
  for (const key of ['rect', 'square', 'large', 'source']) {
    const url = resolveMediaUrl(map[key]);
    if (url) return url;
  }
  return null;
}

function mapCard(raw: unknown, categories: Map<string, string>): RoadmapCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const name = str(rec['name']);
  if (!name) return null;
  const id = idStr(rec['id']) || str(rec['url_slug']);
  if (!id) return null;
  const rawDescription = str(rec['description']);
  const rawBody = str(rec['body']);
  // RSI very often repeats the description verbatim in `body`. Rendering both
  // would read as a stutter, so the duplicate is dropped — no information is
  // lost, the identical sentence is still on screen once.
  //
  // Compared RAW, before either is clamped: clamping at two different limits
  // turns one long duplicated paragraph into two strings that differ only by
  // where they were cut, which is exactly the stutter this guard exists to
  // prevent. `startsWith` covers the common "body = description + one more
  // sentence" case only when that sentence adds nothing worth a second block.
  const duplicateBody = !!rawBody && (
    rawBody === rawDescription ||
    (rawDescription.length > 0 && rawBody.startsWith(rawDescription) &&
      rawBody.length - rawDescription.length < 20)
  );
  return {
    id,
    slug: str(rec['url_slug']) || id,
    name,
    description: clamp(rawDescription, MAX_DESCRIPTION),
    body: duplicateBody ? '' : clamp(rawBody, MAX_BODY),
    status: normalizeStatus(rec['status']),
    category: categories.get(idStr(rec['category_id'])) ?? '',
    thumbnail: cardThumbnail(rec['thumbnail']),
  };
}

function mapRelease(raw: unknown, categories: Map<string, string>): RoadmapRelease | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const name = str(rec['name']);
  if (!name) return null;
  const rawCards = Array.isArray(rec['cards']) ? rec['cards'] : [];
  const cards: RoadmapCard[] = [];
  for (const c of rawCards) {
    const card = mapCard(c, categories);
    if (card) cards.push(card);
    if (cards.length >= MAX_CARDS_PER_RELEASE) break;
  }
  return {
    id: idStr(rec['id']) || name,
    name,
    quarter: str(rec['description']),
    status: normalizeStatus(rec['status']),
    patchLine: releasePatchLine(name),
    cards,
  };
}

/**
 * `Live Version: 4.9.0 (…) ▪ Latest Roadmap Roundup: … ▪ PTU Version: Alpha 4.10 12442953`
 *
 * RSI maintains that line by hand in the board description, and it is the only
 * place on the board that states which build is actually playable — the
 * releases themselves carry `released: 0` even for shipped patches, so their
 * flag cannot be trusted for it. Parsed defensively: a miss returns '' and the
 * caller falls back to the status column.
 */
export function parseBoardVersions(description: string): { live: string; ptu: string } {
  const version = (label: string): string => {
    const re = new RegExp(`${label}\\s*Version\\s*:?\\s*(?:alpha\\s*)?v?(\\d{1,2}(?:\\.\\d{1,2}){0,2})`, 'i');
    return re.exec(description)?.[1] ?? '';
  };
  return { live: version('live'), ptu: version('ptu') };
}

/**
 * Which release is the one you can play right now.
 *
 * First choice is the build RSI names in the board description, matched on its
 * patch line (`4.9.0` → the `4.9` release). That is the authoritative statement
 * and it survives RSI leaving a release's status on "Released" for a while.
 * Failing that, the LAST release in board order whose status is `released` —
 * board order is RSI's own chronology, so "last released" is "newest shipped".
 */
export function pickCurrent(releases: readonly RoadmapRelease[], liveVersion: string): number {
  const line = releasePatchLine(liveVersion);
  if (line) {
    const byLine = releases.findIndex((r) => r.patchLine === line);
    if (byLine >= 0) return byLine;
  }
  for (let i = releases.length - 1; i >= 0; i--) {
    if (releases[i].status === 'released') return i;
  }
  return -1;
}

/**
 * Parse the Release View board into the payload the patch board renders.
 *
 * Returns null when the document is not a board at all (RSI error envelope,
 * HTML error page, changed shape) — the caller then keeps whatever it had
 * cached rather than overwriting good data with an empty payload.
 */
export function parseRoadmapBoard(raw: unknown): RoadmapPayload | null {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const data = root && root['data'] && typeof root['data'] === 'object'
    ? (root['data'] as Record<string, unknown>)
    : null;
  if (!data || !Array.isArray(data['releases'])) return null;

  const categories = new Map<string, string>();
  if (Array.isArray(data['categories'])) {
    for (const c of data['categories']) {
      if (!c || typeof c !== 'object') continue;
      const rec = c as Record<string, unknown>;
      const id = idStr(rec['id']);
      const name = str(rec['name']);
      if (id && name) categories.set(id, name);
    }
  }

  // Board order is RSI's chronology; `order` is authoritative and the array is
  // not guaranteed to arrive sorted.
  const ordered = [...(data['releases'] as unknown[])].sort((a, b) => {
    const oa = Number((a as Record<string, unknown>)?.['order'] ?? 0);
    const ob = Number((b as Record<string, unknown>)?.['order'] ?? 0);
    return (Number.isFinite(oa) ? oa : 0) - (Number.isFinite(ob) ? ob : 0);
  });

  const releases: RoadmapRelease[] = [];
  for (const r of ordered) {
    const release = mapRelease(r, categories);
    if (release) releases.push(release);
  }

  const versions = parseBoardVersions(str(data['description']));
  const currentIdx = pickCurrent(releases, versions.live);
  const current = currentIdx >= 0 ? releases[currentIdx] : null;
  const next = currentIdx >= 0 ? releases[currentIdx + 1] ?? null : null;
  const later = (currentIdx >= 0 ? releases.slice(currentIdx + 2) : [])
    .slice(0, MAX_LATER)
    .map((r) => ({ name: r.name, quarter: r.quarter, status: r.status }));

  const lastUpdated = Number(data['last_updated']);

  return {
    current,
    next,
    later,
    liveVersion: versions.live,
    ptuVersion: versions.ptu,
    boardUrl: ROADMAP_BOARD_URL,
    // RSI stores it as Unix seconds; an absurd value is dropped rather than
    // thrown at `new Date(...).toISOString()`, which would take the whole parse
    // down with a RangeError.
    updatedAt: Number.isFinite(lastUpdated) && lastUpdated > 0 && lastUpdated < 4102444800
      ? new Date(lastUpdated * 1000).toISOString()
      : '',
  };
}
