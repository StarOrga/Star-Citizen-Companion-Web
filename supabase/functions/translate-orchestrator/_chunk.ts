// Chunking: group strings by key family, route lore to the stronger model, size requests.
// Contract: ~100 strings / ~30k input tokens per request; one shared key prefix per group.

import { INPUT_TOK_PER_CHAR, maxTokensFor } from './_cost.ts';
import { mask } from './_mask.ts';
import type { UniqueText } from './_diff.ts';

/** Lore / missions / dialogue keys (contract § Models). */
export const LORE_RE = /^(pu|dlg|mission|headhunters|covalex|hurston|shubin|foxwell|cfp|mg|human|dxsh|dxsm|ph)_/i;

export const DEFAULT_LORE_MODEL = 'claude-opus-5-5';
export const DEFAULT_REST_MODEL = 'claude-sonnet-5-5';

export interface ChunkItem {
  /** sha256 of the English text — the identity of the item across plan, results and TM. */
  h: string;
  /** Representative key (first of the sorted keys carrying this text). */
  key: string;
  /** Masked English. */
  m: string;
  toks: string[];
  /** Post-edit only: the earlier attempt (masked) and why it failed. */
  prev?: string;
  reason?: string[];
}

export interface Chunk {
  id: string;
  model: string;
  items: ChunkItem[];
  inputChars: number;
  enChars: number;
  maxTokens: number;
}

export function isLoreKey(key: string): boolean {
  return LORE_RE.test(key);
}

/** The key up to and including its last `_`: the family prefix a group shares. */
export function familyOf(key: string): string {
  const i = key.lastIndexOf('_');
  return i > 0 ? key.slice(0, i + 1) : '';
}

export interface FamilyGroup {
  p: string;
  s: ChunkItem[];
}

/** Consecutive items with the same family share one prefix in the request. */
export function groupByFamily(items: ChunkItem[]): FamilyGroup[] {
  const groups: FamilyGroup[] = [];
  for (const it of items) {
    const p = familyOf(it.key);
    const last = groups[groups.length - 1];
    if (last && last.p === p) last.s.push(it);
    else groups.push({ p, s: [it] });
  }
  return groups;
}

function itemChars(it: ChunkItem, withPrefix: boolean): number {
  const rest = it.key.length - familyOf(it.key).length;
  return (withPrefix ? familyOf(it.key).length : 0) + rest + it.m.length + (it.prev?.length ?? 0) +
    (it.reason ? it.reason.join(',').length : 0) + 12;
}

export interface ChunkOptions {
  lang: string;
  loreModel?: string;
  restModel?: string;
  maxItems?: number;
  maxInputTokens?: number;
  idPrefix?: string;
}

export function toChunkItem(u: UniqueText): ChunkItem {
  const { m, toks } = mask(u.en);
  return { h: u.h, key: u.keys[0], m, toks };
}

/** Deterministic: the same input always yields the same chunks and ids. */
export function buildChunks(items: ChunkItem[], keysOf: (it: ChunkItem) => string[], opts: ChunkOptions): Chunk[] {
  const loreModel = opts.loreModel ?? DEFAULT_LORE_MODEL;
  const restModel = opts.restModel ?? DEFAULT_REST_MODEL;
  const maxItems = opts.maxItems ?? 100;
  const maxChars = Math.floor((opts.maxInputTokens ?? 30_000) / INPUT_TOK_PER_CHAR);
  const prefix = opts.idPrefix ?? 'c';

  const routed = items.map((it) => ({ it, model: keysOf(it).some(isLoreKey) ? loreModel : restModel }));
  routed.sort((a, b) =>
    a.model === b.model ? (a.it.key < b.it.key ? -1 : a.it.key > b.it.key ? 1 : 0) : a.model < b.model ? -1 : 1
  );

  const chunks: Chunk[] = [];
  let model = '';
  let cur: ChunkItem[] = [];
  let chars = 0;
  let en = 0;
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      id: `${prefix}${chunks.length}`,
      model,
      items: cur,
      inputChars: chars,
      enChars: en,
      maxTokens: maxTokensFor(opts.lang, { model, enChars: en, strings: cur.length }),
    });
    cur = [];
    chars = 0;
    en = 0;
  };
  for (const r of routed) {
    const prev = cur[cur.length - 1];
    const sameFamily = !!prev && familyOf(prev.key) === familyOf(r.it.key);
    if (cur.length && (model !== r.model || cur.length >= maxItems || chars + itemChars(r.it, !sameFamily) > maxChars)) flush();
    model = r.model;
    const last = cur[cur.length - 1];
    chars += itemChars(r.it, !(last && familyOf(last.key) === familyOf(r.it.key)));
    en += r.it.m.length;
    cur.push(r.it);
  }
  flush();
  return chunks;
}
