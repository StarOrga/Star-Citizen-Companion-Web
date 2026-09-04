import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import {
  LoadoutShareRow,
  SharedLoadoutView,
  SharedWithMeRow,
  shareErrorKey,
} from './loadout-share.types';

/**
 * Loadout sharing (migration 20260904020000).
 *
 * Every call is an RPC: `loadout_shares` carries no INSERT/UPDATE/DELETE
 * policy at all, and the SECURITY DEFINER functions pin the owner to
 * `auth.uid()`. Nothing here passes an owner id — the server decides who is
 * acting, exactly as in FriendsService.
 *
 * `error` holds an i18n KEY, never a message.
 */
@Injectable({ providedIn: 'root' })
export class LoadoutShareService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** Live shares of ONE loadout, owner view. */
  async listShares(loadoutId: string): Promise<LoadoutShareRow[]> {
    return this.run(async () => {
      const { data, error } = await this.sb.client.rpc('list_loadout_shares', {
        target_loadout: loadoutId,
      });
      if (error) throw error;
      return (data ?? []) as LoadoutShareRow[];
    }, []);
  }

  /**
   * Mints the link, or returns the one that already exists — the RPC is
   * idempotent on purpose, so a double click cannot leave a second live URL
   * behind that the owner does not know about.
   */
  async createLink(loadoutId: string): Promise<string | null> {
    return this.run(async () => {
      const { data, error } = await this.sb.client.rpc('create_loadout_link', {
        target_loadout: loadoutId,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    }, null);
  }

  /** `created` on the first share, `duplicate` when the friend already has it. */
  async shareWithFriend(loadoutId: string, friendId: string): Promise<string | null> {
    return this.run(async () => {
      const { data, error } = await this.sb.client.rpc('share_loadout_with_friend', {
        target_loadout: loadoutId,
        friend: friendId,
      });
      if (error) throw error;
      return (data as string | null) ?? 'created';
    }, null);
  }

  async revoke(shareId: string): Promise<boolean> {
    return this.run(async () => {
      const { error } = await this.sb.client.rpc('revoke_loadout_share', { share_id: shareId });
      if (error) throw error;
      return true;
    }, false);
  }

  /** Everything friends have shared with me, friendship re-checked server-side. */
  async listSharedWithMe(): Promise<SharedWithMeRow[]> {
    return this.run(async () => {
      const { data, error } = await this.sb.client.rpc('list_loadouts_shared_with_me');
      if (error) throw error;
      return (data ?? []) as SharedWithMeRow[];
    }, []);
  }

  /**
   * The public read. Uses `realClient`, not `client`: this runs on a route
   * that a SIGNED-OUT visitor reaches, and it must behave identically whether
   * or not an admin happens to be previewing as somebody else.
   *
   * Resolves to `null` for an unknown token, a revoked link and a suspended
   * owner alike — the server answers all three the same way, so this cannot
   * become a probe for which tokens once existed.
   */
  async getShared(token: string): Promise<SharedLoadoutView | null> {
    return this.run(async () => {
      const { data, error } = await this.sb.realClient.rpc('get_shared_loadout', {
        share_token: token,
      });
      if (error) throw error;
      const rows = (data ?? []) as SharedLoadoutView[];
      return rows.length > 0 ? rows[0] : null;
    }, null);
  }

  private async run<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    this.busy.set(true);
    this.error.set(null);
    try {
      return await fn();
    } catch (e) {
      this.error.set(shareErrorKey(messageOf(e)));
      return fallback;
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
