// uex-proxy allow-list — pure, so the narrow-proxy rules have a test
// (allow.test.ts). See index.ts for why the proxy exists.

// Read-only resources this proxy may reach. Everything the "Where to buy"
// feature needs to map an item / a ship → price → terminal → physical
// location. User-specific / write resources (user, data_submit, trades, …)
// are deliberately excluded — they are none of this feature's business.
export const ALLOWED_RESOURCES: ReadonlySet<string> = new Set<string>([
  'items',            // UEX item catalog (match our SC item → UEX id_item)
  'items_prices',     // buy/sell prices per item, references a terminal
  'categories',       // item categories (for filtering)
  'vehicles',         // UEX ship catalog (match our SC ship → UEX id_vehicle; has the game uuid)
  'vehicles_purchases_prices', // in-game ship purchase prices per terminal (search CTA "Bezugsquelle", #832)
  'terminals',        // terminal → location (star system / planet / station)
  'cities',
  'space_stations',
  'outposts',
  'planets',
  'star_systems',
]);

// Only forward filter params whose key looks like a UEX filter (snake_case
// alnum) and whose value is a short scalar — no arbitrary passthrough.
const PARAM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function safeParam(key: string, value: string): boolean {
  return PARAM_KEY_RE.test(key) && value.length <= 120 && /^[\w .,:%\-]*$/.test(value);
}

/** The upstream URL for an allowed resource with its safe filter params, or null when not allowed. */
export function upstreamUrl(base: string, resource: string, params: URLSearchParams): URL | null {
  if (!ALLOWED_RESOURCES.has(resource)) return null;
  const upstream = new URL(`${base}/${resource}/`);
  for (const [key, value] of params) {
    if (key === 'resource') continue;
    if (safeParam(key, value)) upstream.searchParams.append(key, value);
  }
  return upstream;
}
