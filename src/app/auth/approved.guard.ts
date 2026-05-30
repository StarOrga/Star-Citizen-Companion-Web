import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { RoleService } from './role.service';

/**
 * Invite-only gate. Runs after `authGuard` (which guarantees a session).
 * A user passes only when their profile is flagged `is_approved` — i.e.
 * they were invited by an admin (or are the bootstrap admin). Anyone who
 * self-registered (open sign-up / first-time Google) is approved=false:
 * we sign them out and bounce to /login with `?denied=invite` so the
 * login page can explain why.
 */
export const approvedGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const roles = inject(RoleService);
  const router = inject(Router);

  auth.init();
  await waitForReady(auth);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  await roles.waitReady();
  if (roles.approved()) return true;

  // Not invited — drop the session and explain on the login page.
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
