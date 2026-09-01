/**
 * Product dimension of the admin telemetry page.
 *
 * The page used to be a two-way switch between the SCC app and the Data
 * Uploader. It is now a multi-product view: `get_telemetry_stats` returns a
 * per-product roll-up in every response (independent of the active filter), so
 * the page can show every product side by side AND drill into one.
 *
 * Everything here is pure so the merge/label rules are unit-testable without
 * rendering the component.
 */

/**
 * Products we ship a translated label for. The page does NOT depend on this
 * list to know what exists — the server decides that — it only decides what
 * gets a friendly name and what is guaranteed to appear even with zero events.
 *
 * Adding a fourth product means adding one entry here plus two i18n keys; the
 * rest of the page (cards, drill-down, filter) already scales to N.
 */
export const KNOWN_PRODUCTS = ['scc-app', 'data-uploader', 'starscape'] as const;

/** Pseudo-product for the cross-product view. Never a real `product` value. */
export const ALL_PRODUCTS = 'all';

/** One product's roll-up over the selected time window. */
export interface ProductRow {
  /** Product id as stored (legacy NULL rows are coalesced to 'scc-app'). */
  product: string;
  events: number;
  crashes: number;
  usage: number;
  extractAborts: number;
  installs: number;
  sessions: number;
  /** Distinct app versions seen; not rendered today, kept for parity with the RPC. */
  versions?: number;
  /** Epoch ms of the most recent event, or null when there is none. */
  lastSeen: number | null;
}

const ZERO = { events: 0, crashes: 0, usage: 0, extractAborts: 0, installs: 0, sessions: 0 };

/** An all-zero row, so a product that has never reported still gets a card. */
export function emptyProductRow(product: string): ProductRow {
  return { product, ...ZERO, lastSeen: null };
}

/**
 * The rows to render as cards: everything the server reported (busiest first,
 * which is the order the RPC already returns), followed by the known products
 * that reported nothing at all.
 *
 * A silent product is the single most interesting state on this page — "did the
 * Starscape build we just shipped report anything?" is answered by a zero card,
 * not by an absent one.
 */
export function mergeProductRows(rows: readonly ProductRow[] | null | undefined): ProductRow[] {
  const reported = (rows ?? []).filter((r) => !!r?.product);
  const seen = new Set(reported.map((r) => r.product));
  const silent = KNOWN_PRODUCTS.filter((p) => !seen.has(p)).map(emptyProductRow);
  return [...reported, ...silent];
}

/**
 * Synthetic "all products" row. Summing is exact here: every counter is a plain
 * count, and install/session hashes come from per-product random ids, so no
 * identity is counted twice across products.
 */
export function allProductsRow(rows: readonly ProductRow[]): ProductRow {
  return rows.reduce<ProductRow>(
    (acc, r) => ({
      product: ALL_PRODUCTS,
      events: acc.events + r.events,
      crashes: acc.crashes + r.crashes,
      usage: acc.usage + r.usage,
      extractAborts: acc.extractAborts + r.extractAborts,
      installs: acc.installs + r.installs,
      sessions: acc.sessions + r.sessions,
      lastSeen: Math.max(acc.lastSeen ?? 0, r.lastSeen ?? 0) || null,
    }),
    emptyProductRow(ALL_PRODUCTS),
  );
}

/**
 * i18n key for a product we ship a label for, or null to render the raw id.
 * Same degradation rule as the abort reasons: an unknown id shows as itself
 * rather than as a missing-translation key.
 */
export function productLabelKey(product: string): string | null {
  if (product === ALL_PRODUCTS) return 'telemetry.product.all';
  return (KNOWN_PRODUCTS as readonly string[]).includes(product)
    ? `telemetry.product.${product}`
    : null;
}

/**
 * Normalise a `?product=` query param into something the RPC accepts.
 * Anything unrecognised falls back to the cross-product view rather than
 * silently filtering to a product that cannot exist.
 */
export function normaliseProductParam(
  raw: string | null | undefined,
  available: readonly string[],
): string {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v || v === ALL_PRODUCTS) return ALL_PRODUCTS;
  if ((KNOWN_PRODUCTS as readonly string[]).includes(v)) return v;
  return available.includes(v) ? v : ALL_PRODUCTS;
}

/**
 * Bar width (%) for a comparison row, clamped to 0..100. A zero `max` would
 * divide by zero and a stale `max` would render a bar wider than its track, so
 * both ends are pinned here rather than at every call site.
 */
export function sharePct(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round((value / Math.max(1, max)) * 100));
}
