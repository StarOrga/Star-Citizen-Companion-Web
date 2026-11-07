/*
 * Warenkorb (cart) model - pure. The wishlist as the cart shows it: grouped (Waffen first, Blaupausen last), the
 * "last N added" cut the quick access uses, and the type -> Bestand mapping of its context section.
 */
import { groupWish, type FlowGroup, type FlowRow } from '../../hq/plan/hq-nachschub-flow.util';
import type { WishPosition } from '../../hq/nachschub/nachschub.model';
import { categoryOf } from '../../hq/stock/hq-stock-model';
import type { HqStockTab } from '../../hq/hq-routes';
import type { MerkType } from '../merkliste/merkliste.model';

/** One cart position: a wishlist row or a wished ship, with what the quick access needs on top. */
export interface CartItem extends WishPosition {
  readonly key: string;
  readonly createdAt: string;
  readonly manufacturer: string | null;
  /** `hangar_ships.id` of a wished ship (its quantity and removal go through the Hangar), else null. */
  readonly shipId: string | null;
}

/** Group order of the cart: Waffen first, the craft groups ("für X craften", Blaupausen) last. */
export const CART_GROUP_ORDER = ['weapons', 'armor', 'components', 'ships', 'items', 'materials', 'blueprint'] as const;


/** Which cart group a plain item belongs to (the wish kind first, then the class-name tokens the stock uses). */
export function itemGroupOf(row: Pick<WishPosition, 'kind' | 'className'>): 'weapons' | 'armor' | 'components' | 'items' | 'ships' {
  if (row.kind === 'upcoming') return 'ships';
  if (row.kind === 'weapon') return 'weapons';
  if (row.kind === 'component') return 'components';
  const cat = categoryOf({ class_name: row.className, unit: 'pcs' });
  if (cat === 'weapons') return 'weapons';
  if (cat === 'armor') return 'armor';
  return 'items';
}

const TITLE_KEY: Record<string, string> = {
  weapons: 'cart.group.weapons',
  armor: 'cart.group.armor',
  components: 'cart.group.components',
  ships: 'cart.group.ships',
  items: 'cart.group.items',
  materials: 'cart.group.materials',
};

/**
 * The cart's groups. Built on the Nachschub flow's grouping (so a position lands in the same group in both places),
 * with the plain items split into weapons / armor / components / the rest and the groups put in {@link CART_GROUP_ORDER}.
 */
export function cartGroups(wish: readonly WishPosition[]): FlowGroup[] {
  const base = groupWish(wish);
  const out: FlowGroup[] = [];
  for (const g of base) {
    if (g.type !== 'items') {
      out.push(g.type === 'ships' || g.type === 'materials' ? { ...g, titleKey: TITLE_KEY[g.type] } : g);
      continue;
    }
    const split = new Map<'weapons' | 'armor' | 'components' | 'items' | 'ships', FlowRow[]>();
    for (const r of g.rows) {
      const id = itemGroupOf(r);
      split.set(id, [...(split.get(id) ?? []), r]);
    }
    for (const [id, rows] of split) {
      // Announced ships (kind `upcoming`) join the ships group when there is one already.
      const have = out.find((o) => o.id === id);
      if (have) out[out.indexOf(have)] = { ...have, rows: [...have.rows, ...rows] };
      else out.push({ id, type: id, titleKey: TITLE_KEY[id], title: null, rows, blueprint: null });
    }
  }
  const rank = (g: FlowGroup): number => CART_GROUP_ORDER.indexOf(g.type as (typeof CART_GROUP_ORDER)[number]);
  return out.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

/** The newest `n` by `createdAt` (ties keep the given order). Rows without a date count as oldest. */
export function lastAdded<T extends { createdAt: string }>(rows: readonly T[], n: number): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.createdAt < b.r.createdAt ? 1 : a.r.createdAt > b.r.createdAt ? -1 : a.i - b.i))
    .slice(0, n)
    .map((x) => x.r);
}

/** The Bestand tab a page type belongs to - what the quick access's context section shows - and its stock filter. */
export interface BestandContext {
  /** i18n key suffix: `quick.section.<id>` */
  readonly id: 'inventar' | 'hangar' | 'sammlung';
  readonly tab: HqStockTab;
  /** Stock category carried into the deep link (`cat=`), Inventar only. */
  readonly cat: 'weapons' | 'armor' | 'other' | null;
}

/**
 * Page type -> context section. Ships live in the Hangar, blueprints and news in the Sammlung, everything else in the
 * Inventar, filtered by the stock category that type maps to (weapon -> weapons, FPS item -> armor, component -> other).
 * A page without a type (null) has no context section.
 */
export function bestandContextOf(type: MerkType | null): BestandContext | null {
  switch (type) {
    case 'ship':
      return { id: 'hangar', tab: 'hangar', cat: null };
    case 'blueprint':
    case 'news':
      return { id: 'sammlung', tab: 'sammlung', cat: null };
    case 'weapon':
      return { id: 'inventar', tab: 'inventar', cat: 'weapons' };
    case 'item':
      return { id: 'inventar', tab: 'inventar', cat: 'armor' };
    case 'component':
      return { id: 'inventar', tab: 'inventar', cat: 'other' };
    default:
      return null;
  }
}
