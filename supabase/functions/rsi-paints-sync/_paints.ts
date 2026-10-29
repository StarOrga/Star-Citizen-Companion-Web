// Pure parts of rsi-paints-sync (no Deno / network; tested by _paints.test.mjs).
//
// The RSI store lists paints ("skins") as resources whose title carries BOTH the
// ship and the paint ("Gladius - Ghoulish Green Paint" or the reverse order), and
// whose media block carries the image derivatives. The exact response shape is
// not under our control, so every reader here is defensive: an entry we cannot
// read fully (no id, no ship, no https image) is DROPPED, never half-stored -
// "paints without an image are not returned as image options".

export const RSI_BASE = 'https://robertsspaceindustries.com';

export interface PaintRow {
  rsi_id: string;
  ship_name: string;
  ship_norm: string;
  class_name: string | null;
  name: string;
  image_url: string;
  rsi_url: string | null;
  released_at: string | null;
}

/** Same normalisation as rsi-upcoming-ships / UpcomingShipsService.normalizeShipName. */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Art variants in preference order; only RSI-hosted https urls are accepted (store payload is untrusted). */
const IMAGE_KEYS = ['store_small', 'storeSmall', 'store_large', 'storeLarge', 'post', 'slideshow', 'source'];

function rsiUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const abs = raw.startsWith('//') ? `https:${raw}` : raw.startsWith('/') ? `${RSI_BASE}${raw}` : raw;
  try {
    const u = new URL(abs);
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'robertsspaceindustries.com' && !u.hostname.endsWith('.robertsspaceindustries.com')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** First usable RSI image of a store resource's media block, or null. */
export function pickImage(media: unknown): string | null {
  const m = (media ?? {}) as Record<string, unknown>;
  const pools = [m.thumbnail, m.thumbnails, m.images, m].filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  for (const key of IMAGE_KEYS) {
    for (const pool of pools) {
      const hit = rsiUrl(pool[key]);
      if (hit) return hit;
    }
  }
  for (const pool of pools) {
    for (const v of Object.values(pool)) {
      const hit = rsiUrl(v);
      if (hit && /\.(png|jpe?g|webp)(\?|$)/i.test(hit)) return hit;
    }
  }
  return null;
}

/** Strips the generic "Paint" / "Skin" suffix so tiles read "Ghoulish Green". */
export function cleanPaintName(raw: string): string {
  return raw.replace(/\s+(paint|skin|livery)\s*$/i, '').replace(/^\s*(paint|skin|livery)\s*[:-]\s*/i, '').trim();
}

/**
 * Splits "<Ship> - <Paint>" (either order) using the ship names we know:
 * the side whose normalised name equals / is contained in a known ship wins
 * (longest known ship first, so "Idris-M" beats "Idris").
 */
export function splitTitle(
  title: string,
  knownShips: ReadonlyMap<string, string>, // norm -> display name
): { ship: string; paint: string } | null {
  const parts = title.split(/\s+[-–—:]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const ordered = [...knownShips.keys()].sort((a, b) => b.length - a.length);
  for (let i = 0; i < parts.length; i++) {
    const norm = normalizeName(parts[i]);
    if (!norm) continue;
    const exact = knownShips.has(norm) ? norm : ordered.find((k) => k.length >= 4 && (norm === k || norm.endsWith(k) || norm.startsWith(k)));
    if (exact) {
      const rest = parts.filter((_, j) => j !== i).join(' - ');
      return { ship: knownShips.get(exact) ?? parts[i], paint: cleanPaintName(rest) };
    }
  }
  return null;
}

/**
 * Game-data ship matching: norm of the RSI ship vs normalised codex names
 * ("Aegis Gladius" contains "gladius"). Exact wins, then the shortest container
 * (most specific), min length 4 for contains-matches - same spirit as the
 * upcoming-ships matcher, one-directional because paints name a ship we hold.
 */
export function matchShipClass(shipNorm: string, byNorm: ReadonlyMap<string, string>): string | null {
  if (!shipNorm) return null;
  const exact = byNorm.get(shipNorm);
  if (exact) return exact;
  if (shipNorm.length < 4) return null;
  let best: { len: number; cls: string } | null = null;
  for (const [n, cls] of byNorm) {
    if (n.includes(shipNorm) && (!best || n.length < best.len)) best = { len: n.length, cls };
  }
  return best?.cls ?? null;
}

function pickDate(r: Record<string, unknown>): string | null {
  for (const k of ['publishedAt', 'releasedAt', 'releaseDate', 'createdAt', 'created_at', 'date']) {
    const v = r[k];
    if (typeof v === 'string' || typeof v === 'number') {
      const t = new Date(v);
      if (!Number.isNaN(t.getTime())) return t.toISOString();
    }
  }
  return null;
}

/** One store resource -> a row, or null when anything essential (id, ship, image) is missing. */
export function toPaintRow(
  resource: unknown,
  knownShips: ReadonlyMap<string, string>,
  classByNorm: ReadonlyMap<string, string>,
): PaintRow | null {
  const r = (resource ?? {}) as Record<string, unknown>;
  const id = r.id ?? r.skuId ?? r.sku;
  const title = String(r.title ?? r.name ?? '').trim();
  if ((typeof id !== 'string' && typeof id !== 'number') || !title) return null;
  const image = pickImage(r.media);
  if (!image) return null;
  const split = splitTitle(title, knownShips);
  if (!split || !split.paint) return null;
  const ship_norm = normalizeName(split.ship);
  const url = rsiUrl(r.url ?? r.path);
  return {
    rsi_id: String(id),
    ship_name: split.ship,
    ship_norm,
    class_name: matchShipClass(ship_norm, classByNorm),
    name: split.paint,
    image_url: image,
    rsi_url: url,
    released_at: pickDate(r),
  };
}

/** A GraphQL batch/object answer -> its resource list + total count (tolerates both envelope shapes). */
export function readListing(answer: unknown): { resources: unknown[]; total: number | null } {
  const first = Array.isArray(answer) ? answer[0] : answer;
  const search = (first as { data?: { store?: { search?: { resources?: unknown; totalCount?: unknown; count?: unknown } } } })
    ?.data?.store?.search;
  const resources = Array.isArray(search?.resources) ? (search?.resources as unknown[]) : [];
  const total = typeof search?.totalCount === 'number' ? search.totalCount : typeof search?.count === 'number' ? search.count : null;
  return { resources, total };
}
