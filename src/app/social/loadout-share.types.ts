/**
 * Types + pure helpers for loadout sharing (migration 20260904020000, admin
 * feedback cf0ddf7d phase 2).
 *
 * `hangar_role_loadouts` keeps its self-only RLS — there is no public-read
 * policy anywhere in this feature. A non-owner only ever sees a loadout
 * through one of two SECURITY DEFINER read functions:
 *   * `list_loadouts_shared_with_me()` — re-checks the friendship on every
 *     read, so un-friending revokes access with no cleanup pass, and
 *   * `get_shared_loadout(token)` — the link path, the only hangar data the
 *     `anon` role can reach at all, and only with a live 64-hex-char token.
 */

import { RoleLoadoutItem, RoleLoadoutRole } from '../hangar/hangar.types';

/** One row of `list_loadout_shares()` — the owner's view of a live share. */
export interface LoadoutShareRow {
  id: string;
  /** Set for a LINK share, null for a friend share (the two are exclusive). */
  token: string | null;
  /** Set for a FRIEND share, null for a link share. */
  shared_with: string | null;
  friend_name: string | null;
  friend_handle: string | null;
  created_at: string;
}

/** One row of `list_loadouts_shared_with_me()`. */
export interface SharedWithMeRow {
  share_id: string;
  loadout_id: string;
  name: string;
  role: RoleLoadoutRole;
  items: RoleLoadoutItem[] | null;
  owner_id: string;
  owner_name: string | null;
  owner_handle: string | null;
  shared_at: string;
  updated_at: string;
}

/** The single row `get_shared_loadout()` returns — or nothing at all. */
export interface SharedLoadoutView {
  loadout_id: string;
  name: string;
  role: RoleLoadoutRole;
  items: RoleLoadoutItem[] | null;
  owner_name: string | null;
  owner_handle: string | null;
  shared_at: string;
  updated_at: string;
}

/** True for a link share, false for a friend share. */
export function isLinkShare(s: Pick<LoadoutShareRow, 'token'>): boolean {
  return s.token !== null && s.token !== '';
}

/**
 * Mirrors `loadout_shares_token_len` plus the shape `new_share_token()`
 * actually mints (two dash-stripped v4 uuids = 64 hex chars). Used to reject
 * an obviously mangled URL before it becomes a round trip; the authority
 * stays `get_shared_loadout()`.
 */
export function isValidShareToken(raw: string): boolean {
  return /^[0-9a-f]{32,128}$/i.test(raw.trim());
}

/**
 * The canonical, absolute URL of a share token. Absolute because the whole
 * point is that it gets pasted somewhere else; built from `location.origin`
 * so it is right on the preview deployments too.
 */
export function shareLinkFor(token: string, origin?: string | null): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/shared/loadout/${token}`;
}

/** `items` arrives as JSONB and may legitimately be null on an empty loadout. */
export function shareItems(row: { items: RoleLoadoutItem[] | null }): RoleLoadoutItem[] {
  return Array.isArray(row.items) ? row.items : [];
}

/**
 * Maps a PostgREST error onto an i18n key. Same contract as
 * `friendErrorKey()`: the RPCs raise stable one-word codes so raw SQL text
 * never reaches a template.
 */
export function shareErrorKey(message: string | null | undefined): string {
  const code = (message ?? '').toLowerCase();
  if (code.includes('not_friends')) return 'share.error.notFriends';
  if (code.includes('loadout_not_found')) return 'share.error.loadoutNotFound';
  if (code.includes('share_not_found')) return 'share.error.shareNotFound';
  if (code.includes('account_suspended')) return 'share.error.suspended';
  if (code.includes('invalid_target')) return 'share.error.invalidTarget';
  if (code.includes('not approved')) return 'share.error.notApproved';
  return 'share.error.generic';
}
