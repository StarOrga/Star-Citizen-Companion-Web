import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { edgeLabel } from './friends.types';
import { SocialService } from './social.service';
import { CompareRow, SocialStats, compareRows } from './social.types';

/**
 * Me versus one friend (C07): how each of us uses SCC and what each does.
 * Only numbers the server really knows. Web page use has no data (telemetry is
 * anonymous by design), so it is not shown; "active days" is the closest real
 * number. A weaker value renders in --sc-warning, never --sc-danger.
 *
 * Used on the Social page (a picker over all friends) and on the friend page
 * (`fixed` = the numbers already loaded with `friend_overview`).
 */
@Component({
  selector: 'sc-social-compare',
  standalone: true,
  imports: [TranslatePipe, ScSelectComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card section" id="social-compare">
      <h2>{{ 'social.comparePanel.title' | translate }}</h2>
      <p class="hint">{{ 'social.comparePanel.hint' | translate }}</p>

      @if (fixed(); as fx) {
        <ng-container [ngTemplateOutlet]="table" />
      }

      @if (!fixed()) {
        @if (social.loadError(); as key) {
          <div class="load-error" role="alert">
            <span>{{ key | translate }}</span>
            <button type="button" class="sc-btn micro" (click)="reload()">{{ 'errors.retry' | translate }}</button>
          </div>
        } @else if (!social.compare()) {
          <p class="empty-inline">{{ 'social.comparePanel.loading' | translate }}</p>
        } @else if (friendOptions().length === 0) {
          <p class="empty-inline">{{ 'social.comparePanel.noFriends' | translate }}</p>
        } @else {
          <div class="pick">
            <span class="inline-label">{{ 'social.comparePanel.with' | translate }}</span>
            <sc-select [options]="friendOptions()" [value]="selectedId()" [allowEmpty]="false"
                       [ariaLabel]="'social.comparePanel.with' | translate"
                       (valueChange)="selected.set($event)" />
          </div>
          <ng-container [ngTemplateOutlet]="table" />
        }
      }
    </div>

    <ng-template #table>
      @if (current(); as c) {
        <table class="cmp">
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">{{ 'social.comparePanel.metric' | translate }}</span></th>
              <th scope="col">{{ 'social.comparePanel.me' | translate }}</th>
              <th scope="col">{{ c.name }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of c.rows; track r.metric) {
              <tr>
                <th scope="row">{{ r.labelKey | translate }}</th>
                <td [class.ahead]="r.standing === 'ahead'" [class.behind]="r.standing === 'behind'">{{ r.me }}</td>
                <td [class.behind]="r.standing === 'ahead'" [class.ahead]="r.standing === 'behind'">
                  @if (r.friend === null) { <span class="hidden-val">{{ 'social.comparePanel.hidden' | translate }}</span> }
                  @else { {{ r.friend }} }
                </td>
              </tr>
            }
            <tr>
              <th scope="row">{{ 'social.comparePanel.desktop' | translate }}</th>
              <td>{{ (c.me.desktop_connected ? 'social.comparePanel.yes' : 'social.comparePanel.no') | translate }}</td>
              <td>
                @if (c.friend) { {{ (c.friend.desktop_connected ? 'social.comparePanel.yes' : 'social.comparePanel.no') | translate }} }
                @else { <span class="hidden-val">{{ 'social.comparePanel.hidden' | translate }}</span> }
              </td>
            </tr>
          </tbody>
        </table>
        @if (!c.friend) {
          <p class="hint">{{ 'social.comparePanel.friendHides' | translate }}</p>
        }
        <p class="hint">{{ 'social.comparePanel.webNote' | translate }}</p>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    h2 { margin: 0 0 6px; font-size: 1rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .hint { color: var(--sc-fg-2); margin: 8px 0 0; }
    .empty-inline { color: var(--sc-fg-2); font-style: italic; margin: 10px 0 0; }
    .load-error {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
      padding: 10px 14px; border-radius: 4px; margin-top: 10px;
      background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .pick { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .inline-label {
      color: var(--sc-fg-2); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .cmp { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .cmp th, .cmp td { padding: 8px 6px; border-bottom: 1px solid var(--sc-border); text-align: right; font-variant-numeric: tabular-nums; }
    .cmp th[scope='row'], .cmp thead th:first-child { text-align: left; font-weight: 400; color: var(--sc-fg-1); }
    .cmp thead th { color: var(--sc-fg-2); font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; overflow-wrap: anywhere; }
    .cmp tr:last-child th, .cmp tr:last-child td { border-bottom: 0; }
    td.ahead { color: var(--sc-success); }
    td.behind { color: var(--sc-warning); }
    .hidden-val { color: var(--sc-fg-2); font-style: italic; }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `],
})
export class SocialCompareComponent implements OnInit {
  readonly social = inject(SocialService);

  /** Friend page: the numbers `friend_overview` already carries. Skips the picker and the load. */
  readonly fixed = input<{ me: SocialStats; friend: SocialStats | null; name: string } | null>(null);

  readonly selected = signal<string | null>(null);

  readonly friendOptions = computed<ScSelectOption[]>(() =>
    (this.social.compare()?.friends ?? []).map((f) => ({ value: f.user_id, labelKey: '', label: edgeLabel(f) }) as ScSelectOption),
  );
  readonly selectedId = computed(() => this.selected() ?? this.friendOptions()[0]?.value ?? null);

  readonly current = computed<{ name: string; me: SocialStats; friend: SocialStats | null; rows: CompareRow[] } | null>(() => {
    const fx = this.fixed();
    if (fx) return { name: fx.name, me: fx.me, friend: fx.friend, rows: compareRows(fx.me, fx.friend) };
    const c = this.social.compare();
    const f = c?.friends.find((x) => x.user_id === this.selectedId());
    if (!c || !f) return null;
    return { name: edgeLabel(f), me: c.me, friend: f.stats, rows: compareRows(c.me, f.stats) };
  });

  ngOnInit(): void {
    if (!this.fixed()) void this.social.loadCompare();
  }

  reload(): void {
    void this.social.loadCompare();
  }
}
