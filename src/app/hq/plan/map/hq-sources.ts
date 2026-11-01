import type { HqCommunityMedianRow, HqInventorySource } from '../../data/hq-db.types';
import type { MapPlace } from './hq-map.types';
import { slug } from './hq-route';

/** Where-to-get-it sources in trust order (D43): log → search (Codex) → community → OCR. */
export const SOURCE_ORDER = ['log', 'search', 'community', 'ocr'] as const satisfies readonly HqInventorySource[];
export type SourceKind = (typeof SOURCE_ORDER)[number];

/** The community median only counts with at least this many reports (D43; the RPC enforces it too). */
export const COMMUNITY_MIN_REPORTS = 5;

/** A place a source knows, with an optional unit price (aUEC). */
export interface PricedPlace {
  place: MapPlace;
  price?: number | null;
}

export interface SourceInputs {
  /** Shops seen in the user's own game log. */
  log?: readonly PricedPlace[];
  /** Codex shop data (what the search finds). */
  codex?: readonly PricedPlace[];
  /** `hq_community_median` rows. */
  community?: readonly HqCommunityMedianRow[];
  /** Places read from an OCR snapshot. */
  ocr?: readonly PricedPlace[];
  /** Maps a community `location` to a place; default parses `system/planet/location` or `System › Planet › Ort`. */
  placeOf?: (location: string) => MapPlace | null;
}

export interface SourceHit {
  place: MapPlace;
  /** The most trusted source that knows this place. */
  source: SourceKind;
  price?: number;
  /** Set when the price comes from a later source than `source`. */
  priceSource?: SourceKind;
  /** Community: reports behind the median. */
  n?: number;
}

/**
 * "Where to get it" for one item (D43). One hit per place; the first source in
 * {@link SOURCE_ORDER} that knows a place wins it, a missing price is filled from
 * the next source that has one. Sorted by source, then price (cheapest first),
 * then place id. Pure.
 */
export function resolveSources(inputs: SourceInputs): SourceHit[] {
  const placeOf = inputs.placeOf ?? parsePlace;
  const community: (PricedPlace & { n: number })[] = [];
  for (const row of inputs.community ?? []) {
    if (row.n < COMMUNITY_MIN_REPORTS || !Number.isFinite(row.median)) continue;
    const place = placeOf(row.location);
    if (place) community.push({ place, price: row.median, n: row.n });
  }
  const lists: Record<SourceKind, readonly (PricedPlace & { n?: number })[]> = {
    log: inputs.log ?? [],
    search: inputs.codex ?? [],
    community,
    ocr: inputs.ocr ?? [],
  };

  const hits = new Map<string, SourceHit>();
  for (const source of SOURCE_ORDER) {
    for (const entry of lists[source]) {
      const price = validPrice(entry.price);
      const hit = hits.get(entry.place.id);
      if (!hit) {
        hits.set(entry.place.id, {
          place: entry.place,
          source,
          ...(price !== undefined ? { price } : {}),
          ...(entry.n !== undefined ? { n: entry.n } : {}),
        });
      } else if (hit.price === undefined && price !== undefined) {
        hit.price = price;
        if (source !== hit.source) hit.priceSource = source;
      }
    }
  }

  return [...hits.values()].sort(
    (a, b) =>
      SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
      (a.price ?? Infinity) - (b.price ?? Infinity) ||
      a.place.id.localeCompare(b.place.id),
  );
}

/** `stanton/hurston/lorville`, `Stanton › Hurston › Lorville` or `Stanton › Port Tressler` (no planet). */
export function parsePlace(location: string): MapPlace | null {
  const parts = location
    .split(/\s*(?:\/|›|>)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { id: slug(parts[0]), system: '', planet: null, location: parts[0] };
  const system = parts[0];
  const planet = parts.length >= 3 ? parts[1] : null;
  const loc = parts[parts.length - 1];
  return { id: [system, planet, loc].filter((p): p is string => !!p).map(slug).join('/'), system, planet, location: loc };
}

function validPrice(p: number | null | undefined): number | undefined {
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : undefined;
}
