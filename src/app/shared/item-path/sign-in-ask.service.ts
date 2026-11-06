import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { ScConfirmService } from '../dialog/sc-confirm.service';

/** Signed out, a write asks first, then leads to the sign-in page and back here afterwards. */
@Injectable({ providedIn: 'root' })
export class SignInAskService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ScConfirmService);

  /** True when signed in. */
  async ensure(): Promise<boolean> {
    if (this.auth.user()) return true;
    const go = await this.confirm.confirm({
      titleKey: 'search.signIn.title',
      messageKey: 'search.signIn.message',
      confirmKey: 'search.signIn.confirm',
    });
    if (go) void this.router.navigate(['/login'], { queryParams: { redirect: this.router.url } });
    return false;
  }
}
