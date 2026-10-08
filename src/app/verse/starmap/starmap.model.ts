import type { VersePoint, VerseStarKey } from '../data/verse.models';

/** Stars per patch constellation (server: `verse_explorer_state`). */
export const STARS_PER_PATCH = 7;

/**
 * The order in which the 7 stars of a constellation light up — SYMMETRIC, never
 * along the outline. The hull is a top view with the nose up, so its mirror axis
 * is the vertical line through the centroid. Stars closest to that axis (nose,
 * tail, spine) light first, then mirrored pairs from the inside out: sorting by
 * |x − cx| puts the left and right partner of a pair next to each other; the
 * tie-break (smaller y first, then smaller x) keeps the result deterministic.
 *
 * Returns point indices; the first `starCount` of them are lit.
 */
export function symmetricLightOrder(points: readonly VersePoint[]): number[] {
  if (points.length === 0) return [];
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const eps = 1e-6;
  return points
    .map((p, i) => ({ i, d: Math.abs(p[0] - cx), y: p[1], x: p[0] }))
    .sort((a, b) => {
      // Points whose axis distance differs by < 2 % of the width count as one ring.
      const ring = Math.round(a.d * 50) - Math.round(b.d * 50);
      if (ring !== 0) return ring;
      if (Math.abs(a.y - b.y) > eps) return a.y - b.y;
      return a.x - b.x;
    })
    .map((e) => e.i);
}

/** The lit point indices for a star count. */
export function litIndices(points: readonly VersePoint[], starCount: number): Set<number> {
  return new Set(symmetricLightOrder(points).slice(0, Math.max(0, Math.min(points.length, starCount))));
}

/**
 * Rank of each point in the lighting order (0 = first). Drives the CSS stagger
 * of the light-up animation so it, too, runs centre → outside.
 */
export function lightRank(points: readonly VersePoint[]): number[] {
  const rank: number[] = new Array<number>(points.length).fill(0);
  symmetricLightOrder(points).forEach((idx, r) => (rank[idx] = r));
  return rank;
}

/**
 * Fallback shape when a patch has no uploaded constellation yet: a calm,
 * mirror-symmetric "arrow" (nose, two wing pairs, tail pair) in 0..1.
 */
export const FALLBACK_POINTS: readonly VersePoint[] = [
  [0.5, 0.08],
  [0.36, 0.38],
  [0.64, 0.38],
  [0.14, 0.62],
  [0.86, 0.62],
  [0.4, 0.9],
  [0.6, 0.9],
];

/**
 * Generated supernova constellation (streak 7): a 7-ray burst seeded by the
 * patch line, so every supernova differs but stays reproducible.
 */
export function supernovaPoints(seed: string): VersePoint[] {
  const rnd = mulberry32(hashSeed(`supernova:${seed}`));
  const pts: VersePoint[] = [];
  for (let i = 0; i < STARS_PER_PATCH; i++) {
    const a = -Math.PI / 2 + (i / STARS_PER_PATCH) * Math.PI * 2;
    const r = 0.3 + rnd() * 0.18;
    pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
  }
  return pts;
}

/** FNV-1a 32-bit — the seed hash the Rust mirror uses as well. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 PRNG → floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a task is done. `newship` = the patch's newest vehicle detail when known. */
export type StarTarget =
  | { readonly kind: 'patch' }
  | { readonly kind: 'route'; readonly link: string; readonly queryParams?: Record<string, string> }
  | { readonly kind: 'newship'; readonly fallback: string };

export interface StarTask {
  readonly key: VerseStarKey;
  /** `starmap.task.<i18nKey>.{title,how,link}`. */
  readonly i18nKey: string;
  readonly target: StarTarget;
}

const TASKS: Record<VerseStarKey, StarTask> = {
  notes: { key: 'notes', i18nKey: 'notes', target: { kind: 'patch' } },
  archive: { key: 'archive', i18nKey: 'archive', target: { kind: 'route', link: '/codex' } },
  loadout: { key: 'loadout', i18nKey: 'loadout', target: { kind: 'route', link: '/hangar' } },
  comet: { key: 'comet', i18nKey: 'comet', target: { kind: 'patch' } },
  'cx-newship': { key: 'cx-newship', i18nKey: 'cxNewship', target: { kind: 'newship', fallback: '/codex' } },
  'cx-keybinds': { key: 'cx-keybinds', i18nKey: 'cxKeybinds', target: { kind: 'route', link: '/codex/keybinds' } },
  'cx-changed': { key: 'cx-changed', i18nKey: 'cxChanged', target: { kind: 'newship', fallback: '/codex' } },
  'cx-blueprint': { key: 'cx-blueprint', i18nKey: 'cxBlueprint', target: { kind: 'route', link: '/codex/blueprint' } },
  'cx-fps': { key: 'cx-fps', i18nKey: 'cxFps', target: { kind: 'route', link: '/codex/fps' } },
  'cx-loadout': { key: 'cx-loadout', i18nKey: 'cxLoadout', target: { kind: 'newship', fallback: '/codex' } },
};

export function starTask(key: VerseStarKey): StarTask {
  return TASKS[key];
}

/** Resolves a task target to a routerLink for a patch. */
export function taskLink(task: StarTask, patchLine: string, newShipClass: string | null): string {
  switch (task.target.kind) {
    case 'patch':
      return `/verse/patches/${patchLine}`;
    case 'route':
      return task.target.link;
    case 'newship':
      return newShipClass ? `/codex/ship/${encodeURIComponent(newShipClass)}` : task.target.fallback;
  }
}

export type StreakRewardKey = 'road' | 'nebula' | 'live' | 'reserve' | 'meteor' | 'supernova';

/**
 * Display thresholds of the streak road. Whether a reward is unlocked always
 * comes from the server (`VerseExplorerState.rewards`), never from these numbers.
 */
export const STREAK_REWARDS: readonly { readonly key: StreakRewardKey; readonly at: number }[] = [
  { key: 'road', at: 2 },
  { key: 'nebula', at: 3 },
  { key: 'live', at: 4 },
  { key: 'reserve', at: 5 },
  { key: 'meteor', at: 6 },
  { key: 'supernova', at: 7 },
];

/** Local calendar date of `d` as `yyyy-mm-dd`. */
function localYmd(d: Date): string {
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * sr-meteor plays only on a patch's LIVE day — the Starscape app's rule: the
 * LIVE day is the reader's local calendar day that contains the instant
 * `live_at` (converted to local time first). A 17:00 UTC release is the same
 * day in Europe and the Americas and the next day east of UTC+7, and never a
 * day early anywhere — comparing the UTC date of `live_at` with the local date
 * got that wrong. The shower ends at local midnight.
 */
export function isLiveDay(liveAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!liveAt) return false;
  const at = new Date(liveAt);
  if (Number.isNaN(at.getTime())) return false;
  return localYmd(at) === localYmd(now);
}

/** What a shared Kartograph badge shows — everything travels in the link, no user id. */
export interface KartographBadge {
  readonly rank: number;
  readonly patch: string;
  readonly stars: number;
  readonly sun: boolean;
}

const PATCH_RE = /^\d{1,2}\.\d{1,2}$/;

export function badgeQuery(b: KartographBadge): Record<string, string> {
  return { rank: String(b.rank), patch: b.patch, stars: String(b.stars), sun: b.sun ? '1' : '0' };
}

/** Parses (and clamps) badge query params; null when the link is unusable. */
export function parseBadge(q: { get(name: string): string | null }): KartographBadge | null {
  const patch = q.get('patch') ?? '';
  const rank = Number(q.get('rank'));
  const stars = Number(q.get('stars'));
  if (!PATCH_RE.test(patch) || !Number.isInteger(rank) || rank < 1 || rank > 999) return null;
  return {
    rank,
    patch,
    stars: Number.isInteger(stars) ? Math.max(0, Math.min(STARS_PER_PATCH, stars)) : 0,
    sun: q.get('sun') === '1',
  };
}

/**
 * Community constellation: per lighting rank (centre → outside) the share of
 * explorers who earned the offered key in that slot, 0..1. Offered key i sits
 * on the i-th star of the symmetric order, the same mapping the own map uses.
 */
export function communityLevels(
  offered: readonly VerseStarKey[],
  stars: Readonly<Partial<Record<VerseStarKey, number>>>,
  explorers: number,
): number[] {
  return Array.from({ length: STARS_PER_PATCH }, (_, i) => {
    const key = offered[i];
    if (!key || explorers <= 0) return 0;
    return Math.max(0, Math.min(1, (stars[key] ?? 0) / explorers));
  });
}
