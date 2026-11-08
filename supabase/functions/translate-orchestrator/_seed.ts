// Community-seed filter (pure): which pack lines become TM entries (concept 2026-11-08, A4).
// Precedence: admin > CIG (blind) > community vs AI (the arbiter decides conflicts, never this file).

import { isCigValid, sha256Hex } from './_diff.ts';
import type { TmEntry } from './_diff.ts';
import { sameMultiset, tokensOf } from './_mask.ts';
import { normalizeKey } from './_pack.ts';

export interface SeedConflict {
  key: string;
  h: string;
  en: string;
  incumbent: TmEntry;
  challenger: TmEntry;
}

export interface SeedCounts {
  /** English keys looked at (non-blank). */
  keys: number;
  /** Keys CIG translates validly: the pack is irrelevant there. */
  skipped_cig: number;
  /** Pack value blank, identical to English or a `NOT FOUND` marker. */
  skipped_same: number;
  /** Key absent from the pack. */
  missing: number;
  /** Placeholder multiset differs from English. */
  rejected_qa: number;
  /** Distinct English texts that got / refreshed a TM entry. */
  imported: number;
  /** Distinct English texts whose TM entry already holds exactly this text. */
  unchanged: number;
  /** Distinct English texts that go to the arbiter. */
  conflicts: number;
  /** Distinct English texts protected by an admin entry. */
  admin_kept: number;
  /** Distinct English texts where CIG's own (TM) translation stays. */
  cig_kept: number;
}

export interface SeedResult {
  updates: Record<string, TmEntry>;
  conflicts: SeedConflict[];
  counts: SeedCounts;
}

export interface SeedInput {
  en: Record<string, string>;
  cig: Record<string, string>;
  pack: Map<string, string> | Record<string, string>;
  sourceId: string;
  lic: string;
  at: string;
  /** Existing translation memory of the language (hash → entry). */
  tm?: Record<string, TmEntry>;
  hash?: (s: string) => Promise<string>;
}

/** Pack lines that are not a translation: blank, the English itself, `! … NOT FOUND` markers. */
export function isPackNoise(en: string, v: string): boolean {
  if (!v.trim() || v === en) return true;
  if (v.startsWith('! ') || /TRANSLATION NOT FOUND/i.test(v)) return true;
  return false;
}

/** Placeholder multiset of the pack value must equal the English one (QA gate, `_mask.ts`). */
export function placeholdersMatch(en: string, v: string): boolean {
  return sameMultiset(tokensOf(en), tokensOf(v)) && !/[\r\n]/.test(v);
}

export async function seedEntries(input: SeedInput): Promise<SeedResult> {
  const hash = input.hash ?? sha256Hex;
  const tm = input.tm ?? {};
  const get = input.pack instanceof Map
    ? (k: string) => (input.pack as Map<string, string>).get(k)
    : (k: string) => (input.pack as Record<string, string>)[k];
  const counts: SeedCounts = {
    keys: 0, skipped_cig: 0, skipped_same: 0, missing: 0, rejected_qa: 0,
    imported: 0, unchanged: 0, conflicts: 0, admin_kept: 0, cig_kept: 0,
  };
  // h → { en, key (first, sorted), votes: value → count } — one TM slot per English text.
  const cand = new Map<string, { en: string; key: string; votes: Map<string, number> }>();
  const cache = new Map<string, string>();

  for (const key of Object.keys(input.en).sort()) {
    const en = input.en[key];
    if (!en || !en.trim()) continue;
    counts.keys++;
    if (isCigValid(en, input.cig[key])) {
      counts.skipped_cig++;
      continue;
    }
    const v = get(normalizeKey(key));
    if (v === undefined) {
      counts.missing++;
      continue;
    }
    if (isPackNoise(en, v)) {
      counts.skipped_same++;
      continue;
    }
    if (!placeholdersMatch(en, v)) {
      counts.rejected_qa++;
      continue;
    }
    let h = cache.get(en);
    if (!h) cache.set(en, (h = await hash(en)));
    const c = cand.get(h);
    if (c) c.votes.set(v, (c.votes.get(v) ?? 0) + 1);
    else cand.set(h, { en, key, votes: new Map([[v, 1]]) });
  }

  const updates: Record<string, TmEntry> = {};
  const conflicts: SeedConflict[] = [];
  for (const [h, c] of cand) {
    // Most frequent translation among the keys sharing this English; ties keep the first seen.
    let t = '';
    let best = 0;
    for (const [v, n] of c.votes) {
      if (n > best) {
        best = n;
        t = v;
      }
    }
    const challenger: TmEntry = { t, o: 'community', src: input.sourceId, lic: input.lic, at: input.at };
    const inc = tm[h];
    if (!inc) {
      updates[h] = challenger;
      counts.imported++;
    } else if (inc.o === 'admin') counts.admin_kept++;
    else if (inc.o === 'cig') counts.cig_kept++;
    else if (inc.t === t) counts.unchanged++;
    else if (inc.o === 'community' && inc.src === input.sourceId) {
      // The same source changed its own text: a refresh, not a dispute.
      updates[h] = challenger;
      counts.imported++;
    } else {
      conflicts.push({ key: c.key, h, en: c.en, incumbent: inc, challenger });
      counts.conflicts++;
    }
  }
  return { updates, conflicts, counts };
}

/** Share (0..100, one decimal) of the non-blank English keys the pack really translates. */
export function packTextPct(translated: number, keys: number): number {
  return keys ? Math.round((translated / keys) * 1000) / 10 : 0;
}
