import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { FriendsService } from './friends.service';
import { FoundUser, edgeInitial, edgeLabel, isValidHandle } from './friends.types';
import { SocialService } from './social.service';
import { inviteLinkFor } from './social.types';

/**
 * The invite box of the Social page (C20): a personal link that expires after
 * 7 days (clicking it files a request, the inviter still accepts: D1), and the
 * exact-username path that existed before. The username lookup stays an exact
 * match on purpose: a substring search would be a user-enumeration endpoint.
 */
@Component({
  selector: 'sc-social-invite-box',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card section" id="social-invite">
      <h2>{{ 'social.invite.title' | translate }}</h2>
      <p class="hint">{{ 'social.invite.hint' | translate }}</p>

      @if (social.error(); as key) {
        <div class="flash error" role="alert">{{ key | translate }}</div>
      }
      @if (friends.error(); as key) {
        <div class="flash error" role="alert">{{ key | translate }}</div>
      }
      @if (flash(); as key) {
        <div class="flash success" role="status">{{ key | translate }}</div>
      }

      @if (social.invite(); as inv) {
        <div class="link-row">
          <input type="text" class="text-input" readonly [value]="link()"
                 [attr.aria-label]="'social.invite.linkLabel' | translate"
                 (focus)="selectAll($event)" />
          <button type="button" class="sc-btn sc-btn-primary" (click)="copy()">
            {{ (copied() ? 'social.invite.copied' : 'social.invite.copy') | translate }}
          </button>
        </div>
        <p class="hint">{{ 'social.invite.expires' | translate: { date: (inv.expires_at | scDate) } }}</p>
        <div class="actions">
          <button type="button" class="sc-btn micro" [disabled]="social.busy()" (click)="renew()">
            {{ 'social.invite.renew' | translate }}
          </button>
          <button type="button" class="sc-btn micro" [disabled]="social.busy()" (click)="revoke()">
            {{ 'social.invite.revoke' | translate }}
          </button>
        </div>
      } @else {
        <button type="button" class="sc-btn sc-btn-primary create" [disabled]="social.busy()" (click)="create()">
          {{ 'social.invite.create' | translate }}
        </button>
      }

      <h3>{{ 'friends.add.title' | translate }}</h3>
      <p class="hint">{{ 'friends.add.hint' | translate }}</p>
      <form class="field-row" (submit)="lookup($event)">
        <input type="text" class="text-input" [value]="handleInput()" (input)="onHandleInput($event)"
               [placeholder]="'friends.add.placeholder' | translate"
               [attr.aria-label]="'friends.add.placeholder' | translate"
               maxlength="20" autocomplete="off" spellcheck="false" />
        <button type="submit" class="sc-btn" [disabled]="friends.busy() || !handleValid()">
          {{ 'friends.add.search' | translate }}
        </button>
      </form>
      @if (searched() && !found()) {
        <p class="empty-inline">{{ 'friends.add.notFound' | translate }}</p>
      }
      @if (found(); as f) {
        <div class="found">
          <span class="found-name">{{ labelOf(f) }}</span>
          <button type="button" class="sc-btn sc-btn-primary" [disabled]="friends.busy()" (click)="sendRequest(f)">
            {{ 'friends.add.send' | translate }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    h2 { margin: 0 0 6px; font-size: 1rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    h3 { margin: 22px 0 4px; font-size: 0.92rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .empty-inline { color: var(--sc-fg-2); font-style: italic; margin: 10px 0 0; }
    .flash { padding: 10px 14px; border-radius: 4px; font-size: 0.9rem; margin-top: 10px; }
    .flash.error { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); }
    .flash.success { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-success); color: var(--sc-success); }
    .link-row, .field-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .create { margin-top: 12px; }
    .text-input {
      flex: 1 1 200px; min-width: 0; padding: 9px 12px; background: var(--sc-bg-1); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-radius: 4px; font: inherit; font-size: max(0.9rem, var(--sc-fs-input));
    }
    .text-input:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25); }
    .found {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; padding: 10px 12px;
      border: 1px solid var(--sc-border); border-radius: 4px; background: var(--sc-bg-1);
    }
    .found-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    @media (pointer: coarse) { .sc-btn { min-height: 48px; } }
  `],
})
export class SocialInviteBoxComponent implements OnInit {
  readonly social = inject(SocialService);
  readonly friends = inject(FriendsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly handleInput = signal('');
  readonly handleValid = computed(() => isValidHandle(this.handleInput()));
  readonly found = signal<FoundUser | null>(null);
  readonly searched = signal(false);
  readonly flash = signal<string | null>(null);
  readonly copied = signal(false);

  readonly link = computed(() => {
    const inv = this.social.invite();
    return inv ? inviteLinkFor(inv.token) : '';
  });

  ngOnInit(): void {
    void this.social.loadInvite();
  }

  /** The page's empty state calls this: scroll the box in, focus the first control. */
  reveal(): void {
    const el = this.host.nativeElement;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('button.create, .link-row button')?.focus({ preventScroll: true });
  }

  labelOf(e: { display_name: string | null; username: string | null }): string {
    return edgeLabel(e);
  }

  initialOf(e: { display_name: string | null; username: string | null }): string {
    return edgeInitial(e);
  }

  selectAll(ev: Event): void {
    (ev.target as HTMLInputElement).select();
  }

  async create(): Promise<void> {
    this.flash.set(null);
    await this.social.createInvite();
  }

  async renew(): Promise<void> {
    this.flash.set(null);
    if (await this.social.revokeInvite()) await this.social.createInvite();
  }

  async revoke(): Promise<void> {
    this.flash.set(null);
    if (await this.social.revokeInvite()) this.flash.set('social.invite.revoked');
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard denied: the field is read-only and selects on focus, so the link stays copyable by hand.
      this.host.nativeElement.querySelector<HTMLInputElement>('.link-row input')?.select();
    }
  }

  onHandleInput(event: Event): void {
    this.handleInput.set((event.target as HTMLInputElement).value);
    this.searched.set(false);
    this.found.set(null);
  }

  async lookup(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.handleValid()) return;
    this.flash.set(null);
    this.found.set(await this.friends.findByUsername(this.handleInput()));
    this.searched.set(true);
  }

  async sendRequest(target: FoundUser): Promise<void> {
    const result = await this.friends.sendRequest(target.user_id);
    if (!result) return;
    this.found.set(null);
    this.searched.set(false);
    this.handleInput.set('');
    // "accepted" means the other side had already asked me: "request sent" would be a lie.
    this.flash.set(
      result === 'accepted' ? 'friends.flash.nowFriends'
        : result === 'already_friends' ? 'friends.flash.alreadyFriends'
          : 'friends.flash.requestSent',
    );
  }
}
