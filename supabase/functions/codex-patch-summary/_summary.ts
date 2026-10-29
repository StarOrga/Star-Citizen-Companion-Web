// Pure parts of codex-patch-summary: prompt building, reply parsing, clamping.
// No Deno / network here so `node --test` can import it (see _summary.test.mjs).

export const MAX_LINES = 3;
export const MAX_LINE_CHARS = 140;

export interface PatchSummary {
  de: string[];
  en: string[];
}

/** Compact diff handed to the model; shape = codex_build_diff_digest() output. */
export interface DiffDigest {
  patch?: string;
  channel?: string;
  has_previous?: boolean;
  [table: string]: unknown;
}

export function buildPrompt(digest: DiffDigest): string {
  return [
    `You summarise a Star Citizen game-data patch (${digest.patch ?? 'unknown'}, ${digest.channel ?? 'LIVE'}) for a catalog landing page.`,
    'Input is a machine diff against the previous build: per table (ships, weapons, components, items) added/removed counts,',
    'a few added names, and numeric stat changes grouped by data path (items = how many entries changed, avg_pct = mean change).',
    '',
    'Rules:',
    `- Reply with ONLY a JSON object {"de": [..], "en": [..]}: at most ${MAX_LINES} lines per language, max ${MAX_LINE_CHARS} characters each, DE and EN saying the same.`,
    '- Each line is a TREND, e.g. "Light fighters lose ~8 % shield" or "12 new FPS weapons". Summarise; NEVER list items one by one.',
    '- Name a single item only if that one item changed a lot (large percentage or newly added flagship).',
    '- Use only facts present in the diff. No invention, no marketing tone, no emojis. If nothing notable changed, return fewer lines (possibly none).',
    '',
    'Diff:',
    JSON.stringify(digest),
  ].join('\n');
}

function cleanLine(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : s;
}

export function clampLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = cleanLine(x);
    if (s && !out.includes(s)) out.push(s);
    if (out.length === MAX_LINES) break;
  }
  return out;
}

/** Model reply text -> clamped summary, or null when unusable (both languages empty / not JSON). */
export function parseSummary(text: string): PatchSummary | null {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { de?: unknown; en?: unknown };
    const de = clampLines(v.de);
    const en = clampLines(v.en);
    if (de.length === 0 && en.length === 0) return null;
    // One language missing would leave the other UI blank: mirror it rather than store a hole.
    return { de: de.length ? de : en, en: en.length ? en : de };
  } catch {
    return null;
  }
}

/** True when the digest has nothing worth a model call (no previous build / no change at all). */
export function digestIsEmpty(digest: DiffDigest | null): boolean {
  if (!digest || digest.has_previous === false) return true;
  for (const t of ['ships', 'weapons', 'components', 'items']) {
    const e = digest[t] as { added?: number; removed?: number; stat_changes?: unknown[] } | undefined;
    if (e && ((e.added ?? 0) > 0 || (e.removed ?? 0) > 0 || (e.stat_changes?.length ?? 0) > 0)) return false;
  }
  return true;
}
