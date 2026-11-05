import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { FriendsService } from '../../social/friends.service';
import { SocialService } from '../../social/social.service';
import { FriendShareKind, FriendShareRow, friendPath } from '../../social/social.types';

export type FriendShareSubject = FriendShareKind | 'loadout';

/** The audience option value: `f:<user id>` for a friend, `g:<group id>` for a group. */
export function audienceOf(value: string | null): { friendId: string } | { groupId: string } | null {
  if (!value) return null;
  if (value.startsWith('f:')) return { friendId: value.slice(2) };
  if (value.startsWith('g:')) return { groupId: value.slice(2) };
  return null;
}

/**
 * "Mit Freunden teilen": one small disclosure that exists only for an account that has friends or
 * groups. An Einsatz or a ship variant goes to one friend or one group (shared read-only, revocable;
 * a group is expanded at read time, D4). A set goes to a group only (the single-friend path is the
 * set share panel) and fans out to its current members at once, later members do not get it (D5).
 */
@Component({
  selector: 'sc-hq-friend-share',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available()) {
      <div class="fs">
        <button type="button" class="sc-btn tiny ghost" [attr.aria-expanded]="open()" (click)="toggle()">
          {{ 'hq.friends.share.open' | translate }}
        </button>
        @if (open()) {
          <div class="panel">
            @if (kind() === 'loadout') {
              <p class="hint">{{ 'hq.friends.share.setHint' | translate }}</p>
            } @else {
              <p class="hint">{{ 'hq.friends.share.hint' | translate }}</p>
            }
            <div class="pick">
              <sc-select [options]="options()" [value]="choice()" [ariaLabel]="'hq.friends.share.audience' | translate"
                         placeholderKey="hq.friends.share.choose" (valueChange)="choice.set($event)" />
              <button type="button" class="sc-btn small" [disabled]="!choice() || social.busy()" (click)="share()">
                {{ 'hq.friends.share.send' | translate }}
              </button>
            </div>
            @if (flash(); as f) {
              <p class="flash" role="status">{{ f.key | translate: f.params }}</p>
            }
            @if (social.error(); as key) {
              <p class="err" role="alert">{{ key | translate }}</p>
            }
            @if (rows().length) {
              <ul class="rows">
                @for (r of rows(); track r.share_id) {
                  <li>
                    @if (r.shared_with) {
                      <a [routerLink]="pathOf(r)">{{ r.friend_name || r.friend_handle || '—' }}</a>
                    } @else {
                      <span>{{ r.group_name }} <span class="kind">({{ 'social.group.kind.' + r.group_kind | translate }})</span></span>
                    }
                    <button type="button" class="sc-btn tiny ghost" (click)="revoke(r)">{{ 'hq.friends.share.revoke' | translate }}</button>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .fs { display: grid; gap: var(--sc-space-2, 8px); justify-items: start; }
      .panel { display: grid; gap: var(--sc-space-2, 8px); width: 100%; padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); background: var(--sc-bg-1); }
      .hint { margin: 0; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .pick { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); align-items: center; }
      .pick sc-select { flex: 1 1 14rem; min-width: 12rem; }
      .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-1, 4px); }
      .rows li { display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-2, 8px); }
      .kind { color: var(--sc-fg-2); }
      a { color: var(--sc-accent); }
      a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .flash { margin: 0; color: var(--sc-accent); }
      .err { margin: 0; color: var(--sc-danger); }
      @media (pointer: coarse) { .sc-btn { min-height: 48px; } }
    `,
  ],
})
export class HqFriendShareComponent implements OnInit {
  protected readonly friends = inject(FriendsService);
  protected readonly social = inject(SocialService);

  readonly kind = input.required<FriendShareSubject>();
  readonly subjectId = input.required<string>();

  protected readonly open = signal(false);
  protected readonly choice = signal<string | null>(null);
  protected readonly rows = signal<FriendShareRow[]>([]);
  protected readonly flash = signal<{ key: string; params?: Record<string, unknown> } | null>(null);

  /** Only an account with friends (or, for a set, groups) sees the entry at all. */
  protected readonly available = computed(() =>
    this.kind() === 'loadout' ? this.social.groups().length > 0 : this.friends.friendCount() > 0,
  );

  protected readonly options = computed<ScSelectOption[]>(() => {
    const groups = this.social.groups().map((g) => ({ value: `g:${g.id}`, labelKey: '', label: g.name }));
    if (this.kind() === 'loadout') return groups;
    const friends = this.friends.graph().friends.map((f) => ({
      value: `f:${f.user_id}`,
      labelKey: '',
      label: f.display_name || f.username || '—',
    }));
    return [...friends, ...groups];
  });

  ngOnInit(): void {
    if (this.friends.friendCount() === 0 && !this.friends.loading()) void this.friends.load();
    if (this.social.groups().length === 0) void this.social.loadGroups();
  }

  protected pathOf(r: FriendShareRow): string[] {
    return friendPath({ user_id: r.shared_with ?? '', username: r.friend_handle });
  }

  protected async toggle(): Promise<void> {
    this.open.update((o) => !o);
    if (this.open()) await this.reload();
  }

  private async reload(): Promise<void> {
    if (this.kind() === 'loadout') return;
    this.rows.set((await this.social.listShares(this.kind() as FriendShareKind, this.subjectId())) ?? this.rows());
  }

  protected async share(): Promise<void> {
    const to = audienceOf(this.choice());
    if (!to) return;
    this.flash.set(null);
    if (this.kind() === 'loadout') {
      if (!('groupId' in to)) return;
      const n = await this.social.shareLoadoutWithGroup(this.subjectId(), to.groupId);
      if (n !== null) this.flash.set({ key: 'hq.friends.share.setDone', params: { n } });
    } else {
      const verdict =
        this.kind() === 'einsatz'
          ? await this.social.shareEinsatz(this.subjectId(), to)
          : await this.social.shareShipConfig(this.subjectId(), to);
      if (verdict) this.flash.set({ key: verdict === 'created' ? 'hq.friends.share.done' : 'hq.friends.share.duplicate' });
      await this.reload();
    }
    this.choice.set(null);
  }

  protected async revoke(r: FriendShareRow): Promise<void> {
    if (await this.social.revokeShare(r.share_id)) await this.reload();
  }
}
