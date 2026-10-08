// Verse-hub constellation: pure helpers for the `constellation` op.
//
// The Data Uploader precomputes 7 stars per ship silhouette
// (data-uploader/python/sc_extract/constellation.py) and sends them all as
// candidates. This module validates them and picks the patch's newest vehicle;
// index.ts does the DB reads and the upsert into verse_constellations.

export const STAR_COUNT = 7;

export interface ConstellationCandidate {
  class_name: string;
  kind: 'ship' | 'ground';
  points: [number, number][];
}

/** "4.3.1" / "4.3" / "4.3.1-live" -> "4.3"; anything else -> null. */
export function patchLineOf(patchVersion: unknown): string | null {
  const m = /^\s*(\d+)\.(\d+)/.exec(String(patchVersion ?? ''));
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
}

function validPoints(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length !== STAR_COUNT) return null;
  const out: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    out.push([x, y]);
  }
  return out;
}

/** Keep only well-formed candidates; first occurrence of a class_name wins. */
export function sanitizeCandidates(raw: unknown): ConstellationCandidate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ConstellationCandidate[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    const name = typeof c.class_name === 'string' ? c.class_name.trim() : '';
    const points = validPoints(c.points);
    if (!name || !points || seen.has(name)) continue;
    seen.add(name);
    out.push({ class_name: name, kind: c.kind === 'ground' ? 'ground' : 'ship', points });
  }
  return out;
}

/**
 * The newest vehicle of the build. `firstSeen` maps class_name -> the
 * earliest created_at of that class in any OTHER build still in the catalog.
 * A candidate missing from it is new in this build and wins; among several
 * new ones, and as the fallback when nothing is new, the latest first
 * appearance wins. Ties break on class_name (ascending) so the pick is
 * deterministic.
 */
export function pickNewest(
  candidates: ConstellationCandidate[],
  firstSeen: Map<string, string>,
): ConstellationCandidate | null {
  let best: ConstellationCandidate | null = null;
  let bestKey = '';
  for (const c of candidates) {
    // '~' sorts after any ISO timestamp, so "never seen" outranks every date.
    const key = firstSeen.get(c.class_name) ?? '~';
    if (
      best === null ||
      key > bestKey ||
      (key === bestKey && c.class_name < best.class_name)
    ) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

/** Fold (class_name, created_at) rows into the earliest timestamp per class. */
export function earliestByClass(rows: { class_name: string; created_at: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const iso = new Date(r.created_at).toISOString();
    const prev = out.get(r.class_name);
    if (prev === undefined || iso < prev) out.set(r.class_name, iso);
  }
  return out;
}
