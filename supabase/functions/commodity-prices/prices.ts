// commodity-prices — pure helpers (tested in prices.test.ts). See index.ts.

export const CACHE_SECONDS = 600;

export interface UexCommodityPriceRow {
  id_commodity?: number;
  id_terminal?: number;
  commodity_name?: string | null;
  terminal_name?: string | null;
  price_buy?: number | null;
  price_sell?: number | null;
  price_buy_avg?: number | null;
  price_sell_avg?: number | null;
  date_modified?: number | null;
}

export interface CommodityPrice {
  commodityId: number;
  commodity: string;
  terminalId: number;
  terminal: string;
  /** UEC per SCU; null = not bought / sold here. */
  buy: number | null;
  sell: number | null;
  buyAvg: number | null;
  sellAvg: number | null;
  /** When UEX last saw the price change: ISO-8601 from the response's `date_modified` (unix seconds). Null if absent. */
  updatedAt: string | null;
}

export interface CommodityPricesBody {
  source: 'uex';
  /** When this proxy fetched from UEX. The age of a single price is its own `updatedAt`. */
  fetchedAt: string;
  cacheSeconds: number;
  prices: CommodityPrice[];
}

export interface CommodityEntry {
  id: number;
  name: string;
}

/** A positive price, else null (UEX sends 0 for "not traded here"). */
function money(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function normalizePrices(rows: unknown, now: Date): CommodityPricesBody {
  const list = Array.isArray(rows) ? (rows as UexCommodityPriceRow[]) : [];
  const prices: CommodityPrice[] = [];
  for (const r of list) {
    if (typeof r?.id_commodity !== 'number' || typeof r?.id_terminal !== 'number') continue;
    const ts = typeof r.date_modified === 'number' && r.date_modified > 0 ? r.date_modified : null;
    prices.push({
      commodityId: r.id_commodity,
      commodity: r.commodity_name ?? '',
      terminalId: r.id_terminal,
      terminal: r.terminal_name ?? '',
      buy: money(r.price_buy),
      sell: money(r.price_sell),
      buyAvg: money(r.price_buy_avg),
      sellAvg: money(r.price_sell_avg),
      updatedAt: ts === null ? null : new Date(ts * 1000).toISOString(),
    });
  }
  return { source: 'uex', fetchedAt: now.toISOString(), cacheSeconds: CACHE_SECONDS, prices };
}

export function normalizeCommodities(rows: unknown): CommodityEntry[] {
  const list = Array.isArray(rows) ? (rows as { id?: number; name?: string }[]) : [];
  return list
    .filter((r) => typeof r?.id === 'number' && typeof r?.name === 'string' && r.name !== '')
    .map((r) => ({ id: r.id as number, name: r.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The upstream URL for a request, or null when the query is not one of the two supported shapes. */
export function upstreamFor(base: string, params: URLSearchParams): URL | null {
  if (params.get('list') === 'commodities') return new URL(`${base}/commodities/`);
  const id = (params.get('id_commodity') ?? '').trim();
  if (/^\d{1,6}$/.test(id)) {
    const u = new URL(`${base}/commodities_prices/`);
    u.searchParams.set('id_commodity', id);
    return u;
  }
  return null;
}

/** In-isolate TTL cache so a burst of visitors costs one upstream call per commodity. */
export class TtlCache<T> {
  private readonly store = new Map<string, { at: number; value: T }>();
  private readonly ttlMs: number;
  private readonly max: number;
  constructor(ttlMs: number, max = 200) {
    this.ttlMs = ttlMs;
    this.max = max;
  }
  get(key: string, nowMs: number): T | undefined {
    const hit = this.store.get(key);
    if (!hit || nowMs - hit.at > this.ttlMs) return undefined;
    return hit.value;
  }
  set(key: string, value: T, nowMs: number): void {
    if (this.store.size >= this.max) this.store.delete(this.store.keys().next().value as string);
    this.store.set(key, { at: nowMs, value });
  }
}
