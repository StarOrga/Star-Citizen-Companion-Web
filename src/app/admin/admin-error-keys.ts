/**
 * Edge-function error codes → i18n keys for the admin surfaces (audit plan
 * D05, AUD-295/AUD-345). The functions answer `{ error: '<snake_case code>',
 * message?: '<operator context>' }`; only the code is mapped, the `message`
 * never reaches the UI. Pure functions, shared by the admin page and the
 * account-deletion flow in settings.
 */

/** Every code `supabase/functions/invite-user` can answer with (see its header). */
export const INVITE_ERROR_CODES = [
  'method_not_allowed',
  'server_misconfigured',
  'unauthorized',
  'forbidden',
  'invalid_json',
  'invalid_email',
  'invalid_role',
  'allowlist_write_failed',
  'user_lookup_failed',
  'invite_failed',
  'role_assign_failed',
  'existing_account_not_updated',
  'user_exists',
] as const;

/** Every code `supabase/functions/delete-user` can answer with (see its header). */
export const DELETE_USER_ERROR_CODES = [
  'protected_admin',
  'cannot_delete_last_admin',
  'user_not_found',
  'forbidden',
  'unauthorized',
  'invalid_body',
  'delete_failed',
  'server_misconfigured',
  'method_not_allowed',
] as const;

const INVITE = new Set<string>(INVITE_ERROR_CODES);
const DELETE_USER = new Set<string>(DELETE_USER_ERROR_CODES);

/** i18n key for an `invite-user` error code; unknown/missing → `admin.register.unknownError`. */
export function inviteErrorKey(code: string | null): string {
  return code && INVITE.has(code) ? `admin.register.err.${code}` : 'admin.register.unknownError';
}

/** i18n key for a `delete-user` error code; unknown/missing → `fallback`. */
export function deleteUserErrorKey(code: string | null, fallback = 'admin.delete.failed'): string {
  return code && DELETE_USER.has(code) ? `admin.delete.err.${code}` : fallback;
}

/**
 * Admin RPCs (`set_user_role`, …) raise prose such as
 * `forbidden: admin role required` or `protected_admin: …`. Their prefix is the
 * stable part; map it before the generic translator sees the text.
 */
export function adminRpcErrorKey(err: unknown): string | null {
  const msg = (err as { message?: unknown } | null)?.message;
  if (typeof msg !== 'string') return null;
  if (msg.startsWith('protected_admin')) return 'admin.delete.err.protected_admin';
  if (msg.startsWith('forbidden')) return 'errors.forbidden';
  return null;
}
