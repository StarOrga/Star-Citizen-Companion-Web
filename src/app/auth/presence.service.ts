import { DestroyRef, Injectable, Injector, effect, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';

/** Client-side floor between two `touch_last_seen()` calls (the RPC throttles at 5 min anyway). */
export const PRESENCE_MIN_INTERVAL_MS = 5 * 60_000;
/** Re-touch cadence while the tab stays open and visible. */
export const PRESENCE_TICK_MS = 15 * 60_000;

/**
 * Keeps `profiles.last_seen_at` honest: the admin "last seen" column used to
 * be `auth.users.last_sign_in_at`, which only moves on an actual sign-in —
 * a member who stays signed in for weeks and opens the site daily read as
 * "last active" on the day they typed their password.
 *
 * Three triggers, all funnelled through `touch()` and its client-side floor:
 *   1. a real session appears (boot with a restored session, or sign-in),
 *   2. the tab becomes visible again after being hidden,
 *   3. a slow timer while the tab is open.
 *
 * Always the REAL session — an admin previewing as anon/viewer is still a
 * person using the site, so their own presence keeps ticking.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private initialized = false;
  private lastTouchAt = 0;
  private touchedUserId: string | null = null;
  private inflight: Promise<void> | null = null;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    effect(() => {
      const user = this.auth.realUser();
      if (!user) {
        // Signed out: the next session (even the same account) touches fresh.
        this.touchedUserId = null;
        this.lastTouchAt = 0;
        return;
      }
      if (this.touchedUserId !== user.id) {
        this.touchedUserId = user.id;
        this.lastTouchAt = 0;
      }
      void this.touch();
    }, { injector: this.injector });

    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.touch();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.touch();
    }, PRESENCE_TICK_MS);

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    });
  }

  /**
   * Record "seen now" for the real session's user. No-op without a session,
   * within `PRESENCE_MIN_INTERVAL_MS` of the last call, or while a call is
   * already in flight. Failures are swallowed — presence is best effort and
   * must never surface as an error in the UI.
   */
  async touch(now: number = Date.now()): Promise<void> {
    if (!this.auth.realUser()) return;
    if (this.inflight) return this.inflight;
    if (now - this.lastTouchAt < PRESENCE_MIN_INTERVAL_MS) return;
    this.lastTouchAt = now;
    this.inflight = (async () => {
      try {
        const { error } = await this.sb.realClient.rpc('touch_last_seen');
        // Let the next trigger retry instead of waiting out the floor: a
        // transient failure on boot would otherwise cost the whole interval.
        if (error) this.lastTouchAt = 0;
      } catch {
        this.lastTouchAt = 0;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
