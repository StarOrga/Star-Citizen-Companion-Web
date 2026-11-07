import type { CodexKind } from '../../codex/codex.service';
import type { Lang } from '../../codex/codex.types';
import type { PolySearchHit } from '../../codex/codex-poly-search';
import { normalizeSearch } from '../../codex/codex-search';
import { hitTitle } from '../../codex/search/codex-search-model';
import { polyHitLink } from '../../codex/codex-poly-search';
import { hqShipLink, personalItemLink } from '../hq-routes';

/**
 * What an entry of "Lager per Ort" points at. The table has only a nullable `class_name`
 * column, so a manual entry stores `<kind>:<ClassName>` there (no migration); entries from the
 * desktop app or the log carry a bare class name or none and stay readable.
 */
export const STOCK_KINDS: readonly CodexKind[] = ['ship', 'item', 'component', 'weapon', 'ammunition'];

export function encodeStockRef(kind: CodexKind, className: string): string {
  return `${kind}:${className}`;
}

export function parseStockRef(ref: string | null | undefined): { kind: CodexKind | null; className: string } | null {
  const v = (ref ?? '').trim();
  if (!v) return null;
  const i = v.indexOf(':');
  if (i > 0) {
    const kind = v.slice(0, i) as CodexKind;
    if (STOCK_KINDS.includes(kind) && v.length > i + 1) return { kind, className: v.slice(i + 1) };
  }
  return { kind: null, className: v };
}

export interface StockTarget {
  commands: string[];
  queryParams: Record<string, string> | null;
}

/**
 * Where an entry leads: a ship the reader owns → their hangar ship (`hq`: its HQ page), else the Codex page;
 * any other known kind → its Codex page; a bare class name (kind unknown) → the Codex index
 * search for the entry's name; nothing known → null (plain text).
 */
export function stockTarget(
  name: string,
  classRef: string | null | undefined,
  ownedShips: readonly { id: string; shipClassName: string }[],
  hq = false,
): StockTarget | null {
  const ref = parseStockRef(classRef);
  if (!ref) return null;
  const owned = ownedShips.find((s) => s.shipClassName === ref.className);
  if (ref.kind === 'ship' || (!ref.kind && owned)) {
    return owned
      ? hq
        ? hqShipLink(owned.id)
        : { commands: personalItemLink('ship', owned.shipClassName).commands, queryParams: personalItemLink('ship', owned.shipClassName).queryParams }
      : { commands: polyHitLink({ kind: 'ship', classNameSlug: ref.className }), queryParams: null };
  }
  if (ref.kind) return { commands: polyHitLink({ kind: ref.kind, classNameSlug: ref.className }), queryParams: null };
  return { commands: ['/codex/index'], queryParams: { q: name } };
}

/**
 * A raw material is not a Codex kind: the Codex holds one cargo crate per size and material
 * (`Carryable_TBO_FL_32SCU_Commodity_Metal_Iron`), while crafting recipes name the plain material
 * (`Iron`). This reads the material off a crate class name; null for anything that is not a
 * commodity crate. Ore stays its own material ("Iron (Ore)" is not "Iron").
 */
export function materialOf(className: string): { token: string; ore: boolean; key: string } | null {
  const m = /_Commodity_(.+)$/.exec(className);
  if (!m) return null;
  const segs = m[1].split('_').filter(Boolean);
  const token = segs[segs.length - 1];
  if (!token) return null;
  const ore = segs.slice(0, -1).includes('Ore');
  return { token, ore, key: ore ? `${token}_Ore` : token };
}

/** The recipe ingredient name a crate stands for ("Iron"), null for ore and for non-commodities. */
export function ingredientTokenOfCrate(className: string): string | null {
  const m = materialOf(className);
  return m && !m.ore ? m.token : null;
}

export interface StockSuggestion {
  key: string;
  kind: 'ship' | 'item' | 'component' | 'weapon' | 'ammunition';
  title: string;
}

export const STOCK_PICK_KINDS: readonly string[] = ['ship', 'item', 'component', 'weapon', 'ammunition'];
/** Items that cannot lie in a store: paints, doors, shop furniture, usables. */
const NOISE_ATTACH = new Set(['paints', 'door', 'shopdisplay', 'usable']);

function matchRank(title: string, term: string): number {
  const t = normalizeSearch(title);
  if (t === term) return 0;
  if (t.startsWith(term)) return 1;
  if (t.split(/[\s_-]+/).some((w) => w.startsWith(term))) return 2;
  return 3;
}

/**
 * The suggestion list for a typed term: crates of one material collapse into one entry (stored as
 * the item ref of its first crate class name), unnamed crates only count when a sibling has a name,
 * paints/doors/shop noise is dropped, exact and prefix name matches come first. Pure.
 */
export function stockSuggestions(hits: readonly PolySearchHit[], rawTerm: string, lang: Lang, max = 8): StockSuggestion[] {
  const term = normalizeSearch(rawTerm.trim());
  const mats = new Map<string, { hits: PolySearchHit[]; ore: boolean; token: string }>();
  const out: (StockSuggestion & { rank: number })[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (!STOCK_PICK_KINDS.includes(h.kind)) continue;
    if (h.kind === 'item' && NOISE_ATTACH.has((h.attachType ?? '').toLowerCase())) continue;
    const mat = h.kind === 'item' ? materialOf(h.classNameSlug) : null;
    if (mat) {
      const g = mats.get(mat.key) ?? { hits: [], ore: mat.ore, token: mat.token };
      g.hits.push(h);
      mats.set(mat.key, g);
      continue;
    }
    const kind = h.kind as StockSuggestion['kind'];
    const key = encodeStockRef(kind, h.classNameSlug);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = hitTitle(h, lang);
    out.push({ key, kind, title, rank: matchRank(title, term) });
  }
  for (const g of mats.values()) {
    const named = g.hits.filter((h) => h.name || h.nameLocalized);
    if (!named.length) continue;
    const titled = named
      .map((h) => ({ h, title: hitTitle(h, lang) }))
      .sort((a, b) => matchRank(a.title, term) - matchRank(b.title, term) || a.h.classNameSlug.localeCompare(b.h.classNameSlug));
    const best = titled[0];
    const rep = [...g.hits].sort((a, b) => a.classNameSlug.localeCompare(b.classNameSlug))[0];
    const title = g.ore && !/\bore\b/i.test(best.title) ? `${best.title} (Ore)` : best.title;
    // A hit by the other language's name ("Eisen" for the iron crates) matches through any sibling.
    const rank = Math.min(...titled.map((x) => matchRank(x.title, term)));
    out.push({ key: encodeStockRef('item', rep.classNameSlug), kind: 'item', title, rank });
  }
  return out
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.rank - b.o.rank || a.o.title.length - b.o.title.length || a.i - b.i)
    .slice(0, max)
    .map(({ o }) => ({ key: o.key, kind: o.kind, title: o.title }));
}
