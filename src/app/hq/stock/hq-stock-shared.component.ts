import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import { LoadoutShareService } from '../../social/loadout-share.service';
import { SharedWithMeRow } from '../../social/loadout-share.types';
import { SocialService } from '../../social/social.service';
import { SharedShipConfig, friendPath } from '../../social/social.types';
import { hqHangar, hqLocker } from '../hq-routes';

/**
 * "Von Freunden geteilt" in Bestand (C14, C13): the sets and ship variants friends shared with the
 * reader, the friend as a real anchor to their page, and an adopt button that makes a copy owned by
 * the reader. The section does not exist while nothing is shared. Adopting reloads the hangar so
 * the copy shows up in the counts above.
 */
@Component({
  selector: 'sc-hq-stock-shared',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sets().length || configs().length) {
      <section class="shared" aria-labelledby="hq-stock-shared">
        <h3 id="hq-stock-shared">{{ 'share.sharedWithMe.title' | translate }}</h3>
        <ul class="rows">
          @for (s of sets(); track s.share_id) {
            <li class="card">
              <div class="what">
                <strong>{{ s.name }}</strong>
                <span class="meta">{{ 'hq.friends.stock.kindSet' | translate }} ·
                  {{ 'share.view.by' | translate: { name: '' } }}<a [routerLink]="path(s.owner_id, s.owner_handle)">{{ s.owner_handle || s.owner_name || '—' }}</a></span>
              </div>
              @if (adopted().has(s.share_id)) {
                <a class="done" [routerLink]="lockerLink">{{ 'hq.friends.stock.adopted' | translate }} ›</a>
              } @else {
                <button type="button" class="sc-btn tiny" [disabled]="busy()" (click)="adoptSet(s)">{{ 'hq.friends.stock.adopt' | translate }}</button>
              }
            </li>
          }
          @for (c of configs(); track c.share_id) {
            <li class="card">
              <div class="what">
                <strong>{{ c.name }}</strong>
                <span class="meta">{{ 'hq.friends.stock.kindVariant' | translate: { ship: c.ship_class_name } }} ·
                  {{ 'share.view.by' | translate: { name: '' } }}<a [routerLink]="path(c.owner_id, c.owner_handle)">{{ c.owner_handle || c.owner_name || '—' }}</a></span>
              </div>
              @if (adopted().has(c.share_id)) {
                <a class="done" [routerLink]="hangarLink">{{ 'hq.friends.stock.adopted' | translate }} ›</a>
              } @else {
                <button type="button" class="sc-btn tiny" [disabled]="busy()" (click)="adoptConfig(c)">{{ 'hq.friends.stock.adopt' | translate }}</button>
              }
            </li>
          }
        </ul>
        @if (error(); as key) {
          <p class="err" role="alert">{{ key | translate }}</p>
        }
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .shared { display: grid; gap: var(--sc-space-2, 8px); margin-bottom: var(--sc-space-6, 24px); }
      h3 { margin: 0; font: 600 1.1rem / 1.2 var(--sc-font-display); }
      .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-2, 8px); }
      .card { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); }
      .what { display: grid; gap: 2px; min-width: 0; }
      .meta { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      a { color: var(--sc-accent); }
      a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .err { margin: 0; color: var(--sc-warning); }
      @media (pointer: coarse) { .sc-btn { min-height: 48px; } }
    `,
  ],
})
export class HqStockSharedComponent implements OnInit {
  private readonly social = inject(SocialService);
  private readonly shares = inject(LoadoutShareService);
  private readonly hangar = inject(HangarService);

  protected readonly lockerLink = hqLocker;
  protected readonly hangarLink = hqHangar;

  protected readonly sets = signal<SharedWithMeRow[]>([]);
  protected readonly configs = computed(() => this.social.sharedShipConfigs());
  protected readonly adopted = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = this.social.busy;
  protected readonly error = this.social.error;

  ngOnInit(): void {
    void this.shares.listSharedWithMe().then((rows) => this.sets.set(rows));
    void this.social.loadSharedShipConfigs();
  }

  protected path(userId: string, handle: string | null): string[] {
    return friendPath({ user_id: userId, username: handle });
  }

  protected async adoptSet(s: SharedWithMeRow): Promise<void> {
    if (await this.social.adoptLoadout(s.share_id)) await this.afterAdopt(s.share_id);
  }

  protected async adoptConfig(c: SharedShipConfig): Promise<void> {
    if (await this.social.adoptShipConfig(c.share_id)) await this.afterAdopt(c.share_id);
  }

  private async afterAdopt(shareId: string): Promise<void> {
    this.adopted.update((a) => new Set(a).add(shareId));
    await this.hangar.loadAll();
  }
}
