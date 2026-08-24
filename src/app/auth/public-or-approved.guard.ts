import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { RoleService } from './role.service';

/**
 * Hybrid gate for the public hangar landing (#131): anonymous visitors pass
 * (the dashboard renders a benefits teaser + sign-in CTA instead of data),
 * while signed-in users go through the same invite check as `approvedGuard` —
 * a non-approved session is signed out and bounced, exactly like on the
 * private routes. Never runs the role lookup for anon (RoleService.waitReady
 * would hang without a user).
 *
 * NOTE: no route references this guard any more — the access-control redesign
 * (2026-08-05) retired the signed-out hangar teaser, see the comment on the
 * `hangar` route in `app.routes.ts`. It is kept because it is the only shape
 * a future public-but-gated route would need. It is therefore held to the same
 * safety rules as `approvedGuard` rather than left to rot with the old
 * destructive one.
 */
export const publicOrApprovedGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const roles = inject(RoleService);
  const router = inject(Router);

  auth.init();
  await waitForReady(auth);
  if (!auth.isAuthenticated()) return true; // anon → component shows the teaser

  await roles.waitReady();
  if (roles.approved()) return true;

  // Same distinction `approvedGuard` makes: `approved() === false` is also
  // what a transient `profiles` read failure with no known-good data
  // (`identityUnknown()`) and `waitReady()`'s timeout fallback (`!loaded()`)
  // look like. Neither is grounds to destroy a real session. On THIS route
  // the conservative answer differs from `approvedGuard`'s, though: the route
  // is public by design, so let it render — the component already falls back
  // to the teaser when `approved()` is false, which is precisely the
  // fail-closed behaviour for the data. Blocking instead would deny a page
  // an anonymous visitor is allowed to see.
  if (!roles.loaded() || roles.identityUnknown()) return true;

  // Genuinely not invited (a real, DB-confirmed `is_approved = false`).
  await auth.signOut(false);
  return router.createUrlTree(['/login'], { queryParams: { denied: 'invite' } });
};

function waitForReady(auth: AuthService): Promise<void> {
  return new Promise((resolve) => {
    if (auth.ready()) return resolve();
    const interval = setInterval(() => {
      if (auth.ready()) {
        clearInterval(interval);
        resolve();
      }
    }, 30);
  });
}
