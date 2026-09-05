import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { moderationErrorKey } from './moderation.types';

/**
 * The admin side of moderation (migration 20260904020000).
 *
 * All four calls are `is_admin()`-gated SECURITY DEFINER RPCs, and all four
 * route through `moderation_target()`, which refuses self, admins and
 * protected accounts before anything is written. Nothing here passes an actor
 * — the server takes it from `auth.uid()`.
 *
 * `realClient`, not `client`: moderation must act as the real admin, never as
 * whoever an active "view as" preview is pretending to be.
 */
@Injectable({ providedIn: 'root' })
export class ModerationService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly busy = signal(false);
  /** i18n KEY of the last failure, or null. */
  readonly error = signal<string | null>(null);

  /** The "grace period with info to the user" branch — no access is removed. */
  async warn(userId: string, message: string): Promise<boolean> {
    return this.run(async () => {
      const { error } = await this.sb.realClient.rpc('warn_user', {
        target: userId,
        message: message.trim(),
      });
      if (error) throw error;
      return true;
    });
  }

  /** `days = null` suspends indefinitely, i.e. until an admin lifts it. */
  async suspend(userId: string, reason: string, days: number | null): Promise<boolean> {
    return this.run(async () => {
      const { error } = await this.sb.realClient.rpc('suspend_user', {
        target: userId,
        reason: reason.trim(),
        days,
      });
      if (error) throw error;
      return true;
    });
  }

  async unsuspend(userId: string, note = ''): Promise<boolean> {
    return this.run(async () => {
      const { error } = await this.sb.realClient.rpc('unsuspend_user', {
        target: userId,
        note: note.trim() || null,
      });
      if (error) throw error;
      return true;
    });
  }

  /**
   * Closes every open report against one account. `dismiss` records which way
   * it went; either way the reporter/target slot frees up, so the same
   * account can be reported again if the behaviour continues.
   */
  async resolveReports(userId: string, dismiss: boolean): Promise<boolean> {
    return this.run(async () => {
      const { error } = await this.sb.realClient.rpc('resolve_reports_for_user', {
        target: userId,
        dismiss,
      });
      if (error) throw error;
      return true;
    });
  }

  private async run(fn: () => Promise<boolean>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      return await fn();
    } catch (e) {
      this.error.set(moderationErrorKey(messageOf(e)));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

function messageOf(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return '';
}
