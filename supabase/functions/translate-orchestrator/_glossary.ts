// Glossary derivation: CIG label pairs and frequent proper-noun n-grams.
// Precedence on conflict: admin > cig > ai; a locked row is never touched.

import { isCigValid } from './_diff.ts';
import { tokensOf } from './_mask.ts';
import type { GlossaryRow } from './_prompt.ts';

const LABEL_KEY_RE = /^(item_Name|vehicle_Name|ui_|hud_|mobiGlas)/i;
const MAX_LABELS = 1500;
const MAX_AI_TERMS = 300;

/** Short CIG label pairs (UI field labels, names) as `label` rows, origin cig. */
export function deriveCigLabels(en: Record<string, string>, cig: Record<string, string>): GlossaryRow[] {
  const votes = new Map<string, Map<string, number>>();
  const rank = new Map<string, number>();
  const orig = new Map<string, string>();
  for (const key of Object.keys(en).sort()) {
    if (!LABEL_KEY_RE.test(key)) continue;
    const e = en[key];
    const t = cig[key];
    if (!e || e.length > 40 || !isCigValid(e, t) || /[\r\n]/.test(t) || tokensOf(e).length || tokensOf(t).length) continue;
    const src = e.trim();
    const m = votes.get(src.toLowerCase()) ?? new Map<string, number>();
    m.set(t.trim(), (m.get(t.trim()) ?? 0) + 1);
    votes.set(src.toLowerCase(), m);
    if (!orig.has(src.toLowerCase())) orig.set(src.toLowerCase(), src);
    if (!rank.has(src.toLowerCase())) rank.set(src.toLowerCase(), /^(ui_|hud_|mobiGlas)/i.test(key) ? 0 : 1);
  }
  const out: (GlossaryRow & { r: number })[] = [];
  for (const [lower, m] of votes) {
    const best = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    out.push({ source_term: orig.get(lower) ?? lower, target_term: best, category: 'label', origin: 'cig', r: rank.get(lower) ?? 1 });
  }
  out.sort((a, b) => a.r - b.r || a.source_term.length - b.source_term.length || (a.source_term < b.source_term ? -1 : 1));
  return out.slice(0, MAX_LABELS).map(({ r: _r, ...row }) => row);
}

const NGRAM_RE = /(?<=[a-z,;:] )[A-Z][\p{L}\p{N}'-]+(?: [A-Z][\p{L}\p{N}'-]+){0,2}/gu;

/**
 * Proper-noun-ish n-grams (≥ 5 occurrences mid-sentence) that the model kept
 * verbatim in ≥ 90 % of its translations become `dnt` rows, origin ai.
 */
export function deriveAiTerms(pairs: { en: string; t: string }[], minCount = 5): GlossaryRow[] {
  const seen = new Map<string, { n: number; kept: number }>();
  for (const p of pairs) {
    const found = new Set(p.en.match(NGRAM_RE) ?? []);
    for (const term of found) {
      const s = seen.get(term) ?? { n: 0, kept: 0 };
      s.n++;
      if (p.t.includes(term)) s.kept++;
      seen.set(term, s);
    }
  }
  const rows: GlossaryRow[] = [];
  for (const [term, s] of seen) {
    if (s.n >= minCount && s.kept / s.n >= 0.9) {
      rows.push({ source_term: term, target_term: term, category: 'dnt', origin: 'ai' });
    }
  }
  rows.sort((a, b) => b.source_term.length - a.source_term.length || (a.source_term < b.source_term ? -1 : 1));
  return rows.slice(0, MAX_AI_TERMS);
}

/** Effective glossary: DB rows win over derived rows with the same (lower-cased) source term. */
export function mergeGlossary(db: GlossaryRow[], derived: GlossaryRow[]): GlossaryRow[] {
  const have = new Set(db.map((g) => g.source_term.toLowerCase()));
  return [...db, ...derived.filter((g) => !have.has(g.source_term.toLowerCase()))];
}

/** Derived rows the DB does not hold yet (never an update — admin/locked rows stay as they are). */
export function newRows(db: GlossaryRow[], derived: GlossaryRow[]): GlossaryRow[] {
  const have = new Set(db.map((g) => g.source_term.toLowerCase()));
  const out: GlossaryRow[] = [];
  for (const g of derived) {
    const k = g.source_term.toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    out.push(g);
  }
  return out;
}
