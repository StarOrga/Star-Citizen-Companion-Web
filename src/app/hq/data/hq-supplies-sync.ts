/**
 * Pure helpers of the HQ last-write-wins sync (hq_supplies, hq_einsaetze). The server trigger
 * `hq_sync_before_write` skips a stale upsert, so the client only has to (1) push its dirty rows,
 * (2) pull everything with `synced_at` above its watermark and (3) merge by `updatedAt`.
 */

export interface SyncRow {
  readonly id: string;
  /** Client edit time, ISO. The LWW key. */
  readonly updatedAt: string;
  /** Tombstone, ISO, or null. */
  readonly deletedAt: string | null;
  /** Local change not yet accepted by the server. */
  readonly dirty: boolean;
}

export function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Merge freshly pulled rows into the local ones. A dirty local row that is newer than (or as new
 * as) the remote one stays; otherwise the remote row wins and is clean. Clean tombstones are
 * dropped afterwards - a deletion has reached this device and nothing needs to remember it.
 * Order: existing local order first, new remote rows after, by creation order of the pull.
 */
export function mergePulled<T extends SyncRow>(local: readonly T[], remote: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const l of local) byId.set(l.id, l);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || !l.dirty || ms(r.updatedAt) > ms(l.updatedAt)) byId.set(r.id, { ...r, dirty: false });
  }
  return [...byId.values()].filter((r) => r.dirty || r.deletedAt === null);
}

/** Clear the dirty flag of rows that were pushed unchanged (an edit during the push stays dirty). */
export function markPushed<T extends SyncRow>(rows: readonly T[], pushed: ReadonlyMap<string, string>): T[] {
  return rows
    .map((r) => (r.dirty && pushed.get(r.id) === r.updatedAt ? { ...r, dirty: false } : r))
    .filter((r) => r.dirty || r.deletedAt === null);
}

/** Highest `synced_at` of a pulled batch (the next watermark), or the previous one. */
export function nextWatermark(previous: string | null, syncedAt: readonly string[]): string | null {
  let best = previous;
  for (const s of syncedAt) if (best === null || ms(s) > ms(best)) best = s;
  return best;
}

export function newClientId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
}
