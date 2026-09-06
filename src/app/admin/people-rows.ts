import type { Role } from '../auth/role.service';

/**
 * The merge behind the admin panel's single people list (feedback 5e2facd9).
 *
 * The panel used to show two tables: the accounts from `list_users_for_admin()`
 * and, above them, the whole `list_allowed_emails()` allowlist. Every address
 * that had actually signed in therefore appeared twice — once as an allowlist
 * row whose only content was the word "joined", once as the account it had
 * become. This folds the two into one list and drops the duplicate half.
 *
 * Kept as a pure function next to `admin-protection.ts` for the same reason:
 * the rule that decides whether a person is listed once or twice deserves a
 * test that does not need a TestBed.
 */

/** The bits of an account row the merge itself reads. */
export interface PeopleAccountLike {
  id: string;
  email: string;
  role: Role;
  created_at: string;
}

/** The bits of an `allowed_emails` row the merge itself reads. */
export interface PeopleInviteLike {
  email: string;
  role: Role;
  created_at: string;
  /** Projected by `list_allowed_emails()` — an `auth.users` row exists. */
  joined: boolean;
}

/**
 * One line of the people list — either a real account or a still-open
 * invitation. Exactly one of `user`/`invite` is set; callers narrow on that
 * rather than on a discriminant string, so both row shapes stay type-checked
 * (Angular's `@if (p.user; as u)` narrows the same way a `if` would).
 */
export interface PeopleRow<A extends PeopleAccountLike, I extends PeopleInviteLike> {
  /** Stable `@for` key — the account id, or `invite:<email>`. */
  key: string;
  email: string;
  role: Role;
  /** When the account signed up / the invitation was added. */
  since: string;
  user: A | null;
  invite: I | null;
}

/**
 * Accounts first, then the invitations that have not been taken up yet.
 *
 * An invitation is suppressed as soon as there is an account behind it. Two
 * independent tests for that, because they fail in different directions:
 * `joined` is the RPC's own `auth.users` probe (it sees accounts this admin's
 * user list may not project), and the email comparison catches the window
 * where a fresh signup is already in `users` but the allowlist snapshot in
 * memory still predates `consumed_at` being stamped.
 *
 * Ordering is not decided here — the component sorts the merged list by the
 * column the admin picked.
 */
export function mergePeopleRows<A extends PeopleAccountLike, I extends PeopleInviteLike>(
  accounts: readonly A[],
  invites: readonly I[],
): PeopleRow<A, I>[] {
  const claimed = new Set(accounts.map((u) => u.email.toLowerCase()));
  const rows: PeopleRow<A, I>[] = accounts.map((u) => ({
    key: u.id,
    email: u.email,
    role: u.role,
    since: u.created_at,
    user: u,
    invite: null,
  }));
  for (const a of invites) {
    if (a.joined || claimed.has(a.email.toLowerCase())) continue;
    rows.push({
      key: `invite:${a.email}`,
      email: a.email,
      role: a.role,
      since: a.created_at,
      user: null,
      invite: a,
    });
  }
  return rows;
}
