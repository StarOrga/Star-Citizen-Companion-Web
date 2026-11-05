import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { FriendsService } from '../../social/friends.service';
import { FriendEdgeRow, edgeLabel } from '../../social/friends.types';
import { SocialService } from '../../social/social.service';
import { friendPath } from '../../social/social.types';
import { hqPage } from '../hq-routes';

/**
 * Friends on HQ Jetzt (C10): one quiet line for who is online and one for an active Einsatz a
 * friend shared, with its yes count. Renders nothing without either, so an account without friends
 * sees the page exactly as before.
 */
@Component({
  selector: 'sc-hq-now-friends',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (online().length) {
      <p class="line">
        <span>{{ 'hq.friends.now.online' | translate }}</span>
        @for (f of online(); track f.user_id) {
          <a [routerLink]="path(f)">{{ label(f) }}</a>
        }
      </p>
    }
    @if (active(); as e) {
      <p class="line">
        <a [routerLink]="plan.commands" [fragment]="plan.fragment">
          {{ 'hq.friends.now.active' | translate: { title: e.title, n: e.crew.counts.yes } }}
        </a>
      </p>
    }
  `,
  styles: [
    `
      :host { display: grid; gap: var(--sc-space-1, 4px); }
      :host(:empty) { display: none; }
      .line { margin: 0; display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); font-size: max(0.85rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      a { color: var(--sc-accent); }
      a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    `,
  ],
})
export class HqNowFriendsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly friends = inject(FriendsService);
  private readonly social = inject(SocialService);

  protected readonly plan = hqPage('planen');
  protected readonly online = computed(() => {
    const ids = this.social.onlineIds();
    return this.friends.graph().friends.filter((f) => ids.has(f.user_id));
  });
  protected readonly active = computed(
    () => this.social.sharedEinsaetze().find((e) => e.status === 'active') ?? null,
  );

  async ngOnInit(): Promise<void> {
    if (!this.auth.user()) return;
    if (this.friends.friendCount() === 0) await this.friends.load();
    if (this.friends.friendCount() === 0) return;
    await Promise.all([this.social.loadOnline(), this.social.loadSharedEinsaetze()]);
  }

  protected path(f: FriendEdgeRow): string[] {
    return friendPath(f);
  }

  protected label(f: FriendEdgeRow): string {
    return edgeLabel(f);
  }
}
