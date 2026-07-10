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
