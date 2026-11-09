import { reservationsOf, reservedOf, roundQty } from '../stock/hq-stock-counter';
import type { HqInventoryStack, HqStockReservation } from './hq-db.types';

/** The fields of an inventory item row the quality helpers read. */
export interface QualityRow {
  location: string;
  name: string;
  class_name: string | null;
  /** The item row's TOTAL amount. */
  qty: number;
  unit: 'pcs' | 'scu';
  /** The quality split of `qty`; absent = nothing known, all of it is "quality unknown". */
  stacks?: readonly HqInventoryStack[] | null;
  reservations?: readonly HqStockReservation[] | null;
}

/**
 * The stacks of an item row for display, always summing to `qty`: the known qualities (best first) plus the
 * remainder `qty - sum(known)` as the unknown-quality stack (quality null). If the known stacks add up to MORE than
 * `qty` an older app lowered the total after the split was written: the stacks are stale and ignored (all unknown).
 * Pure; the DB view `hq_inventory_item_quality` states the same rule.
 */
export function resolveStacks(qty: number, known: readonly HqInventoryStack[] | null | undefined): HqInventoryStack[] {
  const list = (known ?? [])
    .filter((s) => s.quality !== null && Number(s.qty) > 0)
    .map((s) => ({ quality: s.quality, qty: roundQty(Number(s.qty)) }));
  const sum = roundQty(list.reduce((t, s) => t + s.qty, 0));
  if (sum > qty + 1e-9) return qty > 0 ? [{ quality: null, qty }] : [];
  const out = list.sort((a, b) => (b.quality as number) - (a.quality as number));
  const rest = roundQty(qty - sum);
  if (rest > 1e-9) out.push({ quality: null, qty: rest });
  return out;
}

/** One stack of an item at a place. */
export interface QualityStack {
  /** 1..1000, null = unknown. */
  quality: number | null;
  qty: number;
  /** Reserved on THIS quality (reservations naming it); "any quality" reservations count on the aggregate only. */
  reserved: number;
  available: number;
  /** Those reservations, for the hover (amount + note/friend + exact quality). */
  reservations: readonly HqStockReservation[];
}

/** An item aggregated over its quality stacks ("Eisen" at Area18: Ø Q 780, range 612-905). */
export interface QualityAggregate {
  key: string;
  /** '' = all places (see {@link aggregateQuality} `by: 'item'`). */
  location: string;
  name: string;
  className: string | null;
  unit: 'pcs' | 'scu';
  qty: number;
  /** All live reservations, quality-specific and "any". */
  reserved: number;
  available: number;
  /** Reservations without a quality (they sit on the item, not on one stack). */
  anyReservations: readonly HqStockReservation[];
  /** Amount whose quality is known; the average weighs by it. */
  knownQty: number;
  /** Amount of the unknown-quality stack. */
  unknownQty: number;
  /** Amount-weighted average of the KNOWN qualities, rounded; null when no stack has one. */
  avg: number | null;
  /** Lowest / highest known quality; null when none is known. */
  min: number | null;
  max: number | null;
  /** Best quality first, the unknown stack last. */
  stacks: readonly QualityStack[];
}

/** The identity of an item across places: class name when there is one, else the name. */
export function itemIdentity(r: Pick<QualityRow, 'class_name' | 'name'>): string {
  return (r.class_name || r.name).trim().toLowerCase();
}

/**
 * Aggregates item rows per place and item (`by: 'place'`, the Frachtdeck container) or per item over all places
 * (`by: 'item'`, the detail "Eisen nach Qualität"). Each row's total is split by {@link resolveStacks}. Empty rows are
 * skipped. Order: place, then name.
 */
export function aggregateQuality(rows: readonly QualityRow[], by: 'place' | 'item' = 'place'): QualityAggregate[] {
  const groups = new Map<string, QualityRow[]>();
  for (const r of rows) {
    if (!(r.qty > 0)) continue;
    const k = `${by === 'place' ? r.location : ''}\u0000${itemIdentity(r)}\u0000${r.unit}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const out: QualityAggregate[] = [];
  for (const [key, list] of groups) {
    const stackMap = new Map<number | null, QualityStack>();
    const any: HqStockReservation[] = [];
    for (const r of list) {
      const res = reservationsOf(r);
      any.push(...res.filter((x) => x.quality == null));
      for (const s of resolveStacks(r.qty, r.stacks)) {
        const prev = stackMap.get(s.quality);
        const own = s.quality === null ? [] : res.filter((x) => x.quality === s.quality);
        const reservations = [...(prev?.reservations ?? []), ...own];
        const reserved = roundQty(reservations.reduce((t, x) => t + Number(x.amount), 0));
        const qty = roundQty((prev?.qty ?? 0) + s.qty);
        stackMap.set(s.quality, { quality: s.quality, qty, reserved, available: Math.max(0, roundQty(qty - reserved)), reservations });
      }
    }
    const stacks = [...stackMap.values()].sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
    const known = stacks.filter((s) => s.quality !== null);
    const knownQty = roundQty(known.reduce((s, x) => s + x.qty, 0));
    const first = list[0];
    const qty = roundQty(list.reduce((t, r) => t + r.qty, 0));
    const reserved = roundQty(list.reduce((t, r) => t + reservedOf(r), 0));
    out.push({
      key,
      location: by === 'place' ? first.location : '',
      name: first.name,
      className: list.find((r) => r.class_name)?.class_name ?? null,
      unit: first.unit,
      qty,
      reserved,
      available: Math.max(0, roundQty(qty - reserved)),
      anyReservations: any,
      knownQty,
      unknownQty: roundQty(qty - knownQty),
      avg: knownQty > 0 ? Math.round(known.reduce((s, x) => s + (x.quality as number) * x.qty, 0) / knownQty) : null,
      min: known.length ? Math.min(...known.map((s) => s.quality as number)) : null,
      max: known.length ? Math.max(...known.map((s) => s.quality as number)) : null,
      stacks,
    });
  }
  return out.sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
}

/**
 * Takes `amount` out of an item's stacks. With a `quality` that stack shrinks (gone at 0); without, the unknown remainder
 * goes first, then the known stacks from the lowest quality up. Returns the new KNOWN stacks to store (the remainder is
 * implied by the item qty); `qty` is the item total BEFORE the take.
 */
export function takeFromStacks(
  qty: number,
  known: readonly HqInventoryStack[] | null | undefined,
  amount: number,
  quality?: number | null,
): HqInventoryStack[] {
  const stacks = resolveStacks(qty, known);
  let left = roundQty(amount);
  const take = (q: number | null): void => {
    const i = stacks.findIndex((s) => s.quality === q);
    if (i < 0 || left <= 0) return;
    const cut = Math.min(stacks[i].qty, left);
    stacks[i] = { ...stacks[i], qty: roundQty(stacks[i].qty - cut) };
    left = roundQty(left - cut);
  };
  if (quality != null) take(quality);
  else {
    take(null);
    for (const s of [...stacks].filter((x) => x.quality !== null).sort((a, b) => (a.quality as number) - (b.quality as number))) take(s.quality);
  }
  return stacks.filter((s) => s.quality !== null && s.qty > 0);
}

/** One band of the quality diagram. */
export interface QualityBand {
  /** Inclusive band bounds, e.g. 701-800. */
  from: number;
  to: number;
  qty: number;
  reserved: number;
}

/**
 * The bars of "Eisen nach Qualität": amount per band of `width` quality points (default 100: bands 1-100, 101-200 ...
 * 901-1000). Only bands that hold something are returned, ordered best first; the unknown-quality stack is not a band
 * (see {@link QualityAggregate.unknownQty}).
 */
export function qualityBands(stacks: readonly QualityStack[], width = 100): QualityBand[] {
  const w = Math.max(1, Math.floor(width));
  const bands = new Map<number, QualityBand>();
  for (const s of stacks) {
    if (s.quality === null) continue;
    const i = Math.floor((s.quality - 1) / w);
    const b = bands.get(i) ?? { from: i * w + 1, to: Math.min(1000, (i + 1) * w), qty: 0, reserved: 0 };
    bands.set(i, { ...b, qty: roundQty(b.qty + s.qty), reserved: roundQty(b.reserved + s.reserved) });
  }
  return [...bands.values()].sort((a, b) => b.from - a.from);
}

/** "Ø Q 780" for an aggregate with a known quality, else null (the UI shows "Q ?"). */
export function averageLabel(a: Pick<QualityAggregate, 'avg'>): string | null {
  return a.avg === null ? null : `Ø Q ${a.avg}`;
}

/** "612-905" when the range spans more than one quality, "780" when it is one, null when none is known. */
export function rangeLabel(a: Pick<QualityAggregate, 'min' | 'max'>): string | null {
  if (a.min === null || a.max === null) return null;
  return a.min === a.max ? String(a.min) : `${a.min}–${a.max}`;
}
