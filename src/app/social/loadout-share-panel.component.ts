import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { FriendsService } from './friends.service';
import { edgeLabel } from './friends.types';
import { LoadoutShareService } from './loadout-share.service';
import { LoadoutShareRow, isLinkShare, shareLinkFor } from './loadout-share.types';

/**
 * "Share this loadout" — friends and/or a public link (feedback cf0ddf7d
 * phase 2). Drops into any page that owns a role loadout; the editor is the
 * first host.
 *
 * The two share shapes are shown as two separate blocks because they are two
 * different decisions with two different blast radii: a friend share is
 * revocable by un-friending and never leaves the app, a link is readable by
 * anybody who ever sees the URL, signed out included. Collapsing them into
 * one list would hide that difference behind a row of similar-looking chips.
 */
@Component({
  selector: 'sc-loadout-share-panel',
  standalone: true,
  imports: [TranslateModule, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card share-card">
      <h2>{{ 'share.title' | translate }}</h2>
      <p class="hint">{{ 'share.hint' | translate }}</p>

      @if (shares.error(); as key) {
        <p class="flash error" role="alert">{{ key | translate }}</p>
      }
      @if (flash(); as key) {
        <p class="flash success" role="status">{{ key | translate }}</p>
      }

      <!-- Friends -->
      <section class="block">
        <h3>{{ 'share.friends.title' | translate }}</h3>

        @if (loading()) {
          <p class="empty-inline">{{ 'share.loading' | translate }}</p>
        } @else if (friendShares().length === 0) {
          <p class="empty-inline">{{ 'share.friends.empty' | translate }}</p>
        } @else {
          <ul class="share-list">
            @for (s of friendShares(); track s.id) {
              <li class="share-row">
                <span class="share-main">
                  <span class="share-name">{{ friendLabel(s) }}</span>
                  <span class="share-meta">{{ s.created_at | scDate }}</span>
                </span>
                <button
                  type="button"
                  class="sc-btn micro"
                  [disabled]="shares.busy()"
                  (click)="revoke(s.id)">
                  {{ 'share.revoke' | translate }}
                </button>
              </li>
            }
          </ul>
        }

        @if (shareableFriends().length > 0) {
          <div class="pick-row">
            <label class="sr-only" for="share-friend-select">
              {{ 'share.friends.pick' | translate }}
            </label>
            <select
              id="share-friend-select"
              class="sc-select"
              [value]="pickedFriend()"
              (change)="onPick($event)">
              <option value="">{{ 'share.friends.pick' | translate }}</option>
              @for (f of shareableFriends(); track f.user_id) {
                <option [value]="f.user_id">{{ labelOf(f) }}</option>
              }
            </select>
            <button
              type="button"
              class="sc-btn sc-btn-primary"
              [disabled]="shares.busy() || !pickedFriend()"
              (click)="shareWithFriend()">
              {{ 'share.friends.share' | translate }}
            </button>
          </div>
        } @else if (!loading() && friends.friendCount() === 0) {
          <p class="empty-inline">{{ 'share.friends.noFriends' | translate }}</p>
        } @else if (!loading()) {
          <p class="empty-inline">{{ 'share.friends.allShared' | translate }}</p>
        }
      </section>

      <!-- Public link -->
      <section class="block">
        <h3>{{ 'share.link.title' | translate }}</h3>
        <p class="hint small">{{ 'share.link.warning' | translate }}</p>

        @if (linkShare(); as l) {
          <div class="link-row">
            <input
              class="text-input"
              type="text"
              readonly
              [value]="linkUrl()"
              [attr.aria-label]="'share.link.url' | translate"
              (focus)="selectAll($event)" />
            <button type="button" class="sc-btn" (click)="copy()">
              {{ (copied() ? 'share.link.copied' : 'share.link.copy') | translate }}
            </button>
            <!-- A real anchor: middle click and "open in new tab" are browser
                 features that only work on one. -->
            <a class="sc-btn" [href]="linkUrl()" target="_blank" rel="noopener noreferrer">
              {{ 'share.link.open' | translate }}
            </a>
            <button
              type="button"
              class="sc-btn micro danger"
              [disabled]="shares.busy()"
              (click)="revoke(l.id)">
              {{ 'share.link.revoke' | translate }}
            </button>
          </div>
          <p class="share-meta">{{ 'share.link.since' | translate: { date: (l.created_at | scDate) } }}</p>
        } @else if (!loading()) {
          <button
            type="button"
            class="sc-btn sc-btn-primary"
            [disabled]="shares.busy()"
            (click)="createLink()">
            {{ 'share.link.create' | translate }}
          </button>
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .share-card h2 { margin: 0 0 6px; font-size: 1rem; }
    .share-card h3 {
      margin: 0 0 6px;
      font-size: max(0.78rem, var(--sc-fs-floor));
      font-family: var(--sc-font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .hint { color: var(--sc-fg-2); margin: 0 0 4px; font-size: 0.86rem; }
    .hint.small { font-size: max(0.74rem, var(--sc-fs-floor)); }
    .block { margin-top: 18px; }
    .block:first-of-type { margin-top: 14px; }
    .empty-inline { color: var(--sc-fg-2); font-style: italic; margin: 8px 0 0; font-size: 0.86rem; }
    .flash {
      margin: 10px 0 0;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.85rem;
    }
    .flash.error { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); }
    .flash.success { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-success); color: var(--sc-success); }

    .share-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; }
    .share-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 8px 0;
      border-bottom: 1px solid var(--sc-border);
    }
    .share-row:last-child { border-bottom: 0; }
    .share-main { display: flex; flex-direction: column; gap: 2px; flex: 1 1 160px; min-width: 0; }
    .share-name { overflow-wrap: anywhere; }
    .share-meta { color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); margin: 6px 0 0; }

    .pick-row, .link-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    .text-input, .sc-select {
      padding: 8px 10px;
      background: var(--sc-bg-0);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      font: inherit;
      font-size: 0.84rem;
    }
    .text-input { flex: 1 1 260px; min-width: 0; }
    .sc-select { flex: 1 1 180px; min-width: 0; }
    .text-input:focus, .sc-select:focus { outline: none; border-color: var(--sc-accent); }

    .sc-btn {
      padding: 8px 14px;
      border-radius: 6px;
      background: var(--sc-bg-1);
      border: 1px solid var(--sc-accent);
      color: var(--sc-accent);
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .sc-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .sc-btn:disabled { opacity: 0.5; cursor: default; }
    .sc-btn.sc-btn-primary { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .sc-btn.micro { padding: 5px 10px; font-size: max(0.66rem, var(--sc-fs-floor)); }
    .sc-btn.danger { border-color: var(--sc-danger); color: var(--sc-danger); }
    .sc-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }

    .sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    /* 48px, not 44: two overlapping scale(0.994) shell animations shave a
       hair off every measured box, so a 44px target measures 43. */
    @media (pointer: coarse) {
      .sc-btn, .text-input, .sc-select { min-height: 48px; }
    }
    @media (max-width: 560px) {
      .pick-row, .link-row { flex-direction: column; align-items: stretch; }
      /* The rows turn into COLUMNS here, and flex-basis follows the main
         axis — so the "flex: 1 1 260px" above would become a 260px-TALL
         input. Reset the basis before it becomes a height. */
      .link-row .text-input, .pick-row .sc-select { flex: 0 0 auto; width: 100%; }
      .pick-row .sc-btn, .link-row .sc-btn { width: 100%; justify-content: center; }
      .share-row .sc-btn { width: 100%; justify-content: center; }
    }
  `],
})
export class LoadoutSharePanelComponent implements OnInit {
  /** The role loadout being shared. Owner-only — the RPCs enforce that. */
  readonly loadoutId = input.required<string>();

  readonly shares = inject(LoadoutShareService);
  readonly friends = inject(FriendsService);

  private readonly rows = signal<LoadoutShareRow[]>([]);
  readonly loading = signal(true);
  readonly flash = signal<string | null>(null);
  readonly copied = signal(false);
  readonly pickedFriend = signal('');

  readonly friendShares = computed(() => this.rows().filter((r) => !isLinkShare(r)));
  readonly linkShare = computed(() => this.rows().find((r) => isLinkShare(r)) ?? null);
  readonly linkUrl = computed(() => {
    const l = this.linkShare();
    return l?.token ? shareLinkFor(l.token) : '';
  });

  /** Friends who do not already have this loadout — no duplicate offers. */
  readonly shareableFriends = computed(() => {
    const taken = new Set(this.friendShares().map((s) => s.shared_with));
    return this.friends.graph().friends.filter((f) => !taken.has(f.user_id));
  });

  async ngOnInit(): Promise<void> {
    // The friend graph may not have been loaded by this route; loading it here
    // is idempotent and keeps the picker from being empty on a deep link.
    if (this.friends.graph().friends.length === 0) await this.friends.load();
    await this.reload();
  }

  labelOf(e: { display_name: string | null; username: string | null }): string {
    return edgeLabel(e);
  }

  friendLabel(s: LoadoutShareRow): string {
    return edgeLabel({ display_name: s.friend_name, username: s.friend_handle });
  }

  onPick(event: Event): void {
    this.pickedFriend.set((event.target as HTMLSelectElement).value);
  }

  selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  async shareWithFriend(): Promise<void> {
    const friendId = this.pickedFriend();
    if (!friendId) return;
    this.flash.set(null);
    const result = await this.shares.shareWithFriend(this.loadoutId(), friendId);
    if (!result) return;
    this.pickedFriend.set('');
    this.flash.set(result === 'duplicate' ? 'share.flash.alreadyShared' : 'share.flash.shared');
    await this.reload();
  }

  async createLink(): Promise<void> {
    this.flash.set(null);
    const token = await this.shares.createLink(this.loadoutId());
    if (!token) return;
    this.flash.set('share.flash.linkCreated');
    await this.reload();
  }

  async revoke(shareId: string): Promise<void> {
    this.flash.set(null);
    if (await this.shares.revoke(shareId)) {
      this.flash.set('share.flash.revoked');
      this.copied.set(false);
      await this.reload();
    }
  }

  async copy(): Promise<void> {
    const url = this.linkUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
    } catch {
      // No clipboard permission (or no secure context): the URL is already
      // in a focusable, selectable input right next to the button, so there
      // is nothing to recover from — just don't claim it was copied.
      this.copied.set(false);
    }
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    this.rows.set(await this.shares.listShares(this.loadoutId()));
    this.loading.set(false);
  }
}
