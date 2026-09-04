/**
 * Types + pure helpers for the moderation surface (migration
 * 20260904020000, admin feedback cf0ddf7d phase 2).
 *
 * Two audiences share this file:
 *   * the SIGNED-IN user, who may be carrying a warning ("grace period with
 *     info to the user") or an active suspension, and
 *   * the ADMIN, who decides between the two on a reported account.
 *
 * Everything crosses the wire through SECURITY DEFINER RPCs — there is no
 * table read anywhere in this feature — so the shapes below mirror the
 * functions' RETURNS TABLE, not a table schema.
 */

/** One row of `my_account_status()` — the caller's own moderation state. */
export interface AccountStatusRow {
  suspended: boolean;
  suspended_at: string | null;
  suspended_until: string | null;
  /** Only populated while `suspended` is true; the RPC nulls it otherwise. */
  suspension_reason: string | null;
  /** Newest un-acknowledged warning, if any. */
  warning_id: string | null;
  warning_reason: string | null;
  warning_at: string | null;
}

/** The neutral state — also what a pre-migration DB is treated as. */
export function clearAccountStatus(): AccountStatusRow {
  return {
    suspended: false,
    suspended_at: null,
    suspended_until: null,
    suspension_reason: null,
    warning_id: null,
    warning_reason: null,
    warning_at: null,
  };
}

/**
 * Suspension state as the admin table renders it, straight off
 * `list_users_for_admin()`. Every field is optional: the admin page must keep
 * working against a DB that has not had this migration applied yet (the app
 * deploys on merge, the migration lands out of band afterwards).
 */
export interface SuspensionFields {
  suspended?: boolean | null;
  suspended_at?: string | null;
  suspended_until?: string | null;
  suspension_reason?: string | null;
}

/** True only for a CONFIRMED active suspension — `undefined` is not "yes". */
export function isSuspended(u: SuspensionFields | null | undefined): boolean {
  return u?.suspended === true;
}

/**
 * `null` = indefinite (that is what `suspended_until is null` means in the
 * DB), a Date otherwise. A value in the past means the suspension already
 * lifted itself, which `isSuspended()` above has already accounted for.
 */
export function suspensionEnd(u: SuspensionFields | null | undefined): Date | null {
  const raw = u?.suspended_until;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Mirrors `moderation_actions_reason_len` — the client refuses before the DB does. */
export const MODERATION_REASON_MAX = 2000;

/**
 * Preset suspension lengths offered in the admin dialog. `null` = indefinite,
 * i.e. "until an admin lifts it" — the strongest option, so it is last.
 */
export const SUSPENSION_DURATIONS: readonly (number | null)[] = [1, 7, 30, null];

/** Mirrors `suspend_user()`'s `days between 1 and 3650` guard. */
export function isValidSuspensionDays(days: number | null): boolean {
  return days === null || (Number.isInteger(days) && days >= 1 && days <= 3650);
}

/** A moderation reason is mandatory — the RPC raises `reason_required` on blank. */
export function isValidModerationReason(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= MODERATION_REASON_MAX;
}

/**
 * Maps a PostgREST error onto an i18n key, same contract as
 * `friendErrorKey()`: the RPCs raise stable one-word codes precisely so no
 * raw SQL text can reach a template.
 */
export function moderationErrorKey(message: string | null | undefined): string {
  const code = (message ?? '').toLowerCase();
  if (code.includes('target_protected')) return 'admin.moderation.error.protected';
  if (code.includes('invalid_target')) return 'admin.moderation.error.invalidTarget';
  if (code.includes('user_not_found')) return 'admin.moderation.error.userNotFound';
  if (code.includes('reason_required')) return 'admin.moderation.error.reasonRequired';
  if (code.includes('reason_too_long')) return 'admin.moderation.error.reasonTooLong';
  if (code.includes('invalid_duration')) return 'admin.moderation.error.invalidDuration';
  if (code.includes('forbidden')) return 'admin.moderation.error.forbidden';
  return 'admin.moderation.error.generic';
}

/**
 * True when the error means "this DB has not had migration 20260904020000
 * applied yet". PostgREST answers an unknown RPC with PGRST202 / "Could not
 * find the function"; the app deploys on merge and the migration is applied
 * out of band afterwards, so this window is real and must degrade to "no
 * moderation state known", never to a lockout.
 */
export function isMissingFunction(message: string | null | undefined, code?: string | null): boolean {
  if (code === 'PGRST202' || code === '42883') return true;
  // Deliberately NOT a bare "does not exist" match. That substring also comes
  // back from `relation … does not exist` / `column … does not exist`, i.e.
  // from a HALF-applied migration — exactly the window this check exists for
  // — and treating those as "the feature is not deployed" would quietly
  // disarm client-side suspension enforcement on a transient server error.
  // Only PostgREST's own wording for an unknown RPC counts.
  return (message ?? '').toLowerCase().includes('could not find the function');
}
