import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { FriendsService } from './friends.service';
import {
  FoundUser,
  FriendEdgeRow,
  REPORT_CATEGORIES,
  REPORT_REASON_MAX,
  ReportCategory,
  daysUntilExpiry,
  edgeInitial,
  edgeLabel,
  isExpiringSoon,
  isValidHandle,
} from './friends.types';

/**
 * The friends page (`/friends`, linked from the account menu and from
 * Settings).
 *
 * Everything on this page is an ACTION on a relationship — accept, decline,
 * block, report — so everything is a `<button>`. There is no per-user detail
 * route in phase 1, hence no `<a [routerLink]>` here; the moment a public
 * profile page exists, the name in each row becomes the anchor.
 */
@Component({
  selector: 'sc-friends',
  standalone: true,
  imports: [TranslateModule, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'friends.title' | translate }}</h1>
          <p class="hint">{{ 'friends.subtitle' | translate }}</p>
        </div>
      </header>

      @if (friends.error(); as key) {
        <div class="flash error" role="alert">{{ key | translate }}</div>
      }
      @if (flash(); as key) {
        <div class="flash success" role="status">{{ key | translate }}</div>
      }

      <!-- Add a friend by exact handle. Not a search box on purpose: a
           substring search over profiles would be a user-enumeration
           endpoint, so find_user_by_username() matches exactly. -->
      <div class="sc-card section">
        <h2>{{ 'friends.add.title' | translate }}</h2>
        <p class="hint">{{ 'friends.add.hint' | translate }}</p>
        <form class="field-row" (submit)="lookup($event)">
          <input
            type="text"
            class="text-input"
            [value]="handleInput()"
            (input)="onHandleInput($event)"
            [placeholder]="'friends.add.placeholder' | translate"
            [attr.aria-label]="'friends.add.placeholder' | translate"
            maxlength="20"
            autocomplete="off"
            spellcheck="false" />
          <button
            type="submit"
            class="sc-btn sc-btn-primary"
            [disabled]="friends.busy() || !handleValid()">
            {{ 'friends.add.search' | translate }}
          </button>
        </form>

        @if (searched() && !found()) {
          <p class="empty-inline">{{ 'friends.add.notFound' | translate }}</p>
        }
        @if (found(); as f) {
          <div class="found">
            <span class="avatar">{{ initialOf(f) }}</span>
            <span class="found-name">{{ labelOf(f) }}</span>
            <button
              type="button"
              class="sc-btn sc-btn-primary"
              [disabled]="friends.busy()"
              (click)="sendRequest(f)">
              {{ 'friends.add.send' | translate }}
            </button>
          </div>
        }
      </div>

      <!-- Incoming requests first: they are the only bucket that needs a
           decision from the user. -->
      <div class="sc-card section">
        <h2>
          {{ 'friends.incoming.title' | translate }}
          @if (graph().incoming.length > 0) {
            <span class="count">{{ graph().incoming.length }}</span>
          }
        </h2>
        <p class="hint">{{ 'friends.incoming.expiryHint' | translate }}</p>
        @if (graph().incoming.length === 0) {
          <p class="empty-inline">{{ 'friends.incoming.empty' | translate }}</p>
        } @else {
          <ul class="edge-list">
            @for (e of graph().incoming; track e.user_id) {
              <li class="edge">
                <span class="avatar">{{ initialOf(e) }}</span>
                <span class="edge-main">
                  <span class="edge-name">{{ labelOf(e) }}</span>
                  <span class="edge-meta">
                    {{ e.since | scDate }}
                    @if (daysLeft(e); as d) {
                      <span class="expiry" [class.soon]="expiringSoon(e)">
                        {{ 'friends.expiry.left' | translate: { days: d } }}
                      </span>
                    } @else if (hasDeadline(e)) {
                      <span class="expiry soon">{{ 'friends.expiry.today' | translate }}</span>
                    }
                  </span>
                </span>
                <span class="edge-actions">
                  <button type="button" class="sc-btn micro sc-btn-primary"
                          [disabled]="friends.busy()" (click)="respond(e, true)">
                    {{ 'friends.actions.accept' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro"
                          [disabled]="friends.busy()" (click)="respond(e, false)">
                    {{ 'friends.actions.decline' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro"
                          [disabled]="friends.busy()" (click)="block(e)">
                    {{ 'friends.actions.block' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro danger"
                          [disabled]="friends.busy()" (click)="openReport(e)">
                    {{ 'friends.actions.report' | translate }}
                  </button>
                </span>
              </li>
            }
          </ul>
        }
      </div>

      <div class="sc-card section">
        <h2>{{ 'friends.list.title' | translate }}</h2>
        @if (friends.loading() && graph().friends.length === 0) {
          <p class="empty-inline">{{ 'friends.loading' | translate }}</p>
        } @else if (graph().friends.length === 0) {
          <p class="empty-inline">{{ 'friends.list.empty' | translate }}</p>
        } @else {
          <ul class="edge-list">
            @for (e of graph().friends; track e.user_id) {
              <li class="edge">
                <span class="avatar">{{ initialOf(e) }}</span>
                <span class="edge-main">
                  <span class="edge-name">{{ labelOf(e) }}</span>
                  <span class="edge-meta">
                    {{ 'friends.list.since' | translate: { date: (e.since | scDate) } }}
                  </span>
                </span>
                <span class="edge-actions">
                  <button type="button" class="sc-btn micro"
                          [disabled]="friends.busy()" (click)="removeFriend(e)">
                    {{ 'friends.actions.remove' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro"
                          [disabled]="friends.busy()" (click)="block(e)">
                    {{ 'friends.actions.block' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro danger"
                          [disabled]="friends.busy()" (click)="openReport(e)">
                    {{ 'friends.actions.report' | translate }}
                  </button>
                </span>
              </li>
            }
          </ul>
        }
      </div>

      <div class="sc-card section">
        <h2>{{ 'friends.outgoing.title' | translate }}</h2>
        <p class="hint">{{ 'friends.outgoing.expiryHint' | translate }}</p>
        @if (graph().outgoing.length === 0) {
          <p class="empty-inline">{{ 'friends.outgoing.empty' | translate }}</p>
        } @else {
          <ul class="edge-list">
            @for (e of graph().outgoing; track e.user_id) {
              <li class="edge">
                <span class="avatar">{{ initialOf(e) }}</span>
                <span class="edge-main">
                  <span class="edge-name">{{ labelOf(e) }}</span>
                  <span class="edge-meta">
                    {{ e.since | scDate }}
                    @if (daysLeft(e); as d) {
                      <span class="expiry" [class.soon]="expiringSoon(e)">
                        {{ 'friends.expiry.left' | translate: { days: d } }}
                      </span>
                    } @else if (hasDeadline(e)) {
                      <span class="expiry soon">{{ 'friends.expiry.today' | translate }}</span>
                    }
                  </span>
                </span>
                <span class="edge-actions">
                  <button type="button" class="sc-btn micro"
                          [disabled]="friends.busy()" (click)="withdraw(e)">
                    {{ 'friends.actions.withdraw' | translate }}
                  </button>
                </span>
              </li>
            }
          </ul>
        }
      </div>

      <div class="sc-card section">
        <h2>{{ 'friends.blocked.title' | translate }}</h2>
        <p class="hint">{{ 'friends.blocked.hint' | translate }}</p>
        @if (graph().blocked.length === 0) {
          <p class="empty-inline">{{ 'friends.blocked.empty' | translate }}</p>
        } @else {
          <ul class="edge-list">
            @for (e of graph().blocked; track e.user_id) {
              <li class="edge">
                <span class="avatar">{{ initialOf(e) }}</span>
                <span class="edge-main">
                  <span class="edge-name">{{ labelOf(e) }}</span>
                  <span class="edge-meta">{{ e.since | scDate }}</span>
                </span>
                <span class="edge-actions">
                  <button type="button" class="sc-btn micro"
                          [disabled]="friends.busy()" (click)="unblock(e)">
                    {{ 'friends.actions.unblock' | translate }}
                  </button>
                </span>
              </li>
            }
          </ul>
        }
      </div>

      <!-- Report form. Inline rather than a modal: it needs a category and a
           free-text reason, and a one-line native confirm() cannot carry
           either. -->
      @if (reportTarget(); as t) {
        <div class="sc-card section report-card">
          <h2>{{ 'friends.report.title' | translate: { name: labelOf(t) } }}</h2>
          <p class="hint">{{ 'friends.report.hint' | translate }}</p>
          <label class="report-field">
            <span class="inline-label">{{ 'friends.report.category' | translate }}</span>
            <select
              class="sc-select"
              [value]="reportCategory()"
              (change)="onCategoryChange($event)"
              [attr.aria-label]="'friends.report.category' | translate">
              @for (c of categories; track c) {
                <option [value]="c">{{ 'friends.report.categories.' + c | translate }}</option>
              }
            </select>
          </label>
          <label class="report-field">
            <span class="inline-label">{{ 'friends.report.reason' | translate }}</span>
            <textarea
              class="text-input"
              rows="3"
              [value]="reportReason()"
              (input)="onReasonInput($event)"
              [attr.maxlength]="reasonMax"
              [placeholder]="'friends.report.reasonPlaceholder' | translate"></textarea>
          </label>
          <div class="report-actions">
            <button type="button" class="sc-btn sc-btn-primary"
                    [disabled]="friends.busy()" (click)="submitReport(t)">
              {{ 'friends.report.submit' | translate }}
            </button>
            <button type="button" class="sc-btn" (click)="cancelReport()">
              {{ 'friends.report.cancel' | translate }}
            </button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; }
    h1 { margin: 0; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .section h2 {
      margin: 0 0 6px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .count {
      display: inline-block;
      min-width: 20px;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--sc-accent);
      color: var(--sc-bg-0);
      font-size: 0.72rem;
      text-align: center;
    }
    .flash {
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 0.9rem;
      &.error { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); }
      &.success { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-success); color: var(--sc-success); }
    }
    .empty-inline { color: var(--sc-fg-2); font-style: italic; margin: 10px 0 0; }

    .field-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .text-input {
      flex: 1 1 200px;
      min-width: 0;
      padding: 9px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.9rem;
    }
    .text-input:focus, .sc-select:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .sc-select {
      padding: 9px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.9rem;
    }

    .found {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      background: var(--sc-bg-1);
    }
    .found-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }

    .edge-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; }
    .edge {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--sc-border);
      flex-wrap: wrap;
    }
    .edge:last-child { border-bottom: 0; }
    .avatar {
      flex: 0 0 auto;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--sc-bg-2);
      color: var(--sc-fg-1);
      font-family: var(--sc-font-display);
      font-size: 0.9rem;
    }
    .edge-main { display: flex; flex-direction: column; gap: 2px; flex: 1 1 160px; min-width: 0; }
    .edge-name { color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .edge-meta {
      color: var(--sc-fg-2);
      font-size: max(0.74rem, var(--sc-fs-floor));
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: baseline;
    }
    /* The deadline is neutral information for six of its seven days; only the
       last one earns a colour, and --sc-warning (caution), never --sc-danger
       (which is reserved for errors and destructive actions). */
    .expiry { color: var(--sc-fg-2); }
    .expiry.soon { color: var(--sc-warning); }
    .edge-actions { display: flex; gap: 6px; flex-wrap: wrap; }

    .sc-btn.micro {
      padding: 4px 10px;
      font-size: max(0.7rem, var(--sc-fs-floor));
      letter-spacing: 0.04em;
    }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }

    /* 48px tap targets on touch: two overlapping scale(0.994) animations in
       the shell shave a hair off every measured box, so 44 measures as 43. */
    @media (pointer: coarse) {
      .edge-actions .sc-btn { min-height: 48px; }
      .edge-actions { width: 100%; }
    }
    @media (max-width: 560px) {
      .edge-actions { width: 100%; }
      .edge-actions .sc-btn { flex: 1 1 auto; }
    }

    .report-card { border-color: var(--sc-danger); }
    .report-field { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
    .inline-label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .report-actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  `],
})
export class FriendsComponent implements OnInit {
  readonly friends = inject(FriendsService);

  readonly categories = REPORT_CATEGORIES;
  readonly reasonMax = REPORT_REASON_MAX;

  readonly graph = this.friends.graph;

  readonly handleInput = signal('');
  readonly handleValid = computed(() => isValidHandle(this.handleInput()));
  readonly found = signal<FoundUser | null>(null);
  readonly searched = signal(false);
  readonly flash = signal<string | null>(null);

  readonly reportTarget = signal<FriendEdgeRow | null>(null);
  readonly reportCategory = signal<ReportCategory>('other');
  readonly reportReason = signal('');

  ngOnInit(): void {
    void this.friends.load();
  }

  labelOf(e: { display_name: string | null; username: string | null }): string {
    return edgeLabel(e);
  }

  initialOf(e: { display_name: string | null; username: string | null }): string {
    return edgeInitial(e);
  }

  /**
   * Whole days a pending request has left, or `null` when there is no
   * deadline at all. `0` is deliberately falsy in the template so the last
   * day reads "expires today" instead of "0 d left" — `hasDeadline()` is what
   * tells those two apart from "no deadline".
   */
  daysLeft(e: FriendEdgeRow): number | null {
    return daysUntilExpiry(e);
  }

  hasDeadline(e: FriendEdgeRow): boolean {
    return daysUntilExpiry(e) !== null;
  }

  expiringSoon(e: FriendEdgeRow): boolean {
    return isExpiringSoon(e);
  }

  onHandleInput(event: Event): void {
    this.handleInput.set((event.target as HTMLInputElement).value);
    this.searched.set(false);
    this.found.set(null);
  }

  onCategoryChange(event: Event): void {
    this.reportCategory.set((event.target as HTMLSelectElement).value as ReportCategory);
  }

  onReasonInput(event: Event): void {
    this.reportReason.set((event.target as HTMLTextAreaElement).value);
  }

  async lookup(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.handleValid()) return;
    this.flash.set(null);
    const hit = await this.friends.findByUsername(this.handleInput());
    this.found.set(hit);
    this.searched.set(true);
  }

  async sendRequest(target: FoundUser): Promise<void> {
    const result = await this.friends.sendRequest(target.user_id);
    if (!result) return;
    this.found.set(null);
    this.searched.set(false);
    this.handleInput.set('');
    // "accepted" happens when the other side had already sent me a request —
    // saying "request sent" there would be a lie.
    this.flash.set(
      result === 'accepted'
        ? 'friends.flash.nowFriends'
        : result === 'already_friends'
          ? 'friends.flash.alreadyFriends'
          : 'friends.flash.requestSent',
    );
  }

  async respond(edge: FriendEdgeRow, accept: boolean): Promise<void> {
    if (!edge.request_id) return;
    this.flash.set(null);
    const ok = await this.friends.respond(edge.request_id, accept);
    if (ok) this.flash.set(accept ? 'friends.flash.nowFriends' : 'friends.flash.declined');
  }

  async withdraw(edge: FriendEdgeRow): Promise<void> {
    if (!edge.request_id) return;
    this.flash.set(null);
    if (await this.friends.withdraw(edge.request_id)) this.flash.set('friends.flash.withdrawn');
  }

  async removeFriend(edge: FriendEdgeRow): Promise<void> {
    this.flash.set(null);
    if (await this.friends.removeFriend(edge.user_id)) this.flash.set('friends.flash.removed');
  }

  async block(edge: FriendEdgeRow): Promise<void> {
    this.flash.set(null);
    if (await this.friends.block(edge.user_id)) this.flash.set('friends.flash.blocked');
  }

  async unblock(edge: FriendEdgeRow): Promise<void> {
    this.flash.set(null);
    if (await this.friends.unblock(edge.user_id)) this.flash.set('friends.flash.unblocked');
  }

  openReport(edge: FriendEdgeRow): void {
    this.flash.set(null);
    this.reportCategory.set('other');
    this.reportReason.set('');
    this.reportTarget.set(edge);
  }

  cancelReport(): void {
    this.reportTarget.set(null);
  }

  async submitReport(target: FriendEdgeRow): Promise<void> {
    const result = await this.friends.report(
      target.user_id,
      this.reportCategory(),
      this.reportReason(),
    );
    if (!result) return;
    this.reportTarget.set(null);
    this.flash.set(
      result === 'duplicate' ? 'friends.flash.reportDuplicate' : 'friends.flash.reported',
    );
  }
}
