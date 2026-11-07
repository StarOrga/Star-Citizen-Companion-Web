import { BetaService } from '../../core/beta.service';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqLink, hqHangar, hqSet, ownVariantLink } from '../hq-routes';
import { HqPatchHit, HqStartFeedService } from '../start/hq-start-feed.service';
import type { HqFleetPatch } from './hq-db.types';

/**
 * The most important hit for the Start hero. The RPC returns its lines biggest change first, so that
 * is the first line; a line without a set stays plain text in the hero.
 *
 * A ship set's `set_id` is a VARIANT (config) id, not a hangar ship id: `variantLink` turns it into
 * that variant on the ship (HQ page under the shell beta, else its personal Codex view). A variant the reader's index does not know falls
 * back to the hangar list — never to `/hq/hangar/:id`, which looks up ship ids.
 */
export function mapPatchHit(
  patch: HqFleetPatch | null,
  variantLink: (configId: string) => HqLink | null = () => null,
): HqPatchHit | null {
  const l = patch?.lines?.[0];
  if (!l) return null;
  let link: string[] | undefined;
  let linkQuery: Record<string, string> | undefined;
  if (l.set_id && l.set_kind === 'fps') {
    link = hqSet(l.set_id);
  } else if (l.set_id) {
    const own = variantLink(l.set_id);
    link = own ? own.commands : [hqHangar];
    if (own) linkQuery = own.queryParams;
  }
  return {
    plan: l.set_name || null,
    build: patch?.build || null,
    name: l.class_name.replace(/_/g, ' ').trim(),
    pct: Math.abs(l.pct),
    weaker: l.pct < 0,
    ...(link ? { link } : {}),
    ...(linkQuery ? { linkQuery } : {}),
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
  private readonly ownership = inject(HqOwnershipService);
  private readonly shellBeta = inject(BetaService).isEnabled('shell');

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
      // The ownership index resolves a ship set's variant id to its ship; it never throws.
      const [{ data, error }] = await Promise.all([
        this.sb.client.rpc('hq_fleet_patch' as never),
        this.ownership.ensureLoaded(),
      ]);
      if (error) throw error;
      const patch = (data ?? null) as HqFleetPatch | null;
      this.patch.set(patch);
      this.feed.patchHit.set(mapPatchHit(patch, (id) => this.variantLink(id)));
    } catch (err) {
      this.loadedFor = null;
      this.error.set(toErrorKey('hq', 'patch.load', err));
      this.feed.patchHit.set(null);
    }
  }

  /** The HQ page (shell beta) or personal Codex view of one of the reader's variants, or null when the index does not know it. */
  private variantLink(configId: string): HqLink | null {
    const cfg = this.ownership.configById(configId);
    if (!cfg) return null;
    for (const e of this.ownership.index().values()) {
      if (e.ship?.id === cfg.hangarShipId) return ownVariantLink(e.ship, cfg.id, this.shellBeta());
    }
    return null;
  }
}
