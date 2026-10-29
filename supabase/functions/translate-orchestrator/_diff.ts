// Content diff: which (key, sha256(english)) pairs still need a translation.
// Trigger = content diff, never build novelty (contract § Ground rules).

export interface TmEntry {
  t: string;
  o: 'ai' | 'cig' | 'admin';
  m?: string;
  at?: string;
}

export interface UniqueText {
  /** sha256 hex of the English text. */
  h: string;
  en: string;
  /** All keys that carry this exact English text (sorted). */
  keys: string[];
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * CIG's value wins only when it is a real translation of the current English:
 * not missing, not blank, not identical to English, not a `! … NOT FOUND` marker.
 */
export function isCigValid(en: string, cig: string | undefined): boolean {
  if (cig === undefined) return false;
  if (!cig.trim() || cig === en) return false;
  if (cig.startsWith('! ')) return false;
  return true;
}

export interface DiffCounts {
  keys: number;
  cig: number;
  blank: number;
  tm: number;
  forced: number;
  todo: number;
}

export interface DiffResult {
  /** Not in the TM (or forced): to translate, one entry per distinct English text. */
  todo: UniqueText[];
  /** Overlay entries already known from the TM: key → { h, t }. */
  reused: Record<string, { h: string; t: string }>;
  counts: DiffCounts;
}

export interface DiffInput {
  en: Record<string, string>;
  cig: Record<string, string>;
  tm: Record<string, TmEntry>;
  /** Glossary terms flagged needs_retranslate: strings containing them skip the TM. */
  forceTerms?: string[];
  hash?: (s: string) => Promise<string>;
}

export async function diffStrings(input: DiffInput): Promise<DiffResult> {
  const hash = input.hash ?? sha256Hex;
  const force = (input.forceTerms ?? []).map((t) => t.toLowerCase()).filter(Boolean);
  const cache = new Map<string, string>();
  const todoMap = new Map<string, UniqueText>();
  const reused: Record<string, { h: string; t: string }> = {};
  const counts: DiffCounts = { keys: 0, cig: 0, blank: 0, tm: 0, forced: 0, todo: 0 };

  for (const key of Object.keys(input.en).sort()) {
    const en = input.en[key];
    counts.keys++;
    if (!en || !en.trim()) {
      counts.blank++;
      continue;
    }
    if (isCigValid(en, input.cig[key])) {
      counts.cig++;
      continue;
    }
    let h = cache.get(en);
    if (!h) cache.set(en, (h = await hash(en)));
    const hit = input.tm[h];
    const lower = force.length ? en.toLowerCase() : '';
    const forced = !!hit && force.some((t) => lower.includes(t));
    if (hit && !forced) {
      counts.tm++;
      reused[key] = { h, t: hit.t };
      continue;
    }
    if (forced) counts.forced++;
    const u = todoMap.get(h);
    if (u) u.keys.push(key);
    else todoMap.set(h, { h, en, keys: [key] });
  }
  const todo = [...todoMap.values()];
  counts.todo = todo.length;
  return { todo, reused, counts };
}
