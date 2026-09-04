import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountStatusService } from '../social/account-status.service';
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
  const account = inject(AccountStatusService);
  const router = inject(Router);

  auth.init();
  await waitForReady(auth);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  await roles.waitReady();
  if (roles.approved()) {
    // A suspension (feedback cf0ddf7d phase 2) is checked AFTER approval and
    // through its own RPC, never through the `profiles` read above — see
    // AccountStatusService for why widening that read would lock everybody
    // out during the deploy→migration window.
    //
    // Same fail-closed asymmetry as the approval branch, mirrored: only a
    // CONFIRMED `suspended === true` destroys the session. An unreachable or
    // not-yet-migrated RPC leaves `suspended()` false and the navigation
    // proceeds — the server side is the real lockout (`is_approved()` is
    // false for a suspended account, so every gated table denies it anyway),
    // and inventing a suspension out of a network blip would sign real users
    // out for nothing.
    await account.ensureLoaded();
    if (account.suspended()) {
      account.rememberNotice();
      await auth.signOut(false);
      return router.createUrlTree(['/login'], { queryParams: { denied: 'suspended' } });
    }
    return true;
  }

  // `approved() === false` is not always the confirmed "not invited" fact
  // it used to always be: it's also what a transient `profiles` read
  // failure with no known-good data yet looks like (`identityUnknown()`),
  // and what `waitReady()`'s timeout fallback looks like (`!loaded()`).
  // Neither is grounds to destroy a real session — so fail closed on
  // GRANTING access without touching the session.
  //
  // How that denial is expressed matters: returning `false` makes the
  // router abandon the navigation, and when it is the FIRST navigation of a
  // page load there is then no active route at all — an empty window, no
  // message, no way out but a manual reload. That is what a user hit on
  // 2026-08-30 after a Google sign-in (`RoleService.refresh()` now retries
  // the 401 that caused it). Route to a page that says so instead; it lives
  // outside these gated routes, so it cannot bounce back here in a loop.
  if (!roles.loaded() || roles.identityUnknown()) {
    return router.createUrlTree(['/unavailable'], { queryParams: { redirect: state.url } });
  }

  // Genuinely not invited (a real, DB-confirmed `is_approved = false`) —
  // drop the session and explain on the login page.
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
