import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { ItemPathComponent } from '../shared/item-path/item-path.component';
import { FriendsService } from './friends.service';
import { humanizeClassName } from '../codex/codex-format';
import { REPORT_CATEGORIES, REPORT_REASON_MAX, ReportCategory, edgeLabel, isValidReportReason } from './friends.types';
import { SocialCompareComponent } from './social-compare.component';
import { SocialService } from './social.service';
import { FriendOverview, OverviewShared } from './social.types';

type View = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; key: string } | { kind: 'ok'; data: FriendOverview };

/**
 * `/social/<handle or id>` (C19): a friend's page, friends only. It shows what
 * you share in both directions, their hangar when they show it, the
 * comparison, and the actions. Not-a-friend, blocked and unknown look the same
 * (server answer null = "missing"); a failed call is an error with retry.
 */
@Component({
  selector: 'sc-social-friend',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, RouterLink, PageHeaderComponent, SocialCompareComponent, ScTooltipDirective, NgTemplateOutlet, ScSelectComponent, ItemPathComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      @switch (view().kind) {
        @case ('loading') {
          <sc-page-header [crumbs]="crumbs" [rememberAs]="'social.page.title' | translate" />
          <p class="empty-inline">{{ 'social.friendPage.loading' | translate }}</p>
        }
        @case ('missing') {
          <sc-page-header [crumbs]="crumbs" [title]="'social.friendPage.missingTitle' | translate"
                          [rememberAs]="'social.page.title' | translate" />
          <div class="sc-card"><p class="empty-inline">{{ 'social.friendPage.missing' | translate }}</p></div>
        }
        @case ('error') {
          <sc-page-header [crumbs]="crumbs" [rememberAs]="'social.page.title' | translate" />
          <div class="load-error" role="alert">
            <span>{{ errorKey() | translate }}</span>
            <button type="button" class="sc-btn" (click)="load()">{{ 'errors.retry' | translate }}</button>
          </div>
        }
        @case ('ok') {
          @if (data(); as d) {
            <sc-page-header [crumbs]="crumbs" [title]="displayName()"
                            [subtitle]="'social.friendPage.since' | translate: { date: (d.friend.since | scDate) }"
                            [rememberAs]="displayName()">
              <span phTitle>
                @if (d.friend.online) {
                  <span class="online-dot" role="img" [attr.aria-label]="'social.page.online' | translate"
                        [scTooltip]="'social.page.online' | translate"></span>
                }
              </span>
              <div phActions class="actions">
                <a class="sc-btn" routerLink="/hq/locker">{{ 'social.friendPage.share' | translate }}</a>
                <button type="button" class="sc-btn" [disabled]="friends.busy()" (click)="remove()">{{ 'friends.actions.remove' | translate }}</button>
                <button type="button" class="sc-btn" [disabled]="friends.busy()" (click)="block()">{{ 'friends.actions.block' | translate }}</button>
                <button type="button" class="sc-btn danger" [disabled]="friends.busy()" (click)="reportOpen.set(true)">{{ 'friends.actions.report' | translate }}</button>
              </div>
            </sc-page-header>

            @if (friends.error(); as key) {
              <div class="load-error" role="alert">{{ key | translate }}</div>
            }

            @if (reportOpen()) {
              <div class="sc-card report-card">
                <h2>{{ 'friends.report.title' | translate: { name: displayName() } }}</h2>
                <p class="hint">{{ 'friends.report.hint' | translate }}</p>
                <div class="report-field">
                  <span class="hint">{{ 'friends.report.category' | translate }}</span>
                  <sc-select
                    [options]="categoryOptions"
                    [value]="reportCategory()"
                    [allowEmpty]="false"
                    [ariaLabel]="'friends.report.category' | translate"
                    (valueChange)="setCategory($event)" />
                </div>
                <label class="report-field">
                  <span class="hint">{{ 'friends.report.reason' | translate }}</span>
                  <textarea class="report-reason" rows="3" [attr.maxlength]="reasonMax"
                            [value]="reportReason()"
                            (input)="reportReason.set($any($event.target).value)"
                            [placeholder]="'friends.report.reasonPlaceholder' | translate"></textarea>
                </label>
                <div class="report-actions">
                  <button type="button" class="sc-btn sc-btn-primary" [disabled]="friends.busy()" (click)="submitReport()">{{ 'friends.report.submit' | translate }}</button>
                  <button type="button" class="sc-btn" (click)="reportOpen.set(false)">{{ 'friends.report.cancel' | translate }}</button>
                </div>
              </div>
            }

            @if (d.my_groups.length) {
              <p class="hint">
                {{ 'social.friendPage.inGroups' | translate }}
                @for (g of d.my_groups; track g.id; let last = $last) {
                  <span>{{ g.name }}{{ last ? '' : ',' }}</span>
                }
              </p>
            }

            <div class="cols">
              <div class="sc-card section">
                <h2>{{ 'social.friendPage.fromFriend' | translate: { name: displayName() } }}</h2>
                @if (isEmpty(d.from_friend)) {
                  <p class="empty-inline">{{ 'social.friendPage.nothingShared' | translate }}</p>
                } @else {
                  <ng-container [ngTemplateOutlet]="sharedList" [ngTemplateOutletContext]="{ s: d.from_friend }" />
                }
              </div>
              <div class="sc-card section">
                <h2>{{ 'social.friendPage.fromMe' | translate }}</h2>
                @if (isEmpty(d.from_me)) {
                  <p class="empty-inline">{{ 'social.friendPage.nothingSharedByMe' | translate }}</p>
                } @else {
                  <ng-container [ngTemplateOutlet]="sharedList" [ngTemplateOutletContext]="{ s: d.from_me }" />
                }
              </div>
            </div>

            <div class="sc-card section">
              <h2>{{ 'social.friendPage.hangar' | translate }}</h2>
              @if (d.friend.flagship_ship_class) {
                <p class="flagship">{{ 'social.friendPage.flagship' | translate }}: <strong>{{ pretty(d.friend.flagship_ship_class) }}</strong></p>
              }
              @if (d.hangar === null) {
                <p class="empty-inline">{{ 'social.friendPage.hangarHidden' | translate }}</p>
              } @else if (d.hangar.length === 0) {
                <p class="empty-inline">{{ 'social.friendPage.hangarEmpty' | translate }}</p>
              } @else {
                <ul class="ships">
                  @for (s of d.hangar; track $index) {
                    <li>
                      <span>{{ s.custom_name || pretty(s.ship_class_name) }}</span>
                      @if (s.custom_name) { <span class="hint">{{ pretty(s.ship_class_name) }}</span> }
                      @if (s.status === 'wishlist') { <span class="tag">{{ 'social.friendPage.wishlist' | translate }}</span> }
                      <sc-item-path class="path" kind="ship" [className]="s.ship_class_name" [name]="pretty(s.ship_class_name)" />
                    </li>
                  }
                </ul>
              }
            </div>

            <sc-social-compare [fixed]="{ me: d.compare.me, friend: d.compare.friend, name: displayName() }" />
          }
        }
      }
    </section>

    <ng-template #sharedList let-s="s">
      <ul class="shared">
        @for (l of s.loadouts; track l.share_id) { <li><span class="kind">{{ 'social.friendPage.kindSet' | translate }}</span> {{ l.name }}</li> }
        @for (c of s.ship_configs; track c.share_id) { <li><span class="kind">{{ 'social.friendPage.kindVariant' | translate }}</span> {{ c.name }}<sc-item-path class="path" kind="ship" [className]="c.ship_class_name" [name]="pretty(c.ship_class_name)" /></li> }
        @for (e of s.einsaetze; track e.einsatz_id) { <li><span class="kind">{{ 'social.friendPage.kindEinsatz' | translate }}</span> {{ e.title }}</li> }
      </ul>
    </ng-template>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; }
    .report-card { border-color: var(--sc-danger); display: grid; gap: 12px; }
    .report-field { display: grid; gap: 4px; }
    .report-reason { width: 100%; box-sizing: border-box; padding: 8px 10px; font: inherit; font-size: max(16px, 1em); color: var(--sc-fg-0); background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 6px); }
    .report-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    h2 { margin: 0 0 8px; font-size: 1rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .hint { color: var(--sc-fg-2); margin: 0; font-size: max(0.8rem, var(--sc-fs-floor)); }
    .empty-inline { color: var(--sc-fg-2); font-style: italic; margin: 6px 0 0; }
    .load-error {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
      padding: 10px 14px; border-radius: 4px; background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions .sc-btn { text-decoration: none; display: inline-flex; align-items: center; }
    .sc-btn.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }
    .online-dot { display: inline-block; width: 10px; height: 10px; margin-left: 10px; border-radius: 50%; background: var(--sc-success); }
    .cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
    @media (max-width: 760px) { .cols { grid-template-columns: minmax(0, 1fr); } }
    .shared, .ships { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .shared li, .ships li { padding: 8px 0; border-bottom: 1px solid var(--sc-border); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; overflow-wrap: anywhere; }
    .shared li:last-child, .ships li:last-child { border-bottom: 0; }
    .kind, .tag {
      color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; font-family: var(--sc-font-display);
    }
    .tag { color: var(--sc-warning); }
    .path { margin-inline-start: auto; }
    .flagship { margin: 0 0 6px; }
    @media (pointer: coarse) { .actions .sc-btn { min-height: 48px; } }
  `],
})
export class SocialFriendComponent {
  readonly social = inject(SocialService);
  readonly friends = inject(FriendsService);
  private readonly confirmSvc = inject(ScConfirmService);
  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);
  private readonly who = signal(this.route.snapshot.paramMap.get('who') ?? '');
  readonly view = signal<View>({ kind: 'loading' });
  readonly crumbs = [{ labelKey: 'social.page.title', link: '/social' }];

  readonly data = computed(() => {
    const v = this.view();
    return v.kind === 'ok' ? v.data : null;
  });
  readonly errorKey = computed(() => {
    const v = this.view();
    return v.kind === 'error' ? v.key : 'errors.generic';
  });
  readonly displayName = computed(() => {
    const d = this.data();
    return d ? edgeLabel(d.friend) : this.who();
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((p) => {
      this.who.set(p.get('who') ?? '');
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.view.set({ kind: 'loading' });
    const r = await this.social.friendOverview(this.who());
    this.view.set(r.kind === 'ok' ? { kind: 'ok', data: r.data } : r);
  }

  isEmpty(s: OverviewShared): boolean {
    return s.loadouts.length + s.einsaetze.length + s.ship_configs.length === 0;
  }

  pretty(cls: string): string {
    return humanizeClassName(cls);
  }

  private id(): string | null {
    return this.data()?.friend.user_id ?? null;
  }

  async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.friendPage.removeTitle',
      messageKey: 'social.friendPage.removeMessage',
      params: { name: this.displayName() },
      confirmKey: 'friends.actions.remove',
      tone: 'danger',
    });
    if (ok && (await this.friends.removeFriend(id))) await this.router.navigate(['/social']);
  }

  async block(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.friendPage.blockTitle',
      messageKey: 'social.friendPage.blockMessage',
      params: { name: this.displayName() },
      confirmKey: 'friends.actions.block',
      tone: 'danger',
    });
    if (ok && (await this.friends.block(id))) await this.router.navigate(['/social']);
  }

  /** Same category and reason as the list on /social: an admin triages by category. */
  readonly categoryOptions: readonly ScSelectOption[] = REPORT_CATEGORIES.map((c) => ({
    value: c,
    labelKey: 'friends.report.categories.' + c,
  }));
  readonly reasonMax = REPORT_REASON_MAX;
  readonly reportOpen = signal(false);
  readonly reportCategory = signal<ReportCategory>('other');
  readonly reportReason = signal('');

  setCategory(value: string | null): void {
    this.reportCategory.set((value ?? 'other') as ReportCategory);
  }

  async submitReport(): Promise<void> {
    const id = this.id();
    const reason = this.reportReason();
    if (!id || !isValidReportReason(reason)) return;
    const outcome = await this.friends.report(id, this.reportCategory(), reason.trim());
    if (outcome === null) return;
    this.reportOpen.set(false);
    this.reportReason.set('');
  }
}
