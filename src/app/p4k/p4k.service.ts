import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';

export type ChannelTag = 'live' | 'ptu' | 'eptu' | 'tech-preview' | 'unknown';

/** Row shape returned by the `list_p4k_bundles_for_collaborator` RPC. */
export interface P4kBundleRow {
  id: string;
  channel: ChannelTag;
  patch_version: string;
  schema_version: number;
  quality_score: number | null;
  entity_counts: Record<string, unknown> | null;
  tool_version: string | null;
  uploaded_by_id: string;
  uploaded_by_email: string;
  uploaded_by_name: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class P4kService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly bundles = signal<P4kBundleRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  async listBundles(): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('list_p4k_bundles_for_collaborator');
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      this.bundles.set(((data ?? []) as P4kBundleRow[]));
    }
    this.busy.set(false);
  }
}

// ============================================================
// Filename heuristics — kept for the desktop tool's filename probe
// and any future legacy-table cleanup view. Pure helpers, no I/O.
// ============================================================

const CHANNEL_RX = /(?:^|[\\/_\-\.\s])(live|ptu|eptu|tech-?preview)(?:[\\/_\-\.\s]|$)/i;
const VERSION_RX = /(\d+\.\d+(?:\.\d+)?(?:[-_]?[a-z]+\d*)?)/i;

export function detectChannel(name: string): ChannelTag {
  const match = name.match(CHANNEL_RX);
  if (!match) return 'unknown';
  const tag = match[1].toLowerCase().replace(/^techpreview$/, 'tech-preview');
  if (tag === 'live' || tag === 'ptu' || tag === 'eptu' || tag === 'tech-preview') return tag;
  return 'unknown';
}

export function detectVersion(name: string): string | null {
  const match = name.match(VERSION_RX);
  return match ? match[1] : null;
}
