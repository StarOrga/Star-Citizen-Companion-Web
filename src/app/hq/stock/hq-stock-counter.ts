import type { HqStockReservation } from '../data/hq-db.types';

/** Longest reservation note ("Spieler X", "Verkauf an …"). */
export const RESERVATION_NOTE_MAX = 120;
/** Reservations per row (mirrors the DB check). */
export const RESERVATIONS_MAX = 50;

/** Amounts are SCU fractions too: trimmed to 6 decimals (float noise). */
export const roundQty = (n: number): number => Math.round(n * 1e6) / 1e6;

/** A row's reservations, defensive against a missing column or a malformed entry. */
export function reservationsOf(row: { reservations?: readonly HqStockReservation[] | null }): HqStockReservation[] {
  const list = Array.isArray(row.reservations) ? row.reservations : [];
  return list.filter((r) => !!r && Number.isFinite(Number(r.amount)) && Number(r.amount) > 0);
}

export function reservedOf(row: { reservations?: readonly HqStockReservation[] | null }): number {
  return roundQty(reservationsOf(row).reduce((s, r) => s + Number(r.amount), 0));
}

/** What can still be handed out: amount minus reservations, never below zero. */
export function availableOf(row: { qty: number; reservations?: readonly HqStockReservation[] | null }): number {
  return Math.max(0, roundQty(row.qty - reservedOf(row)));
}

/** A positive, finite amount from a field, else null. Pieces are whole numbers. */
export function parseAmount(raw: unknown, unit: 'pcs' | 'scu'): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const v = unit === 'pcs' ? Math.round(n) : roundQty(n);
  return v > 0 ? v : null;
}

/**
 * Taking `amount` out of a row. Free stock goes first; when the take-out eats into reserved stock,
 * the newest reservations shrink first (they are the least committed). Returns the new amount and
 * reservations; `qty` 0 means the row goes.
 */
export function takeOut(
  qty: number,
  reservations: readonly HqStockReservation[],
  amount: number,
): { qty: number; reservations: HqStockReservation[] } {
  const next = Math.max(0, roundQty(qty - amount));
  const list = [...reservations];
  let over = roundQty(list.reduce((s, r) => s + r.amount, 0) - next);
  for (let i = list.length - 1; i >= 0 && over > 0; i--) {
    const cut = Math.min(list[i].amount, over);
    over = roundQty(over - cut);
    const left = roundQty(list[i].amount - cut);
    if (left > 0) list[i] = { ...list[i], amount: left };
    else list.splice(i, 1);
  }
  return { qty: next, reservations: list };
}
