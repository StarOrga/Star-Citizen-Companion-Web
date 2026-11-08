import type { HqInventorySource } from './hq-db.types';

const SNAPSHOT_SOURCES: readonly HqInventorySource[] = ['log', 'search', 'community', 'ocr', 'manual'];

/** A quality 1..1000 (whole), else null = unknown. */
export function parseQuality(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 1000 ? Math.round(n) : null;
}

export interface PreviousSnapshot {
  location: string;
  system: string | null;
  source: HqInventorySource;
  takenAt: string;
  items: { name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu'; quality: number | null }[];
}

/** Defensive parse of the `previous` snapshot a desktop `inventory.snapshot` event carries. */
export function parsePreviousSnapshot(raw: unknown): PreviousSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  let o = raw as Record<string, unknown>;
  // The desktop writes `{ snapshot: <snapshot row>, items: [<item rows>] }` (docs/contracts/hq-live.md).
  const nested = o['snapshot'];
  if (nested && typeof nested === 'object') o = { ...(nested as Record<string, unknown>), items: o['items'] };
  const location = typeof o['location'] === 'string' ? o['location'].trim().slice(0, 200) : '';
  if (!location) return null;
  const source = SNAPSHOT_SOURCES.find((s) => s === o['source']) ?? 'manual';
  const takenRaw = o['taken_at'] ?? o['takenAt'];
  const takenAt = typeof takenRaw === 'string' && Number.isFinite(Date.parse(takenRaw)) ? takenRaw : new Date().toISOString();
  const items: PreviousSnapshot['items'] = [];
  for (const it of Array.isArray(o['items']) ? (o['items'] as unknown[]).slice(0, 400) : []) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim().slice(0, 160) : '';
    const qty = Number(r['qty']);
    if (!name || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000_000) continue;
    items.push({
      name,
      class_name: typeof r['class_name'] === 'string' && r['class_name'] ? r['class_name'] : null,
      qty,
      unit: r['unit'] === 'scu' ? 'scu' : 'pcs',
      quality: parseQuality(r['quality']),
    });
  }
  return { location, system: typeof o['system'] === 'string' ? o['system'] : null, source, takenAt, items };
}
