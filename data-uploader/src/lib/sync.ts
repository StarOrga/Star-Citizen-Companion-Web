/**
 * Server-state sync — pulls the bundle catalog the operator can already see in
 * the web app (RPC `list_p4k_bundles_for_collaborator`) so the desktop tile can
 * show, at a glance, what the server currently holds per channel. Runs in the
 * MAIN process (like uploader.ts); progress is streamed to the renderer so the
 * tile fills in as channels are folded in.
 *
 * This is the first, lightweight consumer of the generic resumable / keep-latest
 * sync infrastructure (see version-store.ts). A future bulk-data download (needs
 * a dedicated paginated endpoint) plugs into the same progress + snapshot shape.
 */

export type ChannelTag = 'live' | 'ptu' | 'eptu' | 'tech-preview' | 'unknown';

export interface ChannelState {
  channel: ChannelTag;
  patchVersion: string;
  buildNumber: string;
  qualityScore: number | null;
  entityTotal: number;
  bundleId: string;
  createdAt: string;
}

export interface CatalogSnapshot {
  /** Unix seconds when the sync completed. */
  syncedAt: number;
  channels: ChannelState[];
  bundleCount: number;
}

export interface SyncProgress {
  phase: 'connecting' | 'fetching' | 'processing' | 'saving' | 'done' | 'error';
  /** 0..100 */
  pct: number;
  message?: string;
  /** Channel label currently being folded in (drives the "parts build up"). */
  channel?: string;
}

interface RawBundleRow {
  id: string;
  channel: string;
  patch_version: string;
  build_number: string;
  quality_score: number | null;
  entity_counts: Record<string, unknown> | null;
  created_at: string;
}

type FetchLike = typeof fetch;

export interface SyncOptions {
  apiBase: string;
  anonKey: string;
  accessToken: string;
  onProgress?: (p: SyncProgress) => void;
  fetchImpl?: FetchLike;
  /** Injectable clock (Unix seconds) for deterministic tests. */
  now?: () => number;
}

export interface SyncResult {
  ok: boolean;
  snapshot?: CatalogSnapshot;
  error?: string;
}

const CHANNEL_ORDER: ChannelTag[] = ['live', 'ptu', 'eptu', 'tech-preview', 'unknown'];

export async function syncServerCatalog(opts: SyncOptions): Promise<SyncResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const emit = (p: SyncProgress): void => opts.onProgress?.(p);

  emit({ phase: 'connecting', pct: 5 });

  const endpoint = `${opts.apiBase}/rest/v1/rpc/list_p4k_bundles_for_collaborator`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    emit({ phase: 'fetching', pct: 20, message: 'catalog' });
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: opts.anonKey,
        authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify({ include_history: false, include_disabled: false }),
    });
  } catch (err) {
    const msg = (err as Error).message;
    emit({ phase: 'error', pct: 100, message: msg });
    return { ok: false, error: msg };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = (body['message'] as string | undefined) ?? `HTTP ${res.status}`;
    emit({ phase: 'error', pct: 100, message: msg });
    return { ok: false, error: msg };
  }

  const rows = (await res.json().catch(() => [])) as RawBundleRow[];
  emit({ phase: 'processing', pct: 50, message: String(rows.length) });

  // Keep only the latest (most recent) bundle per channel — "nur die letzten
  // speicherwürdig". RPC returns newest-first, but sort defensively.
  const latestByChannel = new Map<ChannelTag, ChannelState>();
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  let processed = 0;
  for (const row of sorted) {
    processed += 1;
    const channel = normalizeChannel(row.channel);
    if (!latestByChannel.has(channel)) {
      latestByChannel.set(channel, {
        channel,
        patchVersion: row.patch_version,
        buildNumber: row.build_number,
        qualityScore: row.quality_score,
        entityTotal: sumEntityCounts(row.entity_counts),
        bundleId: row.id,
        createdAt: row.created_at,
      });
      emit({
        phase: 'processing',
        pct: Math.min(95, 50 + Math.round((processed / Math.max(1, sorted.length)) * 45)),
        channel,
      });
    }
  }

  const channels = CHANNEL_ORDER.filter((c) => latestByChannel.has(c)).map(
    (c) => latestByChannel.get(c) as ChannelState,
  );
  const snapshot: CatalogSnapshot = { syncedAt: now(), channels, bundleCount: rows.length };

  emit({ phase: 'saving', pct: 98 });
  emit({ phase: 'done', pct: 100 });
  return { ok: true, snapshot };
}

function normalizeChannel(raw: string): ChannelTag {
  const v = (raw ?? '').toLowerCase();
  if (v === 'live' || v === 'ptu' || v === 'eptu' || v === 'tech-preview') return v;
  return 'unknown';
}

function sumEntityCounts(counts: Record<string, unknown> | null): number {
  if (!counts) return 0;
  let total = 0;
  for (const value of Object.values(counts)) {
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
  }
  return total;
}
