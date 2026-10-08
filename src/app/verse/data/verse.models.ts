import type { VerseBetaArea } from '../../core/analytics.service';

export type { VerseBetaArea } from '../../core/analytics.service';

/** Every opt-in area of the β switch, in menu order. */
export const VERSE_BETA_AREAS: readonly VerseBetaArea[] = ['briefing', 'news', 'patches', 'gallery', 'starmap'];

/** The server-validated star pool (migration 20261009100000_verse_hub.sql). */
export type VerseStarKey =
  | 'notes'
  | 'archive'
  | 'loadout'
  | 'comet'
  | 'cx-newship'
  | 'cx-keybinds'
  | 'cx-changed'
  | 'cx-blueprint'
  | 'cx-fps'
  | 'cx-loadout';

export const VERSE_STAR_KEYS: readonly VerseStarKey[] = [
  'notes',
  'archive',
  'loadout',
  'comet',
  'cx-newship',
  'cx-keybinds',
  'cx-changed',
  'cx-blueprint',
  'cx-fps',
  'cx-loadout',
];

export type VerseItemKind = 'news' | 'patch' | 'gallery' | 'link';
export type VerseDoor = 'news' | 'patches' | 'gallery';

/** One ranked briefing entry. `url` is an in-app path (starts with `/`) or an https link. */
export interface VerseDigestItem {
  readonly key: string;
  readonly kind: VerseItemKind;
  readonly title: string;
  readonly url: string | null;
  readonly summary: string | null;
  readonly image: string | null;
  /** ISO timestamp of the source event (publish / LIVE / detection). */
  readonly at: string | null;
  readonly pinned: boolean;
  readonly score: number;
  readonly rank: number;
}

export interface VerseGateCount {
  readonly recent: number;
  readonly total?: number;
}

export interface VersePatchStatus {
  readonly line: string;
  readonly liveAt: string | null;
  /** channel → version, e.g. `{ live: '4.3.1', ptu: '4.4.0' }`. */
  readonly channels: Readonly<Record<string, string>>;
  readonly status: 'live' | 'ptu';
}

export interface VerseDigest {
  readonly generatedAt: string;
  /** Up to 7 items, server rank order. */
  readonly items: readonly VerseDigestItem[];
  /** Adaptive list length, 3..7. */
  readonly suggested: number;
  readonly patch: VersePatchStatus | null;
  readonly counts: Readonly<Record<VerseDoor, VerseGateCount>>;
}

export interface PatchReadiness {
  readonly patchLine: string;
  readonly checklist: Readonly<Record<string, boolean>>;
  readonly updatedAt: string;
}

export interface PatchPrediction {
  readonly patchLine: string;
  /** `YYYY-MM-DD`. */
  readonly predictedLiveDate: string;
  readonly createdAt: string;
}

export interface PredictionMedian {
  readonly patchLine: string;
  /** `YYYY-MM-DD`. */
  readonly median: string;
  readonly votes: number;
}

/** Normalised [x, y] in 0..1, exactly 7 per constellation. */
export type VersePoint = readonly [number, number];

export interface VerseConstellation {
  readonly patchLine: string;
  readonly className: string;
  readonly kind: 'ship' | 'ground';
  readonly points: readonly VersePoint[];
}

export interface VerseExplorerPatch {
  readonly patchLine: string;
  readonly liveAt: string | null;
  readonly stars: readonly VerseStarKey[];
  readonly starCount: number;
  readonly sun: boolean;
  /** The <= 7 keys offered for this patch. */
  readonly offered: readonly VerseStarKey[];
  readonly constellation: Omit<VerseConstellation, 'patchLine'> | null;
  readonly unlocks: { readonly logEntry: boolean; readonly community: boolean; readonly wallpaper: boolean };
}

export interface VerseExplorerState {
  /** Newest first. */
  readonly patches: readonly VerseExplorerPatch[];
  readonly totalStars: number;
  /** Patch lines with a sun (comet hit within +-2 days). */
  readonly suns: readonly string[];
  readonly streak: {
    readonly current: number;
    readonly best: number;
    readonly reserveAvailable: boolean;
    readonly reservesUsed: number;
  };
  readonly kartograph: { readonly unlocked: boolean; readonly rank: number };
  /** Streak rewards unlock on the best streak: road 2, nebula 3, live 4, reserve 5, meteor 6, supernova 7. */
  readonly rewards: {
    readonly road: boolean;
    readonly nebula: boolean;
    readonly live: boolean;
    readonly reserve: boolean;
    readonly meteor: boolean;
    readonly supernova: boolean;
    readonly sunCollection: boolean;
  };
}

/** Anon-safe aggregate of a patch line (verse_community_stars): counts only. */
export interface VerseCommunityStars {
  readonly patchLine: string;
  readonly explorers: number;
  readonly stars: Readonly<Partial<Record<VerseStarKey, number>>>;
}

export type VerseSuggestionStatus = 'open' | 'pinned' | 'dismissed';

/** A Kartograph's top-item suggestion (verse_suggestions). */
export interface VerseSuggestion {
  readonly id: string;
  readonly itemUrl: string;
  readonly note: string | null;
  readonly status: VerseSuggestionStatus;
  readonly createdAt: string;
}

/** Outcome of a user action; `errorKey` is an `errors.*` i18n key. */
export type VerseResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly errorKey: string };

export type VerseLoadState = 'idle' | 'loading' | 'ready' | 'error';

// ---------------------------------------------------------------- mappers

type Row = Record<string, unknown>;

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const sn = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const b = (v: unknown): boolean => v === true;
const obj = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const starKeys = (v: unknown): VerseStarKey[] =>
  arr(v).filter((k): k is VerseStarKey => VERSE_STAR_KEYS.includes(k as VerseStarKey));

function mapPoints(v: unknown): VersePoint[] {
  return arr(v).map((p) => {
    const a = arr(p);
    return [n(a[0]), n(a[1])] as const;
  });
}

export function mapDigest(raw: unknown): VerseDigest | null {
  const r = obj(raw);
  if (!Array.isArray(r['items'])) return null;
  const counts = obj(r['counts']);
  const gate = (k: VerseDoor): VerseGateCount => {
    const g = obj(counts[k]);
    return g['total'] === undefined ? { recent: n(g['recent']) } : { recent: n(g['recent']), total: n(g['total']) };
  };
  const p = r['patch'] ? obj(r['patch']) : null;
  return {
    generatedAt: s(r['generated_at']),
    items: arr(r['items']).map((x) => {
      const i = obj(x);
      return {
        key: s(i['key']),
        kind: s(i['kind']) as VerseItemKind,
        title: s(i['title']),
        url: sn(i['url']),
        summary: sn(i['summary']),
        image: sn(i['image']),
        at: sn(i['at']),
        pinned: b(i['pinned']),
        score: n(i['score']),
        rank: n(i['rank']),
      };
    }),
    suggested: Math.min(7, Math.max(3, n(r['suggested']) || 3)),
    patch: p
      ? {
          line: s(p['line']),
          liveAt: sn(p['live_at']),
          channels: Object.fromEntries(Object.entries(obj(p['channels'])).map(([k, v]) => [k, s(v)])),
          status: p['status'] === 'ptu' ? 'ptu' : 'live',
        }
      : null,
    counts: { news: gate('news'), patches: gate('patches'), gallery: gate('gallery') },
  };
}

export function mapExplorer(raw: unknown): VerseExplorerState | null {
  if (raw === null || raw === undefined) return null;
  const r = obj(raw);
  const st = obj(r['streak']);
  const k = obj(r['kartograph']);
  const rw = obj(r['rewards']);
  return {
    patches: arr(r['patches']).map((x) => {
      const p = obj(x);
      const c = p['constellation'] ? obj(p['constellation']) : null;
      const u = obj(p['unlocks']);
      return {
        patchLine: s(p['patch_line']),
        liveAt: sn(p['live_at']),
        stars: starKeys(p['stars']),
        starCount: n(p['star_count']),
        sun: b(p['sun']),
        offered: starKeys(p['offered']),
        constellation: c
          ? { className: s(c['class_name']), kind: c['kind'] === 'ground' ? 'ground' : 'ship', points: mapPoints(c['points']) }
          : null,
        unlocks: { logEntry: b(u['log_entry']), community: b(u['community']), wallpaper: b(u['wallpaper']) },
      };
    }),
    totalStars: n(r['total_stars']),
    suns: arr(r['suns']).map(s),
    streak: {
      current: n(st['current']),
      best: n(st['best']),
      reserveAvailable: b(st['reserve_available']),
      reservesUsed: n(st['reserves_used']),
    },
    kartograph: { unlocked: b(k['unlocked']), rank: n(k['rank']) },
    rewards: {
      road: b(rw['road']),
      nebula: b(rw['nebula']),
      live: b(rw['live']),
      reserve: b(rw['reserve']),
      meteor: b(rw['meteor']),
      supernova: b(rw['supernova']),
      sunCollection: b(rw['sun_collection']),
    },
  };
}

export function mapCommunityStars(raw: unknown): VerseCommunityStars | null {
  if (raw === null || raw === undefined) return null;
  const r = obj(raw);
  const st = obj(r['stars']);
  const stars: Partial<Record<VerseStarKey, number>> = {};
  for (const k of VERSE_STAR_KEYS) if (st[k] !== undefined) stars[k] = n(st[k]);
  return { patchLine: s(r['patch_line']), explorers: n(r['explorers']), stars };
}

export function mapSuggestion(raw: unknown): VerseSuggestion {
  const r = obj(raw);
  const st = s(r['status']);
  return {
    id: s(r['id']),
    itemUrl: s(r['item_url']),
    note: sn(r['note']),
    status: st === 'pinned' || st === 'dismissed' ? st : 'open',
    createdAt: s(r['created_at']),
  };
}

export function mapConstellation(raw: unknown): VerseConstellation | null {
  if (!raw) return null;
  const r = obj(raw);
  return {
    patchLine: s(r['patch_line']),
    className: s(r['class_name']),
    kind: r['kind'] === 'ground' ? 'ground' : 'ship',
    points: mapPoints(r['points']),
  };
}

/**
 * The briefing's top list: admin pins first, then unseen before seen, each in
 * server rank order, cut to the adaptive length.
 */
export function rankTopItems(digest: VerseDigest | null, seen: ReadonlySet<string>): VerseDigestItem[] {
  if (!digest) return [];
  const bucket = (i: VerseDigestItem): number => (i.pinned ? 0 : seen.has(i.key) ? 2 : 1);
  return [...digest.items].sort((a, c) => bucket(a) - bucket(c) || a.rank - c.rank).slice(0, digest.suggested);
}
