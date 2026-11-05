import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { FriendsService } from '../../social/friends.service';
import { FriendEdgeRow } from '../../social/friends.types';
import { SocialService } from '../../social/social.service';
import { friendPath } from '../../social/social.types';
import { hqPage } from '../hq-routes';

/**
 * Friends on HQ Start (C11, C10): a card ONLY while friend requests are waiting, answered in one
 * click right here, and one quiet line when friends shared Einsätze with the reader. With neither
 * the component renders nothing at all, so an account without friends sees Start exactly as before.
 */
@Component({
  selector: 'sc-hq-start-friends',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (requests().length) {
      <section class="card" aria-labelledby="hq-start-requests">
        <h2 id="hq-start-requests">{{ 'hq.friends.requests.title' | translate: { n: requests().length } }}</h2>
        <ul class="list">
          @for (r of requests(); track r.request_id) {
            <li>
              <a class="who" [routerLink]="path(r)">{{ r.display_name || r.username || '—' }}</a>
              <span class="acts">
                <button type="button" class="sc-btn tiny" [disabled]="friends.busy()" (click)="answer(r, true)">{{ 'hq.friends.requests.accept' | translate }}</button>
                <button type="button" class="sc-btn tiny ghost" [disabled]="friends.busy()" (click)="answer(r, false)">{{ 'hq.friends.requests.decline' | translate }}</button>
              </span>
            </li>
          }
        </ul>
        @if (friends.error(); as key) {
          <p class="err" role="alert">{{ key | translate }}</p>
        }
      </section>
    }
    @if (sharedCount() > 0) {
      <p class="line">
        <a [routerLink]="plan.commands" [fragment]="plan.fragment">{{ 'hq.friends.sharedLine' | translate: { n: sharedCount() } }} ›</a>
      </p>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; align-items: center; gap: var(--sc-space-2, 8px); width: 100%; }
      .card { width: min(100%, 32rem); display: grid; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); background: color-mix(in srgb, var(--sc-bg-1) 80%, transparent); }
      h2 { margin: 0; font: 600 1rem / 1.3 var(--sc-font-display); }
      .list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-2, 8px); }
      .list li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sc-space-2, 8px); }
      .acts { display: inline-flex; gap: var(--sc-space-2, 8px); }
      a { color: var(--sc-accent); }
      a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .line { margin: 0; font-size: max(0.85rem, var(--sc-fs-floor)); }
      .err { margin: 0; color: var(--sc-warning); }
      @media (pointer: coarse) { .sc-btn { min-height: 48px; } }
    `,
  ],
})
export class HqStartFriendsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly friends = inject(FriendsService);
  private readonly social = inject(SocialService);

  protected readonly plan = hqPage('planen');
  protected readonly requests = computed(() => this.friends.graph().incoming);
  protected readonly sharedCount = computed(() => this.social.sharedEinsaetze().length);

  async ngOnInit(): Promise<void> {
    if (!this.auth.user()) return;
    await this.friends.load();
    if (this.friends.friendCount() > 0) await this.social.loadSharedEinsaetze();
  }

  protected path(r: FriendEdgeRow): string[] {
    return friendPath(r);
  }

  protected async answer(r: FriendEdgeRow, accept: boolean): Promise<void> {
    if (r.request_id) await this.friends.respond(r.request_id, accept);
  }
}
