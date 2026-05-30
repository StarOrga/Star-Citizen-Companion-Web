import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';

export type ChannelTag = 'live' | 'ptu' | 'eptu' | 'tech-preview' | 'unknown';

export interface BundleDiffSummary {
  prev_id: string;
  new_id: string;
  count_diffs?: Record<string, { prev: number; new: number; delta: number }>;
  summary?: { entities_added: number; entities_removed: number };
}

/** Row shape returned by the `list_p4k_bundles_for_collaborator` RPC. */
export interface P4kBundleRow {
  id: string;
  channel: ChannelTag;
  patch_version: string;
  build_number: string;
  schema_version: number;
  quality_score: number | null;
  entity_counts: Record<string, unknown> | null;
  diff_summary: BundleDiffSummary | null;
  disabled: boolean;
  disabled_reason: string | null;
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
  readonly includeHistory = signal(false);
  readonly includeDisabled = signal(false);

  async listBundles(): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('list_p4k_bundles_for_collaborator', {
      include_history: this.includeHistory(),
      include_disabled: this.includeDisabled(),
    });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      this.bundles.set((data ?? []) as P4kBundleRow[]);
    }
    this.busy.set(false);
  }

  async setDisabled(bundleId: string, disabled: boolean, reason: string | null): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.rpc('set_bundle_disabled', {
      bundle_id: bundleId,
      new_disabled: disabled,
      reason: reason,
    });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      await this.listBundles();
    }
    this.busy.set(false);
  }

  async deleteBundle(bundleId: string): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.rpc('delete_p4k_bundle', {
      bundle_id: bundleId,
    });
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      await this.listBundles();
    }
    this.busy.set(false);
  }

  toggleHistory(): void {
    this.includeHistory.set(!this.includeHistory());
    void this.listBundles();
  }

  toggleDisabled(): void {
    this.includeDisabled.set(!this.includeDisabled());
    void this.listBundles();
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
