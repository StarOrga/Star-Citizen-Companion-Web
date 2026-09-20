import { Injectable, computed, signal } from '@angular/core';
import type { FeedbackArea } from './feedback-area.types';

/**
 * What a page hands to a composer it wants pre-filled: text, the area tag,
 * the complexity mark and files to attach. Everything stays EDITABLE in the
 * composer — a seed is a starting point, never a message that goes out on
 * its own; the human still presses send.
 */
export interface ComposerSeed {
  body: string;
  area?: FeedbackArea | null;
  complex?: boolean;
  /** Attached as if picked from disk: images are re-encoded, files ride as-is. */
  files?: File[];
}

/**
 * Hands a pre-filled draft to a feedback composer that may not be on screen
 * yet, and asks the shell to bring it on screen.
 *
 * WHY
 *   The admin telemetry page can turn an uploader run's log diagnostics into
 *   a feedback topic: one click, and the docked feedback panel opens with the
 *   new-topic box holding a prompt, the area tag and the transcript as an
 *   attachment — ready to send, still editable. The page and the composer do
 *   not know each other: the composer lives in the shell's FAB panel and is
 *   only mounted once the panel is open and its "＋ Neues Thema" bar was
 *   pressed. So the seed is parked here by scope (the same key the draft
 *   store uses), and whichever composer next owns that scope takes it.
 *
 * ONE-SHOT
 *   `take` removes the seed. Two composers can share a scope (the full board
 *   at /admin/feedback and the docked panel both use `admin:new`); the first
 *   to mount or notice the seed wins, the other sees nothing — which is what
 *   keeps a seed from being applied twice.
 *
 * OPEN REQUESTS
 *   A counter, like `PanelNavigationService`: the FAB mounts + un-minimizes
 *   the panel on every bump, the embedded board opens its composer. Neither
 *   has to be reset afterwards.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackComposerSeedService {
  private readonly _seeds = signal<ReadonlyMap<string, ComposerSeed>>(new Map());
  private readonly _openRequests = signal(0);

  /** Scopes that currently hold a seed — what a composer watches. */
  readonly pendingScopes = computed(() => new Set(this._seeds().keys()));
  /** Bumped every time a page asks for the admin feedback panel to open. */
  readonly openRequests = this._openRequests.asReadonly();

  /** Park a seed for the composer with this draft scope. Replaces an older one. */
  plant(scope: string, seed: ComposerSeed): void {
    const next = new Map(this._seeds());
    next.set(scope, seed);
    this._seeds.set(next);
  }

  /** Take (and remove) the seed for a scope; null when there is none. */
  take(scope: string): ComposerSeed | null {
    const seed = this._seeds().get(scope) ?? null;
    if (!seed) return null;
    const next = new Map(this._seeds());
    next.delete(scope);
    this._seeds.set(next);
    return seed;
  }

  /** Ask the shell to open the admin feedback panel with its composer unfolded. */
  requestOpen(): void {
    this._openRequests.update((n) => n + 1);
  }
}
