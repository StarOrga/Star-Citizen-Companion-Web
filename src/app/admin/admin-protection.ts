import type { Role } from '../auth/role.service';

/**
 * Client-side mirror of the DB guard from migration
 * `20260730120000_protected_admins.sql`.
 *
 * The database is the authority: `public.protected_admins` + the
 * `profiles_protected_admin_guard` trigger reject every demotion,
 * un-approval and deletion of a protected account, no matter which
 * caller attempts it. These helpers exist purely so the admin table can
 * explain *why* a button is dead instead of letting the admin run into
 * a raw 403 from PostgREST.
 */
export interface ProtectableUser {
  role: Role;
  /** Projected by `list_users_for_admin()` — true ⇒ row in `protected_admins`. */
  protected?: boolean | null;
}

/** Is this account in the protected set? */
export function isProtectedAccount(u: ProtectableUser): boolean {
  return u.protected === true;
}

/**
 * Would a role change be rejected by the DB? Protected accounts have a
 * frozen role — including promotions, since the trigger keys on "role
 * changed at all", not on "role got weaker".
 */
export function isRoleChangeBlocked(u: ProtectableUser, newRole: Role): boolean {
  return isProtectedAccount(u) && newRole !== u.role;
}

/** Would deleting this account be rejected by the DB? */
export function isDeleteBlocked(u: ProtectableUser): boolean {
  return isProtectedAccount(u);
}
