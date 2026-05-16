import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  auth.init();
  await waitForReady(auth);

  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
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
