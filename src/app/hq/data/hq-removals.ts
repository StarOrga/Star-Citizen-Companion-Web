import type { HqInventoryRemovalRow, HqLiveEventRow, HqRemovalKind } from './hq-db.types';
import { parsePreviousSnapshot } from './hq-snapshot';
import { itemIdentity } from './hq-quality';

/** "Zuletzt aufgebraucht" shows this many removals. */
export const LAST_REMOVALS = 10;

/** One removal from the Bestand, whoever caused it. */
export interface Removal {
  /** Stable id for `@for` tracking. */
  readonly key: string;
  readonly at: string;
  readonly location: string;
  readonly name: string;
  readonly className: string | null;
  readonly qty: number;
  readonly unit: 'pcs' | 'scu';
  readonly quality: number | null;
  /** `snapshot` = the stock fell between two desktop snapshots of the place. */
  readonly kind: HqRemovalKind | 'snapshot';
}

/** The stock rows a snapshot drop is measured against. */
interface StockRef {
  location: string;
  name: string;
  class_name: string | null;
  qty: number;
}

/**
 * The last `limit` removals, newest first, independent of sessions and of any time window:
 *  - every manual removal (`hq_inventory_removals`), and
 *  - every drop the desktop's replaced snapshots show (`inventory.snapshot` event, `applied.previous` = the stock
 *    BEFORE; whatever of it is missing or lower now at that place was used up). Per place and item only the newest
 *    replaced snapshot counts, so two snapshots of one place never report the same drop twice. Undone events are
 *    skipped.
 */
export function lastRemovals(
  manual: readonly HqInventoryRemovalRow[],
  eventsNewestFirst: readonly Pick<HqLiveEventRow, 'id' | 'type' | 'at' | 'applied' | 'undone'>[],
  current: readonly StockRef[],
  limit: number = LAST_REMOVALS,
): Removal[] {
  const out: Removal[] = manual.map((m) => ({
    key: `m:${m.id}`,
    at: m.at,
    location: m.location,
    name: m.name,
    className: m.class_name,
    qty: m.qty,
    unit: m.unit,
    quality: m.quality ?? null,
    kind: m.kind,
  }));

  const have = new Map<string, number>();
  for (const r of current) {
    const k = `${r.location}\u0000${itemIdentity(r)}`;
    have.set(k, (have.get(k) ?? 0) + r.qty);
  }
  const seen = new Set<string>();
  for (const ev of eventsNewestFirst) {
    if (ev.type !== 'inventory.snapshot' || ev.undone || !Number.isFinite(Date.parse(ev.at))) continue;
    const prev = parsePreviousSnapshot((ev.applied as Record<string, unknown> | null)?.['previous']);
    if (!prev) continue;
    // Quality stacks of one item in the replaced snapshot add up: the drop is measured per place and item.
    const before = new Map<string, { name: string; className: string | null; unit: 'pcs' | 'scu'; qty: number }>();
    for (const it of prev.items) {
      const id = itemIdentity(it);
      const b = before.get(id);
      before.set(id, { name: it.name, className: it.class_name, unit: it.unit, qty: (b?.qty ?? 0) + it.qty });
    }
    for (const [id, b] of before) {
      const k = `${prev.location}\u0000${id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const dropped = b.qty - (have.get(k) ?? 0);
      if (dropped <= 1e-9) continue;
      out.push({
        key: `s:${ev.id}:${id}`,
        at: ev.at,
        location: prev.location,
        name: b.name,
        className: b.className,
        qty: Math.round(dropped * 1e6) / 1e6,
        unit: b.unit,
        quality: null,
        kind: 'snapshot',
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key)).slice(0, Math.max(0, limit));
}
