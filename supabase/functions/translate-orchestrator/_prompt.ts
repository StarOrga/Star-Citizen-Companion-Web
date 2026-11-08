// Prompt builders: system prompt (style guide + glossary), user messages, request params, judge.
// Baseline proved in the 2026-10-29 pilot (128/128 placeholders kept, German).

import { groupByFamily } from './_chunk.ts';
import type { Chunk, ChunkItem } from './_chunk.ts';
import { reasonHint } from './_qa.ts';
import type { QaGlossaryRow } from './_qa.ts';
import { styleBlock } from './_style.ts';
import type { LearnedStyle } from './_style.ts';

export interface GlossaryRow extends QaGlossaryRow {
  id?: string;
  lang?: string;
  needs_retranslate?: boolean;
}

export const LANG_NAMES: Record<string, string> = { de: 'German', fr: 'French', es: 'Spanish' };

/** Per-language style block. fr/es mirror CIG usage but are TO BE VERIFIED against CIG's tables before approving them. */
export const STYLE: Record<string, string> = {
  de: `- Address the player informally ("du"), consistently.
- Keep proper names in English: manufacturers, ships, vehicles, weapon brand names, star systems, planets, moons, stations, corporations, factions, people.
- German number formatting: decimal comma, space as thousands separator, a space before % and units ("40 %", "26 800 REM").
- Sci-fi, terse, natural German; mission briefings keep the in-world voice of the sender (corporate, criminal, military).`,
  fr: `- Address the player informally ("tu") as CIG's French localization does (TO BE VERIFIED against CIG's table).
- Keep proper names in English: manufacturers, ships, vehicles, weapon brand names, star systems, planets, moons, stations, corporations, factions, people.
- French number formatting: decimal comma, narrow space as thousands separator, a space before % and units.
- Sci-fi, terse, natural French; mission briefings keep the in-world voice of the sender.`,
  es: `- Address the player informally ("tú") as CIG's Spanish localization does (TO BE VERIFIED against CIG's table).
- Keep proper names in English: manufacturers, ships, vehicles, weapon brand names, star systems, planets, moons, stations, corporations, factions, people.
- Spanish number formatting: decimal comma, space as thousands separator, a space before % and units.
- Sci-fi, terse, natural Spanish; mission briefings keep the in-world voice of the sender.`,
};

const STYLE_DEFAULT = `- Address the player the way CIG's own localization of this language does; stay consistent.
- Keep proper names in English: manufacturers, ships, vehicles, weapon brand names, star systems, planets, moons, stations, corporations, factions, people.
- Use the number formatting of the target language (decimal separator, thousands separator, space before % and units).
- Sci-fi, terse, natural phrasing; mission briefings keep the in-world voice of the sender.`;

const SOURCE_RANK: Record<string, number> = { admin: 0, cig: 1, mined: 2, community: 3, ai: 4 };
const GLOSSARY_CHAR_CAP = 40_000;

/** Glossary lines for the prompt: admin/locked first, then cig, then ai; shorter terms first; capped. */
export function glossaryBlock(rows: GlossaryRow[], capChars = GLOSSARY_CHAR_CAP): string {
  const sorted = [...rows].sort((a, b) =>
    (a.locked ? 0 : 1) - (b.locked ? 0 : 1) ||
    (SOURCE_RANK[a.origin] ?? 3) - (SOURCE_RANK[b.origin] ?? 3) ||
    a.source_term.length - b.source_term.length ||
    (a.source_term < b.source_term ? -1 : 1)
  );
  const lines: string[] = [];
  let used = 0;
  for (const g of sorted) {
    const tag = g.category === 'dnt' ? ' [keep as is]' : g.category === 'label' ? ' [label]' : '';
    const line = `${g.source_term} => ${g.target_term}${tag}`;
    if (used + line.length + 1 > capChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/** Learned extras for the system prompt (C3 style record, admin card notes). */
export interface SystemExtras {
  style?: LearnedStyle | null;
  /** General admin hints and per-term hints from answered cards. */
  notes?: { general?: string[]; byTerm?: Record<string, string> } | null;
}

function extrasBlock(glossary: GlossaryRow[], extras?: SystemExtras): string {
  const parts: string[] = [];
  const learned = styleBlock(extras?.style);
  if (learned) parts.push(learned);
  const general = (extras?.notes?.general ?? []).filter(Boolean).slice(-30);
  const have = new Set(glossary.map((g) => g.source_term.toLowerCase()));
  const byTerm = Object.entries(extras?.notes?.byTerm ?? {}).filter(([t]) => have.has(t.toLowerCase())).slice(0, 200);
  if (general.length || byTerm.length) {
    const lines = [...general.map((n) => `- ${n}`), ...byTerm.map(([t, n]) => `- "${t}": ${n}`)];
    parts.push(`Reviewer notes (an admin answered these; they override the general rules):\n${lines.join('\n')}`);
  }
  return parts.length ? `\n${parts.join('\n')}` : '';
}

/**
 * The static STYLE block stays the fallback; a learned style record (C3) is appended and wins
 * where it is clear, admin notes from answered cards after it.
 */
export function buildSystem(lang: string, glossary: GlossaryRow[], extras?: SystemExtras): string {
  const name = LANG_NAMES[lang] ?? lang;
  return `You are a senior game localizer translating Star Citizen (CIG) UI and lore strings from English into ${name}.
House style, taken from CIG's official ${name} localization:
${STYLE[lang] ?? STYLE_DEFAULT}${extrasBlock(glossary, extras)}
- Field labels (e.g. "Item Type:", "HEI", weapon classes) must follow CIG's own wording from the glossary and the reference pairs, even where a more literal translation exists.
- Tokens like ⟦1⟧ are placeholders. Copy every token exactly once, unchanged; move them only where the target word order requires it. Never add line breaks.
- Use the glossary below whenever a term occurs. Entries marked [keep as is] stay untranslated. Do not translate text inside tokens.
- The input is JSON: {"g":[{"p":"<shared key prefix>","s":[["<key suffix>","<english>"],...]}]}. The key tells the context (pu_/mission = mission text, item_Desc = item description, dlg = spoken dialogue).
- Return only JSON {"t":[...]}: one translated string per input string, flat, in input order, same length as the input.

GLOSSARY (English => ${name}; CIG's official terms first):
${glossaryBlock(glossary)}`;
}

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { t: { type: 'array', items: { type: 'string' } } },
  required: ['t'],
  additionalProperties: false,
} as const;

export interface CigPair {
  key: string;
  en: string;
  t: string;
  /** Origin of the pair (C4: the whole TM, admin > cig > community > ai); absent = cig. */
  o?: 'admin' | 'cig' | 'community' | 'ai';
}

/** Few-shot origin rank: lower is better. */
export const FEWSHOT_RANK: Record<string, number> = { admin: 0, cig: 1, community: 2, ai: 3 };
const rankOf = (p: CigPair) => FEWSHOT_RANK[p.o ?? 'cig'] ?? 3;

export interface FewShotIndex {
  byHead: Map<string, CigPair[]>;
  all: CigPair[];
}

const MAX_POOL = 2500;

/**
 * C4: the reference pool is the whole TM, not only CIG pairs — retrieval of similar
 * translated segments as few-shot examples (TM fuzzy-match few-shot, Moslem et al. 2023).
 * One pair per English text, the best origin wins (admin > cig > community > ai).
 */
export function buildFewShotIndex(input: CigPair[]): FewShotIndex {
  const best = new Map<string, CigPair>();
  for (const p of input) {
    const cur = best.get(p.en);
    if (!cur || rankOf(p) < rankOf(cur)) best.set(p.en, p);
  }
  const pairs = input.length === best.size ? input : input.filter((p) => best.get(p.en) === p);
  const byHead = new Map<string, CigPair[]>();
  for (const p of pairs) {
    if (p.en.length > 300) continue;
    const head = p.key.split('_', 1)[0].toLowerCase();
    let list = byHead.get(head);
    if (!list) byHead.set(head, (list = []));
    list.push(p);
  }
  return { byHead, all: pairs };
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function sharedSegments(a: string, b: string): number {
  const x = a.split('_');
  const y = b.split('_');
  let n = 0;
  while (n < x.length && n < y.length && x[n].toLowerCase() === y[n].toLowerCase()) n++;
  return n;
}

/** The `n` most similar pairs for a request: shared key prefix first, shared words second, origin rank third. */
export function pickSimilar(index: FewShotIndex, items: ChunkItem[], n = 8): CigPair[] {
  if (!items.length) return [];
  const head = items[0].key.split('_', 1)[0].toLowerCase();
  let pool = index.byHead.get(head) ?? [];
  if (pool.length < n) pool = index.all;
  if (pool.length > MAX_POOL) {
    const step = Math.ceil(pool.length / MAX_POOL);
    pool = pool.filter((_, i) => i % step === 0);
  }
  const probe = words(items.slice(0, 12).map((i) => i.m).join(' '));
  const probeKey = items[0].key;
  const scored = pool.map((p) => {
    let w = 0;
    for (const x of words(p.en)) if (probe.has(x)) w++;
    return { p, score: sharedSegments(probeKey, p.key) * 4 + Math.min(w, 8) };
  });
  scored.sort((a, b) => b.score - a.score || rankOf(a.p) - rankOf(b.p) || (a.p.key < b.p.key ? -1 : 1));
  return scored.slice(0, n).map((s) => s.p);
}

export function userMessage(chunk: Pick<Chunk, 'items'>, fewShot: CigPair[] = [], keyNotes: Record<string, string> = {}): string {
  const g = groupByFamily(chunk.items).map((grp) => ({
    p: grp.p,
    s: grp.s.map((it) => [it.key.slice(grp.p.length), it.m]),
  }));
  const ref = fewShot.length
    ? `Reference pairs (admin-reviewed and official CIG translations of similar strings first; follow their wording):\n${
      fewShot.map((p) => JSON.stringify([p.en, p.t])).join('\n')
    }\n\n`
    : '';
  const notes = chunk.items.filter((it) => keyNotes[it.key]).slice(0, 40).map((it) => `- ${it.key}: ${keyNotes[it.key]}`);
  const hint = notes.length ? `Reviewer notes for some of these keys (an admin wrote them; follow them):\n${notes.join('\n')}\n\n` : '';
  return `${ref}${hint}Translate these ${chunk.items.length} strings.\n${JSON.stringify({ g })}`;
}

/** Post-edit: each string comes with the failed attempt and why it failed. */
export function postEditMessage(chunk: Pick<Chunk, 'items'>): string {
  const g = groupByFamily(chunk.items).map((grp) => ({
    p: grp.p,
    s: grp.s.map((it) => [
      it.key.slice(grp.p.length),
      it.m,
      it.prev ?? '',
      (it.reason ?? []).map(reasonHint).join('; '),
    ]),
  }));
  return `Re-translate these ${chunk.items.length} strings. Each entry is [key suffix, english, previous attempt (may be empty), what was wrong with it]. Fix exactly the stated problems; return one string per entry.\n${
    JSON.stringify({ g })
  }`;
}

export interface BatchParams {
  model: string;
  max_tokens: number;
  system: unknown;
  messages: { role: 'user'; content: string }[];
  output_config?: { effort?: 'low' | 'medium'; format?: { type: 'json_schema'; schema: unknown } };
  thinking?: { type: 'between_tools' };
  /** Server tools (web research only). */
  tools?: unknown[];
}

/**
 * Request shape per model (contract § Models). No temperature / top_p. The system
 * prompt carries a 1 h ephemeral cache marker.
 */
export function requestParams(model: string, maxTokens: number, system: string, user: string): BatchParams {
  const opus = model.includes('opus');
  const p: BatchParams = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { effort: opus ? 'medium' : 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  };
  if (!opus) p.thinking = { type: 'between_tools' };
  return p;
}

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    r: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          score: { type: 'integer' },
          back: { type: 'string' },
          // C5: term corrections (MQM terminology errors, Lommel et al. 2014; Freitag et al. 2021):
          // a short English term the translation got wrong and its correct target term.
          terms: {
            type: 'array',
            items: {
              type: 'object',
              properties: { source: { type: 'string' }, target: { type: 'string' } },
              required: ['source', 'target'],
              additionalProperties: false,
            },
          },
        },
        required: ['score', 'back', 'terms'],
        additionalProperties: false,
      },
    },
  },
  required: ['r'],
  additionalProperties: false,
} as const;

export function judgeParams(
  lang: string,
  judgeModel: string,
  samples: { key: string; en: string; t: string }[],
): BatchParams {
  const name = LANG_NAMES[lang] ?? lang;
  const system =
    `You are an expert ${name} game-localization reviewer (native speaker, Star Citizen player). For each item: translate the ${name} text back to English ("back"), compare it with the English source, and score the translation 1-10 for accuracy, natural fluency and Star Citizen house style (informal address, English proper names, local number formatting). If the translation uses a wrong term for a short English game term (at most 4 words: an item class, a UI label, a game mechanic), list it in "terms" as {"source":"<English term as in the source>","target":"<correct ${name} term>"}; proper names stay in English; [] when every term is right. Return {"r":[{"score":<1-10>,"back":"<back-translation>","terms":[...]}]}, one entry per item in input order.`;
  const user = JSON.stringify(samples.map((s) => ({ key: s.key, en: s.en, t: s.t })));
  return {
    model: judgeModel,
    max_tokens: Math.min(64_000, 1024 + samples.length * 400),
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
  };
}
