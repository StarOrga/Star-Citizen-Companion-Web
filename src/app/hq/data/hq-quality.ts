import { availableOf, reservedOf, roundQty } from '../stock/hq-stock-counter';
import type { HqStockReservation } from './hq-db.types';

/** The fields of an inventory stack the quality helpers read. */
export interface QualityRow {
  location: string;
  name: string;
  class_name: string | null;
  qty: number;
  unit: 'pcs' | 'scu';
  quality?: number | null;
  reservations?: readonly HqStockReservation[] | null;
}

/** One stack of an item at a place. */
export interface QualityStack {
  /** 1..1000, null = unknown. */
  quality: number | null;
  qty: number;
  reserved: number;
  available: number;
  /** The reservations on it, for the hover (amount + note/friend + exact quality). */
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
  reserved: number;
  available: number;
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

/** The identity of an item across places and qualities: class name when there is one, else the name. */
export function itemIdentity(r: Pick<QualityRow, 'class_name' | 'name'>): string {
  return (r.class_name || r.name).trim().toLowerCase();
}

/**
 * Aggregates stacks per place and item (`by: 'place'`, the Frachtdeck container) or per item over all places
 * (`by: 'item'`, the detail "Eisen nach Qualität"). Zero or negative stacks are skipped. Order: place, then name.
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
    for (const r of list) {
      const q = r.quality ?? null;
      const prev = stackMap.get(q);
      const reservations = [...(prev?.reservations ?? []), ...(r.reservations ?? [])];
      const qty = roundQty((prev?.qty ?? 0) + r.qty);
      stackMap.set(q, {
        quality: q,
        qty,
        reserved: roundQty((prev?.reserved ?? 0) + reservedOf(r)),
        available: roundQty((prev?.available ?? 0) + availableOf(r)),
        reservations,
      });
    }
    const stacks = [...stackMap.values()].sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
    const known = stacks.filter((s) => s.quality !== null);
    const knownQty = roundQty(known.reduce((s, x) => s + x.qty, 0));
    const first = list[0];
    out.push({
      key,
      location: by === 'place' ? first.location : '',
      name: first.name,
      className: list.find((r) => r.class_name)?.class_name ?? null,
      unit: first.unit,
      qty: roundQty(stacks.reduce((s, x) => s + x.qty, 0)),
      reserved: roundQty(stacks.reduce((s, x) => s + x.reserved, 0)),
      available: roundQty(stacks.reduce((s, x) => s + x.available, 0)),
      knownQty,
      unknownQty: roundQty(stacks.filter((s) => s.quality === null).reduce((s, x) => s + x.qty, 0)),
      avg: knownQty > 0 ? Math.round(known.reduce((s, x) => s + (x.quality as number) * x.qty, 0) / knownQty) : null,
      min: known.length ? Math.min(...known.map((s) => s.quality as number)) : null,
      max: known.length ? Math.max(...known.map((s) => s.quality as number)) : null,
      stacks,
    });
  }
  return out.sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
}

/** One band of the quality diagram. */
export interface QualityBand {
  /** Inclusive band bounds, e.g. 700-799. */
  from: number;
  to: number;
  qty: number;
  reserved: number;
}

/**
 * The bars of "Eisen nach Qualität": amount per band of `width` quality points (default 100: 1-99 would make a
 * lopsided first band, so bands are 1-100, 101-200 ... 901-1000). Only bands that hold something are returned,
 * ordered best first; the unknown-quality stack is not a band (see {@link QualityAggregate.unknownQty}).
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
