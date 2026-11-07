import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { toErrorKey } from '../core/describe-error';
import { SupabaseClientProvider } from '../core/supabase.client';
import { Team, TeamEinsatzShare, TeamMember, TeamRole, socialErrorKey } from './social.types';

/**
 * Real groups (#903): create, join with a code, rotate, leave, remove a member,
 * change a role, delete, and the member list. Every call is an RPC; the tables
 * accept no client write. Sharing an Einsatz with a group goes through
 * `SocialService.shareEinsatz(id, { teamId })`, the one invite path.
 *
 * `error` / `loadError` hold an i18n key, never a message.
 */
@Injectable({ providedIn: 'root' })
export class TeamsService {
  private readonly injector = inject(Injector);
  private get sb(): SupabaseClientProvider {
    return this.injector.get(SupabaseClientProvider);
  }

  readonly teams = signal<Team[]>([]);
  readonly members = signal<ReadonlyMap<string, TeamMember[]>>(new Map());
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly loaded = signal(false);
  readonly count = computed(() => this.teams().length);

  async load(): Promise<void> {
    try {
      const rows = await this.call<Team[]>('list_my_groups');
      this.teams.set(rows ?? []);
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(this.keyOf('list_my_groups', e));
    } finally {
      this.loaded.set(true);
    }
  }

  async loadMembers(groupId: string): Promise<void> {
    try {
      const rows = await this.call<TeamMember[]>('list_group_members', { p_group: groupId });
      this.members.update((m) => new Map(m).set(groupId, rows ?? []));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(this.keyOf('list_group_members', e));
    }
  }

  async create(name: string): Promise<string | null> {
    const res = await this.act<{ id: string } | null>('create_group', { p_name: name.trim() }, null);
    if (res) await this.load();
    return res?.id ?? null;
  }

  /** Resolves true when joined. A wrong, expired or rotated code sets `invalidCode`. */
  readonly invalidCode = signal(false);
  async join(code: string): Promise<boolean> {
    this.invalidCode.set(false);
    const id = await this.act<string | null>('join_group', { p_code: code }, null);
    if (id === null) {
      if (!this.error()) this.invalidCode.set(true);
      return false;
    }
    await this.load();
    return true;
  }

  async rotate(groupId: string): Promise<boolean> {
    const res = await this.act<{ invite_code: string } | null>('rotate_group_invite', { p_group: groupId }, null);
    if (res) await this.load();
    return res !== null;
  }

  async leave(groupId: string): Promise<boolean> {
    return this.mutate('leave_group', { p_group: groupId });
  }

  async remove(groupId: string, userId: string): Promise<boolean> {
    const ok = await this.mutate('remove_group_member', { p_group: groupId, p_member: userId }, false);
    if (ok) await Promise.all([this.loadMembers(groupId), this.load()]);
    return ok;
  }

  async setRole(groupId: string, userId: string, role: TeamRole): Promise<boolean> {
    const ok = await this.mutate('set_group_member_role', { p_group: groupId, p_member: userId, p_role: role }, false);
    if (ok) await this.loadMembers(groupId);
    return ok;
  }

  async delete(groupId: string): Promise<boolean> {
    return this.mutate('delete_group', { p_group: groupId });
  }

  private async mutate(fn: string, args: Record<string, unknown>, reload = true): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.call<unknown>(fn, args);
    } catch (e) {
      this.error.set(this.keyOf(fn, e));
      return false;
    } finally {
      this.busy.set(false);
    }
    if (reload) await this.load();
    return true;
  }

  private async act<T>(fn: string, args: Record<string, unknown>, fallback: T): Promise<T> {
    this.busy.set(true);
    this.error.set(null);
    try {
      return await this.call<T>(fn, args);
    } catch (e) {
      this.error.set(this.keyOf(fn, e));
      return fallback;
    } finally {
      this.busy.set(false);
    }
  }

  private async call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = args
      ? await this.sb.client.rpc(fn as never, args as never)
      : await this.sb.client.rpc(fn as never);
    if (error) throw error;
    return data as unknown as T;
  }

  /** The groups one of the caller's Einsatz is shared with. Empty on failure. */
  async einsatzShares(einsatzId: string): Promise<TeamEinsatzShare[]> {
    try {
      return (await this.call<TeamEinsatzShare[]>('list_einsatz_group_shares', { p_einsatz: einsatzId })) ?? [];
    } catch {
      return [];
    }
  }

  async unshareEinsatz(einsatzId: string, groupId: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.call<unknown>('unshare_einsatz_from_group', { p_einsatz: einsatzId, p_group: groupId });
      return true;
    } catch (e) {
      this.error.set(this.keyOf('unshare_einsatz_from_group', e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private keyOf(fn: string, e: unknown): string {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
    return socialErrorKey(msg) ?? toErrorKey('social', fn, e);
  }
}
