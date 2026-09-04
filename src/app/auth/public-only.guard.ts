import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { safeRedirectTarget } from '../core/safe-redirect.util';

/**
 * Guards `/login` against an already-authenticated visitor.
 *
 * Defect B: exiting a "View as" preview reloads the SAME document (same URL,
 * incl. any `?redirect=…` query string authGuard attached when it originally
 * bounced a shadowed session to /login) — see `ImpersonationService.exit()`.
 * This guard used to unconditionally send an authenticated visitor to
 * `/news`, silently discarding that `redirect` and dropping the admin's
 * place (e.g. `/login?redirect=/starscape` → `/news` instead of back to
 * `/starscape`). Honoring `redirect` here — validated through the exact same
 * `safeRedirectTarget()` used by `LoginComponent`'s post-sign-in navigation —
 * fixes both that case and the ordinary "already signed in, typed /login by
 * hand" case (no `redirect` param → falls back to `/news`, unchanged).
 *
 * The `redirect` value is untrusted input on this read-back, same as
 * anything read out of `sc.viewAs` storage — `safeRedirectTarget()` rejects
 * anything that is not a same-origin absolute path (rejects
 * `//evil.example`) so this can never become an open redirect.
 */
export const publicOnlyGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  auth.init();
  await waitForReady(auth);
  if (!auth.isAuthenticated()) return true;
  const target = safeRedirectTarget(route.queryParamMap.get('redirect'));
  return router.parseUrl(target);
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
