// Override alerts (concept 2026-11-08, B4): when CIG changes the English original or its own
// translation of a key that carries an admin correction, the admin gets an alert with the diff.
// detectOverrideAlerts is pure; writeAlerts uses the service-role client.

import { sha256Hex } from './_diff.ts';
import type { TmEntry } from './_diff.ts';
import { containsTerm } from './_qa.ts';

export interface AdminTerm {
  source_term: string;
  target_term: string;
  origin: string;
  locked?: boolean;
}

export interface AlertRow {
  key: string;
  en_old: string | null;
  en_new: string | null;
  cig_old: string | null;
  cig_new: string | null;
  /** The admin text the change may have invalidated (TM text, or `term → target` for a glossary hit). */
  admin_text: string;
}

export interface DetectInput {
  /** English / CIG tables of the base build (previous build of the channel) and the current one. */
  baseEn: Record<string, string>;
  en: Record<string, string>;
  baseCig: Record<string, string>;
  cig: Record<string, string>;
  tm: Record<string, TmEntry>;
  /** Glossary rows of the language; only admin-origin or locked rows count. */
  adminGlossary: AdminTerm[];
  hash?: (s: string) => Promise<string>;
}

const isAdminTerm = (g: AdminTerm) => (g.origin === 'admin' || g.locked === true) && !!g.source_term && !!g.target_term;

/**
 * Keys that existed in the base build, whose English or CIG value changed, and that carry an admin
 * correction: a TM `o:'admin'` entry for the OLD English hash, or an admin glossary term contained
 * in the old string. A key whose NEW English already has an admin TM entry is settled and skipped.
 */
export async function detectOverrideAlerts(input: DetectInput): Promise<AlertRow[]> {
  const hash = input.hash ?? sha256Hex;
  const terms = input.adminGlossary.filter(isAdminTerm);
  const rows: AlertRow[] = [];
  for (const key of Object.keys(input.en).sort()) {
    const enOld = input.baseEn[key];
    const enNew = input.en[key];
    if (enOld === undefined || !enOld.trim()) continue;
    const cigOld = input.baseCig[key];
    const cigNew = input.cig[key];
    const enChanged = enOld !== enNew;
    const cigChanged = cigOld !== cigNew;
    if (!enChanged && !cigChanged) continue;

    let adminText: string | null = null;
    const hit = input.tm[await hash(enOld)];
    if (hit?.o === 'admin') adminText = hit.t;
    else {
      const t = terms.find((g) => containsTerm(enOld, g.source_term));
      if (t) adminText = `${t.source_term} → ${t.target_term}`;
    }
    if (adminText === null) continue;
    if (enChanged && enNew && input.tm[await hash(enNew)]?.o === 'admin') continue;
    rows.push({
      key,
      en_old: enOld,
      en_new: enNew ?? null,
      cig_old: cigOld ?? null,
      cig_new: cigNew ?? null,
      admin_text: adminText,
    });
  }
  return rows;
}

// deno-lint-ignore no-explicit-any
type Client = any;

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

/**
 * Inserts alerts as `open`; an already open alert of the same key keeps its original
 * en_old/cig_old (the diff spans the whole period) and only learns the newest values.
 * (The unique index is partial, so PostgREST's on_conflict cannot be used.) Returns { inserted, updated }.
 */
export async function writeAlerts(
  sb: Client,
  lang: string,
  buildId: string | null,
  rows: AlertRow[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const open = await sb.from('translation_override_alerts').select('id,key')
      .eq('lang', lang).eq('status', 'open').in('key', part.map((r) => r.key));
    if (open.error) fail(open.error);
    const byKey = new Map<string, string>(((open.data ?? []) as { id: string; key: string }[]).map((r) => [r.key, r.id]));
    const fresh = part.filter((r) => !byKey.has(r.key)).map((r) => ({ lang, build_id: buildId, ...r }));
    if (fresh.length) {
      const ins = await sb.from('translation_override_alerts').insert(fresh);
      // 23505: a concurrent run opened the same alert first.
      if (ins.error && ins.error.code !== '23505') fail(ins.error);
      else if (!ins.error) inserted += fresh.length;
    }
    for (const r of part) {
      const id = byKey.get(r.key);
      if (!id) continue;
      const up = await sb.from('translation_override_alerts')
        .update({ build_id: buildId, en_new: r.en_new, cig_new: r.cig_new, admin_text: r.admin_text }).eq('id', id);
      if (up.error) fail(up.error);
      updated++;
    }
  }
  return { inserted, updated };
}
