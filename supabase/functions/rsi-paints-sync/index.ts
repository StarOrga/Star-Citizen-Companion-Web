// rsi-paints-sync — crawls the RSI store's paint/skin listing (new AND existing
// paints) and upserts URL + metadata into public.rsi_ship_paints (no blobs,
// storage.md 500 MB budget). Paints without an RSI image are never stored, so the
// Codex landing never offers an image-less paint tile.
//
//   POST { max_pages?: number, products?: number[] }  ->  { ok, pages, seen, stored, matched }
//
// SERVICE ROLE ONLY (Bearer <service role key>); run by hand / a scheduled call.
// Read-only against RSI's public store GraphQL; no key involved. The ship <->
// class mapping uses the ship names of the LIVE codex build.
//
// UNVERIFIED ASSUMPTION: the store listing query below follows the shape the RSI
// pledge store itself sends (GetBrowseListingsQuery, product id for "Skins" is
// RSI_SKIN_PRODUCT_ID, default 190). RSI offers no documented API; if the
// answer shape differs, `readListing`/`toPaintRow` return nothing and the run
// reports stored: 0 instead of failing - adjust the constants, not the contract.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { RSI_BASE, normalizeName, readListing, toPaintRow } from './_paints.ts';

const PAGE_SIZE = 40;
const DEFAULT_MAX_PAGES = 60;
const TIMEOUT_MS = 15_000;
const SKIN_PRODUCT_ID = Number(Deno.env.get('RSI_SKIN_PRODUCT_ID') ?? '190');

const QUERY = `query GetBrowseListingsQuery($query: SearchQuery) {
  store(browse: true) { search(query: $query) { count totalCount resources { id title name url path media { thumbnail { storeSmall } } } } }
}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fetchPage(page: number, products: number[]): Promise<unknown> {
  const res = await fetch(`${RSI_BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'sc-companion-paints/1.0' },
    body: JSON.stringify([{
      operationName: 'GetBrowseListingsQuery',
      variables: { query: { limit: PAGE_SIZE, page, skus: { products }, sort: { field: 'weight', direction: 'desc' } } },
      query: QUERY,
    }]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rsi ${res.status}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || req.headers.get('authorization') !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);

  let body: { max_pages?: number; products?: number[] } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const maxPages = Math.min(Math.max(Number(body.max_pages) || DEFAULT_MAX_PAGES, 1), 200);
  const products = Array.isArray(body.products) && body.products.length ? body.products.map(Number) : [SKIN_PRODUCT_ID];

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
  try {
    // Known ships of the LIVE build: norm -> display name / class_name.
    const { data: ships, error } = await admin
      .from('codex_ships')
      .select('class_name, name_localized, codex_builds!inner(is_current, channel)')
      .eq('codex_builds.is_current', true)
      .eq('codex_builds.channel', 'LIVE')
      .eq('is_variant', false)
      .limit(2000);
    if (error) throw error;
    const classByNorm = new Map<string, string>();
    const knownShips = new Map<string, string>();
    for (const s of (ships ?? []) as { class_name: string; name_localized: string | null }[]) {
      const display = (s.name_localized ?? '').trim();
      const norm = normalizeName(display);
      if (norm) { classByNorm.set(norm, s.class_name); knownShips.set(norm, display); }
    }
    // Bare model names ("Gladius" out of "Aegis Gladius") so RSI titles resolve.
    for (const [norm, display] of [...knownShips]) {
      const bare = display.split(/\s+/).slice(1).join(' ');
      const bn = normalizeName(bare);
      if (bn.length >= 3 && !knownShips.has(bn)) knownShips.set(bn, bare);
    }

    let pages = 0, seen = 0, matched = 0;
    const rows = new Map<string, ReturnType<typeof toPaintRow>>();
    for (let page = 1; page <= maxPages; page++) {
      const { resources, total } = readListing(await fetchPage(page, products));
      pages = page;
      if (resources.length === 0) break;
      seen += resources.length;
      for (const r of resources) {
        const row = toPaintRow(r, knownShips, classByNorm);
        if (row) { rows.set(row.rsi_id, row); if (row.class_name) matched++; }
      }
      if (total !== null && page * PAGE_SIZE >= total) break;
    }

    const list = [...rows.values()].filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    for (let i = 0; i < list.length; i += 200) {
      // first_seen_at is omitted on purpose: the column default only applies to NEW rows.
      const { error: upErr } = await admin.from('rsi_ship_paints').upsert(list.slice(i, i + 200), { onConflict: 'rsi_id' });
      if (upErr) throw upErr;
    }
    return json({ ok: true, pages, seen, stored: list.length, matched });
  } catch (e) {
    console.error(`rsi-paints-sync: ${(e as Error).message}`);
    return json({ error: 'sync_failed', message: (e as Error).message }, 502);
  }
});
