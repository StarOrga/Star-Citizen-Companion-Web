import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const publicOnlyGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  auth.init();
  await waitForReady(auth);
  return auth.isAuthenticated() ? router.createUrlTree(['/news']) : true;
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
