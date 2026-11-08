import { ARMOR_SUBS, WEAPON_SUBS, type BestandKind } from '../data/hq-codex-kind';
import { type QualityAggregate, type QualityRow, aggregateQuality } from '../data/hq-quality';
import type { HqGatherStop } from '../data/hq-db.types';
import type { NachschubLineInput } from '../nachschub/nachschub.model';
import { type StockCategory, categoryOf } from './hq-stock-model';
import { materialOf, parseStockRef } from './hq-stock-ref';

/**
 * View helpers of the Frachtdeck (HQ Bestand, concept 20261108-2135, design frachtdeck3). Pure: the component and
 * the specs feed rows in and read view state out. Spec: `docs/concepts/hq-bestand-ui-spec.md`.
 */

/** Inventar kind chips, fixed order (F4: always all, never derived from what the player owns). */
export type InvKind = StockCategory | 'sets';
export const INV_KINDS: readonly InvKind[] = ['materials', 'weapons', 'armor', 'other', 'sets'];
/** Raw materials split by the crate class name (ore vs. refined), the Codex slots for weapons and armor (I9). */
export const MATERIAL_SUBS = ['ore', 'refined'] as const;
export const SUBS_OF: Readonly<Partial<Record<InvKind, readonly string[]>>> = {
  materials: MATERIAL_SUBS,
  weapons: WEAPON_SUBS,
  armor: ARMOR_SUBS,
};

export interface DeckFilter {
  readonly kind: InvKind | null;
  readonly sub: string | null;
  /** Stored location id, null = all places. */
  readonly place: string | null;
  readonly reserved: boolean;
  readonly scrap: boolean;
  /** Free text (already without the `q>700` part). */
  readonly text: string;
  /** Minimum quality from the query (`eisen q>700`), null = none. */
  readonly minQ: number | null;
}

export const NO_DECK_FILTER: DeckFilter = { kind: null, sub: null, place: null, reserved: false, scrap: false, text: '', minQ: null };

/** One Frachtdeck container: an item at a place, all its quality stacks aggregated (I3). */
export interface DeckCrate extends QualityAggregate {
  readonly kind: StockCategory;
  readonly sub: string | null;
}

const bareClass = (classRef: string | null | undefined): string | null => parseStockRef(classRef)?.className ?? null;

/** Kind and sub-kind of a row: the Codex lane when known (`kinds`, lower-cased class names), else the row heuristic. */
export function deckKindOf(r: Pick<QualityRow, 'class_name' | 'unit'>, kinds: ReadonlyMap<string, BestandKind>): { kind: StockCategory; sub: string | null } {
  const cls = bareClass(r.class_name);
  const k = cls ? kinds.get(cls.toLowerCase()) : undefined;
  if (k?.area === 'weapons') return { kind: 'weapons', sub: k.sub };
  if (k?.area === 'armor') return { kind: 'armor', sub: k.sub };
  const kind = categoryOf(r);
  if (kind === 'materials') {
    const m = cls ? materialOf(cls) : null;
    return { kind, sub: m ? (m.ore ? 'ore' : 'refined') : null };
  }
  return { kind, sub: null };
}

/** All containers of the Inventar: one per (place, item), blueprint rows (the Sammlung) skipped. Largest first. */
export function buildCrates(rows: readonly QualityRow[], kinds: ReadonlyMap<string, BestandKind>, skipPlace?: string): DeckCrate[] {
  const own = skipPlace ? rows.filter((r) => r.location !== skipPlace) : rows;
  return aggregateQuality(own, 'place')
    .map((a) => ({ ...a, ...deckKindOf({ class_name: a.className, unit: a.unit }, kinds) }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

/** `eisen q>700` / `Eisen Q ≥ 700` → text "eisen", minimum quality 700. */
export function parseStockQuery(raw: string): { text: string; minQ: number | null } {
  const m = /\bq\s*(?:>=|≥|>|=)?\s*(\d{1,4})\b/i.exec(raw);
  const minQ = m ? Math.min(1000, Number(m[1])) : null;
  const text = (m ? raw.replace(m[0], ' ') : raw).replace(/\s+/g, ' ').trim().toLowerCase();
  return { text, minQ: minQ && minQ > 0 ? minQ : null };
}

export const textMatches = (name: string, className: string | null, text: string): boolean =>
  !text || name.toLowerCase().includes(text) || (className ?? '').toLowerCase().includes(text);

type Facet = 'kind' | 'sub' | 'place';

/** Whether a container passes the filter; `skip` leaves one facet out (for the counts of that facet's chips). */
export function crateMatches(c: DeckCrate, f: DeckFilter, scrapYes: (c: DeckCrate) => boolean, skip?: Facet): boolean {
  if (skip !== 'kind' && skip !== 'sub' && f.kind && f.kind !== 'sets' && c.kind !== f.kind) return false;
  if (f.kind === 'sets' && skip !== 'kind' && skip !== 'sub') return false;
  if (skip !== 'sub' && f.sub && c.sub !== f.sub) return false;
  if (skip !== 'place' && f.place && c.location !== f.place) return false;
  if (f.reserved && !(c.reserved > 0)) return false;
  if (f.scrap && !scrapYes(c)) return false;
  if (f.minQ !== null && !((c.max ?? 0) >= f.minQ)) return false;
  return textMatches(c.name, c.className, f.text);
}

export const filterCrates = (crates: readonly DeckCrate[], f: DeckFilter, scrapYes: (c: DeckCrate) => boolean): DeckCrate[] =>
  crates.filter((c) => crateMatches(c, f, scrapYes));

/**
 * Kind chip counts (F4): every kind in {@link INV_KINDS} gets a number — 0 when nothing under the OTHER active filters
 * (place, toggles, text) — so the chip is dimmed, never hidden. `sets` counts the player's sets.
 */
export function kindCounts(crates: readonly DeckCrate[], f: DeckFilter, scrapYes: (c: DeckCrate) => boolean, sets: number): Map<InvKind, number> {
  const m = new Map<InvKind, number>(INV_KINDS.map((k) => [k, 0]));
  for (const c of crates) if (crateMatches(c, { ...f, kind: null, sub: null }, scrapYes)) m.set(c.kind, (m.get(c.kind) ?? 0) + 1);
  m.set('sets', sets);
  return m;
}

/** Sub chip counts of the chosen kind: every sub of {@link SUBS_OF} (0 = dimmed), honouring place, toggles and text. */
export function subCounts(crates: readonly DeckCrate[], f: DeckFilter, scrapYes: (c: DeckCrate) => boolean): Map<string, number> {
  const subs = f.kind ? (SUBS_OF[f.kind] ?? []) : [];
  const m = new Map<string, number>(subs.map((s) => [s, 0]));
  for (const c of crates) if (c.sub && m.has(c.sub) && crateMatches(c, { ...f, sub: null }, scrapYes)) m.set(c.sub, (m.get(c.sub) ?? 0) + 1);
  return m;
}

/** Containers per place under the filter without its place facet: the amounts of the place select (I10). */
export function placeCounts(crates: readonly DeckCrate[], f: DeckFilter, scrapYes: (c: DeckCrate) => boolean): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of crates) if (crateMatches(c, f, scrapYes, 'place')) m.set(c.location, (m.get(c.location) ?? 0) + 1);
  return m;
}

export interface DeckBay {
  readonly location: string;
  /** Flex weight: how many containers the CURRENT filter shows there (I1: not SCU, not pieces). */
  readonly weight: number;
}

/** Loading bays of what the filter shows, most containers first. */
export function deckBays(shown: readonly DeckCrate[]): DeckBay[] {
  const m = new Map<string, number>();
  for (const c of shown) m.set(c.location, (m.get(c.location) ?? 0) + 1);
  return [...m.entries()].map(([location, weight]) => ({ location, weight })).sort((a, b) => b.weight - a.weight || a.location.localeCompare(b.location));
}

/** Containers grouped into lanes by kind, fixed lane order (only lanes with containers render). */
export function deckLanes(shown: readonly DeckCrate[]): { kind: StockCategory; crates: DeckCrate[] }[] {
  const order: StockCategory[] = ['materials', 'weapons', 'armor', 'other'];
  return order.map((kind) => ({ kind, crates: shown.filter((c) => c.kind === kind) })).filter((l) => l.crates.length);
}

/** One entry of the tiered page search (I14). */
export interface SearchEntry {
  readonly area: 'inventar' | 'hangar' | 'sammlung';
  readonly key: string;
  readonly name: string;
  readonly className: string | null;
}

/**
 * Tiered search: the entries of the active area first, then the rest of the Bestand. `active` = the areas of the tab
 * (`alles` = every area, so `rest` is empty). The Codex tier is the caller's (wishlist suggestion).
 */
export function tieredSearch(entries: readonly SearchEntry[], active: readonly SearchEntry['area'][], text: string): { active: SearchEntry[]; rest: SearchEntry[] } {
  const hits = text ? entries.filter((e) => textMatches(e.name, e.className, text)) : [];
  return { active: hits.filter((e) => active.includes(e.area)), rest: hits.filter((e) => !active.includes(e.area)) };
}

/** At most this many hits still show the alternatives (R3 pin a3-s7 "<= 3 Treffer"). */
export const ALT_MAX_HITS = 3;

export interface Alternatives {
  /** Same item outside the current place / sub filter, with its free amount: one click plans the pick-up. */
  readonly elsewhere: readonly DeckCrate[];
  /** "… wünschen und einplanen" with the minimum quality; null without a text. */
  readonly wish: { readonly text: string; readonly minQ: number | null } | null;
  /** Same Codex slot (swap archetype) the player holds and that meets the quality. */
  readonly swap: readonly DeckCrate[];
  /** Owned blueprints whose name matches: craft it yourself. */
  readonly craft: readonly { readonly id: string; readonly name: string }[];
}

/**
 * Alternatives for a search (I15): only with a text and at most {@link ALT_MAX_HITS} hits. `elsewhere` drops the
 * place and sub facets (that is where "the same thing" still lies), keeps quality; `swap` takes the slot of the
 * best hit or elsewhere-hit and offers other items of it; `craft` matches owned blueprints by name.
 */
export function alternativesFor(
  crates: readonly DeckCrate[],
  hits: readonly DeckCrate[],
  f: DeckFilter,
  scrapYes: (c: DeckCrate) => boolean,
  blueprints: readonly { id: string; name: string | null }[],
): Alternatives | null {
  if (!f.text || hits.length > ALT_MAX_HITS) return null;
  const hitKeys = new Set(hits.map((h) => h.key));
  const wide: DeckFilter = { ...f, place: null, sub: null, kind: f.kind === 'sets' ? null : f.kind };
  const elsewhere = crates.filter((c) => !hitKeys.has(c.key) && crateMatches(c, wide, scrapYes) && c.available > 0).sort((a, b) => b.available - a.available).slice(0, 3);
  const ref = hits[0] ?? elsewhere[0] ?? null;
  const swap = ref
    ? crates
        .filter((c) => c.kind === ref.kind && c.sub === ref.sub && itemKey(c) !== itemKey(ref) && !textMatches(c.name, c.className, f.text) && (f.minQ === null || (c.max ?? 0) >= f.minQ) && c.available > 0)
        .slice(0, 2)
    : [];
  const craft = blueprints
    .filter((b) => textMatches(b.name ?? b.id, b.id, f.text))
    .slice(0, 2)
    .map((b) => ({ id: b.id, name: b.name ?? b.id }));
  return { elsewhere, wish: { text: f.text, minQ: f.minQ }, swap, craft };
}

const itemKey = (c: Pick<DeckCrate, 'className' | 'name'>): string => (c.className || c.name).toLowerCase();

/** Hand-over lines for the Nachschub picker: one line per item, one stop per selected place, largest first (D4). */
export function linesOf(selected: readonly DeckCrate[], placeSystem: (location: string) => string | null): NachschubLineInput[] {
  const by = new Map<string, DeckCrate[]>();
  for (const c of selected) {
    const k = `${itemKey(c)}\u0000${c.unit}`;
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return [...by.values()].map((list) => {
    const stops: HqGatherStop[] = list
      .filter((c) => c.available > 0)
      .sort((a, b) => b.available - a.available)
      .map((c) => ({ location: c.location, system: placeSystem(c.location) ?? undefined, amount: c.available, done: false }));
    const first = list[0];
    return {
      name: first.name,
      className: bareClass(first.className) ?? first.name,
      amount: stops.reduce((s, x) => s + x.amount, 0),
      unit: first.unit,
      stops,
    };
  });
}
