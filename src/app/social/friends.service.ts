import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import {
  FoundUser,
  FriendEdgeRow,
  FriendGraph,
  ReportCategory,
  emptyGraph,
  friendErrorKey,
  groupFriendEdges,
} from './friends.types';

/**
 * Signal store for the friend graph (migration 20260901181500).
 *
 * Every mutation is an RPC, never a table write: the tables carry no
 * INSERT/UPDATE/DELETE policy at all, and the SECURITY DEFINER functions pin
 * the actor to `auth.uid()`. That is also why nothing here passes a
 * "reporter"/"requester" id — the server decides who is acting.
 *
 * `error` holds an i18n KEY, not a message: the RPCs raise stable one-word
 * codes and `friendErrorKey()` maps them, so no raw SQL text can reach a
 * template.
 */
@Injectable({ providedIn: 'root' })
export class FriendsService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly graph = signal<FriendGraph>(emptyGraph());
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly incomingCount = computed(() => this.graph().incoming.length);
  readonly friendCount = computed(() => this.graph().friends.length);

  /** Reloads the whole graph in one round trip. */
  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const { data, error } = await this.sb.client.rpc('list_my_friend_edges');
      if (error) throw error;
      this.graph.set(groupFriendEdges((data ?? []) as FriendEdgeRow[]));
      this.error.set(null);
    } catch (e) {
      this.error.set(friendErrorKey(messageOf(e)));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Exact-handle lookup. Resolves to `null` for "no such user" AND for
   * "blocked in either direction" — the server answers identically on purpose,
   * so this method cannot become a block detector.
   */
  async findByUsername(handle: string): Promise<FoundUser | null> {
    return this.run(async () => {
      const { data, error } = await this.sb.client.rpc('find_user_by_username', {
        handle: handle.trim(),
      });
      if (error) throw error;
      const rows = (data ?? []) as FoundUser[];
      return rows.length > 0 ? rows[0] : null;
    }, null);
  }

  /** Returns the server's verdict: `pending`, `accepted` (crossed requests) or `already_friends`. */
  async sendRequest(targetId: string): Promise<string | null> {
    const result = await this.run(async () => {
      const { data, error } = await this.sb.client.rpc('send_friend_request', { target: targetId });
      if (error) throw error;
      return (data as string | null) ?? 'pending';
    }, null);
    if (result) await this.load();
    return result;
  }

  async respond(requestId: string, accept: boolean): Promise<boolean> {
    const ok = await this.run(async () => {
      const { error } = await this.sb.client.rpc('respond_friend_request', {
        request_id: requestId,
        accept,
      });
      if (error) throw error;
      return true;
    }, false);
    if (ok) await this.load();
    return ok;
  }

  async withdraw(requestId: string): Promise<boolean> {
    const ok = await this.run(async () => {
      const { error } = await this.sb.client.rpc('withdraw_friend_request', {
        request_id: requestId,
      });
      if (error) throw error;
      return true;
    }, false);
    if (ok) await this.load();
    return ok;
  }

  async removeFriend(targetId: string): Promise<boolean> {
    const ok = await this.run(async () => {
      const { error } = await this.sb.client.rpc('remove_friend', { target: targetId });
      if (error) throw error;
      return true;
    }, false);
    if (ok) await this.load();
    return ok;
  }

  async block(targetId: string): Promise<boolean> {
    const ok = await this.run(async () => {
      const { error } = await this.sb.client.rpc('block_user', { target: targetId });
      if (error) throw error;
      return true;
    }, false);
    if (ok) await this.load();
    return ok;
  }

  async unblock(targetId: string): Promise<boolean> {
    const ok = await this.run(async () => {
      const { error } = await this.sb.client.rpc('unblock_user', { target: targetId });
      if (error) throw error;
      return true;
    }, false);
    if (ok) await this.load();
    return ok;
  }

  /** `created` on the first report, `duplicate` when one is already open. */
  async report(targetId: string, category: ReportCategory, reason: string): Promise<string | null> {
    return this.run(async () => {
      const { data, error } = await this.sb.client.rpc('report_user', {
        target: targetId,
        category,
        reason: reason.trim() || null,
      });
      if (error) throw error;
      return (data as string | null) ?? 'created';
    }, null);
  }

  /** Shared busy/error envelope — `fallback` is what a failed call resolves to. */
  private async run<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    this.busy.set(true);
    this.error.set(null);
    try {
      return await fn();
    } catch (e) {
      this.error.set(friendErrorKey(messageOf(e)));
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
