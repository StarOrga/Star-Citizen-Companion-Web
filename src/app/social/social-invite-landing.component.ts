import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { FriendsService } from './friends.service';
import { edgeLabel } from './friends.types';
import { SocialService } from './social.service';
import { InviteRedeemResult, friendPath, isValidInviteToken } from './social.types';

type State =
  | { kind: 'loading' }
  | { kind: 'dead' }
  | { kind: 'error'; key: string }
  | { kind: 'ready'; handle: string | null };

/**
 * `/invite/<token>` (C20, D16). Public: a signed-out visitor sees who invited
 * them and gets a sign-in step that returns here. Signed in, one explicit
 * button files the friend request (D1: the inviter still accepts). Redeeming
 * is a button and not a side effect of opening the page, so a link preview in
 * Discord cannot file requests. Every kind of dead link renders the same state.
 */
@Component({
  selector: 'sc-social-invite-landing',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="sc-card state">
        <h1>{{ 'social.inviteLanding.title' | translate }}</h1>
        @switch (state().kind) {
          @case ('loading') { <p>{{ 'social.inviteLanding.loading' | translate }}</p> }
          @case ('dead') {
            <p>{{ 'social.inviteLanding.dead' | translate }}</p>
            <a class="sc-btn" routerLink="/social">{{ 'social.inviteLanding.toSocial' | translate }}</a>
          }
          @case ('error') {
            <p class="err" role="alert">{{ errorKey() | translate }}</p>
            <button type="button" class="sc-btn" (click)="ngOnInit()">{{ 'errors.retry' | translate }}</button>
          }
          @case ('ready') {
            <p>{{ (handle() ? 'social.inviteLanding.from' : 'social.inviteLanding.fromAnon') | translate: { name: handle() } }}</p>
            @if (result(); as r) {
              <p class="ok" role="status">
                {{ ('social.inviteLanding.result.' + r.verdict) | translate: { name: resultName(r) } }}
              </p>
              @if (r.verdict === 'pending') {
                <a class="sc-btn" routerLink="/social">{{ 'social.inviteLanding.toSocial' | translate }}</a>
              } @else {
                <a class="sc-btn sc-btn-primary" [routerLink]="friendLink(r)">{{ 'social.inviteLanding.toFriend' | translate: { name: resultName(r) } }}</a>
              }
            } @else if (auth.isAuthenticated()) {
              @if (social.error(); as key) { <p class="err" role="alert">{{ key | translate }}</p> }
              <p class="hint">{{ 'social.inviteLanding.hint' | translate }}</p>
              <button type="button" class="sc-btn sc-btn-primary" [disabled]="social.busy()" (click)="redeem()">
                {{ 'social.inviteLanding.accept' | translate }}
              </button>
            } @else {
              <p class="hint">{{ 'social.inviteLanding.signInHint' | translate }}</p>
              <a class="sc-btn sc-btn-primary" routerLink="/login" [queryParams]="{ redirect: returnPath() }">
                {{ 'social.inviteLanding.signIn' | translate }}
              </a>
            }
          }
        }
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; }
    .state { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
    h1 { margin: 0; font-size: 1.3rem; }
    p { margin: 0; overflow-wrap: anywhere; }
    .hint { color: var(--sc-fg-2); }
    .err { color: var(--sc-danger); }
    .ok { color: var(--sc-success); }
    a.sc-btn { text-decoration: none; display: inline-flex; align-items: center; }
    @media (pointer: coarse) { .sc-btn { min-height: 48px; } }
  `],
})
export class SocialInviteLandingComponent implements OnInit {
  readonly social = inject(SocialService);
  readonly auth = inject(AuthService);
  private readonly friends = inject(FriendsService);
  private readonly route = inject(ActivatedRoute);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';
  readonly state = signal<State>({ kind: 'loading' });
  readonly result = signal<InviteRedeemResult | null>(null);

  readonly handle = computed(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.handle : null;
  });
  readonly errorKey = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.key : 'errors.generic';
  });

  /** A same-origin absolute path, which is what the login page's redirect accepts. */
  returnPath(): string {
    return `/invite/${this.token}`;
  }

  async ngOnInit(): Promise<void> {
    if (!isValidInviteToken(this.token)) {
      this.state.set({ kind: 'dead' });
      return;
    }
    this.state.set({ kind: 'loading' });
    await this.auth.whenReady();
    const peek = await this.social.peekInvite(this.token);
    if (peek) this.state.set({ kind: 'ready', handle: peek.display_handle });
    else if (this.social.error()) this.state.set({ kind: 'error', key: this.social.error() ?? 'errors.generic' });
    else this.state.set({ kind: 'dead' });
  }

  async redeem(): Promise<void> {
    const r = await this.social.redeemInvite(this.token);
    if (!r) return;
    this.result.set(r);
    await this.friends.load();
  }

  resultName(r: InviteRedeemResult): string {
    return edgeLabel(r);
  }

  friendLink(r: InviteRedeemResult): string[] {
    return friendPath(r);
  }
}
