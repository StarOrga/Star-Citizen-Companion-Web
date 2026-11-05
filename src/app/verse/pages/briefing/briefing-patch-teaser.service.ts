import { Injectable, inject, signal } from '@angular/core';
import { logWarn } from '../../../core/log';
import { SupabaseClientProvider } from '../../../core/supabase.client';
import type { PatchTeasers } from './briefing-patch-title';

/**
 * AI teaser titles for patch versions (`patch_teasers`, written by the
 * `patch-teaser` edge function). One read per page load; any failure only logs
 * and leaves the map empty, so every patch title stays on "Neues in <version>".
 */
@Injectable({ providedIn: 'root' })
export class PatchTeaserService {
  private readonly sb = inject(SupabaseClientProvider);
  readonly teasers = signal<PatchTeasers>({});
  private started = false;

  async load(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const { data, error } = await this.sb.client
        .from('patch_teasers')
        .select('version, title_de, title_en')
        .order('generated_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      const out: Record<string, { de: string; en: string }> = {};
      for (const r of data ?? []) {
        const row = r as Record<string, unknown>;
        const version = String(row['version'] ?? '');
        if (version) out[version] = { de: String(row['title_de'] ?? ''), en: String(row['title_en'] ?? '') };
      }
      this.teasers.set(out);
    } catch (err) {
      logWarn('verse', 'patch teasers unavailable', err);
    }
  }
}
