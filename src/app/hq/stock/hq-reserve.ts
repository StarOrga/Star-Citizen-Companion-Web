import type { HqStockReservation } from '../data/hq-db.types';
import type { HqReserveTarget } from '../data/hq-inventory.service';
import { reservationsOf, roundQty } from './hq-stock-counter';
import type { DeckCrate } from './hq-stock-deck';

/**
 * Pure parts of the reservation dialog (D2 / I8, concept 20261108-2135, R2 `q-reserve` friend + text + notify + expire).
 * The dialog feeds the field values in and gets the {@link HqReserveTarget} and amounts out; the service enforces the rest.
 */

/** A reservation of a container with its index in the stored row list (what `endReservation` wants). */
export interface IndexedReservation extends HqStockReservation {
  readonly index: number;
}

/** The row's reservations in stored order, each with its list index; ones without an id (not stored yet) are kept. */
export function indexedReservations(row: { reservations?: readonly HqStockReservation[] | null } | undefined): IndexedReservation[] {
  return row ? reservationsOf(row).map((r, index) => ({ ...r, index })) : [];
}

/** `YYYY-MM-DD` from a date field → the ISO instant at the end of that local day; blank or invalid → null (open-ended). */
export function expiryFromField(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO instant → `YYYY-MM-DD` of the local day (for the date field), '' when none. */
export function expiryToField(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface ReserveForm {
  readonly friendId: string | null;
  readonly note: string;
  readonly quality: number | null;
  readonly expiryDay: string;
}

/** The target the service takes: a friend or a text must be there; the quality and expiry are optional. */
export function reserveTarget(f: ReserveForm): HqReserveTarget | null {
  const note = f.note.trim();
  if (!f.friendId && !note) return null;
  return { note, friendId: f.friendId, quality: f.quality, expiresAt: expiryFromField(f.expiryDay) };
}

/** What a new reservation can take: the quality stack's free amount when one is named, else the container's free amount. */
export function freeForQuality(c: DeckCrate, quality: number | null): number {
  if (quality === null) return c.available;
  const s = c.stacks.find((x) => x.quality === quality);
  return s ? Math.min(c.available, s.available) : 0;
}

/** The amount a multi-selection reserves per container: its whole free amount (nothing to edit per piece). */
export const defaultAmount = (c: DeckCrate, quality: number | null = null): number => roundQty(freeForQuality(c, quality));

/** Friends that hold a reservation among the containers, with how many containers each is on (filter "Reserviert" by friend). */
export function reservationFriends(crates: readonly DeckCrate[]): { id: string; count: number }[] {
  const by = new Map<string, number>();
  for (const c of crates) {
    const ids = new Set([...c.anyReservations, ...c.stacks.flatMap((s) => s.reservations)].map((r) => r.friendId).filter((x): x is string => !!x));
    for (const id of ids) by.set(id, (by.get(id) ?? 0) + 1);
  }
  return [...by].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
