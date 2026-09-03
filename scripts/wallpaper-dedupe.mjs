#!/usr/bin/env node
/**
 * wallpaper-dedupe — backfill `verse_wallpapers.phash` and remove the
 * near-duplicate rows captured before the filter existed.
 *
 * ---------------------------------------------------------------------------
 * SUPERSEDED for day-to-day use (feedback fcd956cf, 2026-09-03)
 *
 * Its job is done: every live row carries a correct hash and the closest pair
 * in the table is 78 bits apart, so `--apply` now finds nothing to delete.
 *
 * Visual duplicates are handled by GROUPING instead — `variant-signature.ts`
 * plus `verse_wallpapers.variant_group`/`variant_role`, maintained by
 * fetch-verse-news itself with no manual step. That path is crop-tolerant
 * (which a dHash is not) and it never deletes a row, so a `?image=<id>` share
 * link keeps resolving. Reach for this script only to re-hash after a decoder
 * change; prefer `--hash-only` and leave the deletion half alone.
 *
 * ---------------------------------------------------------------------------
 * What it fixes
 *
 * The gallery deduped by CDN media id only, so one studio scene republished by
 * RSI under several media ids landed as several rows. The Foundation Festival
 * 2026 comm-link contributed 8 rows, 4 of them the same hangar with the same
 * camera and lighting — two wearing the SAME armour set, front and back. At tile
 * size that reads as one photo repeated, every copy linking to one comm-link.
 *
 * `fetch-verse-news` now rejects such candidates at capture time. This script is
 * the one-off pass over what is already stored: it hashes every row and collapses
 * each near-duplicate cluster to a single keeper.
 *
 * Hashing uses the SAME module the edge function uses
 * (supabase/functions/fetch-verse-news/perceptual-hash.ts) against the SAME
 * image (`preview_url`, the ≤1140px cover), so a backfilled hash is bit-identical
 * to a freshly captured one and the two paths can never drift apart.
 *
 * ---------------------------------------------------------------------------
 * Which row survives a cluster
 *
 * The largest ORIGINAL image wins (pixel count from a 64 KB ranged GET of
 * `source_url`, no full download), ties broken by image id so the choice is
 * deterministic and a re-run picks the same keeper.
 *
 * This differs from the edge function on purpose. At capture time candidates
 * arrive in feed order and the first wins, because RSI lists an article's hero
 * first and a stored row must never be evicted (a `?image=<id>` share link
 * resolves it). Here every member is already stored and equally "first" — the
 * live cluster was captured in a single crawl with identical timestamps — so
 * there is no ordering to honour, and for a wallpaper gallery more pixels is the
 * better tiebreak.
 *
 * Deleting a row does break any `?image=<id>` link pointing at it. `loadOne`
 * returns null for a missing id and the gallery behind the overlay still
 * renders, so the failure mode is a dead share link, not a broken page.
 *
 * ---------------------------------------------------------------------------
 * Usage
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/wallpaper-dedupe.mjs [options]
 *
 *   (default)       dry run — reads only, prints the plan, writes nothing
 *   --apply         write the hashes and delete the duplicate rows
 *   --hash-only     backfill hashes but never delete (safe first pass)
 *   --distance=<n>  override the near-duplicate threshold (default: the
 *                   module's NEAR_DUPLICATE_MAX_DISTANCE)
 *
 * The service-role key is read from the environment only. Never pass it on the
 * command line, never commit it.
 */

import { createClient } from '@supabase/supabase-js';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { readImageSize } from '../supabase/functions/fetch-verse-news/image-variants.ts';
import {
  NEAR_DUPLICATE_MAX_DISTANCE,
  hammingDistance,
  perceptualHash,
} from '../supabase/functions/fetch-verse-news/perceptual-hash.ts';

const RSI_REFERER = 'https://robertsspaceindustries.com/';
const PROBE_BYTES = 65_536;
const FETCH_TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const HASH_ONLY = args.includes('--hash-only');
const MAX_DISTANCE = Number(
  args.find((a) => a.startsWith('--distance='))?.split('=')[1] ?? NEAR_DUPLICATE_MAX_DISTANCE,
);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.');
  process.exit(1);
}
if (!Number.isFinite(MAX_DISTANCE) || MAX_DISTANCE < 0) {
  console.error(`--distance must be a non-negative number (got ${MAX_DISTANCE}).`);
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function fetchWithTimeout(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Referer: RSI_REFERER, ...extraHeaders },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Hash one row's cover image, or null when it cannot be decoded. */
async function hashRow(row) {
  const ext = row.preview_url.slice(row.preview_url.lastIndexOf('.')).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') return null; // parity with the edge function
  try {
    const res = await fetchWithTimeout(row.preview_url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const decoded =
      ext === '.png'
        ? PNG.sync.read(Buffer.from(buf))
        : jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    return perceptualHash(decoded.data, decoded.width, decoded.height);
  } catch (err) {
    console.warn(`  ! hash failed for ${row.image_id}: ${err.message}`);
    return null;
  }
}

/** Pixel count of the ORIGINAL from its header only — a 64 KB ranged GET. */
async function sourcePixels(row) {
  try {
    const res = await fetchWithTimeout(row.source_url, { Range: `bytes=0-${PROBE_BYTES - 1}` });
    if (!res.ok) return 0;
    const dim = readImageSize(new Uint8Array(await res.arrayBuffer()));
    return dim ? dim.w * dim.h : 0;
  } catch {
    return 0; // unknown size sorts last — never the keeper over a measured row
  }
}

/** Group rows so that every member is within MAX_DISTANCE of some other member. */
function cluster(rows) {
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const d = hammingDistance(rows[i].phash, rows[j].phash);
      if (d !== null && d <= MAX_DISTANCE) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  rows.forEach((row, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

async function main() {
  const mode = APPLY ? (HASH_ONLY ? 'APPLY (hashes only)' : 'APPLY') : 'DRY RUN';
  console.log(`wallpaper-dedupe — ${mode}, threshold ${MAX_DISTANCE}/256 bits\n`);

  const { data: rows, error } = await db
    .from('verse_wallpapers')
    .select('image_id, source_url, preview_url, phash, title, article_url')
    .order('captured_at', { ascending: true });
  if (error) throw new Error(`read failed: ${error.message}`);
  console.log(`${rows.length} row(s) in verse_wallpapers`);

  // 1. Backfill missing hashes.
  const missing = rows.filter((r) => !r.phash);
  console.log(`${missing.length} row(s) without a hash\n`);
  for (const row of missing) {
    const phash = await hashRow(row);
    row.phash = phash;
    if (!phash) {
      console.log(`  - ${row.image_id}: not hashable (kept, never treated as a duplicate)`);
      continue;
    }
    if (APPLY) {
      const { error: upErr } = await db
        .from('verse_wallpapers')
        .update({ phash })
        .eq('image_id', row.image_id);
      if (upErr) throw new Error(`hash write failed for ${row.image_id}: ${upErr.message}`);
    }
    console.log(`  ${APPLY ? '+' : '·'} ${row.image_id}: ${phash.slice(0, 16)}…`);
  }

  // 2. Collapse near-duplicate clusters.
  const hashed = rows.filter((r) => r.phash);
  const clusters = cluster(hashed);
  if (clusters.length === 0) {
    console.log('\nNo near-duplicate clusters. Nothing to remove.');
    return;
  }

  const doomed = [];
  console.log(`\n${clusters.length} near-duplicate cluster(s):`);
  for (const group of clusters) {
    const sized = [];
    for (const row of group) sized.push({ row, pixels: await sourcePixels(row) });
    sized.sort((a, b) => b.pixels - a.pixels || a.row.image_id.localeCompare(b.row.image_id));
    const [keeper, ...rest] = sized;
    console.log(`\n  "${keeper.row.title ?? '(untitled)'}" — ${group.length} rows`);
    console.log(`    KEEP   ${keeper.row.image_id}  ${keeper.pixels.toLocaleString()} px`);
    for (const { row, pixels } of rest) {
      const d = hammingDistance(keeper.row.phash, row.phash);
      console.log(`    DELETE ${row.image_id}  ${pixels.toLocaleString()} px  (${d} bits apart)`);
      doomed.push(row.image_id);
    }
  }

  if (HASH_ONLY) {
    console.log(`\n--hash-only: leaving ${doomed.length} duplicate row(s) in place.`);
    return;
  }
  if (!APPLY) {
    console.log(`\nDry run — would delete ${doomed.length} row(s). Re-run with --apply.`);
    return;
  }
  const { error: delErr } = await db.from('verse_wallpapers').delete().in('image_id', doomed);
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);
  console.log(`\nDeleted ${doomed.length} duplicate row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
