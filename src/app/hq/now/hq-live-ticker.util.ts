import type { HqLiveEventRow } from '../data/hq-db.types';
import type { HqPageId } from '../hq-routes';

/** The event types that matter on a page ("was als letztes hierzu aufgenommen wurde"). */
const RELEVANT: Readonly<Partial<Record<HqPageId, readonly string[]>>> = {
  inventar: ['inventory.snapshot', 'inventory.opened', 'shop.purchase', 'refinery.complete'],
  jetzt: ['shop.purchase', 'refinery.complete', 'contract.completed', 'qt.arrived', 'inventory.snapshot'],
  planen: ['shop.purchase', 'contract.completed', 'refinery.complete'],
  statistik: ['contract.completed', 'shop.purchase', 'qt.arrived'],
};

/**
 * The last event that is relevant for a page (events newest first), else the newest event of any type, else null.
 * "Immer das letzte relevante": the ticker never goes empty while the app ever reported something.
 */
export function lastRelevantEvent<E extends Pick<HqLiveEventRow, 'type'>>(eventsNewestFirst: readonly E[], page: HqPageId | null): E | null {
  const types = (page && RELEVANT[page]) || [];
  return eventsNewestFirst.find((e) => types.includes(e.type)) ?? eventsNewestFirst[0] ?? null;
}

export interface TickerAge {
  readonly unit: 'now' | 'minutes' | 'hours' | 'day' | 'days';
  readonly n: number;
}

/** Coarse age of an ISO timestamp; a future or invalid one reads as "just now". One day has its own unit ("vor 1 Tag"). */
export function tickerAge(iso: string, now: number): TickerAge {
  const t = Date.parse(iso);
  const ms = Number.isFinite(t) ? Math.max(0, now - t) : 0;
  if (ms < 60_000) return { unit: 'now', n: 0 };
  if (ms < 3_600_000) return { unit: 'minutes', n: Math.floor(ms / 60_000) };
  if (ms < 86_400_000) return { unit: 'hours', n: Math.floor(ms / 3_600_000) };
  const days = Math.floor(ms / 86_400_000);
  return { unit: days === 1 ? 'day' : 'days', n: days };
}

