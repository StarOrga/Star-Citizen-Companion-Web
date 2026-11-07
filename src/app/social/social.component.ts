import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { FriendsComponent } from './friends.component';
import { SocialCompareComponent } from './social-compare.component';
import { SocialEinsatzComponent } from './social-einsatz.component';
import { SocialGroupsComponent } from './social-groups.component';
import { SocialInviteBoxComponent } from './social-invite-box.component';
import { SocialVisibilityDialogComponent } from './social-visibility-dialog.component';
import { SocialService } from './social.service';
import { VISIBILITY_FACETS } from './social.types';

export const SOCIAL_NOTICE_KEY = 'sc.social.visibility-notice.dismissed';

/**
 * The Social page (`/social`, opened from the profile-icon menu; `/friends`
 * redirects here). Requests, friends with an online dot, the invite box,
 * groups, comparison, and the popup that decides what friends see.
 */
@Component({
  selector: 'sc-social',
  standalone: true,
  imports: [
    TranslatePipe,
    PageHeaderComponent,
    FriendsComponent,
    SocialInviteBoxComponent,
    SocialGroupsComponent,
    SocialCompareComponent,
    SocialEinsatzComponent,
    SocialVisibilityDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <sc-page-header
        [title]="'social.page.title' | translate"
        [subtitle]="'social.page.subtitle' | translate">
        <button phActions type="button" class="sc-btn" (click)="openVisibility()">
          {{ 'social.page.visibilityButton' | translate }}
        </button>
      </sc-page-header>

      @if (showNotice()) {
        <div class="notice" role="note">
          <p>{{ 'social.notice.text' | translate }}</p>
          <div class="notice-actions">
            <button type="button" class="sc-btn sc-btn-primary" (click)="openVisibility()">
              {{ 'social.notice.open' | translate }}
            </button>
            <button type="button" class="sc-btn" (click)="dismissNotice()">
              {{ 'social.notice.dismiss' | translate }}
            </button>
          </div>
        </div>
      }

      <sc-friends (inviteRequested)="invite()?.reveal()" />
      <sc-social-invite-box />
      <sc-social-groups />
      <sc-social-einsatz />
      <sc-social-compare />

      @if (visibilityOpen()) {
        <sc-social-visibility-dialog (closed)="visibilityOpen.set(false)" />
      }
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; }
    .notice {
      padding: 14px 16px; border-radius: 6px; border: 1px solid var(--sc-accent); background: rgba(0, 212, 255, 0.07);
    }
    .notice p { margin: 0 0 10px; color: var(--sc-fg-1); }
    .notice-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    @media (pointer: coarse) { .notice-actions .sc-btn { min-height: 48px; } }
  `],
})
export class SocialComponent implements OnInit {
  private readonly social = inject(SocialService);

  readonly invite = viewChild(SocialInviteBoxComponent);
  readonly visibilityOpen = signal(false);
  private readonly dismissed = signal(readDismissed());

  /**
   * One-time notice for an account that never changed what friends see: all
   * four switches on, no override. Loaded state decides, so a failed load
   * shows nothing rather than a wrong promise.
   */
  readonly showNotice = computed(() => {
    const v = this.social.visibility();
    if (!v || this.dismissed()) return false;
    return v.overrides.length === 0 && VISIBILITY_FACETS.every((f) => v.general[f]);
  });

  ngOnInit(): void {
    void this.social.loadVisibility();
    void this.social.loadOnline();
  }

  openVisibility(): void {
    this.visibilityOpen.set(true);
  }

  dismissNotice(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(SOCIAL_NOTICE_KEY, '1');
    } catch {
      // Storage blocked: the notice returns on the next visit, which is harmless.
    }
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(SOCIAL_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}
