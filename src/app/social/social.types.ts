/**
 * Types + pure helpers for the social area (migration 20261105120000).
 * Contract for the UI: docs/concepts/2026-11-05-freunde-zweck-und-platz/contract.md.
 *
 * Nothing here is an authority: the RPCs decide who may see what, and every
 * limit below only saves a round trip on an obvious mistake.
 */

/** A person as the social RPCs project them: never more than name and handle. */
export interface SocialPerson {
  user_id: string;
  display_name: string | null;
  username: string | null;
}

// --- Invites ---------------------------------------------------------------

/** The caller's live invite (`my_friend_invite()` / `create_friend_invite()`). */
export interface FriendInvite {
  token: string;
  expires_at: string;
}

/** `redeem_friend_invite()`: `accepted` when a crossing request made it a friendship. */
export interface InviteRedeemResult extends SocialPerson {
  verdict: 'pending' | 'accepted' | 'already_friends';
}

/**
 * Same shape `new_share_token()` mints (64 hex chars) within the column's
 * 32-128 bound; rejects a mangled URL before it becomes a round trip.
 */
export function isValidInviteToken(raw: string): boolean {
  return /^[0-9a-f]{32,128}$/i.test(raw.trim());
}

/**
 * The absolute invite URL: it gets pasted into Discord. `/invite/<token>` and
 * not `/social/invite/<token>`, because a signed-out visitor must reach it and
 * `/social/<name>` belongs to the handles.
 */
export function inviteLinkFor(token: string, origin?: string | null): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/invite/${token}`;
}

// --- Friend page path ------------------------------------------------------

/** Router commands of a friend's page. The id is the fallback: most accounts have no handle. */
export function friendPath(person: Pick<SocialPerson, 'user_id' | 'username'>): string[] {
  return ['/social', person.username ?? person.user_id];
}

// --- Groups ----------------------------------------------------------------

export const FRIEND_GROUP_KINDS = ['org', 'einsatzgruppe'] as const;
export type FriendGroupKind = (typeof FRIEND_GROUP_KINDS)[number];

/** Mirrors `friend_groups_name_len`. */
export const GROUP_NAME_MAX = 60;
/** Mirrors the limit in `create_friend_group()`. */
export const GROUPS_MAX = 50;
/** Mirrors the limit in `set_friend_group_member()`. */
export const GROUP_MEMBERS_MAX = 100;

/** One row of `list_my_friend_groups()`. `members` holds current friends only. */
export interface FriendGroup {
  id: string;
  kind: FriendGroupKind;
  name: string;
  created_at: string;
  members: SocialPerson[];
}

export function isValidGroupName(raw: string): boolean {
  const n = raw.trim().length;
  return n >= 1 && n <= GROUP_NAME_MAX;
}

// --- Visibility ------------------------------------------------------------

export const VISIBILITY_FACETS = ['hangar', 'flagship', 'presence', 'stats'] as const;
export type VisibilityFacet = (typeof VISIBILITY_FACETS)[number];

/** The general setting. */
export type SocialVisibility = Record<VisibilityFacet, boolean>;

/** A per-friend override. `null` in a facet = inherit the general setting. */
export type VisibilityOverride = Record<VisibilityFacet, boolean | null>;

export type VisibilityOverrideRow = SocialPerson & VisibilityOverride;

/** `get_my_social_visibility()`. */
export interface MySocialVisibility {
  general: SocialVisibility;
  overrides: VisibilityOverrideRow[];
}

/** What a friend ends up seeing: the override where set, else the general setting. */
export function effectiveVisibility(
  general: SocialVisibility,
  override: Partial<VisibilityOverride> | null | undefined,
): SocialVisibility {
  const pick = (f: VisibilityFacet) => override?.[f] ?? general[f];
  return { hangar: pick('hangar'), flagship: pick('flagship'), presence: pick('presence'), stats: pick('stats') };
}

/** An override that changes nothing is deleted server-side rather than stored. */
export function isEmptyOverride(override: VisibilityOverride): boolean {
  return VISIBILITY_FACETS.every((f) => override[f] === null);
}

// --- Shares ----------------------------------------------------------------

export type FriendShareKind = 'einsatz' | 'ship_config';

/** Who a share goes to: exactly one friend or one group. */
export type ShareAudience = { friendId: string } | { groupId: string } | { teamId: string };

/** `created` on the first share, `duplicate` when that audience already has it. */
export type ShareVerdict = 'created' | 'duplicate';

/** One row of `list_friend_shares()`, the owner's view of a subject's audience. */
export interface FriendShareRow {
  share_id: string;
  shared_with: string | null;
  friend_name: string | null;
  friend_handle: string | null;
  group_id: string | null;
  group_name: string | null;
  group_kind: FriendGroupKind | null;
  created_at: string;
}

/** One step of a shared Einsatz. `supply_id` stays private to the owner. */
export interface SharedEinsatzStep {
  ord: number;
  kind: string;
  label: string;
  location: string | null;
  system: string | null;
  class_name: string | null;
  qty: number | null;
  mission_ref: string | null;
  state: 'todo' | 'done';
}

// --- Crew ------------------------------------------------------------------

export const RSVP_ANSWERS = ['yes', 'maybe', 'no'] as const;
export type RsvpAnswer = (typeof RSVP_ANSWERS)[number];

/** Mirrors `set_einsatz_slots()` and `einsatz_crew_slots_label_len`. */
export const SLOTS_MAX = 12;
export const SLOT_LABEL_MAX = 40;

export interface CrewSlot {
  id: string;
  ord: number;
  label: string;
  taken: boolean;
  /** True when the reader holds this slot. */
  mine: boolean;
  /** Null when free, and when the taker is no friend of the reader. */
  taker: SocialPerson | null;
}

export interface CrewRsvp extends SocialPerson {
  answer: RsvpAnswer;
  slot_id: string | null;
  answered_at: string;
}

/** `get_einsatz_crew()`, `set_einsatz_slots()`, `respond_einsatz()`. */
export interface EinsatzCrew {
  slots: CrewSlot[];
  counts: Record<RsvpAnswer, number>;
  my_answer: RsvpAnswer | null;
  my_slot: string | null;
  /** Who answered what, by name, for every invitee (blocked pairs excluded server-side). */
  rsvps: CrewRsvp[] | null;
}

/** One row of `list_einsaetze_shared_with_me()`. */
export interface SharedEinsatz {
  einsatz_id: string;
  title: string;
  activity: string | null;
  status: 'planned' | 'active' | 'done';
  planned_at: string | null;
  start_location: string | null;
  updated_at: string;
  owner_id: string;
  owner_name: string | null;
  owner_handle: string | null;
  shared_at: string;
  steps: SharedEinsatzStep[];
  crew: EinsatzCrew;
}

/** One row of `list_ship_configs_shared_with_me()`. */
export interface SharedShipConfig {
  share_id: string;
  config_id: string;
  name: string;
  role: string;
  loadout: unknown[];
  ship_class_name: string;
  owner_id: string;
  owner_name: string | null;
  owner_handle: string | null;
  shared_at: string;
  updated_at: string;
}

/** `adopt_friend_loadout()`. */
export interface AdoptedLoadout {
  loadoutId: string;
  existed: boolean;
}

/** `adopt_friend_ship_config()`. Open it with `holoConfigLink(shipClassName, configId)`. */
export interface AdoptedShipConfig {
  configId: string;
  shipClassName: string;
  existed: boolean;
}

// --- Comparison + friend page ----------------------------------------------

/**
 * `social_stats()`: only numbers the server really knows. On a friend's stats
 * `active_days_30` and `desktop_connected` are null when that friend hides their
 * presence; on your own they are always set.
 */
export interface SocialStats {
  ships: number;
  sets: number;
  einsaetze_planned: number;
  einsaetze_done: number;
  missions_30d: number;
  kartograph_rank: number;
  active_days_30: number | null;
  desktop_connected: boolean | null;
}

/** `list_friend_compare()`. `stats` is null for a friend who hides them. */
export interface FriendCompareRow extends SocialPerson {
  stats: SocialStats | null;
}

export interface SocialCompare {
  me: SocialStats;
  friends: FriendCompareRow[];
}

/** The numeric rows of the comparison, in display order, with their i18n keys. */
export const COMPARE_METRICS = [
  'ships',
  'sets',
  'einsaetze_planned',
  'einsaetze_done',
  'missions_30d',
  'kartograph_rank',
  'active_days_30',
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export interface CompareRow {
  metric: CompareMetric;
  labelKey: string;
  me: number;
  /** Null when the friend hides their stats, or their presence for `active_days_30`. */
  friend: number | null;
  /** `behind` renders in `--sc-warning`: a comparison is not an error. */
  standing: 'ahead' | 'even' | 'behind' | null;
}

export function compareRows(me: SocialStats, friend: SocialStats | null): CompareRow[] {
  return COMPARE_METRICS.map((metric) => {
    const mine = Number(me[metric]) || 0;
    const raw = friend ? friend[metric] : null;
    const theirs = raw === null || raw === undefined ? null : Number(raw) || 0;
    return {
      metric,
      labelKey: `social.compare.${metric}`,
      me: mine,
      friend: theirs,
      standing: theirs === null ? null : mine > theirs ? 'ahead' : mine < theirs ? 'behind' : 'even',
    };
  });
}

export interface OverviewLoadout {
  share_id: string;
  loadout_id: string;
  name: string;
  role: string;
  shared_at: string;
}

export interface OverviewEinsatz {
  einsatz_id: string;
  title: string;
  activity: string | null;
  status: string;
  planned_at: string | null;
}

export interface OverviewShipConfig {
  share_id: string;
  config_id: string;
  name: string;
  role: string;
  ship_class_name: string;
}

export interface OverviewShared {
  loadouts: OverviewLoadout[];
  einsaetze: OverviewEinsatz[];
  ship_configs: OverviewShipConfig[];
}

export interface FriendHangarShip {
  ship_class_name: string;
  custom_name: string | null;
  status: 'owned' | 'wishlist';
  pinned_rank: number | null;
}

/**
 * `friend_overview()`. A hidden facet is null, never empty, so the page can say
 * "does not share this" instead of "has no ships".
 */
export interface FriendOverview {
  friend: SocialPerson & {
    since: string;
    flagship_ship_class: string | null;
    online: boolean | null;
  };
  from_friend: OverviewShared;
  from_me: OverviewShared;
  my_groups: Pick<FriendGroup, 'id' | 'kind' | 'name'>[];
  hangar: FriendHangarShip[] | null;
  compare: { me: SocialStats; friend: SocialStats | null };
}

/**
 * `missing` is a real answer: the server says the same for a non-friend, a
 * blocked and a nonexistent account, so the page shows "not found". `error` is
 * a failed call, which needs a retry instead.
 */
export type FriendOverviewResult =
  | { kind: 'ok'; data: FriendOverview }
  | { kind: 'missing' }
  | { kind: 'error'; key: string };

// --- Errors ----------------------------------------------------------------

/**
 * Maps a stable RPC code onto an i18n key; null for anything else, so the
 * service can fall through to `toErrorKey` and name a timeout as a timeout.
 */
export function socialErrorKey(message: string | null | undefined): string | null {
  const code = (message ?? '').toLowerCase();
  const known: readonly (readonly [string, string])[] = [
    ['invite_not_found', 'inviteNotFound'],
    ['invite_expired', 'inviteExpired'],
    ['invite_self', 'inviteSelf'],
    ['invite_rate_limited', 'inviteRateLimited'],
    ['invite_limit', 'inviteLimit'],
    ['invite_full', 'inviteFull'],
    ['invalid_group_kind', 'invalidGroupKind'],
    ['invalid_group_name', 'invalidGroupName'],
    ['group_name_taken', 'groupNameTaken'],
    ['group_not_found', 'groupNotFound'],
    ['group_limit', 'groupLimit'],
    ['group_full', 'groupFull'],
    ['einsatz_not_found', 'einsatzNotFound'],
    ['einsatz_closed', 'einsatzClosed'],
    ['config_not_found', 'configNotFound'],
    ['ship_unavailable', 'shipUnavailable'],
    ['loadout_not_found', 'loadoutNotFound'],
    ['share_not_found', 'shareNotFound'],
    ['too_many_slots', 'tooManySlots'],
    ['invalid_slot_label', 'invalidSlotLabel'],
    ['slot_not_found', 'slotNotFound'],
    ['slot_taken', 'slotTaken'],
    ['invalid_answer', 'invalidAnswer'],
    ['not_friends', 'notFriends'],
    ['invalid_target', 'invalidTarget'],
    ['team_full', 'teamFull'],
    ['team_limit', 'teamLimit'],
    ['last_owner', 'lastOwner'],
    ['invalid_name', 'teamInvalidName'],
    ['invalid_role', 'teamInvalidRole'],
    ['forbidden', 'teamForbidden'],
    ['rate_limited', 'teamRateLimited'],
    ['account_suspended', 'accountSuspended'],
    ['not approved', 'notApproved'],
  ];
  const hit = known.find(([c]) => code.includes(c));
  return hit ? `social.error.${hit[1]}` : null;
}

// --- Real groups (#903) ------------------------------------------------------

/** Mirrors `sc_group_members.role`. */
export const TEAM_ROLES = ['owner', 'admin', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Mirrors the `sc_groups.name` check. */
export const TEAM_NAME_MAX = 40;

/** One row of `list_my_groups()`. The code is only present for an owner or admin. */
export interface Team {
  id: string;
  name: string;
  role: TeamRole;
  member_count: number;
  joined_at: string;
  invite_code: string | null;
  invite_expires_at: string | null;
}

/** One row of `list_group_members()`: what a member learns about another member, nothing more. */
export interface TeamMember {
  user_id: string;
  display_name: string | null;
  username: string;
  role: TeamRole;
  joined_at: string;
  is_me: boolean;
}

/** One row of `list_einsatz_group_shares()`. */
export interface TeamEinsatzShare {
  group_id: string;
  name: string;
  created_at: string;
}

/** Shows a stored code as XXXX-XXXX-XXXX-XXXX. */
export function formatTeamCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/** Owners and admins may rotate the code; only owners promote, demote and delete. */
export function canManageInvite(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** May `me` remove `other`? Mirrors remove_group_member(); never oneself. */
export function canRemoveMember(me: TeamRole, other: TeamRole): boolean {
  return me === 'owner' || (me === 'admin' && other === 'member');
}
