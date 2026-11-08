// D1 admin cards ("Karteikarten"): created ONLY as the last resort — arbiter disagreement or low
// confidence, learning conflicts the Haiku pre-decision could not settle. Clear cases never
// become cards. An answered card has no DB side effect of its own (w1-contract); the
// orchestrator applies it here: a|b → winner into the TM, own → TM admin entry,
// save_as_rule → glossary row origin admin, note → stored hint fed into the prompt.
// "Applied" is recorded as `context.applied_at` (the table has no column for it).

import type { TmEntry } from './_diff.ts';
import { saveTm } from './_io.ts';
import type { Store } from './_io.ts';
import type { CardRow, LearnDb } from './_learn_db.ts';

export type CardKind = CardRow['kind'];

/** Visibility of a key: UI/HUD 3 > item/vehicle 2 > mission/lore/dialogue 1 > everything else 0. */
export function reachOf(key: string): number {
  if (/^(ui_|hud_|mobiglas|interaction|pause_|frontend|menu|options|keybind|inventory|mfd)/i.test(key)) return 3;
  if (/^(item_|vehicle_|ship_|weapon_|commodity|shop_)/i.test(key)) return 2;
  if (/^(pu_|mission|dlg|dialog|lore|galactapedia|journal|news|contract)/i.test(key) || /desc/i.test(key)) return 1;
  return 0;
}

const KIND_RANK: Record<CardKind, number> = { meta: 0, wording: 1, style: 2 };

/** D2 queue order (spread, reach, kind, doubt, fresh); skipped cards last. Mirrors translation_cards_queue_idx. */
export function compareCards(
  a: Pick<CardRow, 'spread' | 'reach' | 'kind' | 'doubt' | 'fresh' | 'status'>,
  b: Pick<CardRow, 'spread' | 'reach' | 'kind' | 'doubt' | 'fresh' | 'status'>,
): number {
  return Number(a.status === 'skipped') - Number(b.status === 'skipped') ||
    b.spread - a.spread ||
    b.reach - a.reach ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.doubt - a.doubt ||
    Number(b.fresh) - Number(a.fresh);
}

export interface TmCardInput {
  lang: string;
  kind?: CardKind;
  key: string;
  keys: string[];
  h: string;
  en: string;
  a: TmEntry;
  b: TmEntry;
  /** 0..1: how unsure the arbiter was. */
  doubt: number;
  fresh: boolean;
  neighbours?: { key: string; en: string }[];
  why: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 1));
const srcOf = (e: TmEntry) => (e.o === 'community' && e.src ? `community:${e.src}` : e.o);

/** Card for one string whose two candidates the arbiter could not separate. */
export function tmCard(i: TmCardInput): CardRow {
  return {
    lang: i.lang,
    kind: i.kind ?? 'wording',
    question: `Which translation fits "${i.en.length > 120 ? `${i.en.slice(0, 117)}…` : i.en}" better?`,
    option_a: { text: i.a.t, source: srcOf(i.a) },
    option_b: { text: i.b.t, source: srcOf(i.b) },
    context: {
      type: 'tm', key: i.key, keys: i.keys.slice(0, 50), h: i.h, en: i.en, why: i.why,
      neighbours: (i.neighbours ?? []).slice(0, 4), where: whereOf(i.key),
      entries: { a: i.a, b: i.b },
    },
    spread: i.keys.length,
    reach: Math.max(...i.keys.map(reachOf), reachOf(i.key)),
    doubt: clamp01(i.doubt),
    fresh: i.fresh,
    dedupe_key: `tm:${i.h}`,
    impact: i.keys.length,
  };
}

export interface TermCardInput {
  lang: string;
  kind?: CardKind;
  source_term: string;
  a: { text: string; source: string; votes: number };
  b: { text: string; source: string; votes: number };
  /** Strings that contain the term. */
  spread: number;
  sampleKeys: string[];
  doubt: number;
  fresh: boolean;
  why: string;
}

/** Card for a glossary term with two competing targets (meta: one answer fixes every string). */
export function termCard(i: TermCardInput): CardRow {
  return {
    lang: i.lang,
    kind: i.kind ?? 'meta',
    question: `How should "${i.source_term}" be translated everywhere?`,
    option_a: { text: i.a.text, source: `${i.a.source} (${i.a.votes}×)` },
    option_b: { text: i.b.text, source: `${i.b.source} (${i.b.votes}×)` },
    context: {
      type: 'term', term: i.source_term, en: i.source_term, keys: i.sampleKeys.slice(0, 20), why: i.why,
      where: i.sampleKeys.length ? whereOf(i.sampleKeys[0]) : null,
    },
    spread: i.spread,
    reach: i.sampleKeys.length ? Math.max(...i.sampleKeys.map(reachOf)) : 0,
    doubt: clamp01(i.doubt),
    fresh: i.fresh,
    dedupe_key: `term:${i.source_term.toLowerCase()}`,
    impact: i.spread,
  };
}

function whereOf(key: string): string {
  const r = reachOf(key);
  return r === 3 ? 'ui' : r === 2 ? 'item' : r === 1 ? 'mission_lore' : 'other';
}

/** Inserts cards (best first, capped); returns how many were new. Duplicates of open cards are skipped. */
export async function createCards(learn: LearnDb, cards: CardRow[], cap = 40): Promise<number> {
  let n = 0;
  for (const c of [...cards].sort(compareCards).slice(0, cap)) if (await learn.insertCard(c)) n++;
  return n;
}

// ── notes: admin hints for the prompt ────────────────────────────────────────

export interface Notes {
  v: 1;
  byKey: Record<string, string>;
  byTerm: Record<string, string>;
  general: string[];
}

export const notesKey = (lang: string) => `translation-work/learn-${lang}/notes.json`;
/** Strings an admin decided on a card (h → text): the arbiter keeps them against later challengers. */
export const decidedKey = (lang: string) => `translation-work/learn-${lang}/decided.json`;

export async function loadNotes(store: Store, lang: string): Promise<Notes> {
  const n = (await store.getJson(notesKey(lang))) as Notes | null;
  return n && n.v === 1 ? n : { v: 1, byKey: {}, byTerm: {}, general: [] };
}

export interface ApplySummary {
  applied: number;
  tm: number;
  rules: number;
  notes: number;
}

/** Applies every answered, not yet applied card of a language. Idempotent: applied cards carry context.applied_at. */
export async function applyAnsweredCards(
  deps: { store: Store; now(): Date; learn?: LearnDb },
  lang: string,
): Promise<ApplySummary> {
  const sum: ApplySummary = { applied: 0, tm: 0, rules: 0, notes: 0 };
  const learn = deps.learn;
  if (!learn) return sum;
  const cards = await learn.listAnsweredUnapplied(lang, 200);
  if (!cards.length) return sum;
  const at = deps.now().toISOString();
  const notes = await loadNotes(deps.store, lang);
  const decided = ((await deps.store.getJson(decidedKey(lang))) ?? {}) as Record<string, string>;
  const tm: Record<string, TmEntry> = {};
  const done: [string, Record<string, unknown>][] = [];
  for (const c of cards) {
    const ctx = (c.context ?? {}) as Record<string, unknown>;
    const chosen = c.answer === 'a' ? c.option_a.text : c.answer === 'b' ? c.option_b.text : (c.own_text ?? '').trim();
    if (ctx.type === 'tm' && typeof ctx.h === 'string' && chosen) {
      const entries = (ctx.entries ?? {}) as { a?: TmEntry; b?: TmEntry };
      const picked = c.answer === 'a' ? entries.a : c.answer === 'b' ? entries.b : undefined;
      // a|b keeps the winner's origin (and its source/licence); own text is an admin entry.
      tm[ctx.h] = picked ? { ...picked, t: chosen, at } : { t: chosen, o: 'admin', m: 'card', at };
      decided[ctx.h] = chosen;
      sum.tm++;
      if (c.save_as_rule && typeof ctx.en === 'string' && ctx.en.length <= 60 && !/[\r\n]/.test(ctx.en)) {
        await learn.upsertAdminRule(lang, { source_term: ctx.en.trim(), target_term: chosen, category: 'term' }, c.answered_by ?? null);
        sum.rules++;
      }
    } else if (ctx.type === 'term' && typeof ctx.term === 'string' && chosen) {
      const term = ctx.term;
      // A term answer is a decision for every string with the term. save_as_rule or own text → admin row;
      // a plain a|b pick → a mined row backed by the admin's choice (still re-decidable by an admin).
      if (c.save_as_rule || c.answer === 'own') {
        await learn.upsertAdminRule(lang, { source_term: term, target_term: chosen, category: term === chosen ? 'dnt' : 'term' }, c.answered_by ?? null);
      } else {
        const have = (await learn.listGlossary(lang)).find((g) => g.source_term.toLowerCase() === term.toLowerCase());
        if (have?.id) await learn.updateGlossary(have.id, { target_term: chosen, origin: 'mined', needs_retranslate: true });
        else await learn.insertGlossary(lang, [{ source_term: term, target_term: chosen, category: term === chosen ? 'dnt' : 'term', origin: 'mined', evidence: Number(c.spread ?? 0) }]);
      }
      sum.rules++;
    } else if (c.kind === 'style' && c.save_as_rule && chosen) {
      if (!notes.general.includes(chosen)) notes.general.push(chosen);
      sum.rules++;
    }
    const note = (c.note ?? '').trim();
    if (note) {
      if (ctx.type === 'term' && typeof ctx.term === 'string') notes.byTerm[ctx.term] = note;
      else if (typeof ctx.key === 'string') for (const k of (ctx.keys as string[] | undefined) ?? [ctx.key]) notes.byKey[k] = note;
      else notes.general.push(note);
      sum.notes++;
    }
    done.push([c.id!, { ...ctx, applied_at: at }]);
  }
  if (Object.keys(tm).length) await saveTm(deps.store, lang, tm);
  notes.general = notes.general.slice(-30);
  await deps.store.putJson(notesKey(lang), notes);
  await deps.store.putJson(decidedKey(lang), decided);
  // Marked only after TM/notes are written: a crash in between re-applies (harmless), never loses an answer.
  for (const [id, ctx] of done) {
    await learn.updateCardContext(id, ctx);
    sum.applied++;
  }
  return sum;
}
