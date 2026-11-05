import { Injectable, computed, inject, signal } from '@angular/core';
import { toErrorKey } from '../core/describe-error';
import { SupabaseClientProvider } from '../core/supabase.client';
import {
  AdoptedLoadout,
  AdoptedShipConfig,
  EinsatzCrew,
  FriendGroup,
  FriendGroupKind,
  FriendInvite,
  FriendOverview,
  FriendOverviewResult,
  FriendShareKind,
  FriendShareRow,
  InviteRedeemResult,
  MySocialVisibility,
  RsvpAnswer,
  ShareAudience,
  ShareVerdict,
  SharedEinsatz,
  SharedShipConfig,
  SocialCompare,
  SocialVisibility,
  VisibilityOverride,
  socialErrorKey,
} from './social.types';

/**
 * The social area (migration 20261105120000): invites, groups, visibility,
 * Einsatz and ship-variant shares, crew slots, comparison, friend page.
 * Friend requests and the graph stay in FriendsService, set shares in
 * LoadoutShareService.
 *
 * Every call is an RPC pinned to `auth.uid()` server-side; the tables have no
 * policy at all. `error` is the last failed action, `loadError` the last failed
 * load (which renders an error state with retry, never the empty state). Both
 * hold an i18n KEY, never a message.
 */
@Injectable({ providedIn: 'root' })
export class SocialService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly invite = signal<FriendInvite | null>(null);
  readonly groups = signal<FriendGroup[]>([]);
  readonly visibility = signal<MySocialVisibility | null>(null);
  readonly onlineIds = signal<ReadonlySet<string>>(new Set());
  readonly sharedEinsaetze = signal<SharedEinsatz[]>([]);
  readonly sharedShipConfigs = signal<SharedShipConfig[]>([]);
  readonly compare = signal<SocialCompare | null>(null);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);

  readonly orgs = computed(() => this.groups().filter((g) => g.kind === 'org'));
  readonly einsatzgruppen = computed(() => this.groups().filter((g) => g.kind === 'einsatzgruppe'));

  // --- Loads ---------------------------------------------------------------

  async loadInvite(): Promise<void> {
    const rows = await this.load<FriendInvite[]>('my_friend_invite');
    if (rows) this.invite.set(rows[0] ?? null);
  }

  async loadGroups(): Promise<void> {
    const rows = await this.load<FriendGroup[]>('list_my_friend_groups');
    if (rows) this.groups.set(rows);
  }

  async loadVisibility(): Promise<void> {
    const data = await this.load<MySocialVisibility>('get_my_social_visibility');
    if (data) this.visibility.set(data);
  }

  async loadOnline(): Promise<void> {
    const rows = await this.load<{ user_id: string }[]>('list_online_friends');
    if (rows) this.onlineIds.set(new Set(rows.map((r) => r.user_id)));
  }

  async loadSharedEinsaetze(): Promise<void> {
    const rows = await this.load<SharedEinsatz[]>('list_einsaetze_shared_with_me');
    if (rows) this.sharedEinsaetze.set(rows);
  }

  async loadSharedShipConfigs(): Promise<void> {
    const rows = await this.load<SharedShipConfig[]>('list_ship_configs_shared_with_me');
    if (rows) this.sharedShipConfigs.set(rows);
  }

  async loadCompare(): Promise<void> {
    const data = await this.load<SocialCompare>('list_friend_compare');
    if (data) this.compare.set(data);
  }

  /** The friend page's data. Accepts a handle or a user id. */
  async friendOverview(handleOrId: string): Promise<FriendOverviewResult> {
    try {
      const data = await this.call<FriendOverview | null>('friend_overview', { p_friend: handleOrId });
      return data ? { kind: 'ok', data } : { kind: 'missing' };
    } catch (e) {
      return { kind: 'error', key: this.keyOf('friend_overview', e) };
    }
  }

  // --- Invites -------------------------------------------------------------

  /** Mints the link or returns the live one. The RPC is idempotent. */
  async createInvite(): Promise<FriendInvite | null> {
    const invite = await this.act<FriendInvite | null>('create_friend_invite', undefined, null);
    if (invite) this.invite.set(invite);
    return invite;
  }

  async revokeInvite(): Promise<boolean> {
    const ok = await this.done('revoke_friend_invite');
    if (ok) this.invite.set(null);
    return ok;
  }

  /**
   * The signed-out read of the invite page. `realClient`, like
   * LoadoutShareService.getShared: it must not depend on an admin preview.
   * Null for every kind of dead link alike. Null on a failed call too, with
   * `error` set, so the caller can tell the two apart.
   */
  async peekInvite(token: string): Promise<{ display_handle: string | null } | null> {
    this.error.set(null);
    try {
      const { data, error } = await this.sb.realClient.rpc('peek_friend_invite' as never, { p_token: token } as never);
      if (error) throw error;
      const rows = (data ?? []) as unknown as { display_handle: string | null }[];
      return rows[0] ?? null;
    } catch (e) {
      this.error.set(this.keyOf('peek_friend_invite', e));
      return null;
    }
  }

  async redeemInvite(token: string): Promise<InviteRedeemResult | null> {
    return this.act<InviteRedeemResult | null>('redeem_friend_invite', { p_token: token }, null);
  }

  // --- Groups --------------------------------------------------------------

  async createGroup(kind: FriendGroupKind, name: string): Promise<string | null> {
    const id = await this.act<string | null>('create_friend_group', { p_kind: kind, p_name: name.trim() }, null);
    if (id) await this.loadGroups();
    return id;
  }

  async renameGroup(groupId: string, name: string): Promise<boolean> {
    const ok = await this.done('rename_friend_group', { p_group: groupId, p_name: name.trim() });
    if (ok) await this.loadGroups();
    return ok;
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    const ok = await this.done('delete_friend_group', { p_group: groupId });
    if (ok) await this.loadGroups();
    return ok;
  }

  async setGroupMember(groupId: string, memberId: string, inGroup: boolean): Promise<boolean> {
    const ok = await this.done('set_friend_group_member', { p_group: groupId, p_member: memberId, p_in: inGroup });
    if (ok) await this.loadGroups();
    return ok;
  }

  // --- Visibility ----------------------------------------------------------

  async setVisibility(v: SocialVisibility): Promise<boolean> {
    const ok = await this.done('set_my_social_visibility', {
      p_hangar: v.hangar,
      p_flagship: v.flagship,
      p_presence: v.presence,
      p_stats: v.stats,
    });
    if (ok) await this.loadVisibility();
    return ok;
  }

  /** A `null` facet inherits the general setting; all null removes the override. */
  async setFriendVisibility(friendId: string, o: VisibilityOverride): Promise<boolean> {
    const ok = await this.done('set_friend_visibility', {
      p_friend: friendId,
      p_hangar: o.hangar,
      p_flagship: o.flagship,
      p_presence: o.presence,
      p_stats: o.stats,
    });
    if (ok) await this.loadVisibility();
    return ok;
  }

  // --- Shares --------------------------------------------------------------

  async shareEinsatz(einsatzId: string, to: ShareAudience): Promise<ShareVerdict | null> {
    return this.act<ShareVerdict | null>('share_einsatz', { p_einsatz: einsatzId, ...audienceArgs(to) }, null);
  }

  async shareShipConfig(configId: string, to: ShareAudience): Promise<ShareVerdict | null> {
    return this.act<ShareVerdict | null>('share_ship_config', { p_config: configId, ...audienceArgs(to) }, null);
  }

  /** Fans out to the group's current friends now. Later members do not get the set. Null on failure. */
  async shareLoadoutWithGroup(loadoutId: string, groupId: string): Promise<number | null> {
    return this.act<number | null>('share_loadout_with_group', { p_loadout: loadoutId, p_group: groupId }, null);
  }

  /** The audience of one Einsatz or ship variant, owner view. Null on failure. */
  async listShares(kind: FriendShareKind, subjectId: string): Promise<FriendShareRow[] | null> {
    return this.act<FriendShareRow[] | null>('list_friend_shares', { p_kind: kind, p_subject: subjectId }, null);
  }

  async revokeShare(shareId: string): Promise<boolean> {
    return this.done('revoke_friend_share', { p_share: shareId });
  }

  // --- Adopt ---------------------------------------------------------------

  /** `shareId` = `SharedWithMeRow.share_id`. The caller reloads HangarService. */
  async adoptLoadout(shareId: string): Promise<AdoptedLoadout | null> {
    return this.act<AdoptedLoadout | null>('adopt_friend_loadout', { p_share: shareId }, null);
  }

  /** `shareId` = `SharedShipConfig.share_id`. The caller reloads HangarService before opening it. */
  async adoptShipConfig(shareId: string): Promise<AdoptedShipConfig | null> {
    return this.act<AdoptedShipConfig | null>('adopt_friend_ship_config', { p_share: shareId }, null);
  }

  // --- Crew ----------------------------------------------------------------

  /** Null on failure, with `error` set: for a friend who lost access that is `einsatzNotFound`. */
  async crew(einsatzId: string): Promise<EinsatzCrew | null> {
    return this.act<EinsatzCrew | null>('get_einsatz_crew', { p_einsatz: einsatzId }, null);
  }

  /** Owner only. Writes the whole label list, positions keep their taker. */
  async setSlots(einsatzId: string, labels: readonly string[]): Promise<EinsatzCrew | null> {
    return this.act<EinsatzCrew | null>('set_einsatz_slots', { p_einsatz: einsatzId, p_labels: labels.map((l) => l.trim()) }, null);
  }

  /**
   * Answers and takes a slot. `slotId` null means "no slot": pass the current
   * one to keep it. Updates `sharedEinsaetze` so an open HQ card follows.
   */
  async respond(einsatzId: string, answer: RsvpAnswer, slotId: string | null = null): Promise<EinsatzCrew | null> {
    const crew = await this.act<EinsatzCrew | null>('respond_einsatz', { p_einsatz: einsatzId, p_answer: answer, p_slot: slotId }, null);
    if (crew) {
      this.sharedEinsaetze.update((rows) => rows.map((r) => (r.einsatz_id === einsatzId ? { ...r, crew } : r)));
    }
    return crew;
  }

  // --- Envelope ------------------------------------------------------------

  /** Typed locally: these RPCs are not in the generated client types. */
  private async call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = args
      ? await this.sb.client.rpc(fn as never, args as never)
      : await this.sb.client.rpc(fn as never);
    if (error) throw error;
    return data as unknown as T;
  }

  private keyOf(fn: string, e: unknown): string {
    return socialErrorKey(messageOf(e)) ?? toErrorKey('social', fn, e);
  }

  /** A read: failure goes to `loadError` and leaves the last good value in place. */
  private async load<T>(fn: string): Promise<T | null> {
    try {
      const data = await this.call<T>(fn);
      this.loadError.set(null);
      return data;
    } catch (e) {
      this.loadError.set(this.keyOf(fn, e));
      return null;
    }
  }

  /** An action: `busy` while it runs, failure goes to `error` and resolves to `fallback`. */
  private async act<T>(fn: string, args: Record<string, unknown> | undefined, fallback: T): Promise<T> {
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

  /** An action whose RPC returns nothing. */
  private async done(fn: string, args?: Record<string, unknown>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.call<unknown>(fn, args);
      return true;
    } catch (e) {
      this.error.set(this.keyOf(fn, e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

function audienceArgs(to: ShareAudience): { p_friend: string | null; p_group: string | null } {
  return 'friendId' in to ? { p_friend: to.friendId, p_group: null } : { p_friend: null, p_group: to.groupId };
}

function messageOf(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return '';
}
