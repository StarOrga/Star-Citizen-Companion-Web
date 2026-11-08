import { availableOf, roundQty } from '../stock/hq-stock-counter';
import type { HqEinsatzStepInput, HqGatherStop, HqStockReservation } from './hq-db.types';

/** A gather line has at most this many stops (mirrors the DB check on hq_supplies.gather). */
export const GATHER_MAX_STOPS = 12;

/** A stack that can feed a gather line. */
export interface GatherSource {
  location: string;
  system?: string | null;
  qty: number;
  quality?: number | null;
  reservations?: readonly HqStockReservation[] | null;
}

/** Largest amount first (the route starts where most lies), ties by place name so the order is stable. */
export function orderByAmount<T extends Pick<HqGatherStop, 'amount' | 'location'>>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => b.amount - a.amount || a.location.localeCompare(b.location));
}

/** Moves the stop at `from` to position `to` (both clamped); returns a new array. Reordering is the user's, so no re-sort. */
export function moveStop<T>(stops: readonly T[], from: number, to: number): T[] {
  const list = [...stops];
  if (from < 0 || from >= list.length) return list;
  const [it] = list.splice(from, 1);
  list.splice(Math.min(Math.max(0, to), list.length), 0, it);
  return list;
}

/**
 * The stops for "need `need` of this item": the FREE amount (not reserved) of each place, largest first, until the
 * need is covered; the last stop takes only the rest. Places that hold nothing free are skipped, the same place is
 * merged over its quality stacks (best quality named). `covered` is false when the stock cannot cover the need.
 */
export function buildGatherStops(sources: readonly GatherSource[], need: number): { stops: HqGatherStop[]; covered: boolean } {
  const perPlace = new Map<string, { location: string; system: string | null; free: number; quality: number | null }>();
  for (const s of sources) {
    const free = availableOf(s);
    if (!(free > 0)) continue;
    const prev = perPlace.get(s.location);
    const q = s.quality ?? null;
    perPlace.set(s.location, {
      location: s.location,
      system: prev?.system ?? s.system ?? null,
      free: roundQty((prev?.free ?? 0) + free),
      quality: prev ? (prev.quality === null ? q : q === null ? prev.quality : Math.max(prev.quality, q)) : q,
    });
  }
  const sorted = orderByAmount([...perPlace.values()].map((p) => ({ ...p, amount: p.free })));
  const stops: HqGatherStop[] = [];
  let left = roundQty(Math.max(0, need));
  for (const p of sorted) {
    if (left <= 0 || stops.length >= GATHER_MAX_STOPS) break;
    const take = Math.min(p.free, left);
    stops.push({ location: p.location, system: p.system, amount: roundQty(take), ...(p.quality !== null ? { quality: p.quality } : {}), done: false });
    left = roundQty(left - take);
  }
  return { stops, covered: left <= 0 };
}

export function gatherProgress(stops: readonly Pick<HqGatherStop, 'done'>[]): { done: number; total: number; complete: boolean } {
  const done = stops.filter((s) => s.done).length;
  return { done, total: stops.length, complete: stops.length > 0 && done === stops.length };
}

/** The next stop to go to: the first one not ticked, null when all are. */
export function nextStop<T extends Pick<HqGatherStop, 'done'>>(stops: readonly T[]): T | null {
  return stops.find((s) => !s.done) ?? null;
}

/** Ticks / unticks the stop at `index` (a new array; out of range = unchanged). */
export function withStopDone(stops: readonly HqGatherStop[], index: number, done: boolean): HqGatherStop[] {
  return stops.map((s, i) => (i === index ? { ...s, done } : s));
}

/** Defensive parse of a stored gather array; null when it holds no usable stop. */
export function parseGather(raw: unknown): HqGatherStop[] | null {
  if (!Array.isArray(raw)) return null;
  const out: HqGatherStop[] = [];
  for (const e of raw.slice(0, GATHER_MAX_STOPS)) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const location = typeof o['location'] === 'string' ? o['location'].trim().slice(0, 200) : '';
    const amount = Number(o['amount']);
    if (!location || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) continue;
    const q = Number(o['quality']);
    out.push({
      location,
      system: typeof o['system'] === 'string' && o['system'] ? o['system'].slice(0, 80) : null,
      amount: roundQty(amount),
      ...(Number.isFinite(q) && q >= 1 && q <= 1000 ? { quality: Math.round(q) } : {}),
      done: o['done'] === true,
    });
  }
  return out.length ? out : null;
}

/**
 * The Einsatz steps of a gather line: one `pickup` step per stop, in route order, each with its own place (a pickup
 * step holds a single place). `qty` is the stop's amount rounded up to whole units; the step label names the item and
 * the exact amount. A ticked stop starts as `done`.
 */
export function gatherToSteps(
  line: { id: string; name: string; className: string | null },
  stops: readonly HqGatherStop[],
): HqEinsatzStepInput[] {
  return stops.map((s) => ({
    kind: 'pickup',
    label: `${line.name} ×${roundQty(s.amount)}`,
    location: s.location,
    system: s.system ?? null,
    class_name: line.className,
    qty: Math.max(1, Math.ceil(s.amount - 1e-9)),
    supply_id: line.id,
    state: s.done ? 'done' : 'todo',
  }));
}
