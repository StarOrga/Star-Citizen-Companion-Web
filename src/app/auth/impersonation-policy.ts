/**
 * Pure policy for the "View as" role-preview feature. No Angular here —
 * this is the single security gate the rest of the feature is built on.
 *
 * Non-negotiable: `impersonationTargets(actual)` is the ONLY allow-list.
 * `clampViewAs` must be implemented in terms of it — never widen the gate
 * with a rank-based shortcut (e.g. "anything ranked lower than actual").
 */

export type Role = 'admin' | 'collaborator' | 'viewer';
export type ViewAs = Role | 'anon';

/** Rank ladder — for invariant assertions/tests only, never for the gate itself. */
export const VIEW_RANK: Record<ViewAs, number> = {
  anon: 0,
  viewer: 1,
  collaborator: 2,
  admin: 3,
};

const ALL_VIEW_AS: readonly ViewAs[] = ['anon', 'viewer', 'collaborator', 'admin'];

/**
 * THE allow-list. Strictly weaker views only. Empty for 'viewer' and for
 * an unknown/not-yet-loaded real role (fail closed).
 */
export function impersonationTargets(actual: Role | null): readonly ViewAs[] {
  switch (actual) {
    case 'admin':
      return ['collaborator', 'viewer', 'anon'];
    case 'collaborator':
      return ['viewer', 'anon'];
    case 'viewer':
    case null:
    default:
      return [];
  }
}

/** Narrowing guard for untrusted (storage) values. */
export function isViewAs(value: unknown): value is ViewAs {
  return typeof value === 'string' && (ALL_VIEW_AS as readonly string[]).includes(value);
}

/**
 * Validates an untrusted (storage) value against the allow-list for the
 * given real role. Anything not a member of `impersonationTargets(actual)`
 * — including malformed strings, wrong case, whitespace, non-strings,
 * objects, or `'admin'` itself — collapses to `null` (no impersonation).
 */
export function clampViewAs(actual: Role | null, stored: unknown): ViewAs | null {
  if (!isViewAs(stored)) return null;
  const targets = impersonationTargets(actual);
  return targets.includes(stored) ? stored : null;
}
