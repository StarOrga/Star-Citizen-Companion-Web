/*
 * "Passt dazu" - the deterministic recommendation engine (W1.8), per docs/concepts/nachschub-recommendations-research.md.
 *
 * A pure function `(anchors, catalogue, owned, wished, ...) -> ranked suggestions`. No randomness, no clock, no
 * I/O: the same input always gives the same list. The score per candidate c, summed over the newest 3 anchors a:
 *
 *   S(c) = sum_a w_a * (100*C + 30*M + 10*L + 4*A)       w = [1.0, 0.6, 0.35]
 *
 * C complement (same set / ammo / ingredient 1.0, free port 0.7, soft relation 0.5), M same material
 * (weighted Jaccard of the recipes), L same place (shop 1, station .8, body .4, system .2), A same action.
 * A real complement (C >= .5) scores >= 50 while M+L+A can add at most 44, so complement > material > place >
 * action by construction. Substitutes (same port kind and size as the anchor) are damped x0.3 and never filled
 * twice. Selection is greedy MMR-like with one suggestion per bucket while other buckets still have candidates.
 *
 * The caller keeps at least {@link READY_COUNT} ready and shows {@link SHOW_COUNT}; a dismissed suggestion is hidden
 * only until the next add and is replaced from the ready list ({@link visibleSuggestions}, {@link dismissState}).
 */

export const SHOW_COUNT = 3;
export const READY_COUNT = 7;
export const MIN_SCORE = 20;
const ANCHOR_WEIGHTS = [1.0, 0.6, 0.35] as const;

export type RecKind =
  | 'armor'
  | 'fps_weapon'
  | 'magazine'
  | 'attachment'
  | 'ship'
  | 'ship_weapon'
  | 'ship_component'
  | 'missile'
  | 'paint'
  | 'mining'
  | 'material'
  | 'blueprint'
  | 'consumable'
  | 'other';

export type RecActivity = 'mining' | 'hauling' | 'fps' | 'ship_combat' | 'crafting';

export interface RecPort {
  /** Port type, compared with the candidate's `slotType` (e.g. 'weapon', 'shield', 'optic'). */
  readonly type: string;
  readonly minSize: number;
  readonly maxSize: number;
}

export interface RecPlace {
  readonly shop?: string | null;
  readonly station?: string | null;
  readonly body?: string | null;
  readonly system?: string | null;
}

/** One catalogue entry, flattened by the adapter from codex tables and payloads. Only the used fields matter. */
export interface RecItem {
  readonly className: string;
  readonly name: string;
  readonly kind: RecKind;
  readonly manufacturer?: string | null;
  /** Armor set key (manufacturer + family token); parts with the same key belong together. */
  readonly setKey?: string | null;
  /** Armor part; the fixed order below decides which part comes first. */
  readonly armorPart?: string | null;
  /** Port type this item occupies (weapon, shield, power, optic, ...). */
  readonly slotType?: string | null;
  readonly size?: number | null;
  /**
   * What tells two same-slot items apart in a loadout (a missile's tracking signal, a consumable's sub type). Two items
   * of one slot and size with different facets complement each other instead of replacing each other.
   */
  readonly facet?: string | null;
  readonly grade?: number | null;
  /** The weapon's standard magazine (class name). */
  readonly magazineClass?: string | null;
  /** Ports this item offers (ships, weapons). */
  readonly ports?: readonly RecPort[];
  /** Ships a paint belongs to. */
  readonly shipClasses?: readonly string[];
  /** Recipe: ingredient class -> quantity. On a blueprint or on the item it crafts. */
  readonly ingredients?: Readonly<Record<string, number>>;
  /** For a blueprint: the item it crafts. */
  readonly outputClass?: string | null;
  readonly place?: RecPlace | null;
  readonly activity?: RecActivity | null;
  readonly isVariant?: boolean;
  /** False when the item is not in the current build. */
  readonly inBuild?: boolean;
  readonly placeholder?: boolean;
}

/** The newest wishlist / cart entries. `weight` overrides the rank weight (cold start from the Hangar uses .5). */
export interface RecAnchor {
  readonly className: string;
  readonly addedAt: string;
  readonly weight?: number;
}

export interface RecContext {
  readonly anchors: readonly RecAnchor[];
  readonly catalogue: ReadonlyMap<string, RecItem>;
  /** Class names in Hangar / Inventar. */
  readonly owned: ReadonlySet<string>;
  /** Class names already on the wishlist or in the cart. */
  readonly wished: ReadonlySet<string>;
  /** Class names stocked (inventory / Nachschub) for the craft-vs-buy decision. */
  readonly stocked?: ReadonlySet<string>;
  /** Dismissed ones are skipped here as well, so the pool refills. */
  readonly dismissed?: ReadonlySet<string>;
  /** How many to return (default {@link READY_COUNT}). */
  readonly count?: number;
}

export type RecReasonKey =
  | 'sameSet'
  | 'magazineFor'
  | 'weaponFor'
  | 'fitsPort'
  | 'ingredientFor'
  | 'usedIn'
  | 'sameMaker'
  | 'paintFor'
  | 'sameSizeClass'
  | 'otherSignal'
  | 'pairsWith'
  | 'sameMaterial'
  | 'sameShop'
  | 'samePlace'
  | 'sameActivity';

export interface Recommendation {
  readonly className: string;
  readonly name: string;
  readonly score: number;
  /** i18n key suffix `nachschub.rec.reason.<reason>`; `params` fill it. Never free text. */
  readonly reason: RecReasonKey;
  readonly params: Readonly<Record<string, string | number>>;
  /** Craft or buy, when the item has both a recipe and a shop (otherwise whichever exists). */
  readonly via: 'craft' | 'buy' | null;
  readonly bucket: string;
}

/** Fixed order of armor parts: legs and torso before the backpack. */
export const ARMOR_PART_ORDER = ['torso', 'legs', 'arms', 'helmet', 'backpack', 'undersuit'] as const;

const BUCKET: Record<RecKind, string> = {
  armor: 'armor',
  fps_weapon: 'weapon',
  magazine: 'magazine',
  attachment: 'attachment',
  ship: 'ship',
  ship_weapon: 'shipcomp',
  ship_component: 'shipcomp',
  missile: 'missile',
  paint: 'paint',
  mining: 'mining',
  material: 'material',
  blueprint: 'blueprint',
  consumable: 'consumable',
  other: 'other',
};

interface Complement {
  readonly c: number;
  readonly reason: RecReasonKey;
  readonly params: Record<string, string | number>;
}

function portFits(ports: readonly RecPort[] | undefined, cand: RecItem): boolean {
  if (!ports || !cand.slotType || cand.size == null) return false;
  return ports.some((p) => p.type === cand.slotType && cand.size! >= p.minSize && cand.size! <= p.maxSize);
}

/** C and its reason for one anchor/candidate pair (0 = no complement). The strongest relation wins. */
export function complement(a: RecItem, c: RecItem, cat: ReadonlyMap<string, RecItem>): Complement {
  const none: Complement = { c: 0, reason: 'sameMaker', params: {} };
  const hit = (v: number, reason: RecReasonKey, params: Record<string, string | number> = {}): Complement => ({ c: v, reason, params });
  const out: Complement[] = [];

  if (a.kind === 'armor' && c.kind === 'armor' && a.setKey && a.setKey === c.setKey) {
    out.push(hit(1, 'sameSet', { item: a.name }));
  }
  if (a.kind === 'fps_weapon' && c.kind === 'magazine' && a.magazineClass === c.className) {
    out.push(hit(1, 'magazineFor', { item: a.name }));
  }
  if (a.kind === 'magazine' && c.kind === 'fps_weapon' && c.magazineClass === a.className) {
    out.push(hit(1, 'weaponFor', { item: a.name }));
  }
  if (a.kind === 'blueprint') {
    if (a.ingredients && c.className in a.ingredients) out.push(hit(1, 'ingredientFor', { item: a.name }));
    const crafted = a.outputClass ? cat.get(a.outputClass) : undefined;
    if (crafted?.magazineClass === c.className) out.push(hit(1, 'magazineFor', { item: crafted.name }));
  }
  if (a.kind === 'material' && c.kind === 'blueprint' && c.ingredients && a.className in c.ingredients) {
    out.push(hit(0.7, 'usedIn', { item: c.name }));
  }
  // Free port: ship -> its weapons/components/missiles; weapon -> attachments; mining head -> modules.
  if ((a.kind === 'ship' || a.kind === 'fps_weapon') && c.kind !== a.kind && portFits(a.ports, c)) {
    out.push(hit(0.7, 'fitsPort', { item: a.name, size: c.size ?? 0 }));
  }
  if ((c.kind === 'ship' || c.kind === 'fps_weapon') && c.kind !== a.kind && portFits(c.ports, a)) {
    out.push(hit(0.7, 'fitsPort', { item: c.name, size: a.size ?? 0 }));
  }
  if (a.kind === 'mining' && c.kind === 'mining' && a.className !== c.className && a.slotType !== c.slotType) {
    out.push(hit(0.7, 'fitsPort', { item: a.name, size: a.size ?? 0 }));
  }
  if (a.kind === 'ship' && c.kind === 'paint' && c.shipClasses?.includes(a.className)) {
    out.push(hit(0.5, 'paintFor', { item: a.name }));
  }
  // Ship loadout: the core components of one size class belong to one hull class (a S2 shield wants a S2 cooler).
  if (a.kind === 'ship_component' && c.kind === 'ship_component' && a.slotType && c.slotType && a.slotType !== c.slotType && a.size != null && a.size === c.size) {
    out.push(hit(0.5, 'sameSizeClass', { item: a.name, size: a.size }));
  }
  // Missiles of one size and kind with another tracking signal cover what the first cannot lock.
  if (a.kind === 'missile' && c.kind === 'missile' && a.facet && c.facet && a.facet !== c.facet && a.slotType === c.slotType && a.size != null && a.size === c.size) {
    out.push(hit(0.5, 'otherSignal', { item: a.name, signal: c.facet.toUpperCase(), size: a.size }));
  }
  // Consumables of a different type (another kind of medpen / gadget) round out the kit.
  if (a.kind === 'consumable' && c.kind === 'consumable' && a.facet && c.facet && a.facet !== c.facet) {
    out.push(hit(0.5, 'pairsWith', { item: a.name }));
  }
  if (a.manufacturer && a.manufacturer === c.manufacturer && a.kind !== c.kind && (a.kind === 'armor' || c.kind === 'armor') && (a.kind === 'fps_weapon' || c.kind === 'fps_weapon')) {
    out.push(hit(0.5, 'sameMaker', { maker: a.manufacturer }));
  }
  if (!out.length) return none;
  return out.reduce((best, x) => (x.c > best.c ? x : best));
}

/** Weighted Jaccard of two recipes (sum min / sum max); 1 when the candidate is itself an ingredient of the anchor. */
export function materialOverlap(a: RecItem, c: RecItem): number {
  if (a.ingredients && c.className in a.ingredients) return 1;
  const ai = a.ingredients;
  const ci = c.ingredients;
  if (!ai || !ci) return 0;
  let mn = 0;
  let mx = 0;
  for (const k of new Set([...Object.keys(ai), ...Object.keys(ci)])) {
    const x = ai[k] ?? 0;
    const y = ci[k] ?? 0;
    mn += Math.min(x, y);
    mx += Math.max(x, y);
  }
  return mx > 0 ? mn / mx : 0;
}

/** L: shop 1, station .8, body .4, system .2, else 0. */
export function placeOverlap(a: RecItem, c: RecItem): number {
  const p = a.place;
  const q = c.place;
  if (!p || !q) return 0;
  if (p.shop && p.shop === q.shop) return 1;
  if (p.station && p.station === q.station) return 0.8;
  if (p.body && p.body === q.body) return 0.4;
  if (p.system && p.system === q.system) return 0.2;
  return 0;
}

function substituteOf(a: RecItem, c: RecItem): boolean {
  if (a.facet && c.facet && a.facet !== c.facet) return false;
  return a.kind === c.kind && !!a.slotType && a.slotType === c.slotType && a.size != null && a.size === c.size;
}

function excluded(c: RecItem, ctx: RecContext): boolean {
  return (
    ctx.owned.has(c.className) ||
    ctx.wished.has(c.className) ||
    (ctx.dismissed?.has(c.className) ?? false) ||
    c.inBuild === false ||
    c.isVariant === true ||
    c.placeholder === true
  );
}

interface Scored {
  readonly item: RecItem;
  readonly score: number;
  readonly best: { rank: number; comp: Complement; m: number; l: number; a: number; anchor: RecItem };
}

function score(c: RecItem, anchors: readonly { rank: number; weight: number; item: RecItem }[], cat: ReadonlyMap<string, RecItem>): Scored | null {
  let total = 0;
  let best: Scored['best'] | null = null;
  let bestContribution = -1;
  for (const an of anchors) {
    if (an.item.className === c.className) continue;
    const comp = complement(an.item, c, cat);
    const m = materialOverlap(an.item, c);
    const l = placeOverlap(an.item, c);
    const act = an.item.activity && an.item.activity === c.activity ? 1 : 0;
    let s = 100 * comp.c + 30 * m + 10 * l + 4 * act;
    if (substituteOf(an.item, c)) s *= 0.3;
    const contribution = an.weight * s;
    total += contribution;
    if (contribution > bestContribution) {
      bestContribution = contribution;
      best = { rank: an.rank, comp, m, l, a: act, anchor: an.item };
    }
  }
  return best ? { item: c, score: total, best } : null;
}

function reasonOf(s: Scored): Pick<Recommendation, 'reason' | 'params'> {
  const b = s.best;
  // Strongest contributing component, order C > M > L > A.
  if (b.comp.c > 0) return { reason: b.comp.reason, params: b.comp.params };
  if (b.m > 0) return { reason: 'sameMaterial', params: { item: b.anchor.name } };
  if (b.l > 0) {
    const p = b.anchor.place;
    return p?.shop && p.shop === s.item.place?.shop
      ? { reason: 'sameShop', params: { place: p.shop } }
      : { reason: 'samePlace', params: { place: p?.station ?? p?.body ?? p?.system ?? '' } };
  }
  return { reason: 'sameActivity', params: { activity: b.anchor.activity ?? '' } };
}

/** Craft when at least 60 % of the recipe is in stock, else buy if a shop is known, else craft. One variant only. */
export function craftOrBuy(c: RecItem, stocked: ReadonlySet<string> | undefined): 'craft' | 'buy' | null {
  const ing = c.ingredients ? Object.keys(c.ingredients) : [];
  const hasRecipe = ing.length > 0;
  const hasShop = !!c.place?.shop;
  if (!hasRecipe && !hasShop) return null;
  if (hasRecipe) {
    const cover = ing.filter((k) => stocked?.has(k)).length / ing.length;
    if (cover >= 0.6) return 'craft';
  }
  return hasShop ? 'buy' : 'craft';
}

function partRank(i: RecItem): number {
  const idx = ARMOR_PART_ORDER.indexOf((i.armorPart ?? '') as (typeof ARMOR_PART_ORDER)[number]);
  return idx < 0 ? ARMOR_PART_ORDER.length : idx;
}

/**
 * The ranked suggestions. Anchors: the newest 3 by `addedAt` (ties: given order); candidates below
 * {@link MIN_SCORE} are not shown; fewer than asked is fine (never padded with noise).
 */
export function recommend(ctx: RecContext): readonly Recommendation[] {
  const count = ctx.count ?? READY_COUNT;
  const sorted = [...ctx.anchors]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.addedAt < y.a.addedAt ? 1 : x.a.addedAt > y.a.addedAt ? -1 : x.i - y.i))
    .map((x) => x.a);
  const anchors: { rank: number; weight: number; item: RecItem }[] = [];
  for (const a of sorted) {
    const item = ctx.catalogue.get(a.className);
    if (!item) continue;
    const rank = anchors.length;
    if (rank >= ANCHOR_WEIGHTS.length) break;
    anchors.push({ rank, weight: a.weight ?? ANCHOR_WEIGHTS[rank], item });
  }
  if (!anchors.length) return [];

  const scored: Scored[] = [];
  for (const c of ctx.catalogue.values()) {
    if (excluded(c, ctx)) continue;
    const s = score(c, anchors, ctx.catalogue);
    if (s && s.score >= MIN_SCORE) scored.push(s);
  }
  const tie = (a: Scored, b: Scored): number =>
    b.score - a.score ||
    a.best.rank - b.best.rank ||
    partRank(a.item) - partRank(b.item) ||
    (b.item.grade ?? 0) - (a.item.grade ?? 0) ||
    a.item.name.localeCompare(b.item.name, 'en') ||
    (a.item.className < b.item.className ? -1 : a.item.className > b.item.className ? 1 : 0);
  scored.sort(tie);

  const picked: Scored[] = [];
  const bucketOf = (s: Scored): string => BUCKET[s.item.kind];
  const slotKey = (s: Scored): string | null => (s.item.slotType && s.item.size != null ? `${s.item.slotType}:${s.item.size}` : null);
  const sim = (a: Scored, b: Scored): number => (bucketOf(a) === bucketOf(b) ? 1 : a.item.slotType && a.item.slotType === b.item.slotType ? 0.5 : 0);

  const pool = [...scored];
  // Pass 1: at most one per bucket; pass 2: fill the rest from what is left.
  for (const pass of [1, 2]) {
    while (picked.length < count && pool.length) {
      let bestIdx = -1;
      let bestVal = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        if (pass === 1 && picked.some((p) => bucketOf(p) === bucketOf(cand))) continue;
        const key = slotKey(cand);
        if (key && picked.some((p) => slotKey(p) === key && p.item.kind === cand.item.kind)) continue;
        const maxSim = picked.reduce((m, p) => Math.max(m, sim(cand, p)), 0);
        const val = cand.score - 30 * maxSim;
        if (val > bestVal + 1e-9) {
          bestVal = val;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      picked.push(pool.splice(bestIdx, 1)[0]);
    }
  }

  return picked.map((s) => ({
    className: s.item.className,
    name: s.item.name,
    score: Math.round(s.score * 100) / 100,
    ...reasonOf(s),
    via: craftOrBuy(s.item, ctx.stocked),
    bucket: bucketOf(s),
  }));
}

// ---------------------------------------------------------------------------------------------------------
// Dismiss / refill (r4 s2-a3): a dismissed suggestion is hidden only until the next add, a new one replaces it.
// ---------------------------------------------------------------------------------------------------------

export interface DismissState {
  readonly dismissed: ReadonlySet<string>;
}

export const emptyDismissState: DismissState = { dismissed: new Set() };

export function dismissSuggestion(s: DismissState, className: string): DismissState {
  return { dismissed: new Set([...s.dismissed, className]) };
}

/** Anything added to the wishlist / cart brings the dismissed ones back into play. */
export function onWishlistAdd(): DismissState {
  return emptyDismissState;
}

/** The 3 to show: the ready list (7) without the dismissed ones - each dismissal slides the next one up. */
export function visibleSuggestions(ready: readonly Recommendation[], s: DismissState, show = SHOW_COUNT): readonly Recommendation[] {
  return ready.filter((r) => !s.dismissed.has(r.className)).slice(0, show);
}
