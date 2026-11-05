import { DestroyRef, Injectable, Injector, effect, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { logWarn } from '../core/log';
import { SupabaseClientProvider } from '../core/supabase.client';

/**
 * Cadence of `touch_presence()` while a tab is visible. "Online" means seen
 * within 5 minutes, so this has to stay well under that; the RPC itself writes
 * at most once per 2 minutes.
 */
export const SOCIAL_PRESENCE_TICK_MS = 3 * 60_000;

/**
 * Backs "which friends are online" and the active-day counter (`user_presence`).
 * Separate from PresenceService on purpose: that one keeps the admin's "last
 * seen" on a 15-minute cadence, too slow for a 5-minute online window, and
 * rewrites the much wider `profiles` row.
 *
 * A hidden tab does not tick, so a forgotten background tab does not read as
 * online. Failures are swallowed: presence is best effort and never surfaces.
 */
@Injectable({ providedIn: 'root' })
export class SocialPresenceService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private initialized = false;
  private inflight: Promise<void> | null = null;

  /** Called once at app start, next to `PresenceService.init()`. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    effect(() => {
      if (this.auth.realUser()) void this.touch();
    }, { injector: this.injector });

    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.touch();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onVisible, SOCIAL_PRESENCE_TICK_MS);

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    });
  }

  async touch(): Promise<void> {
    if (!this.auth.realUser()) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const { error } = await this.sb.realClient.rpc('touch_presence' as never);
        if (error) logWarn('social', 'touch_presence failed', error);
      } catch (error) {
        logWarn('social', 'touch_presence failed', error);
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
