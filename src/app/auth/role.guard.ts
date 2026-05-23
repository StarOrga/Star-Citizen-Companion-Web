import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role, RoleService } from './role.service';

/**
 * Guard factory — pass the roles allowed to enter the route.
 * Example: `canActivate: [roleGuard('admin')]` or `[roleGuard('admin', 'collaborator')]`
 *
 * Behavior:
 *  - Not authenticated → redirect to /login with redirect query
 *  - Authenticated but wrong role → redirect to /news (silent demote)
 */
export function roleGuard(...allowed: Role[]): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const roles = inject(RoleService);
    const router = inject(Router);

    auth.init();
    await waitForAuth(auth);
    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
    }

    await roles.waitReady();
    const r = roles.role();
    if (r && allowed.includes(r)) return true;
    return router.createUrlTree(['/news']);
  };
}

function waitForAuth(auth: AuthService): Promise<void> {
  if (auth.ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (auth.ready()) {
        clearInterval(id);
        resolve();
      }
    }, 30);
  });
}
