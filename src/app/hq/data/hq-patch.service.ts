import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { hqSet, hangarRedirectLink } from '../hq-routes';
import { HqPatchHit, HqStartFeedService } from '../start/hq-start-feed.service';
import type { HqFleetPatch } from './hq-db.types';

/**
 * The most important hit for the Start hero. The RPC returns its lines biggest change first, so that
 * is the first line; a line without a set stays plain text in the hero.
 */
export function mapPatchHit(patch: HqFleetPatch | null): HqPatchHit | null {
  const l = patch?.lines?.[0];
  if (!l) return null;
  const link = l.set_id ? (l.set_kind === 'fps' ? hqSet(l.set_id) : hangarRedirectLink(l.set_id)) : undefined;
  return {
    plan: l.set_name || null,
    build: patch?.build || null,
    name: l.class_name.replace(/_/g, ' ').trim(),
    pct: Math.abs(l.pct),
    weaker: l.pct < 0,
    ...(link ? { link } : {}),
  };
}

/**
 * Newest patch vs the reader's own ships/sets (P8). Loads `hq_fleet_patch()` once per user and
 * feeds {@link HqStartFeedService.patchHit}; nothing relevant or a failure clears the hit
 * (a patch hint is never worth an error state on the Start page).
 */
@Injectable({ providedIn: 'root' })
export class HqPatchService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly feed = inject(HqStartFeedService);

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
          this.feed.patchHit.set(null);
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
      this.feed.patchHit.set(mapPatchHit(patch));
    } catch (err) {
      this.loadedFor = null;
      this.error.set(toErrorKey('hq', 'patch.load', err));
      this.feed.patchHit.set(null);
    }
  }
}
