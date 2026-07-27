#!/usr/bin/env node
/**
 * news-image-compact — shrink the `news-images` bucket to the variant ladder.
 *
 * ---------------------------------------------------------------------------
 * What it fixes
 *
 * The first generation of the verse-news image cache mirrored every source image
 * verbatim under TWO object names, `<hash>/post.<ext>` and `<hash>/cover.<ext>`.
 * For most sources both downloads returned the same file, so the bucket held a
 * byte-identical twin of every image, at full RSI resolution (PNGs up to 9.2 MB).
 * 496 objects added up to 809 MB — essentially the whole 1 GB Supabase quota —
 * to serve tiles that render at ~320 CSS px.
 *
 * This script rewrites each of those into the scheme `fetch-verse-news` now
 * produces: one object per real pixel width, `<hash>/w400.<ext>`,
 * `<hash>/w800.<ext>`, `<hash>/w<top>.<ext>` (top = source width capped at 1600),
 * re-encoded and with a long-lived immutable cache header. Sizing, quality and
 * naming all come from the SAME module the edge function uses
 * (supabase/functions/fetch-verse-news/image-variants.ts), so a backfilled object
 * is indistinguishable from a freshly ingested one.
 *
 * ---------------------------------------------------------------------------
 * Safety model — the order of operations is the whole point
 *
 * Per source hash: download → re-encode → upload the new ladder → RE-LIST the
 * folder and confirm every expected object exists with a non-zero size → update
 * the `verse_image_cache` row → only THEN delete what the row no longer
 * references. A crash at any point leaves either the old objects (row still
 * legacy, retried next run) or both sets (row already migrated, leftovers swept
 * next run). Nothing is ever deleted before its replacement is provably there,
 * and `assertDeletable` refuses any path that the post-update row still points
 * at, so a bug in the planner cannot delete a live object.
 *
 * Idempotent + resumable by construction: the plan is recomputed from bucket and
 * DB state on every run, there is no local progress file to get stale.
 *
 * ---------------------------------------------------------------------------
 * Usage
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/news-image-compact.mjs [options]
 *
 *   (default)            dry run — reads only, writes nothing
 *   --apply              actually upload / update / delete
 *   --sample=<n|all>     dry-run: how many sources to really re-encode for the
 *                        projection (default 20; the rest is extrapolated from
 *                        the measured compression ratio)
 *   --limit=<n>          process at most n source hashes (test the real run small)
 *   --concurrency=<n>    parallel sources (default 3)
 *   --prune-orphans      also remove objects with no `verse_image_cache` row and
 *                        cache rows with no objects (both reported either way)
 *   --orphan-age=<h>     minimum age in hours before an orphan may be pruned
 *                        (default 24) — a live ingest uploads objects seconds
 *                        before it writes the row, so young orphans are normal
 *
 * The service-role key is read from the environment only. Never pass it on the
 * command line, never commit it.
 */

import { createClient } from '@supabase/supabase-js';
import {
  OPAQUE_WIDTH,
  VARIANT_CACHE_CONTROL,
  buildVariants,
  expectedVariantPaths,
  readImageSize,
  totalVariantBytes,
  variantPath,
} from '../supabase/functions/fetch-verse-news/image-variants.ts';
import { nodeCodecs } from './lib/node-image-codecs.mjs';

const BUCKET = 'news-images';
const LIST_PAGE = 1000;

// ---------------------------------------------------------------- cli + env

function parseArgs(argv) {
  const flags = new Map();
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) fail(`unknown argument: ${arg}`);
    flags.set(m[1], m[2] ?? 'true');
  }
  const num = (name, dflt) => {
    const raw = flags.get(name);
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) fail(`--${name} must be a non-negative number`);
    return n;
  };
  const sampleRaw = flags.get('sample') ?? '20';
  return {
    apply: flags.has('apply'),
    sample: sampleRaw === 'all' ? Infinity : Number(sampleRaw),
    limit: flags.has('limit') ? num('limit') : Infinity,
    concurrency: Math.max(1, num('concurrency', 3)),
    pruneOrphans: flags.has('prune-orphans'),
    orphanAgeHours: num('orphan-age', 24),
    // Far above the edge function's 16 MP ceiling: Node has gigabytes of heap
    // where the worker has a couple of hundred MB, and the legacy bucket holds
    // 8K originals (7680×4320 ≈ 132 MB of RGBA) that are exactly the objects
    // worth shrinking most.
    maxPixels: num('max-pixels', 40_000_000),
  };
}

function fail(msg) {
  console.error(`news-image-compact: ${msg}`);
  process.exit(1);
}

function client() {
  const url = process.env.SUPABASE_URL ?? process.env.NG_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) fail('SUPABASE_URL is not set');
  if (!key) fail('SUPABASE_SERVICE_ROLE_KEY is not set (service-role key, environment only)');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------- helpers

const MB = 1024 * 1024;
const mb = (bytes) => (bytes / MB).toFixed(1);
const pct = (a, b) => (b ? ((1 - a / b) * 100).toFixed(1) : '0.0');

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  });
  await Promise.all(workers);
  return out;
}

/** Every `<hash>/` prefix in the bucket, paged. */
async function listFolders(storage) {
  const folders = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await storage.list('', { limit: LIST_PAGE, offset });
    if (error) fail(`listing bucket root failed: ${error.message}`);
    if (!data?.length) break;
    // Storage returns folders as synthetic rows with a null id.
    for (const e of data) if (e.id === null) folders.push(e.name);
    if (data.length < LIST_PAGE) break;
  }
  return folders;
}

/** Objects directly under one `<hash>/` prefix. */
async function listObjects(storage, hash) {
  const out = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await storage.list(hash, { limit: LIST_PAGE, offset });
    if (error) fail(`listing ${hash} failed: ${error.message}`);
    if (!data?.length) break;
    for (const e of data) {
      if (e.id === null) continue; // nested folder — the scheme has none
      out.push({
        path: `${hash}/${e.name}`,
        name: e.name,
        size: Number(e.metadata?.size ?? 0),
        contentType: e.metadata?.mimetype ?? null,
        updatedAt: e.updated_at ?? e.created_at ?? null,
      });
    }
    if (data.length < LIST_PAGE) break;
  }
  return out;
}

/**
 * All cache rows, plus whether the target schema is live.
 *
 * `top_width`/`bytes` arrive with migration 20260727170000. A dry run against a
 * project that has not been pushed yet still works — every row simply reads as
 * legacy — but `--apply` must refuse there, because writing the ladder without
 * being able to record it would leave the feed pointing at deleted objects.
 */
async function loadCacheRows(db) {
  const rows = new Map();
  let schemaReady = true;
  let columns = 'source_key, ext, top_width, bytes';
  for (let from = 0; ; from += LIST_PAGE) {
    const { data, error } = await db
      .from('verse_image_cache')
      .select(columns)
      .order('source_key')
      .range(from, from + LIST_PAGE - 1);
    if (error) {
      if (schemaReady && error.code === '42703') {
        schemaReady = false;
        columns = 'source_key, ext';
        from -= LIST_PAGE; // retry the same page with the legacy projection
        continue;
      }
      fail(`reading verse_image_cache failed: ${error.message}`);
    }
    if (!data?.length) break;
    for (const r of data) rows.set(r.source_key, { top_width: null, bytes: null, ...r });
    if (data.length < LIST_PAGE) break;
  }
  return { rows, schemaReady };
}

/**
 * Guard: a path may only be deleted when the row that survives this run does not
 * reference it. Called for EVERY deletion, including orphan pruning.
 */
function assertDeletable(path, referenced) {
  if (referenced.has(path)) {
    throw new Error(`refusing to delete a referenced object: ${path}`);
  }
}

// ---------------------------------------------------------------- planning

/**
 * Classify one hash folder against its cache row.
 *   'done'    — ladder complete, only leftovers to sweep
 *   'migrate' — needs decode + re-encode
 *   'orphan'  — objects with no cache row
 *   'empty'   — folder with no objects (nothing to do)
 */
function classify(hash, objects, row) {
  if (!objects.length) return { state: 'empty' };
  if (!row) return { state: 'orphan' };
  if (row.top_width != null) {
    const expected = new Set(expectedVariantPaths(hash, row.top_width, row.ext));
    const present = new Map(objects.map((o) => [o.path, o]));
    const complete = [...expected].every((p) => (present.get(p)?.size ?? 0) > 0);
    if (complete) {
      return { state: 'done', expected, leftovers: objects.filter((o) => !expected.has(o.path)) };
    }
  }
  return { state: 'migrate' };
}

/** The object we re-encode from: the widest legacy copy we have (they are twins). */
function pickSource(objects) {
  const cover = objects.find((o) => /^cover\./.test(o.name));
  const post = objects.find((o) => /^post\./.test(o.name));
  const widest = [...objects].sort((a, b) => b.size - a.size)[0];
  return cover ?? post ?? widest;
}

// ---------------------------------------------------------------- migration

async function download(storage, path) {
  const { data, error } = await storage.download(path);
  if (error) throw new Error(`download ${path}: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Re-encode one source into its ladder. Returns the projected/actual result
 * WITHOUT touching storage when `apply` is false.
 */
async function compactOne(ctx, hash, objects, row) {
  const source = pickSource(objects);
  const before = objects.reduce((n, o) => n + o.size, 0);
  const bytes = await download(ctx.storage, source.path);
  const ext = source.name.slice(source.name.lastIndexOf('.') + 1).toLowerCase();

  const variants = buildVariants(bytes, ext, nodeCodecs, ctx.maxPixels);

  // Undecodable source — in practice WebP, which has no lightweight pure-JS
  // decoder (see image-codecs.ts). Unlike ingest, the backfill mirrors it
  // verbatim at ANY size: it is not parking a new blob, it is collapsing an
  // existing duplicated pair down to one object, which can only shrink the
  // bucket. `w0` tells the client "one object, unknown width, no srcset".
  if (!variants) {
    const size = readImageSize(bytes);
    if (size && size.w * size.h > ctx.maxPixels) {
      // Decodable format but too big to hold in memory — leave it completely
      // alone rather than guess. Raise --max-pixels to include it.
      return {
        hash, state: 'skipped', before, after: before,
        reason: `too large to decode (${size.w}×${size.h}, over --max-pixels=${ctx.maxPixels})`,
      };
    }
    const path = variantPath(hash, OPAQUE_WIDTH, ext);
    const after = bytes.length;
    if (!ctx.apply) return { hash, state: 'passthrough', before, after, plannedPaths: [path] };
    await upload(ctx.storage, path, bytes, source.contentType ?? 'application/octet-stream');
    await verifyAndFinish(ctx, hash, objects, { ext, top_width: OPAQUE_WIDTH, bytes: after }, [path]);
    return { hash, state: 'passthrough', before, after };
  }

  const top = variants[variants.length - 1];
  const after = totalVariantBytes(variants);
  const paths = variants.map((v) => variantPath(hash, v.width, v.ext));

  if (!ctx.apply) {
    return {
      hash, state: 'migrated', before, after, plannedPaths: paths, sourceBytes: bytes.length,
      variantSizes: variants.map((v) => ({ width: v.width, bytes: v.bytes.length })),
    };
  }

  for (const v of variants) {
    await upload(ctx.storage, variantPath(hash, v.width, v.ext), v.bytes, v.contentType);
  }
  await verifyAndFinish(ctx, hash, objects, { ext: top.ext, top_width: top.width, bytes: after }, paths);
  return { hash, state: 'migrated', before, after };
}

async function upload(storage, path, bytes, contentType) {
  const { error } = await storage.upload(path, bytes, {
    contentType,
    upsert: true,
    cacheControl: VARIANT_CACHE_CONTROL,
  });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

/**
 * Verify the new ladder is really in the bucket, persist the row, then delete
 * whatever the row no longer references. Never reordered — see the header.
 */
async function verifyAndFinish(ctx, hash, oldObjects, rowPatch, expectedPaths) {
  const now = await listObjects(ctx.storage, hash);
  const present = new Map(now.map((o) => [o.path, o]));
  for (const p of expectedPaths) {
    if (!((present.get(p)?.size ?? 0) > 0)) {
      throw new Error(`verification failed: ${p} missing or empty after upload — nothing deleted`);
    }
  }

  const { error } = await ctx.db
    .from('verse_image_cache')
    .update(rowPatch)
    .eq('source_key', hash);
  if (error) throw new Error(`updating verse_image_cache/${hash}: ${error.message}`);

  const referenced = new Set(expectedPaths);
  const stale = now.filter((o) => !referenced.has(o.path)).map((o) => o.path);
  for (const p of stale) assertDeletable(p, referenced);
  if (stale.length) {
    const { error: delErr } = await ctx.storage.remove(stale);
    if (delErr) throw new Error(`deleting superseded objects of ${hash}: ${delErr.message}`);
  }
  void oldObjects;
  return stale.length;
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = client();
  const storage = db.storage.from(BUCKET);
  const ctx = { db, storage, apply: opts.apply, maxPixels: opts.maxPixels };

  console.log(`news-image-compact — ${opts.apply ? 'APPLY (destructive)' : 'DRY RUN (read-only)'}`);
  console.log(`bucket: ${BUCKET}\n`);

  const [folders, cache] = await Promise.all([listFolders(storage), loadCacheRows(db)]);
  const { rows, schemaReady } = cache;
  console.log(`found ${folders.length} source folder(s), ${rows.size} cache row(s)`);
  if (!schemaReady) {
    console.log('note: verse_image_cache has no top_width/bytes column yet — '
      + 'migration 20260727170000 is not applied to this project.');
    if (opts.apply) fail('refusing to --apply before the migration is pushed (npm run db:push)');
  }

  const inventory = await mapLimit(folders, Math.max(opts.concurrency, 6), async (hash) => {
    const objects = await listObjects(storage, hash);
    return { hash, objects, row: rows.get(hash) ?? null, ...classify(hash, objects, rows.get(hash) ?? null) };
  });

  const totalObjects = inventory.reduce((n, e) => n + e.objects.length, 0);
  const totalBytes = inventory.reduce((n, e) => n + e.objects.reduce((m, o) => m + o.size, 0), 0);
  console.log(`bucket now: ${totalObjects} object(s), ${mb(totalBytes)} MB\n`);

  // --- orphans (objects without a cache row) + dangling rows (row w/o objects)
  const cutoff = Date.now() - opts.orphanAgeHours * 3600_000;
  const orphans = inventory.filter((e) => e.state === 'orphan');
  const orphanBytes = orphans.reduce((n, e) => n + e.objects.reduce((m, o) => m + o.size, 0), 0);
  const prunableOrphans = orphans.filter((e) =>
    e.objects.every((o) => !o.updatedAt || Date.parse(o.updatedAt) < cutoff));
  const folderSet = new Set(folders);
  const danglingRows = [...rows.keys()].filter((k) => !folderSet.has(k));

  console.log(`orphans: ${orphans.length} folder(s) / ${orphans.reduce((n, e) => n + e.objects.length, 0)} object(s)`
    + ` / ${mb(orphanBytes)} MB — ${prunableOrphans.length} older than ${opts.orphanAgeHours}h and prunable`);
  console.log(`dangling cache rows (row but no objects): ${danglingRows.length}\n`);

  // --- the real work
  const todo = inventory.filter((e) => e.state === 'migrate').slice(0, opts.limit);
  const done = inventory.filter((e) => e.state === 'done');
  const sweepable = done.filter((e) => e.leftovers.length);
  console.log(`already compacted: ${done.length} (${sweepable.length} with leftovers to sweep)`);
  console.log(`to compact: ${todo.length}\n`);

  const results = [];
  if (opts.apply) {
    let n = 0;
    await mapLimit(todo, opts.concurrency, async (e) => {
      try {
        const r = await compactOne(ctx, e.hash, e.objects, e.row);
        results.push(r);
        console.log(`[${++n}/${todo.length}] ${e.hash} ${r.state} ${mb(r.before)} → ${mb(r.after)} MB`);
      } catch (err) {
        console.error(`[${++n}/${todo.length}] ${e.hash} FAILED: ${err.message}`);
        results.push({ hash: e.hash, state: 'failed', before: 0, after: 0 });
      }
    });
    // Sweep leftovers of folders migrated by an earlier (interrupted) run.
    for (const e of sweepable) {
      const referenced = e.expected;
      const stale = e.leftovers.map((o) => o.path);
      for (const p of stale) assertDeletable(p, referenced);
      const { error } = await storage.remove(stale);
      if (error) console.error(`sweep ${e.hash}: ${error.message}`);
      else console.log(`swept ${stale.length} leftover object(s) of ${e.hash}`);
    }
  } else {
    // Dry run: really re-encode a sample so the projection is measured, not guessed.
    const sample = todo.slice(0, Number.isFinite(opts.sample) ? opts.sample : todo.length);
    console.log(`re-encoding ${sample.length} sample source(s) in memory for the projection…`);
    let n = 0;
    await mapLimit(sample, opts.concurrency, async (e) => {
      try {
        const r = await compactOne(ctx, e.hash, e.objects, e.row);
        results.push(r);
        console.log(`  [${++n}/${sample.length}] ${e.hash} ${mb(r.before)} → ${mb(r.after)} MB (${r.state})`);
      } catch (err) {
        console.error(`  [${++n}/${sample.length}] ${e.hash} FAILED: ${err.message}`);
      }
    });
  }

  report({ opts, inventory, totalObjects, totalBytes, todo, done, sweepable, results, orphans, orphanBytes, prunableOrphans, danglingRows });

  // --- pruning (explicit opt-in, same safety rules)
  if (opts.pruneOrphans && opts.apply) {
    let freed = 0;
    for (const e of prunableOrphans) {
      const paths = e.objects.map((o) => o.path);
      for (const p of paths) assertDeletable(p, new Set());
      const { error } = await storage.remove(paths);
      if (error) { console.error(`prune ${e.hash}: ${error.message}`); continue; }
      freed += e.objects.reduce((n, o) => n + o.size, 0);
    }
    console.log(`pruned ${prunableOrphans.length} orphan folder(s), freed ${mb(freed)} MB`);
    if (danglingRows.length) {
      const { error } = await db.from('verse_image_cache').delete().in('source_key', danglingRows);
      if (error) console.error(`pruning dangling rows: ${error.message}`);
      else console.log(`deleted ${danglingRows.length} dangling cache row(s) — ingest will re-cache them`);
    }
  } else if (opts.pruneOrphans) {
    console.log(`--prune-orphans is set but this is a dry run — nothing pruned.`);
  }
}

function report(s) {
  const measured = s.results.filter((r) => r.state === 'migrated' || r.state === 'passthrough');
  const measuredBefore = measured.reduce((n, r) => n + r.before, 0);
  const measuredAfter = measured.reduce((n, r) => n + r.after, 0);
  const ratio = measuredBefore ? measuredAfter / measuredBefore : 1;

  console.log('\n' + '='.repeat(66));
  if (s.opts.apply) {
    const freed = measuredBefore - measuredAfter;
    const swept = s.sweepable.reduce((n, e) => n + e.leftovers.reduce((m, o) => m + o.size, 0), 0);
    console.log(`compacted ${measured.length} source(s): ${mb(measuredBefore)} → ${mb(measuredAfter)} MB`);
    console.log(`swept leftovers: ${mb(swept)} MB`);
    console.log(`FREED: ${mb(freed + swept)} MB`);
    const failed = s.results.filter((r) => r.state === 'failed').length;
    const skipped = s.results.filter((r) => r.state === 'skipped').length;
    if (failed || skipped) console.log(`failed: ${failed}, skipped (undecodable/oversized): ${skipped}`);
    console.log(`bucket: ${mb(s.totalBytes)} MB → ~${mb(s.totalBytes - freed - swept)} MB`);
  } else {
    // Sources we did not re-encode are projected with the measured mean ratio.
    // Anything the sample SKIPPED is excluded from the extrapolation and counted
    // at full size — pretending a source we refused to touch will shrink like the
    // others is exactly how a projection turns into a lie.
    const accounted = new Set(s.results.map((r) => r.hash));
    const rest = s.todo.filter((e) => !accounted.has(e.hash));
    const restBefore = rest.reduce((n, e) => n + e.objects.reduce((m, o) => m + o.size, 0), 0);
    const restAfter = restBefore * ratio;
    const sweptBytes = s.sweepable.reduce((n, e) => n + e.leftovers.reduce((m, o) => m + o.size, 0), 0);
    const orphanFreed = s.opts.pruneOrphans
      ? s.prunableOrphans.reduce((n, e) => n + e.objects.reduce((m, o) => m + o.size, 0), 0)
      : 0;
    const projectedAfter = s.totalBytes
      - (measuredBefore - measuredAfter)
      - (restBefore - restAfter)
      - sweptBytes
      - orphanFreed;

    const skipped = s.results.filter((r) => r.state === 'skipped');
    console.log('PROJECTION (dry run)');
    if (skipped.length) {
      const skippedBytes = skipped.reduce((n, r) => n + r.before, 0);
      console.log(`  skipped (left untouched, counted at full size): ${skipped.length} source(s), ${mb(skippedBytes)} MB`);
      for (const r of skipped) console.log(`    ${r.hash}: ${r.reason}`);
    }
    console.log(`  measured on ${measured.length} source(s): ${mb(measuredBefore)} → ${mb(measuredAfter)} MB`
      + `  (−${pct(measuredAfter, measuredBefore)} %)`);
    console.log(`  extrapolated over ${rest.length} remaining source(s): ${mb(restBefore)} → ${mb(restAfter)} MB`);
    console.log(`  leftover sweep: ${mb(sweptBytes)} MB`);
    console.log(`  orphan prune: ${orphanFreed ? mb(orphanFreed) + ' MB' : 'not requested (--prune-orphans)'}`
      + `  [${s.orphans.length} orphan folder(s), ${mb(s.orphanBytes)} MB total]`);
    console.log(`  BUCKET: ${mb(s.totalBytes)} MB → ~${mb(projectedAfter)} MB  (−${pct(projectedAfter, s.totalBytes)} %)`);

    const rungCounts = measured.flatMap((r) => (r.plannedPaths ? [r.plannedPaths.length] : []));
    const meanRungs = rungCounts.length ? rungCounts.reduce((a, b) => a + b, 0) / rungCounts.length : 3;
    const todoObjectsNow = s.todo.reduce((n, e) => n + e.objects.length, 0);
    const leftoverCount = s.sweepable.reduce((n, e) => n + e.leftovers.length, 0);
    const orphanCount = s.opts.pruneOrphans
      ? s.prunableOrphans.reduce((n, e) => n + e.objects.length, 0)
      : 0;
    const projectedObjects = Math.round(
      s.totalObjects - todoObjectsNow + s.todo.length * meanRungs - leftoverCount - orphanCount,
    );
    console.log(`  objects: ${s.totalObjects} → ~${projectedObjects}`);

    // Per-rung sizes: the acceptance target is "well under 100 KB for a tile
    // variant, a few hundred KB for the largest".
    const byWidth = new Map();
    for (const r of measured) {
      for (const v of r.variantSizes ?? []) {
        if (!byWidth.has(v.width)) byWidth.set(v.width, []);
        byWidth.get(v.width).push(v.bytes);
      }
    }
    for (const width of [...byWidth.keys()].sort((a, b) => a - b)) {
      const sizes = byWidth.get(width);
      const kb = (n) => (n / 1024).toFixed(0);
      console.log(`  w${width}: n=${sizes.length}  mean ${kb(sizes.reduce((a, b) => a + b, 0) / sizes.length)} KB`
        + `  max ${kb(Math.max(...sizes))} KB`);
    }
    console.log('\n  run again with --apply to execute.');
  }
  console.log('='.repeat(66));
}

main().catch((err) => fail(err.stack ?? String(err)));
