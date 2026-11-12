// Pure parts of exemplar-ai: input validation, prompts, reply parsing, hard length limits.
// An exemplar is one own hangar config (hangar_ship_configs). Its NAME (<= 32) is a short handle for the build that
// differs from Werk; its SUMMARY (<= 90) says what the loadout is about. Neither is ever labelled as AI.

export const NAME_MAX = 32;
export const SUMMARY_MAX = 90;
export const MAX_CHANGES = 24;

export type ExemplarKind = 'exemplar_name' | 'exemplar_summary';
export type Locale = 'de' | 'en';

/** One changed slot: the factory part and the part the player fitted instead. */
export interface PartChange { slot: string; from: string; to: string }
export interface ExemplarRequest {
  kind: ExemplarKind;
  locale: Locale;
  ship: string;
  changes: PartChange[];
}

// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;
export const stripInvisible = (v: unknown): string => String(v ?? '').replace(INVISIBLE, '');

/** A standalone "AI" / "KI" (also "A.I."): a name or summary never calls itself machine made. */
const AI_WORD = /(^|[^\p{L}\p{N}])(ai|ki|a\.i\.|k\.i\.)(?=$|[^\p{L}\p{N}])/iu;
export const mentionsAi = (v: string): boolean => AI_WORD.test(v);

const text = (v: unknown, max: number): string => stripInvisible(v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Request body -> a clean request, or null when it is unusable (also: nothing differs from Werk). */
export function parseRequest(body: unknown): ExemplarRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'exemplar_name' || b.kind === 'exemplar_summary' ? b.kind : null;
  const ship = text(b.ship, 80);
  if (!kind || !ship || !Array.isArray(b.changes)) return null;
  const changes: PartChange[] = [];
  for (const raw of b.changes.slice(0, MAX_CHANGES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const to = text(r.to, 80);
    if (!to) continue;
    changes.push({ slot: text(r.slot, 60), from: text(r.from, 80), to });
  }
  if (!changes.length) return null;
  return { kind, locale: b.locale === 'en' ? 'en' : 'de', ship, changes };
}

export const limitOf = (kind: ExemplarKind): number => (kind === 'exemplar_name' ? NAME_MAX : SUMMARY_MAX);

/** One line: collapsed whitespace, no surrounding quotes / trailing dots (name only), cut at a word to the limit. */
export function clampText(v: unknown, max: number, stripDot: boolean): string {
  let t = stripInvisible(v).replace(/\s+/g, ' ').replace(/^["'„“”]+|["'“”]+$/g, '').trim();
  if (stripDot) t = t.replace(/\.+$/, '');
  const cps = Array.from(t);
  if (cps.length <= max) return t;
  const cut = cps.slice(0, max).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, '');
}

/** The model's JSON reply -> the one string (key `name` or `summary`), or null when unusable. */
export function parseReply(replyText: string, kind: ExemplarKind): string | null {
  const m = /\{[\s\S]*\}/.exec(replyText ?? '');
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as Record<string, unknown>;
    const out = clampText(kind === 'exemplar_name' ? v.name : v.summary, limitOf(kind), kind === 'exemplar_name');
    return out && !mentionsAi(out) ? out : null;
  } catch {
    return null;
  }
}

export function buildPrompt(req: ExemplarRequest): string {
  const de = req.locale !== 'en';
  const lang = de ? 'German' : 'English';
  const max = limitOf(req.kind);
  const list = req.changes
    .map((c) => `- ${c.slot ? `${c.slot}: ` : ''}${c.from ? `${c.from} -> ` : ''}${c.to}`)
    .join('\n');
  const rules =
    req.kind === 'exemplar_name'
      ? [
          `Name one player-built exemplar of the Star Citizen ship "${req.ship}" in a companion app, from the parts the player swapped against the factory loadout below.`,
          'A short, memorable handle a player would give their own ship, based on the build character (role, weapon type, focus), not a list of parts.',
          de
            ? 'German or the usual English gaming term, correct umlauts. Good: "Laser-Jäger", "Kühlkünstler", "Distortion-Falke".'
            : 'Good: "Laser Hunter", "Cool Runner", "Distortion Hawk".',
          `Do not repeat the ship name "${req.ship}" in full, no version numbers.`,
          `At most ${max} characters, in ${lang}, no quotes, no trailing period, no mention of AI.`,
          'Reply with JSON only: {"name":"..."}.',
        ]
      : [
          `Summarise in one line what this exemplar of the Star Citizen ship "${req.ship}" is about, from the parts the player swapped against the factory loadout below.`,
          de
            ? 'German, telegraphic noun phrase, e.g. "Laser-Jäger mit Distortion-Sekundär, mehr Kühlung". No full sentence, no ship name.'
            : 'English, telegraphic noun phrase, e.g. "Laser fighter with distortion secondary, extra cooling". No full sentence, no ship name.',
          'Name the character of the build (role/weapon type/focus), only what the swaps below support; never invent parts or numbers.',
          `At most ${max} characters, in ${lang}, no quotes, no mention of AI.`,
          'Reply with JSON only: {"summary":"..."}.',
        ];
  return [...rules, '', list].join('\n');
}

/** CORS for the browser invoke (functions.invoke sends authorization, x-client-info, apikey, content-type). */
export const CORS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function preflight(method: string): Response | null {
  return method === 'OPTIONS' ? new Response(null, { headers: { ...CORS } }) : null;
}
