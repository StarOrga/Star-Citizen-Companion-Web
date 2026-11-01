/**
 * Which release ring the auto-updater follows.
 *
 * `auto` — the default — follows the highest ring the signed-in account's role
 * reaches (admin → alpha, collaborator → beta, everyone else → stable), the same
 * contract as Starscape's tray. A pinned ring is an explicit pick in ⚙ and is
 * only offered to admins and collaborators.
 */

export type ReleaseRing = 'alpha' | 'beta' | 'stable';
export type RingPref = 'auto' | ReleaseRing;
export type UserRole = 'admin' | 'collaborator' | 'viewer';

export function isRingPref(v: unknown): v is RingPref {
  return v === 'auto' || v === 'alpha' || v === 'beta' || v === 'stable';
}

export function isReleaseRing(v: unknown): v is ReleaseRing {
  return v === 'alpha' || v === 'beta' || v === 'stable';
}

/** Highest ring a role reaches. */
export function highestRingFor(role: UserRole | null): ReleaseRing {
  switch (role) {
    case 'admin':
      return 'alpha';
    case 'collaborator':
      return 'beta';
    default:
      return 'stable';
  }
}

/** The ring to follow: the pin, or — under auto — the last resolved ring. */
export function effectiveRing(pref: RingPref, autoRing: ReleaseRing): ReleaseRing {
  return pref === 'auto' ? autoRing : pref;
}
