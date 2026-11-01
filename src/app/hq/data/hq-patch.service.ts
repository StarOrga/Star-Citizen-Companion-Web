import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { hqSet, hqShip } from '../hq-routes';
import type { HqPatchLine } from '../start/hq-start.component';
import { HqStartFeedService } from '../start/hq-start-feed.service';
import type { HqFleetPatch } from './hq-db.types';

export const HQ_PATCH_LINES_MAX = 2;

/** Signed percent: real minus sign, decimal comma, non-breaking space before the percent sign. */
export function formatPct(pct: number): string {
  const abs = Math.abs(pct);
  const num = (Number.isInteger(abs) ? String(abs) : abs.toFixed(1)).replace('.', ',');
  return `${pct < 0 ? '\u2212' : '+'}${num}\u00a0%`;
}

/**
 * Maps the RPC result to the Start lines: category "4.3.1 · S3-Repeater \u22128 %", effect
 * "betrifft {set} ›" (via `affects`) linked to the set (ship loadout → ship page, FPS set →
 * locker). A line without a set keeps only the category.
 */
export function mapPatchLines(patch: HqFleetPatch | null, affects: (set: string) => string): HqPatchLine[] {
  if (!patch || !patch.lines?.length) return [];
  return patch.lines.slice(0, HQ_PATCH_LINES_MAX).map((l) => {
    const head = [patch.build, `${l.class_name} ${formatPct(l.pct)}`].filter(Boolean).join(' · ');
    const link = l.set_id ? (l.set_kind === 'fps' ? hqSet(l.set_id) : hqShip(l.set_id)) : undefined;
    return { category: head, effect: l.set_name ? affects(l.set_name) : '', ...(link ? { link } : {}) };
  });
}

/**
 * Newest patch vs the reader's own ships/sets (P8). Loads `hq_fleet_patch()` once per user and
 * feeds {@link HqStartFeedService.patchLines}; nothing relevant or a failure clears the lines
 * (a patch hint is never worth an error state on the Start page).
 */
@Injectable({ providedIn: 'root' })
export class HqPatchService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly feed = inject(HqStartFeedService);
  private readonly i18n = inject(TranslateService);

  readonly patch = signal<HqFleetPatch | null>(null);
  readonly error = signal<string | null>(null);

  private loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const uid = this.auth.user()?.id ?? null;
      untracked(() => {
        if (!uid) {
          this.loadedFor = null;
          this.patch.set(null);
          this.feed.patchLines.set([]);
        } else if (this.loadedFor !== uid) {
          void this.load();
        }
      });
    });
  }

  async load(): Promise<void> {
    const uid = this.auth.user()?.id ?? null;
    if (!uid) return;
    this.loadedFor = uid;
    this.error.set(null);
    try {
      const { data, error } = await this.sb.client.rpc('hq_fleet_patch' as never);
      if (error) throw error;
      const patch = (data ?? null) as HqFleetPatch | null;
      this.patch.set(patch);
      this.feed.patchLines.set(
        mapPatchLines(patch, (set) => this.i18n.instant('hq.patch.affects', { set })),
      );
    } catch (err) {
      this.loadedFor = null;
      this.error.set(toErrorKey('hq', 'patch.load', err));
      this.feed.patchLines.set([]);
    }
  }
}
