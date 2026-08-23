/**
 * Catalog promotion — feeds an extractor out_dir into the public Codex.
 *
 * The desktop upload flow writes a bundle to `p4k_bundles` via `ingest-bundle`,
 * but the public Codex (`/codex`) reads the `codex_*` tables, which are only
 * populated by `ingest-catalog`. This bridge closes that gap: after a bundle
 * upload succeeds, it reads the SAME out_dir the extractor produced and drives
 * the `ingest-catalog` init→upsert→…→finalize protocol using the operator's JWT
 * + the built-in release token (the production auth gate — no seed token).
 *
 * It is a faithful port of `supabase/scripts/seed-codex.mjs --via-function`,
 * reusing the pure row mappers in `../lib/catalog-map.ts` so a desktop upload
 * produces the same codex rows as the seed script. Progress is streamed so the
 * renderer can show a live per-table counter.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log';
import { API_BASE, RELEASE_TOKEN } from '../lib/release-token.js';
import { isInterrupt, type PauseControl } from '../lib/pause-control.js';
import { CATALOG_PHASE_ORDER } from '../lib/catalog-phases.js';
import {
  makeTagger,
  collectStrings,
  collectPorts,
  collectIngredients,
  dedupeStrings,
  hasViableCatalog,
  mapManufacturers,
  mapShips,
  mapWeapons,
  mapComponents,
  mapItems,
  mapAmmunition,
  mapBlueprints,
  mapKeybinds,
  type Nat,
  type StringRow,
  type PortRow,
  type KeybindData,
} from '../lib/catalog-map.js';

const CHUNK = 500; // entity/string rows per request
const LOCALE_CHUNK = 1000; // locale rows per request (small rows)

// ── transient-failure handling ───────────────────────────────────────────────
// One catalog run is thousands of sequential requests over hours. Treating any
// single failure as fatal made the whole stage a coin flip: a Postgres
// statement timeout on one heavy upsert (`HTTP 500 ingest_failed canceling
// statement due to statement timeout`) threw away an entire multi-hour run.
//
// Two independent recoveries, because there are two distinct causes:
//   * flaky transport / momentarily busy server -> retry the SAME request with
//     exponential backoff;
//   * the batch itself is too heavy for the database's statement budget ->
//     retrying it unchanged would time out forever, so HALVE it and send both
//     halves. Every op here is an idempotent upsert, so a split is free.
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 3_000, 8_000, 20_000];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Failure classes the renderer can turn into a sentence an operator can act on. */
export type CatalogErrorCode =
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'server'
  | 'out_dir_missing'
  | 'manifest_missing'
  | 'no_build_id'
  | 'empty_catalog'
  | 'unknown';

/** A non-2xx reply from ingest-catalog, kept structured so retry/split can reason about it. */
export class IngestHttpError extends Error {
  override readonly name = 'IngestHttpError';
  constructor(
    readonly op: string,
    readonly status: number,
    readonly code: string,
    readonly serverMessage: string,
  ) {
    super(`${op} → HTTP ${status} ${code} ${serverMessage}`.trim());
  }

  /**
   * Postgres cancelled the statement — the batch was too heavy, not malformed.
   *
   * Matches the classified reply from a current edge function (`ingest_timeout`,
   * 503) AND the raw `500 ingest_failed / canceling statement …` an older
   * deployment passes through, so the fix works before the function ships.
   * Deliberately NOT keyed on the status alone: a bare 503/504 from the gateway
   * just means "busy", and the right answer there is a plain retry, not a split.
   */
  get isTimeout(): boolean {
    return (
      this.code === 'ingest_timeout' ||
      /statement timeout|canceling statement|57014/i.test(this.serverMessage)
    );
  }

  /** Worth sending again unchanged — as opposed to a permanent client/config error. */
  get isTransient(): boolean {
    // `server_misconfigured` is a 500 but a *deployment* problem: retrying it
    // only burns a minute before failing with the same message.
    if (this.code === 'server_misconfigured') return false;
    return this.isTimeout || this.status === 429 || this.status >= 500;
  }
}

/** A thrown non-HTTP failure (DNS, dropped socket, TLS) — always worth a retry. */
function isTransientFailure(err: unknown): boolean {
  if (err instanceof IngestHttpError) return err.isTransient;
  return err instanceof Error && !isInterrupt(err);
}

/** Map a failure onto the coarse class the renderer explains to the operator. */
export function classifyCatalogError(err: unknown): CatalogErrorCode {
  if (err instanceof IngestHttpError) {
    if (err.isTimeout) return 'timeout';
    if (err.status === 401) return 'unauthorized';
    if (err.status === 403) return 'forbidden';
    return 'server';
  }
  return err instanceof Error ? 'network' : 'unknown';
}

export interface CatalogProgress {
  phase: string; // human/i18n key-ish label, e.g. 'ships'
  current: number;
  total: number;
  // Additive/optional: which of the fixed publish steps we're on (1-based)
  // and how many total, so the renderer can show an overall two-tier bar
  // instead of only the within-table current/total (which resets to 0 each
  // table). Omitted for callers that don't care — never a breaking change.
  phaseIndex?: number;
  phaseTotal?: number;
}
export type CatalogProgressCb = (p: CatalogProgress) => void;

export interface CatalogUploadResult {
  ok: boolean;
  buildId?: string;
  counts?: Record<string, number>;
  /** Technical detail — logs, and the collapsed "details" line in the UI. */
  error?: string;
  /** Coarse failure class, so the renderer writes a sentence instead of dumping `error`. */
  errorCode?: CatalogErrorCode;
  /** Publish phase that failed (`codex_ships`, `finalize`, …) — names WHERE it stopped. */
  errorPhase?: string;
}

/**
 * Either a fixed bearer token, or a getter that returns a FRESH one on demand.
 *
 * A catalog upload is hundreds of sequential requests over what can be *hours*
 * for a full extract. A Supabase access token lives ~1h, so a single token
 * captured at the start goes stale mid-run and every later request 401s ("logs
 * itself out every hour"). Passing a getter — wired in main to
 * `ensureAccessToken`, which silently refreshes near expiry — keeps the
 * Authorization header valid for the whole run regardless of the token TTL.
 */
export type CatalogToken = string | (() => string | Promise<string>);

/**
 * Resume + pause wiring. All optional: omitting `hooks` entirely reproduces the
 * original one-shot behaviour, so callers that don't care (and the existing
 * tests) are unaffected.
 */
export interface CatalogHooks {
  /** Cooperative pause/cancel, checked between chunks. */
  control?: PauseControl;
  /**
   * Awaited between chunks, right after the pause checkpoint. Re-reads the
   * LIVE performance profile on every call, so switching to "minimal impact"
   * mid-upload is honoured by the next chunk instead of at the next run.
   */
  pace?: () => Promise<void>;
  /** Reuse a build row from an interrupted run instead of `init`-ing a new one. */
  buildId?: string | null;
  /** Phases already fully sent — their network calls are skipped. */
  donePhases?: string[];
  /** Rows of `phase` already sent, for a mid-phase resume. */
  sentFor?: (phase: string) => number;
  /** Fired right after `init` mints a build id, so it survives a kill. */
  onBuildId?: (buildId: string) => void;
  /** Fired before each chunk goes out — persist this to resume mid-phase. */
  onCursor?: (phase: string, sent: number) => void;
  /** Fired when a phase is fully sent. */
  onPhaseDone?: (phase: string) => void;
  /**
   * Backoff before retrying a transient failure, in ms, given the 1-based
   * attempt number. A seam for tests only — production wants the real waits, so
   * omitting it uses {@link BACKOFF_MS}.
   */
  backoffMs?: (attempt: number) => number;
}

function endpoint(): string {
  return `${API_BASE.replace(/\/$/, '')}/functions/v1/ingest-catalog`;
}

async function readJsonDir(outDir: string, sub: string): Promise<Record<string, unknown>[]> {
  const dir = join(outDir, sub);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(join(dir, f), 'utf-8')));
    } catch (e) {
      log.warn(`[catalog] skip ${sub}/${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Drive the full ingest-catalog protocol for one extractor out_dir.
 * Best-effort per op with a hard failure surfaced as { ok:false, error }.
 */
export async function uploadCatalog(
  accessToken: CatalogToken,
  outDir: string,
  onProgress: CatalogProgressCb,
  hooks: CatalogHooks = {},
): Promise<CatalogUploadResult> {
  if (!existsSync(outDir)) return { ok: false, error: 'out_dir_missing', errorCode: 'out_dir_missing' };
  const manifestPath = join(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) return { ok: false, error: 'manifest_missing', errorCode: 'manifest_missing' };

  // The fixed order of `phase` values this function emits (below) lives in
  // `../lib/catalog-phases` so the resume banner can turn a stored cursor into
  // the SAME "step N / M" this live bar shows. Additive only: onProgress still
  // receives the original phase/current/total unchanged, just with two extra
  // optional fields attached.
  // Also the "where did it stop" marker a failure reports back to the renderer.
  let livePhase = 'init';
  const progress = (p: CatalogProgress): void => {
    livePhase = p.phase;
    const idx = (CATALOG_PHASE_ORDER as readonly string[]).indexOf(p.phase);
    onProgress(
      idx === -1 ? p : { ...p, phaseIndex: idx + 1, phaseTotal: CATALOG_PHASE_ORDER.length },
    );
  };

  // Resolved per request, not once: a getter re-reads (and, near expiry,
  // refreshes) the token so a multi-hour run never sends a dead JWT.
  const resolveToken = typeof accessToken === 'function' ? accessToken : (): string => accessToken;

  const postOnce = async (op: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const token = await resolveToken();
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-sc-release-token': RELEASE_TOKEN,
      },
      body: JSON.stringify({ op, ...extra }),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new IngestHttpError(
        op,
        res.status,
        String(j.error ?? ''),
        String(j.message ?? ''),
      );
    }
    return j;
  };

  /**
   * Every request goes through here, so one flaky reply can no longer end a
   * multi-hour run. Backs off between attempts and re-checks the pause signal
   * around the wait, so pausing during a retry storm still unwinds promptly
   * instead of sitting out the full backoff.
   */
  const post = async (op: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let last: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await postOnce(op, extra);
      } catch (err) {
        if (isInterrupt(err)) throw err;
        last = err;
        if (attempt === MAX_ATTEMPTS || !isTransientFailure(err)) throw err;
        const wait = hooks.backoffMs?.(attempt) ?? BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
        log.warn(
          `[catalog] ${op}: ${(err as Error).message} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`,
        );
        hooks.control?.checkpoint();
        await sleep(wait);
        hooks.control?.checkpoint();
      }
    }
    throw last;
  };

  /**
   * Send one slice, halving it when the database says the BATCH was the
   * problem. Retrying an over-heavy upsert unchanged just times out again, so
   * the split is the only escape; the recursion floors at a single row, where a
   * persisting timeout is a real failure worth surfacing.
   */
  const sendSlice = async (
    phase: string,
    send: (slice: unknown[]) => Promise<unknown>,
    slice: unknown[],
    budget: { size: number },
  ): Promise<void> => {
    // `progress()` only fires AFTER a chunk lands, so it cannot name the phase a
    // failing FIRST chunk belonged to — set the marker where the request is.
    livePhase = phase;
    try {
      await send(slice);
    } catch (err) {
      if (isInterrupt(err)) throw err;
      const timedOut = err instanceof IngestHttpError && err.isTimeout;
      if (!timedOut || slice.length <= 1) throw err;
      const half = Math.ceil(slice.length / 2);
      // Shrink the phase's standing batch size too, not just this one slice:
      // if 500 ship rows are too heavy once they are too heavy every time, and
      // without this every remaining chunk would pay another timeout + backoff
      // before splitting again.
      budget.size = Math.max(1, Math.min(budget.size, half));
      log.warn(
        `[catalog] ${phase}: statement timeout on ${slice.length} rows — splitting into ${half} + ${slice.length - half} (batch size now ${budget.size})`,
      );
      await sendSlice(phase, send, slice.slice(0, half), budget);
      await sendSlice(phase, send, slice.slice(half), budget);
    }
  };

  const isPhaseDone = (phase: string): boolean => (hooks.donePhases ?? []).includes(phase);
  const alreadySent = (phase: string): number => hooks.sentFor?.(phase) ?? 0;

  /**
   * Send `rows` for one phase in chunks, resumably.
   *
   * Returns the number of rows the phase *represents* — not the number this
   * particular run pushed over the wire. On a resumed run the difference
   * matters: a skipped phase still contributed its rows to the build, and
   * `hasViableCatalog(counts)` gates finalization on ships/manufacturers being
   * non-zero. Reporting 0 for an already-sent phase would make a resumed run
   * refuse to finalize a build it had actually uploaded in full.
   */
  const sendChunks = async (
    phase: string,
    rows: unknown[],
    chunkSize: number,
    send: (slice: unknown[]) => Promise<unknown>,
    opts: { onFirstChunk?: () => Promise<void> } = {},
  ): Promise<number> => {
    if (isPhaseDone(phase)) {
      progress({ phase, current: rows.length, total: rows.length });
      return rows.length;
    }
    const skip = alreadySent(phase);
    // `clear_*` ops (ports, ingredients) wipe the build's existing rows, so they
    // may only run when this phase starts from scratch. Re-issuing one on a
    // mid-phase resume would delete precisely the rows we already paid to send.
    if (skip === 0 && opts.onFirstChunk) await opts.onFirstChunk();
    let done = Math.min(skip, rows.length);
    if (done > 0) progress({ phase, current: done, total: rows.length });
    // Mutable so a batch the database refused can shrink the rest of the phase
    // (see `sendSlice`); it only ever gets smaller, never larger.
    const budget = { size: chunkSize };
    while (done < rows.length) {
      // Safe boundary: between chunks, never mid-request.
      hooks.control?.checkpoint();
      // Same boundary, same reason: a throttle change lands here, where no
      // request is in flight, so it can never truncate one.
      await hooks.pace?.();
      // Persist the cursor BEFORE the call it guards. A kill mid-flight then
      // replays this one chunk (an idempotent upsert) rather than skipping it.
      hooks.onCursor?.(phase, done);
      const slice = rows.slice(done, done + budget.size);
      await sendSlice(phase, send, slice, budget);
      done += slice.length;
      progress({ phase, current: done, total: rows.length });
    }
    hooks.onPhaseDone?.(phase);
    return done;
  };

  const sendEntity = async (table: string, rows: unknown[]): Promise<number> =>
    sendChunks(table, rows, CHUNK, (slice) => post('upsert', { table, rows: slice }));

  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
    const nat: Nat = {
      // Uppercase to match the codex read path (codex.service queries
      // channel='LIVE'); the extractor already emits 'LIVE'/'PTU'/… but this
      // guarantees the promoted build is actually visible.
      channel: String(manifest.channel ?? 'LIVE').toUpperCase(),
      patch_version: String(manifest.patch_version ?? '4.x'),
      // build_number is often empty from the extractor; fall back to a stable
      // label so the (channel,patch,build) natural key stays consistent.
      build_number: String(manifest.build_number ?? '').trim() || 'desktop',
    };

    // 1. build row ----------------------------------------------------------
    // A resumed run reuses the build row the interrupted run already created —
    // re-`init`-ing would orphan the rows we uploaded against the old id and
    // restart the whole catalog from zero.
    progress({ phase: 'init', current: 0, total: 1 });
    let buildId = hooks.buildId ?? '';
    if (buildId) {
      log.info(`[catalog] resuming build ${buildId}`);
    } else {
      const initRes = await post('init', {
        build: {
          ...nat,
          schema_version: manifest.schema_version ?? 1,
          quality_score: manifest.quality_score ?? null,
          tool_version: manifest.tool_version ?? null,
          entity_counts: manifest.entity_counts ?? {},
          manifest,
        },
      });
      buildId = String(initRes.build_id ?? '');
      if (!buildId) return { ok: false, error: 'no_build_id', errorCode: 'no_build_id' };
      hooks.onBuildId?.(buildId);
    }
    progress({ phase: 'init', current: 1, total: 1 });
    const tag = makeTagger(buildId, nat);

    const strings: StringRow[] = [];
    const ports: PortRow[] = [];
    const counts: Record<string, number> = {};

    // 2. manufacturers (always full) ---------------------------------------
    {
      const list = await readJsonDir(outDir, 'manufacturers');
      for (const m of list) {
        collectStrings(strings, buildId, nat, m.className as string, 'manufacturer', [
          { field: 'name', loc: m.name },
          { field: 'description', loc: m.description },
        ]);
      }
      counts.manufacturers = await sendEntity('codex_manufacturers', mapManufacturers(list, tag));
    }

    // 3. ships (always full) -----------------------------------------------
    {
      const list = await readJsonDir(outDir, 'ships');
      for (const s of list) {
        collectStrings(strings, buildId, nat, s.className as string, 'ship', [
          { field: 'name', loc: s.name },
          { field: 'description', loc: s.description },
          { field: 'vehicleName', loc: (s as { vehicleName?: unknown }).vehicleName },
        ]);
        collectPorts(ports, buildId, nat, s.className as string, 'ship', (s as { itemPorts?: unknown }).itemPorts);
      }
      counts.ships = await sendEntity('codex_ships', mapShips(list, tag));
    }

    // 4. weapons -----------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'weapons');
      for (const w of list) {
        collectStrings(strings, buildId, nat, w.className as string, 'weapon', [
          { field: 'name', loc: w.name },
          { field: 'description', loc: w.description },
        ]);
        collectPorts(ports, buildId, nat, w.className as string, 'weapon', (w as { itemPorts?: unknown }).itemPorts);
      }
      counts.weapons = await sendEntity('codex_weapons', mapWeapons(list, tag));
    }

    // 5. components --------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'components');
      for (const c of list) {
        collectStrings(strings, buildId, nat, c.className as string, 'component', [
          { field: 'name', loc: c.name },
          { field: 'description', loc: c.description },
        ]);
        collectPorts(ports, buildId, nat, c.className as string, 'component', (c as { itemPorts?: unknown }).itemPorts);
      }
      counts.components = await sendEntity('codex_components', mapComponents(list, tag));
    }

    // 6. items -------------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'items');
      for (const it of list) {
        collectStrings(strings, buildId, nat, it.className as string, 'item', [
          { field: 'name', loc: it.name },
          { field: 'description', loc: it.description },
        ]);
      }
      counts.items = await sendEntity('codex_items', mapItems(list, tag));
    }

    // 7. ammunition --------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'ammunition');
      counts.ammunition = await sendEntity('codex_ammunition', mapAmmunition(list, tag));
    }

    // 7b. blueprints + ingredients -----------------------------------------
    {
      const list = await readJsonDir(outDir, 'blueprints');
      for (const bp of list) {
        collectStrings(strings, buildId, nat, bp.className as string, 'blueprint', [
          { field: 'name', loc: bp.name },
          { field: 'description', loc: bp.description },
        ]);
      }
      counts.blueprints = await sendEntity('codex_blueprints', mapBlueprints(list, tag));

      const ingredientRows = collectIngredients(buildId, nat, list);
      counts.blueprint_ingredients = await sendChunks(
        'codex_blueprint_ingredients',
        ingredientRows,
        CHUNK,
        (slice) => post('ingredients', { build_id: buildId, rows: slice }),
        { onFirstChunk: () => post('clear_ingredients', { build_id: buildId }).then(() => undefined) },
      );
    }

    // 8. entity strings (deduped) + ports ----------------------------------
    {
      const deduped = dedupeStrings(strings);
      counts.entity_strings = await sendChunks('codex_entity_strings', deduped, CHUNK, (slice) =>
        post('strings', { rows: slice }),
      );
    }
    {
      counts.item_ports = await sendChunks(
        'codex_item_ports',
        ports,
        CHUNK,
        (slice) => post('ports', { build_id: buildId, rows: slice }),
        { onFirstChunk: () => post('clear_ports', { build_id: buildId }).then(() => undefined) },
      );
    }

    // 9. full localization tables ------------------------------------------
    {
      const dir = join(outDir, 'localization');
      const localeRows: { build_id: string; lang: string; key: string; value: string }[] = [];
      if (existsSync(dir)) {
        for (const f of (await readdir(dir)).filter((n) => n.endsWith('.json'))) {
          const lang = f.replace(/\.json$/, '');
          const table = JSON.parse(await readFile(join(dir, f), 'utf-8')) as Record<string, unknown>;
          for (const [key, value] of Object.entries(table)) {
            if (value == null) continue;
            localeRows.push({ build_id: buildId, lang, key, value: String(value) });
          }
        }
      }
      counts.locale_strings = await sendChunks(
        'codex_locale_strings',
        localeRows,
        LOCALE_CHUNK,
        (slice) => post('locale_strings', { rows: slice }),
      );
    }

    // 9b. preview images ----------------------------------------------------
    {
      const dir = join(outDir, 'previews');
      if (existsSync(dir)) {
        const files = (await readdir(dir)).filter((f) => f.endsWith('.webp'));
        // One image per request (they are large) — chunk size 1 makes every
        // preview its own resume point.
        counts.previews = await sendChunks('codex_previews', files, 1, async (slice) => {
          const name = String(slice[0]);
          const bytes = await readFile(join(dir, name));
          await post('preview', {
            build_number: nat.build_number,
            name,
            content_base64: bytes.toString('base64'),
          });
        });
      }
    }

    // 9c. keybindings (default action profile) ------------------------------
    {
      const file = join(outDir, 'keybinds', 'keybinds.json');
      if (existsSync(file)) {
        let data: KeybindData = {};
        try {
          data = JSON.parse(await readFile(file, 'utf-8')) as KeybindData;
        } catch (e) {
          log.warn(`[catalog] skip keybinds: ${(e as Error).message}`);
        }
        const rows = mapKeybinds(data, buildId, nat);
        counts.keybinds = await sendChunks('codex_keybinds', rows, CHUNK, (slice) =>
          post('keybinds', { rows: slice }),
        );
      }
    }

    // 10. finalize (flip is_current) ---------------------------------------
    // Hardening: never promote an empty/partial build to live. If the extract
    // yielded no ships AND no manufacturers, the out_dir was corrupt or its
    // layout changed — leave the build row written but is_current untouched so
    // the codex keeps showing the last good build.
    if (!hasViableCatalog(counts)) {
      log.warn(`[catalog] not finalizing empty/partial build ${buildId} (counts: ${JSON.stringify(counts)})`);
      return { ok: false, buildId, counts, error: 'empty_catalog', errorCode: 'empty_catalog' };
    }
    hooks.control?.checkpoint();
    progress({ phase: 'finalize', current: 0, total: 1 });
    await post('finalize', { build_id: buildId, entity_counts: { ...(manifest.entity_counts as object), seeded: counts } });
    progress({ phase: 'finalize', current: 1, total: 1 });

    log.info(`[catalog] promoted build ${buildId} (${nat.channel} ${nat.patch_version} ${nat.build_number})`);
    return { ok: true, buildId, counts };
  } catch (err) {
    // A pause/cancel is control flow, not a failure: let it unwind to the
    // caller, which persists the cursor and reports `paused` rather than
    // burying it as an "upload error" the operator would try to retry.
    if (isInterrupt(err)) throw err;
    const error = err instanceof Error ? err.message : String(err);
    log.error(`[catalog] promotion failed in phase '${livePhase}': ${error}`);
    return { ok: false, error, errorCode: classifyCatalogError(err), errorPhase: livePhase };
  }
}
