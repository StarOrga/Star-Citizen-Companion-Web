import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import { ScSegmentOption, ScSegmentedComponent } from '../shared/segmented-control.component';
import { FriendsService } from './friends.service';
import { edgeLabel } from './friends.types';
import { SocialService } from './social.service';
import { FRIEND_GROUP_KINDS, FriendGroup, FriendGroupKind, GROUP_NAME_MAX, friendPath, isValidGroupName } from './social.types';

/**
 * Groups (C18, R2): an owner-private list of friends, kind org or
 * Einsatzgruppe, one friend in several. Members never see the list; it is the
 * recipient picker when sharing. A real shared Org is not this.
 */
@Component({
  selector: 'sc-social-groups',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card section" id="social-groups">
      <h2>{{ 'social.groups.title' | translate }}</h2>
      <p class="hint">{{ 'social.groups.privateNote' | translate }}</p>
      <p class="hint">{{ 'social.groups.shareNote' | translate }}</p>

      @if (social.error(); as key) {
        <div class="flash error" role="alert">{{ key | translate }}</div>
      }

      <form class="create" (submit)="create($event)">
        <sc-segmented [options]="kindOptions" [value]="newKind()"
                      [ariaLabel]="'social.groups.kindLabel' | translate"
                      (valueChange)="newKind.set($any($event))" />
        <input type="text" class="text-input" [value]="newName()" (input)="onName($event)"
               [attr.maxlength]="nameMax"
               [placeholder]="'social.groups.namePlaceholder' | translate"
               [attr.aria-label]="'social.groups.namePlaceholder' | translate" autocomplete="off" />
        <button type="submit" class="sc-btn sc-btn-primary" [disabled]="social.busy() || !nameValid()">
          {{ 'social.groups.create' | translate }}
        </button>
      </form>

      @if (social.loadError(); as key) {
        <div class="load-error" role="alert">
          <span>{{ key | translate }}</span>
          <button type="button" class="sc-btn micro" (click)="reload()">{{ 'errors.retry' | translate }}</button>
        </div>
      } @else if (social.groups().length === 0) {
        <p class="empty-inline">{{ 'social.groups.empty' | translate }}</p>
      } @else {
        <ul class="groups">
          @for (g of social.groups(); track g.id) {
            <li class="group">
              <div class="group-head">
                <span class="group-name">{{ g.name }}</span>
                <span class="kind">{{ 'social.group.kind.' + g.kind | translate }}</span>
                <span class="group-actions">
                  <button type="button" class="sc-btn micro" [disabled]="social.busy()" (click)="rename(g)">
                    {{ 'social.groups.rename' | translate }}
                  </button>
                  <button type="button" class="sc-btn micro danger" [disabled]="social.busy()" (click)="remove(g)">
                    {{ 'social.groups.delete' | translate }}
                  </button>
                </span>
              </div>
              @if (friends.graph().friends.length === 0) {
                <p class="empty-inline">{{ 'social.groups.noFriends' | translate }}</p>
              } @else {
                <ul class="chips" [attr.aria-label]="'social.groups.members' | translate">
                  @for (f of friends.graph().friends; track f.user_id) {
                    <li>
                      <button type="button" class="chip" [class.on]="isMember(g, f.user_id)"
                              [attr.aria-pressed]="isMember(g, f.user_id)"
                              [disabled]="social.busy()" (click)="toggle(g, f.user_id)">
                        {{ labelOf(f) }}
                      </button>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
        <p class="hint">
          {{ 'social.groups.friendPageHint' | translate }}
          @if (friends.graph().friends[0]; as first) {
            <a [routerLink]="friendLink(first)">{{ labelOf(first) }}</a>
          }
        </p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    h2 { margin: 0 0 6px; font-size: 1rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .hint a { color: var(--sc-accent); }
    .empty-inline { color: var(--sc-fg-2); font-style: italic; margin: 10px 0 0; }
    .flash.error, .load-error {
      padding: 10px 14px; border-radius: 4px; font-size: 0.9rem; margin-top: 10px;
      background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .load-error { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .create { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
    .text-input {
      flex: 1 1 180px; min-width: 0; padding: 9px 12px; background: var(--sc-bg-1); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; font: inherit; font-size: max(0.9rem, var(--sc-fs-input));
    }
    .text-input:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25); }
    .groups { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; }
    .group { padding: 12px 0; border-bottom: 1px solid var(--sc-border); }
    .group:last-child { border-bottom: 0; }
    .group-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .group-name { color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .kind {
      color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase;
      font-family: var(--sc-font-display);
    }
    .group-actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
    .chips { list-style: none; margin: 10px 0 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      padding: 4px 12px; border-radius: 999px; border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); font: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .chip:hover:not(:disabled) { border-color: var(--sc-accent); }
    .chip.on { border-color: var(--sc-accent); background: rgba(0, 212, 255, 0.12); color: var(--sc-accent); }
    .chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }
    @media (pointer: coarse) { .sc-btn, .chip { min-height: 48px; } }
  `],
})
export class SocialGroupsComponent implements OnInit {
  readonly social = inject(SocialService);
  readonly friends = inject(FriendsService);
  private readonly confirmSvc = inject(ScConfirmService);

  readonly nameMax = GROUP_NAME_MAX;
  readonly kindOptions: readonly ScSegmentOption[] = FRIEND_GROUP_KINDS.map((k) => ({
    value: k,
    labelKey: 'social.group.kind.' + k,
  }));
  readonly newKind = signal<FriendGroupKind>('einsatzgruppe');
  readonly newName = signal('');
  readonly nameValid = computed(() => isValidGroupName(this.newName()));

  ngOnInit(): void {
    void this.social.loadGroups();
  }

  reload(): void {
    void this.social.loadGroups();
  }

  labelOf(e: { display_name: string | null; username: string | null }): string {
    return edgeLabel(e);
  }

  friendLink(e: { user_id: string; username: string | null }): string[] {
    return friendPath(e);
  }

  isMember(g: FriendGroup, userId: string): boolean {
    return g.members.some((m) => m.user_id === userId);
  }

  onName(ev: Event): void {
    this.newName.set((ev.target as HTMLInputElement).value);
  }

  async create(ev: Event): Promise<void> {
    ev.preventDefault();
    if (!this.nameValid()) return;
    if (await this.social.createGroup(this.newKind(), this.newName())) this.newName.set('');
  }

  async rename(g: FriendGroup): Promise<void> {
    const name = await this.confirmSvc.prompt({
      titleKey: 'social.groups.renameTitle',
      params: { name: g.name },
      inputLabelKey: 'social.groups.namePlaceholder',
      inputMaxLength: GROUP_NAME_MAX,
    });
    if (name !== null && isValidGroupName(name)) await this.social.renameGroup(g.id, name);
  }

  async remove(g: FriendGroup): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.groups.deleteTitle',
      messageKey: 'social.groups.deleteMessage',
      params: { name: g.name },
      confirmKey: 'social.groups.delete',
      tone: 'danger',
    });
    if (ok) await this.social.deleteGroup(g.id);
  }

  async toggle(g: FriendGroup, userId: string): Promise<void> {
    await this.social.setGroupMember(g.id, userId, !this.isMember(g, userId));
  }
}
