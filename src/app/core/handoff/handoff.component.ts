import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { HandoffService, maskEmail } from './handoff.service';

/** Same shape check as the edge function: 43 base64url chars. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Phone landing page of "Continue on your phone". Plain layout (route data).
 *
 * Login-CSRF guard: opening the link NEVER signs the browser in. The page
 * shows which account the code belongs to (read-only peek, masked) and waits
 * for an explicit tap; if another account is already signed in here, that tap
 * additionally needs a confirmation.
 *
 * The code travels in the URL fragment (`#c=`), never reaches a server log or a
 * Referer, and is stripped from the address bar before any network call.
 */
@Component({
  selector: 'sc-handoff',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wrap">
      <div class="sc-card card">
        <h1>{{ 'handoff.title' | translate }}</h1>
        @if (errorKey(); as key) {
          <p class="lead" role="alert">{{ key | translate }}</p>
          <a routerLink="/login" class="sc-btn sc-btn-primary">{{ 'handoff.toLogin' | translate }}</a>
        } @else if (account(); as who) {
          <p class="lead">{{ 'handoff.confirm.lead' | translate }}</p>
          <button type="button" class="sc-btn sc-btn-primary" [disabled]="busy()" (click)="signIn()">
            {{ 'handoff.confirm.signInAs' | translate: { account: who } }}
          </button>
        } @else {
          <p class="lead" role="status">{{ 'handoff.working' | translate }}</p>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .wrap {
        display: grid;
        place-items: center;
        min-height: 60dvh;
      }
      .card {
        max-width: 28rem;
        display: grid;
        gap: 0.75rem;
      }
    `,
  ],
})
export class HandoffComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly handoff = inject(HandoffService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ScConfirmService);

  readonly errorKey = signal<string | null>(null);
  /** Masked account the code would sign in; set once the peek succeeded. */
  readonly account = signal<string | null>(null);
  readonly busy = signal(false);
  private code = '';
  private ownerId = '';
  private targetPath = '/';

  async ngOnInit(): Promise<void> {
    this.code = this.readCode();
    // Strip the secret from the address bar / history BEFORE any request.
    if (typeof history !== 'undefined') history.replaceState(history.state, '', location.pathname);
    if (!CODE_SHAPE.test(this.code)) {
      this.errorKey.set('handoff.errors.invalidCode');
      return;
    }
    try {
      const peek = await this.handoff.peek(this.code);
      this.ownerId = peek.userId;
      this.targetPath = peek.targetPath;
      this.account.set(peek.account);
    } catch (err) {
      this.errorKey.set(await this.handoff.errorKey('peek', err));
    }
  }

  async signIn(): Promise<void> {
    // Claimed before the first await: a double tap must not send two redeems.
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.ready();
      const me = this.auth.realUser();
      // Account identity is the user id; the mask is display only (it collides).
      if (me && me.id === this.ownerId) {
        // Already signed in as the owner: nothing to redeem, the code just expires.
        await this.router.navigateByUrl(this.targetPath, { replaceUrl: true });
        return;
      }
      if (me) {
        const ok = await this.confirmDialog.confirm({
          titleKey: 'handoff.switch.title',
          messageKey: 'handoff.switch.message',
          params: { current: maskEmail(me.email ?? ''), target: this.account() },
          confirmKey: 'handoff.switch.confirm',
          tone: 'danger',
        });
        if (!ok) {
          this.busy.set(false);
          return;
        }
      }
      const path = await this.handoff.redeem(this.code);
      await this.router.navigateByUrl(path, { replaceUrl: true });
    } catch (err) {
      this.errorKey.set(await this.handoff.errorKey('redeem', err));
      this.busy.set(false);
    }
  }

  private readCode(): string {
    const frag = this.route.snapshot.fragment ?? location.hash.replace(/^#/, '');
    return new URLSearchParams(frag).get('c') ?? '';
  }
}
