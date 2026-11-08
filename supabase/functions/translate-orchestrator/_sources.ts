// Community sources: seed import, daily sync, overlay republish, outreach drafts (ops of index.ts).
// Runs with the service-role client; auth happens in index.ts. Contract: docs/translation/ARCHITECTURE.md.

import { diffStrings } from './_diff.ts';
import { buildOverlayMeta, loadTm, makeOverlay, overlayKey, readLocaleTable, saveTm } from './_io.ts';
import type { SourceMetaRow } from './_io.ts';
import { learningHooks } from './_hooks.ts';
import { TranslateError } from './_machine.ts';
import type { Deps } from './_machine.ts';
import { parsePack, resolveSource, upstreamToken } from './_pack.ts';
import type { FetchFn, PackSource } from './_pack.ts';
import { buildOutreachDraft } from './_outreach.ts';
import { packTextPct, seedEntries } from './_seed.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

export interface SourceRow extends PackSource, SourceMetaRow {
  last_seen_commit: string | null;
  last_synced_at: string | null;
  coverage: Record<string, unknown> | null;
}

export interface ImportResult {
  source_id: string;
  lang: string;
  imported: number;
  skipped_cig: number;
  skipped_same: number;
  rejected_qa: number;
  conflicts: number;
  coverage: Record<string, unknown>;
}

export interface SyncResult {
  checked: number;
  changed: number;
  errors: { source_id: string; error: string }[];
}

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

export const isUsable = (s: Pick<SourceRow, 'status' | 'enabled'>) =>
  s.enabled && (s.status === 'licensed' || s.status === 'permitted');

export async function loadSource(sb: Client, id: string): Promise<SourceRow> {
  const { data, error } = await sb.from('translation_sources').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new TranslateError('translate.source_unknown');
  return data as SourceRow;
}

export async function listSources(sb: Client, lang?: string): Promise<SourceRow[]> {
  let q = sb.from('translation_sources').select('*').order('id');
  if (lang) q = q.eq('lang', lang);
  const { data, error } = await q;
  if (error) fail(error);
  return (data ?? []) as SourceRow[];
}

/** Newest current build of the LIVE channel (`codex_builds.is_current`, one per channel). */
export async function currentLiveBuild(sb: Client): Promise<string> {
  const { data, error } = await sb.from('codex_builds').select('id').eq('channel', 'LIVE').eq('is_current', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) fail(error);
  if (!data) throw new TranslateError('translate.no_live_build');
  return (data as { id: string }).id;
}

/**
 * Rebuilds `translation-overlay/<lang>/latest.json` for the current LIVE build from the TM:
 * every non-CIG key with a TM hit (+ admin entries over CIG), with sources/attribution.
 */
export async function republishOverlay(
  deps: Deps,
  sb: Client,
  lang: string,
  buildId: string,
  en?: Record<string, string>,
  cig?: Record<string, string>,
): Promise<{ count: number; attribution: string }> {
  const english = en ?? await readLocaleTable(deps.store, buildId, 'en');
  const cigTable = cig ?? await readCigTable(deps, sb, buildId, lang);
  const tm = await loadTm(deps.store, lang);
  const { reused } = await diffStrings({ en: english, cig: cigTable, tm, mode: 'full' });
  const meta = buildOverlayMeta(lang, reused, tm, await listSources(sb, lang));
  const overlay = makeOverlay(lang, buildId, reused, deps.now().toISOString(), meta);
  await deps.store.putJson(overlayKey(lang, buildId), overlay);
  await deps.store.putJson(overlayKey(lang, 'latest'), overlay);
  return { count: overlay.count, attribution: overlay.attribution };
}

async function readCigTable(deps: Deps, sb: Client, buildId: string, lang: string): Promise<Record<string, string>> {
  const { data, error } = await sb.from('translation_languages').select('cig_folder').eq('lang', lang).maybeSingle();
  if (error) fail(error);
  const folder = (data as { cig_folder?: string | null } | null)?.cig_folder || lang;
  return readLocaleTable(deps.store, buildId, folder);
}

/**
 * A4: pack → filter → TM (`o:'community'`) → coverage on the source row → hooks → latest overlay.
 * Idempotent: a second run of an unchanged pack changes nothing.
 */
export async function importSeed(
  deps: Deps,
  sb: Client,
  sourceId: string,
  opts: { trigger?: 'seed' | 'sync'; fetchFn?: FetchFn; ghToken?: string } = {},
): Promise<ImportResult> {
  const src = await loadSource(sb, sourceId);
  if (!isUsable(src)) throw new TranslateError('translate.source_not_permitted');
  const trigger = opts.trigger ?? 'seed';
  const buildId = await currentLiveBuild(sb);
  const en = await readLocaleTable(deps.store, buildId, 'en');
  if (!Object.keys(en).length) throw new TranslateError('translate.english_missing');
  // use_cig_table=false (ru in the korean slot): CIG's table there is another language, skip nothing.
  const cig = src.use_cig_table ? await readCigTable(deps, sb, buildId, src.lang) : {};

  // The version marker is taken from the cheap probe the sync compares against, then the pack is fetched.
  const marker = await upstreamToken(src, opts.fetchFn, opts.ghToken).catch(() => null);
  const resolved = await resolveSource(src, opts.fetchFn, opts.ghToken);
  const at = deps.now().toISOString();
  const tm = await loadTm(deps.store, src.lang);
  let result;
  let packSize = 0;
  {
    const pack = parsePack(resolved.bytes);
    packSize = pack.map.size;
    result = await seedEntries({ en, cig, pack: pack.map, sourceId: src.id, lic: src.license, at, tm });
  }
  if (Object.keys(result.updates).length) await saveTm(deps.store, src.lang, result.updates);

  const { counts } = result;
  // gap_pct = share of the keys CIG leaves untranslated that the pack really translates (text_pct stays the seeded whole-table figure).
  const translated = counts.imported + counts.unchanged + counts.conflicts + counts.admin_kept + counts.cig_kept;
  const coverage: Record<string, unknown> = {
    ...(src.coverage ?? {}),
    gap_pct: packTextPct(translated, counts.keys - counts.skipped_cig),
    pack_keys: packSize,
    keys: counts.keys,
    imported: counts.imported,
    unchanged: counts.unchanged,
    skipped_cig: counts.skipped_cig,
    skipped_same: counts.skipped_same,
    rejected_qa: counts.rejected_qa,
    missing: counts.missing,
    conflicts: counts.conflicts,
    build_id: buildId,
    updated_at: at,
  };
  const up = await sb.from('translation_sources')
    .update({ coverage, last_synced_at: at, last_seen_commit: marker ?? resolved.token ?? src.last_seen_commit })
    .eq('id', src.id);
  if (up.error) fail(up.error);

  if (result.conflicts.length) await learningHooks.arbitrate(deps, src.lang, result.conflicts);
  await learningHooks.runLearning(deps, src.lang, trigger);
  await republishOverlay(deps, sb, src.lang, buildId, en, cig);

  return {
    source_id: src.id,
    lang: src.lang,
    imported: counts.imported,
    skipped_cig: counts.skipped_cig,
    skipped_same: counts.skipped_same,
    rejected_qa: counts.rejected_qa,
    conflicts: counts.conflicts,
    coverage,
  };
}

/** A5: compare the upstream marker with `last_seen_commit`; re-import what changed. */
export async function syncSources(
  deps: Deps,
  sb: Client,
  opts: { fetchFn?: FetchFn; ghToken?: string } = {},
): Promise<SyncResult> {
  const out: SyncResult = { checked: 0, changed: 0, errors: [] };
  for (const src of (await listSources(sb)).filter(isUsable)) {
    out.checked++;
    try {
      const marker = await upstreamToken(src, opts.fetchFn, opts.ghToken);
      // No marker to compare (no ETag at all): do not re-download daily, only when never imported.
      if (marker !== null ? marker === src.last_seen_commit : src.last_synced_at !== null) continue;
      await importSeed(deps, sb, src.id, { ...opts, trigger: 'sync' });
      out.changed++;
    } catch (e) {
      const error = String((e as Error)?.message ?? e);
      deps.log('sync_sources: source failed', { source_id: src.id, error });
      out.errors.push({ source_id: src.id, error });
    }
  }
  return out;
}

/** E3: deterministic draft; an existing unsent draft of the same kind is refreshed, not duplicated. */
export async function draftOutreach(sb: Client, sourceId: string): Promise<Record<string, unknown>> {
  const src = await loadSource(sb, sourceId);
  const d = buildOutreachDraft(src as unknown as Parameters<typeof buildOutreachDraft>[0]);
  const have = await sb.from('translation_outreach').select('id').eq('source_id', sourceId).eq('kind', d.kind).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (have.error) fail(have.error);
  const fields = { kind: d.kind, message_lang: d.message_lang, subject: d.subject, body: d.body };
  const res = have.data
    ? await sb.from('translation_outreach').update(fields).eq('id', (have.data as { id: string }).id).select('*').single()
    : await sb.from('translation_outreach').insert({ source_id: sourceId, ...fields, status: 'draft' }).select('*').single();
  if (res.error) fail(res.error);
  return res.data as Record<string, unknown>;
}
