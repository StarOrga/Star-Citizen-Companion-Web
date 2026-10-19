// sc-events-sync matcher — pure, deterministic logic (no Deno / network APIs).
//
// Turns a page of Comm-Links from the Star Citizen Wiki API
// (https://api.star-citizen.wiki/api/comm-links) into event-date candidates:
//
//   1. Title match: a Comm-Link whose title names a known event family
//      ("Luminalia 2956", "Intergalactic Aerospace Expo 2956 Free Fly …")
//      → the date range closest to the family keyword in its body.
//   2. TWISC match: "This Week in Star Citizen" bodies that mention a family
//      with a date range right after the mention.
//
// Everything that is not a clean, plausible date range is reported as
// "unsure" (title matched, no dates) so the caller can ask the AI fallback or
// log `needs_review`. Nothing here ever guesses.
//
// Runs under `deno test` and `node --test matcher.test.ts` (erasable TS only).

/** Bump whenever matching/extraction rules change — recorded on every run. */
export const PARSER_VERSION = '1.0.0';

export type EventKind = 'expo' | 'showcase' | 'seasonal' | 'community' | 'free-fly';

export interface EventFamily {
  series: string;
  /** Id prefix for rows the scraper creates: `${prefix}-${inGameYear}`. */
  prefix: string;
  name: string;
  kind: EventKind;
  freeFly: boolean;
  /** Matches a Comm-Link title / body mention of this family. */
  pattern: RegExp;
  /** Upper bound for a plausible duration, in days (end - start). */
  maxDays: number;
  /** Recurs yearly → the scraper rolls an `estimated` row forward. */
  annual: boolean;
  summary: { en: string; de: string };
}

export const FAMILIES: readonly EventFamily[] = [
  { series: 'invictus', prefix: 'inv', name: 'Invictus Launch Week', kind: 'expo', freeFly: true, pattern: /\b(invictus(?: launch week)?|defensecon)\b/i, maxDays: 30, annual: true,
    summary: { en: 'Military ship expo with a Free Fly.', de: 'Militär-Schiffsmesse mit Free Fly.' } },
  { series: 'iae', prefix: 'iae', name: 'Intergalactic Aerospace Expo', kind: 'expo', freeFly: true, pattern: /\b([Ii]ntergalactic [Aa]erospace [Ee]xpo|IAE)\b/, maxDays: 30, annual: true,
    summary: { en: 'Annual ship expo with daily manufacturer halls and a Free Fly.', de: 'Jährliche Schiffsmesse mit täglichen Herstellerhallen und Free Fly.' } },
  { series: 'luminalia', prefix: 'lum', name: 'Luminalia', kind: 'seasonal', freeFly: false, pattern: /\bluminalia\b/i, maxDays: 30, annual: true,
    summary: { en: 'Winter festival with a daily gift calendar.', de: 'Winterfest mit täglichem Geschenkekalender.' } },
  { series: 'day-of-the-vara', prefix: 'dotv', name: 'Day of the Vara', kind: 'seasonal', freeFly: false, pattern: /\bday of the vara\b/i, maxDays: 45, annual: true,
    summary: { en: 'Halloween-style festival with contests and themed paints.', de: 'Halloween-artiges Fest mit Wettbewerben und Themen-Lackierungen.' } },
  { series: 'red-festival', prefix: 'red', name: 'Red Festival', kind: 'seasonal', freeFly: false, pattern: /\bred festival\b/i, maxDays: 30, annual: true,
    summary: { en: 'Lunar New Year red-envelope hunt with zodiac paints.', de: 'Mondneujahrs-Fest mit Rote-Umschlag-Suche und Tierkreis-Lackierungen.' } },
  { series: 'stella-fortuna', prefix: 'sf', name: 'Stella Fortuna', kind: 'seasonal', freeFly: false, pattern: /\bstella fortuna\b/i, maxDays: 30, annual: true,
    summary: { en: 'Green-and-gold festival of luck and racing.', de: 'Grün-goldenes Fest des Glücks und der Rennen.' } },
  { series: 'coramor', prefix: 'cor', name: 'Coramor', kind: 'seasonal', freeFly: true, pattern: /\bcoramor\b/i, maxDays: 30, annual: true,
    summary: { en: 'Valentine-style celebration with themed paints.', de: 'Valentins-artiges Fest mit Themen-Lackierungen.' } },
  { series: 'foundation-festival', prefix: 'ff', name: 'Foundation Festival', kind: 'community', freeFly: true, pattern: /\bfoundation festival\b/i, maxDays: 30, annual: true,
    summary: { en: 'Welcome event for new players with Guide System rewards.', de: 'Willkommens-Event für neue Spieler mit Guide-System-Belohnungen.' } },
  { series: 'citizencon', prefix: 'cc', name: 'CitizenCon', kind: 'showcase', freeFly: false, pattern: /\bcitizencon\b/i, maxDays: 3, annual: true,
    summary: { en: 'Annual Star Citizen showcase.', de: 'Jährlicher Star-Citizen-Showcase.' } },
  { series: 'alien-week', prefix: 'aw', name: 'Alien Week', kind: 'seasonal', freeFly: false, pattern: /\balien week\b/i, maxDays: 30, annual: true,
    summary: { en: 'Celebration of the alien species of the \'verse.', de: 'Fest der außerirdischen Spezies im Verse.' } },
  { series: 'ship-showdown', prefix: 'ss', name: 'Ship Showdown', kind: 'community', freeFly: false, pattern: /\bship showdown\b/i, maxDays: 45, annual: true,
    summary: { en: 'Community vote for the favourite ship of the year.', de: 'Community-Abstimmung über das Lieblingsschiff des Jahres.' } },
  { series: 'pirate-week', prefix: 'pw', name: 'Pirate Week', kind: 'seasonal', freeFly: false, pattern: /\bpirate week\b/i, maxDays: 30, annual: true,
    summary: { en: 'Pirate-themed paints and a treasure hunt.', de: 'Piraten-Lackierungen und eine Schatzsuche.' } },
  { series: 'captains-of-industry', prefix: 'coi', name: 'Captains of Industry', kind: 'expo', freeFly: true, pattern: /\bcaptains of industry\b/i, maxDays: 30, annual: true,
    summary: { en: 'Industrial careers event with a Free Fly.', de: 'Industrie-Karriere-Event mit Free Fly.' } },
  { series: 'fleet-week', prefix: 'fw', name: 'Fleet Week', kind: 'expo', freeFly: true, pattern: /\bfleet week\b/i, maxDays: 30, annual: false,
    summary: { en: 'Fleet Week ship event.', de: 'Fleet-Week-Schiffsevent.' } },
  { series: 'jumptown', prefix: 'jt', name: 'Jumptown', kind: 'community', freeFly: false, pattern: /\bjump ?town\b/i, maxDays: 21, annual: false,
    summary: { en: 'Contested drug-lab event.', de: 'Umkämpftes Drogenlabor-Event.' } },
  { series: 'rsi-discovery-month', prefix: 'discovery', name: 'Discovery Month', kind: 'showcase', freeFly: false, pattern: /\bdiscovery month\b/i, maxDays: 35, annual: false,
    summary: { en: 'Manufacturer celebration month.', de: 'Hersteller-Themenmonat.' } },
  // Generic Free Fly last: only used when no named family matched the title.
  { series: 'free-fly', prefix: 'free-fly', name: 'Free Fly', kind: 'free-fly', freeFly: true, pattern: /\bfree[- ]fly\b/i, maxDays: 21, annual: false,
    summary: { en: 'Free Fly: play Star Citizen for free during the event.', de: 'Free Fly: Star Citizen während des Events kostenlos spielen.' } },
];

/** Titles that name a family but never define its dates. */
const TITLE_NOISE = /\b(winners?|results|recap|wrap[- ]?up|monthly report|roadmap|patch|alpha \d|q&a|faq|behind the|inside star citizen|star citizen live)\b/i;
const TWISC_TITLE = /^this week in star citizen\b/i;

export interface CommLink {
  id: number;
  title: string;
  url: string;
  publishedAt: string; // ISO timestamp
  body: string;
}

export interface Candidate {
  series: string;
  start: string; // YYYY-MM-DD
  end: string;
  url: string;
  commLinkId: number;
  publishedAt: string;
  source: 'title' | 'twisc' | 'ai';
  freeFly: boolean;
}

export interface Unsure {
  series: string;
  commLinkId: number;
  title: string;
  url: string;
  publishedAt: string;
  reason: string;
  excerpt: string;
}

// ---------------------------------------------------------------- validation

/** Schema check for one wiki API item. Returns null when the shape is off. */
export function parseCommLink(raw: unknown): CommLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0) return null;
  if (typeof r.title !== 'string' || !r.title.trim()) return null;
  if (typeof r.rsi_url !== 'string' || !isRsiUrl(r.rsi_url)) return null;
  if (typeof r.created_at !== 'string' || Number.isNaN(Date.parse(r.created_at))) return null;
  let body = '';
  const tr = r.translations;
  if (tr && typeof tr === 'object') {
    const en = (tr as Record<string, unknown>).en_EN;
    if (typeof en === 'string') body = en;
  }
  return { id: r.id, title: r.title.trim(), url: r.rsi_url, publishedAt: new Date(r.created_at).toISOString(), body: body.slice(0, 60000) };
}

export function isRsiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && (u.hostname === 'robertsspaceindustries.com' || u.hostname === 'www.robertsspaceindustries.com');
  } catch {
    return false;
  }
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(?:,?\\s*(20\\d{2}))?';
const SEP = '\\s*(?:-|–|—|to|through|thru|until|till)\\s*';
// "October 21 – November 3, 2026" / "Oct 21, 2026 to Nov 3"
const RANGE_TWO_MONTHS = new RegExp(`\\b${MON}\\s+${DAY}${YEAR}${SEP}${MON}\\s+${DAY}${YEAR}`, 'gi');
// "October 21–27, 2026"
const RANGE_ONE_MONTH = new RegExp(`\\b${MON}\\s+${DAY}${SEP}${DAY}\\b${YEAR}`, 'gi');
// "21 October – 3 November"
const RANGE_DAY_FIRST = new RegExp(`\\b${DAY}\\s+${MON}${SEP}${DAY}\\s+${MON}${YEAR}`, 'gi');
// "October 10, 2026" (single day)
const SINGLE = new RegExp(`\\b${MON}\\s+${DAY}\\b${YEAR}`, 'gi');

export interface DateRange { start: string; end: string; index: number; single: boolean }

function iso(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(s) ? s : null;
}

function month(token: string): number {
  return MONTHS[token.toLowerCase().replace('.', '')] ?? 0;
}

/** Year for a month/day without an explicit year, anchored to the post date. */
function inferYear(m: number, d: number, published: Date): number {
  const y = published.getUTCFullYear();
  const candidate = Date.UTC(y, m - 1, d);
  // A date more than ~2 months before the post refers to next year
  // ("Luminalia runs December 10 to January 2" posted in December, or a
  // January event announced in November).
  return candidate < published.getTime() - 60 * 86400000 ? y + 1 : y;
}

function build(sm: number, sd: number, sy: number | null, em: number, ed: number, ey: number | null, published: Date): { start: string; end: string } | null {
  if (!sm || !em) return null;
  const startYear = sy ?? (ey && em < sm ? ey - 1 : ey) ?? inferYear(sm, sd, published);
  const endYear = ey ?? (em < sm ? startYear + 1 : startYear);
  const start = iso(startYear, sm, sd);
  const end = iso(endYear, em, ed);
  if (!start || !end || end < start) return null;
  return { start, end };
}

/** All date ranges (and single dates) in `text`, in document order. */
export function extractDateRanges(text: string, published: Date): DateRange[] {
  const out: DateRange[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  const push = (r: { start: string; end: string } | null, index: number, len: number, single: boolean) => {
    if (!r || overlaps(index, index + len)) return;
    taken.push([index, index + len]);
    out.push({ ...r, index, single });
  };
  for (const m of text.matchAll(RANGE_TWO_MONTHS)) {
    push(build(month(m[1]), +m[2], m[3] ? +m[3] : null, month(m[4]), +m[5], m[6] ? +m[6] : null, published), m.index!, m[0].length, false);
  }
  for (const m of text.matchAll(RANGE_ONE_MONTH)) {
    const mo = month(m[1]);
    const y = m[4] ? +m[4] : null;
    push(build(mo, +m[2], y, mo, +m[3], y, published), m.index!, m[0].length, false);
  }
  for (const m of text.matchAll(RANGE_DAY_FIRST)) {
    push(build(month(m[2]), +m[1], null, month(m[4]), +m[3], m[5] ? +m[5] : null, published), m.index!, m[0].length, false);
  }
  for (const m of text.matchAll(SINGLE)) {
    const mo = month(m[1]);
    const y = m[3] ? +m[3] : null;
    push(build(mo, +m[2], y, mo, +m[2], y, published), m.index!, m[0].length, true);
  }
  return out.sort((a, b) => a.index - b.index);
}

function days(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Dates must fit the family and sit near the post date. */
export function isPlausible(f: EventFamily, r: { start: string; end: string; single?: boolean }, published: Date, yearHint?: number): boolean {
  const len = days(r.start, r.end);
  if (len < 0 || len > f.maxDays) return false;
  if (r.single && f.maxDays > 3) return false; // a start-only date is not a range
  // A title naming the in-game year ("Luminalia 2956") pins the real year; the
  // wiki's created_at of older posts can be an import date, so trust the title.
  if (yearHint) return Number(r.start.slice(0, 4)) === yearHint;
  const offset = (Date.parse(r.start) - published.getTime()) / 86400000;
  return offset >= -45 && offset <= 240;
}

/** First plausible range after (or shortly before) a keyword mention. */
function rangeNear(f: EventFamily, text: string, published: Date, before: number, after: number, yearHint?: number): { range: DateRange | null; excerpt: string } {
  const anchor = yearHint ? new Date(Date.UTC(yearHint, 0, 1)) : published;
  const ranges = extractDateRanges(text, anchor);
  const re = new RegExp(f.pattern.source, f.pattern.flags.includes('g') ? f.pattern.flags : `${f.pattern.flags}g`);
  let excerpt = '';
  for (const m of text.matchAll(re)) {
    const at = m.index!;
    if (!excerpt) excerpt = text.slice(Math.max(0, at - 100), at + 400);
    const near = ranges
      .filter((r) => r.index >= at - before && r.index <= at + after && isPlausible(f, r, published, yearHint))
      .sort((a, b) => Math.abs(a.index - at) - Math.abs(b.index - at) + (a.index < at ? 50 : 0) - (b.index < at ? 50 : 0));
    if (near.length) return { range: near[0], excerpt };
  }
  return { range: null, excerpt };
}

export function familyForTitle(title: string): EventFamily | null {
  if (TWISC_TITLE.test(title) || TITLE_NOISE.test(title)) return null;
  return FAMILIES.find((f) => f.pattern.test(title)) ?? null;
}

// ---------------------------------------------------------------- matching

export function matchCommLinks(links: CommLink[]): { candidates: Candidate[]; unsure: Unsure[] } {
  const candidates: Candidate[] = [];
  const unsure: Unsure[] = [];
  // The wiki's created_at of older posts is sometimes its (re-)import date.
  // Comm-Link ids grow monotonically, so a post can never be newer than any
  // higher id: clamp to the running minimum. Year inference relies on this.
  const ordered = [...links].sort((a, b) => b.id - a.id);
  let floor = Infinity;
  const clamped = ordered.map((l) => {
    floor = Math.min(floor, Date.parse(l.publishedAt));
    return { ...l, publishedAt: new Date(floor).toISOString() };
  });
  for (const link of clamped) {
    const published = new Date(link.publishedAt);
    if (TWISC_TITLE.test(link.title)) {
      for (const f of FAMILIES) {
        if (f.series === 'free-fly') continue; // too generic inside a TWISC
        const { range } = rangeNear(f, link.body, published, 0, 250);
        // A TWISC only announces what is coming soon: the range must start
        // within ~4 months of the post, or it is a recap / misdated import.
        const lead = range ? (Date.parse(range.start) - published.getTime()) / 86400000 : NaN;
        if (range && !range.single && lead >= -14 && lead <= 120) {
          candidates.push({ series: f.series, start: range.start, end: range.end, url: link.url, commLinkId: link.id, publishedAt: link.publishedAt, source: 'twisc', freeFly: false });
        }
      }
      continue;
    }
    const f = familyForTitle(link.title);
    if (!f) continue;
    const text = `${link.title}\n${link.body}`;
    const ig = /\b(29[4-9]\d)\b/.exec(link.title);
    const yearHint = ig ? Number(ig[1]) - 930 : undefined;
    const anchor = yearHint ? new Date(Date.UTC(yearHint, 0, 1)) : published;
    // Title dates win ("… Free Fly: May 18 – 27"), then the body near a mention.
    const inTitle = extractDateRanges(link.title, anchor).find((r) => isPlausible(f, r, published, yearHint));
    const { range, excerpt } = inTitle ? { range: inTitle, excerpt: '' } : rangeNear(f, text, published, 150, 600, yearHint);
    if (range) {
      candidates.push({ series: f.series, start: range.start, end: range.end, url: link.url, commLinkId: link.id, publishedAt: link.publishedAt, source: 'title', freeFly: f.freeFly || /\bfree[- ]fly\b/i.test(text) });
    } else if (Date.now() - published.getTime() < 60 * 86400000 && !unsure.some((u) => u.series === f.series)) {
      // Only recent posts matter, one per family per run (newest first) -
      // keeps the AI budget and the review list meaningful.
      unsure.push({ series: f.series, commLinkId: link.id, title: link.title, url: link.url, publishedAt: link.publishedAt, reason: 'title matched an event family, no plausible date range', excerpt: (excerpt || link.body.slice(0, 500)).replace(/\s+/g, ' ').slice(0, 600) });
    }
  }
  return { candidates, unsure };
}

// ---------------------------------------------------------------- planning

export interface EventRow {
  id: string;
  series: string;
  kind: string;
  name: string;
  start_date: string;
  end_date: string;
  date_status: 'confirmed' | 'estimated';
  status: string;
  free_fly: boolean;
  url: string;
  locked: boolean;
  hidden: boolean;
  source: string;
  source_comm_link_id: number | null;
  source_published_at: string | null;
}

export interface Upsert {
  id: string;
  series: string;
  kind: string;
  name: string;
  start_date: string;
  end_date: string;
  date_status: 'confirmed' | 'estimated';
  free_fly: boolean;
  url: string;
  summary: { en: string; de: string } | Record<string, never>;
  source: string;
  source_comm_link_id: number | null;
  source_published_at: string | null;
}

export interface Change { id: string; action: 'insert' | 'confirm' | 'update' | 'rollforward'; from?: string; to: string; source: string; url?: string }

const familyBySeries = new Map(FAMILIES.map((f) => [f.series, f]));
const inGameYear = (isoDate: string) => Number(isoDate.slice(0, 4)) + 930;

function pickBest(cands: Candidate[]): Candidate[] {
  // One candidate per series + start month window: title > ai > twisc, newer post wins.
  const rank = { title: 3, ai: 2, twisc: 1 } as const;
  const sorted = [...cands].sort((a, b) => rank[b.source] - rank[a.source] || b.publishedAt.localeCompare(a.publishedAt));
  const kept: Candidate[] = [];
  for (const c of sorted) {
    if (kept.some((k) => k.series === c.series && Math.abs(days(k.start, c.start)) <= 120)) continue;
    kept.push(c);
  }
  return kept;
}

/**
 * Diff candidates against the stored rows. Locked rows are never touched;
 * confirmed rows only move for a newer official post; nothing is deleted.
 */
export function planUpserts(rows: EventRow[], cands: Candidate[], today: string): { upserts: Upsert[]; changes: Change[]; skipped: string[] } {
  const upserts: Upsert[] = [];
  const changes: Change[] = [];
  const skipped: string[] = [];
  const ids = new Set(rows.map((r) => r.id));
  const working = rows.map((r) => ({ ...r }));

  for (const c of pickBest(cands)) {
    const f = familyBySeries.get(c.series);
    if (!f) continue;
    const existing = working
      .filter((r) => r.series === c.series && Math.abs(days(r.start_date, c.start)) <= 120)
      .sort((a, b) => Math.abs(days(a.start_date, c.start)) - Math.abs(days(b.start_date, c.start)))[0];
    if (existing) {
      if (existing.locked) { skipped.push(`${existing.id}: locked`); continue; }
      const same = existing.start_date === c.start && existing.end_date === c.end && existing.date_status === 'confirmed';
      if (same) {
        if (existing.url !== c.url && !existing.url) { /* fill a missing link */ } else continue;
      }
      if (existing.date_status === 'confirmed' && !same && existing.source_published_at && existing.source_published_at >= c.publishedAt) {
        skipped.push(`${existing.id}: confirmed by a newer/equal post`);
        continue;
      }
      if (existing.date_status === 'confirmed' && c.source === 'twisc' && existing.source !== 'twisc' && !same) {
        skipped.push(`${existing.id}: twisc mention does not override a confirmed post`);
        continue;
      }
      upserts.push({
        id: existing.id, series: existing.series, kind: existing.kind, name: existing.name,
        start_date: c.start, end_date: c.end, date_status: 'confirmed', free_fly: existing.free_fly || c.freeFly,
        url: c.url, summary: f.summary, source: c.source, source_comm_link_id: c.commLinkId, source_published_at: c.publishedAt,
      });
      changes.push({ id: existing.id, action: existing.date_status === 'estimated' ? 'confirm' : 'update', from: `${existing.start_date}..${existing.end_date} ${existing.date_status}`, to: `${c.start}..${c.end} confirmed`, source: c.source, url: c.url });
      Object.assign(existing, { start_date: c.start, end_date: c.end, date_status: 'confirmed', url: c.url, source: c.source, source_published_at: c.publishedAt });
    } else {
      if (c.end < addDays(today, -400)) continue; // history the feed would not show anyway
      let id = `${f.prefix}-${inGameYear(c.start)}`;
      for (let n = 2; ids.has(id); n++) id = `${f.prefix}-${inGameYear(c.start)}-${n}`;
      ids.add(id);
      const row: Upsert = {
        id, series: f.series, kind: f.kind, name: `${f.name} ${inGameYear(c.start)}`,
        start_date: c.start, end_date: c.end, date_status: 'confirmed', free_fly: c.freeFly, url: c.url,
        summary: f.summary, source: c.source, source_comm_link_id: c.commLinkId, source_published_at: c.publishedAt,
      };
      upserts.push(row);
      changes.push({ id, action: 'insert', to: `${c.start}..${c.end} confirmed`, source: c.source, url: c.url });
      working.push({ ...row, status: 'scheduled', locked: false, hidden: false, date_status: 'confirmed' });
    }
  }

  // Roll annual families forward so the timeline never runs dry when nobody
  // touches it: when a series has nothing upcoming, add next year's occurrence
  // as `estimated` (same calendar dates as the latest one).
  for (const f of FAMILIES) {
    if (!f.annual) continue;
    const own = working.filter((r) => r.series === f.series && !r.hidden).sort((a, b) => a.start_date.localeCompare(b.start_date));
    // A hidden upcoming row still occupies the slot: hiding it must drop the
    // event from the feed, not make the next run re-add it under a new id.
    if (!own.length || working.some((r) => r.series === f.series && r.end_date >= today)) continue;
    const last = own[own.length - 1];
    let start = addYears(last.start_date, 1);
    let end = addYears(last.end_date, 1);
    while (end < today) { start = addYears(start, 1); end = addYears(end, 1); }
    let id = `${f.prefix}-${inGameYear(start)}`;
    for (let n = 2; ids.has(id); n++) id = `${f.prefix}-${inGameYear(start)}-${n}`;
    ids.add(id);
    upserts.push({
      id, series: f.series, kind: last.kind, name: `${f.name} ${inGameYear(start)}`,
      start_date: start, end_date: end, date_status: 'estimated', free_fly: last.free_fly, url: '',
      summary: { en: `${f.summary.en} Dates estimated from last year until RSI announces them.`, de: `${f.summary.de} Termine aus dem Vorjahr geschätzt, bis RSI sie ankündigt.` },
      source: 'rollforward', source_comm_link_id: null, source_published_at: null,
    });
    changes.push({ id, action: 'rollforward', to: `${start}..${end} estimated`, source: 'rollforward' });
  }
  return { upserts, changes, skipped };
}

export function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(isoDate) + n * 86400000).toISOString().slice(0, 10);
}

function addYears(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y + n}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
