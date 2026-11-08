// Pure parts of nachschub-names: input validation, prompt, reply parsing, hard length limits.
// A Nachschub name says what you GET (<= 28), an Einsatz name what you DO (<= 40). Names are never labelled as AI.

export const NACHSCHUB_MAX = 28;
export const EINSATZ_MAX = 40;
export const MAX_ITEMS = 30;

export type NameKind = 'nachschub' | 'einsatz';
export type Locale = 'de' | 'en';

export interface NameItem { name: string; qty: number }
export interface NameRequest { kind: NameKind; locale: Locale; items: NameItem[] }

/**
 * Control characters, soft hyphen, zero-width and bidi marks/overrides/isolates: invisible in a name, usable to spoof one
 * (a right-to-left override flips the text after it) or to smuggle text past a reader. Whitespace controls (tab, newline)
 * are not in the set - they collapse to one space.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;
export const stripInvisible = (v: unknown): string => String(v ?? '').replace(INVISIBLE, '');

/** A standalone "AI" / "KI" (also "A.I."): a name is never labelled as machine made. */
const AI_WORD = /(^|[^\p{L}\p{N}])(ai|ki|a\.i\.|k\.i\.)(?=$|[^\p{L}\p{N}])/iu;
export const mentionsAi = (v: string): boolean => AI_WORD.test(v);

const text = (v: unknown, max: number): string => stripInvisible(v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Request body -> a clean request, or null when it is unusable. Every field is capped; nothing is trusted. */
export function parseRequest(body: unknown): NameRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'nachschub' || b.kind === 'einsatz' ? b.kind : null;
  if (!kind || !Array.isArray(b.items)) return null;
  const items: NameItem[] = [];
  for (const raw of b.items.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = text(r.name, 80);
    const qty = Number(r.qty);
    if (!name) continue;
    items.push({ name, qty: Number.isFinite(qty) ? Math.min(999, Math.max(1, Math.round(qty))) : 1 });
  }
  if (!items.length) return null;
  return { kind, locale: b.locale === 'en' ? 'en' : 'de', items };
}

export function limitOf(kind: NameKind): number {
  return kind === 'nachschub' ? NACHSCHUB_MAX : EINSATZ_MAX;
}

/** One name: collapsed whitespace, no quotes / trailing dots, cut at a word to the limit. */
export function clampName(v: unknown, max: number): string {
  const t = stripInvisible(v).replace(/\s+/g, ' ').replace(/^["'„“]+|["'“”.]+$/g, '').trim();
  const cps = Array.from(t);
  if (cps.length <= max) return t;
  const cut = cps.slice(0, max).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, '');
}

export function parseName(replyText: string, max: number): string | null {
  const m = /\{[\s\S]*\}/.exec(replyText ?? '');
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { name?: unknown };
    const name = clampName(v.name, max);
    // A name that calls itself AI/KI is dropped: the client then uses its rule-based fallback name.
    return name && !mentionsAi(name) ? name : null;
  } catch {
    return null;
  }
}

export function buildPrompt(req: NameRequest): string {
  const max = limitOf(req.kind);
  const lang = req.locale === 'en' ? 'English' : 'German';
  const list = req.items.map((i) => `- ${i.qty}x ${i.name}`).join('\n');
  const what =
    req.kind === 'nachschub'
      ? 'a supply bundle in a Star Citizen companion app. Name it by WHAT THE PLAYER GETS, summarised short (e.g. "Rattler-Vorrat" or "Pembroke-Ruestung").'
      : 'a mission/activity plan in a Star Citizen companion app. Name it by WHAT THE PLAYER HAS TO DO (e.g. "Titan-Erz abbauen und raffinieren").';
  return [
    `Give a name for ${what}`,
    `At most ${max} characters, in ${lang}, no quotes, no trailing period, no mention of AI or of the word package.`,
    'Reply with JSON only: {"name":"..."}.',
    '',
    list,
  ].join('\n');
}

/** CORS for the browser invoke (functions.invoke sends authorization, x-client-info, apikey, content-type). */
export const CORS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** The preflight answer, or null when the request is not a preflight. */
export function preflight(method: string): Response | null {
  return method === 'OPTIONS' ? new Response(null, { headers: { ...CORS } }) : null;
}
