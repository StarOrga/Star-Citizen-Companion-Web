import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import {
  TEAM_NAME_MAX,
  Team,
  TeamMember,
  canManageInvite,
  canRemoveMember,
  formatTeamCode,
} from './social.types';
import { TeamsService } from './teams.service';

/**
 * Real groups (#903): groups people JOIN with an invite code, next to the
 * owner-private friend groups above. A member sees the other members' name,
 * handle and role, nothing else. Destructive steps (leave, delete, remove a
 * member, rotate the code) ask first.
 */
@Component({
  selector: 'sc-social-teams',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card section" id="social-teams">
      <h2>{{ 'social.teams.title' | translate }}</h2>
      <p class="hint">{{ 'social.teams.hint' | translate }}</p>

      @if (teams.error(); as key) {
        <div class="flash error" role="alert">{{ key | translate }}</div>
      }
      @if (teams.invalidCode()) {
        <div class="flash error" role="alert">{{ 'social.teams.invalidCode' | translate }}</div>
      }

      <form class="row" (submit)="create($event)">
        <input type="text" class="sc-input" [value]="newName()" [attr.maxlength]="nameMax" autocomplete="off"
               (input)="newName.set($any($event.target).value)"
               [placeholder]="'social.teams.namePlaceholder' | translate"
               [attr.aria-label]="'social.teams.namePlaceholder' | translate" />
        <button type="submit" scAction tier="secondary" [busy]="teams.busy()" [disabled]="newName().trim().length === 0">
          {{ 'social.teams.create' | translate }}
        </button>
      </form>
      <form class="row" (submit)="join($event)">
        <input type="text" class="sc-input" [value]="code()" maxlength="24" autocomplete="off" spellcheck="false"
               (input)="code.set($any($event.target).value)"
               [placeholder]="'social.teams.codePlaceholder' | translate"
               [attr.aria-label]="'social.teams.codePlaceholder' | translate" />
        <button type="submit" scAction tier="secondary" [busy]="teams.busy()" [disabled]="code().trim().length === 0">
          {{ 'social.teams.join' | translate }}
        </button>
      </form>

      @if (teams.loadError(); as key) {
        <div class="load-error" role="alert">
          <span>{{ key | translate }}</span>
          <button type="button" scAction tier="secondary" (click)="reload()">{{ 'errors.retry' | translate }}</button>
        </div>
      } @else if (teams.loaded() && teams.teams().length === 0) {
        <p class="empty-inline">{{ 'social.teams.empty' | translate }}</p>
      } @else {
        <ul class="teams">
          @for (t of teams.teams(); track t.id) {
            <li class="team">
              <div class="head">
                <strong>{{ t.name }}</strong>
                <span class="meta">{{ 'social.teams.role.' + t.role | translate }}</span>
                <span class="meta">{{ 'social.teams.members' | translate: { count: t.member_count } }}</span>
                <span class="actions">
                  <button type="button" scAction tier="secondary" [attr.aria-expanded]="open() === t.id" (click)="toggle(t)">
                    {{ (open() === t.id ? 'social.teams.hideMembers' : 'social.teams.showMembers') | translate }}
                  </button>
                  <button type="button" scAction tier="secondary" tone="danger" [busy]="teams.busy()" (click)="leave(t)">
                    {{ 'social.teams.leave' | translate }}
                  </button>
                  @if (t.role === 'owner') {
                    <button type="button" scAction tier="secondary" tone="danger" [busy]="teams.busy()" (click)="remove(t)">
                      {{ 'social.teams.delete' | translate }}
                    </button>
                  }
                </span>
              </div>
              @if (canInvite(t) && t.invite_code; as c) {
                <div class="invite">
                  <span class="label">{{ 'social.teams.inviteCode' | translate }}</span>
                  <code class="code">{{ format(c) }}</code>
                  <button type="button" scAction tier="secondary" [busy]="teams.busy()" (click)="rotate(t)">
                    {{ 'social.teams.rotate' | translate }}
                  </button>
                  @if (t.invite_expires_at) {
                    <span class="meta">{{ 'social.teams.expires' | translate: { date: dateOf(t.invite_expires_at) } }}</span>
                  }
                </div>
              }
              @if (open() === t.id) {
                <ul class="members" [attr.aria-label]="'social.teams.membersLabel' | translate">
                  @for (m of membersOf(t.id); track m.user_id) {
                    <li>
                      <span class="who">{{ m.display_name ?? m.username }}</span>
                      <span class="meta">{{ 'social.teams.role.' + m.role | translate }}</span>
                      @if (!m.is_me && canRemoveMember(t.role, m.role)) {
                        <button type="button" scAction tier="secondary" tone="danger" (click)="removeMember(t, m)">
                          {{ 'social.teams.removeMember' | translate }}
                        </button>
                      }
                      @if (t.role === 'owner' && !m.is_me) {
                        <button type="button" scAction tier="secondary" (click)="setRole(t, m, m.role === 'member' ? 'admin' : 'member')">
                          {{ (m.role === 'member' ? 'social.teams.makeAdmin' : 'social.teams.makeMember') | translate }}
                        </button>
                        @if (m.role !== 'owner') {
                          <button type="button" scAction tier="secondary" (click)="setRole(t, m, 'owner')">
                            {{ 'social.teams.makeOwner' | translate }}
                          </button>
                        }
                      }
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    h2 { margin: 0 0 6px; font-size: 1rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .hint, .empty-inline { color: var(--sc-fg-2); margin: 8px 0 0; }
    .empty-inline { font-style: italic; }
    .flash.error, .load-error {
      padding: 10px 14px; border-radius: 4px; margin-top: 10px;
      background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .load-error { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
    .row .sc-input { flex: 1 1 220px; min-width: 0; }
    ul { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .team { border-top: 1px solid var(--sc-border); padding-top: 10px; }
    .head, .invite, .members li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
    .invite { margin-top: 8px; }
    .meta, .label { color: var(--sc-fg-2); }
    .code { font-family: var(--sc-font-mono, monospace); letter-spacing: 0.08em; color: var(--sc-fg-0); user-select: all; }
    .members { gap: 6px; }
    .members li { padding: 4px 0; border-bottom: 1px solid var(--sc-border); }
    @media (pointer: coarse) { .actions button, .members button, .invite button { min-height: 48px; } }
  `],
})
export class SocialTeamsComponent implements OnInit {
  readonly teams = inject(TeamsService);
  private readonly confirmSvc = inject(ScConfirmService);

  readonly nameMax = TEAM_NAME_MAX;
  readonly newName = signal('');
  readonly code = signal('');
  readonly open = signal<string | null>(null);
  readonly canRemoveMember = canRemoveMember;
  readonly format = formatTeamCode;

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    void this.teams.load();
  }

  canInvite(t: Team): boolean {
    return canManageInvite(t.role);
  }

  membersOf(id: string): TeamMember[] {
    return this.teams.members().get(id) ?? [];
  }

  dateOf(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }

  async create(ev: Event): Promise<void> {
    ev.preventDefault();
    if (this.newName().trim().length === 0) return;
    if (await this.teams.create(this.newName())) this.newName.set('');
  }

  async join(ev: Event): Promise<void> {
    ev.preventDefault();
    if (this.code().trim().length === 0) return;
    if (await this.teams.join(this.code())) this.code.set('');
  }

  async toggle(t: Team): Promise<void> {
    if (this.open() === t.id) {
      this.open.set(null);
      return;
    }
    this.open.set(t.id);
    await this.teams.loadMembers(t.id);
  }

  async rotate(t: Team): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.teams.rotateTitle',
      messageKey: 'social.teams.rotateMessage',
      params: { name: t.name },
      confirmKey: 'social.teams.rotate',
    });
    if (ok) await this.teams.rotate(t.id);
  }

  async leave(t: Team): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.teams.leaveTitle',
      messageKey: 'social.teams.leaveMessage',
      params: { name: t.name },
      confirmKey: 'social.teams.leave',
      tone: 'danger',
    });
    if (ok) await this.teams.leave(t.id);
  }

  async remove(t: Team): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.teams.deleteTitle',
      messageKey: 'social.teams.deleteMessage',
      params: { name: t.name },
      confirmKey: 'social.teams.delete',
      tone: 'danger',
    });
    if (ok) await this.teams.delete(t.id);
  }

  async removeMember(t: Team, m: TeamMember): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'social.teams.removeTitle',
      messageKey: 'social.teams.removeMessage',
      params: { name: m.display_name ?? m.username, group: t.name },
      confirmKey: 'social.teams.removeMember',
      tone: 'danger',
    });
    if (ok) await this.teams.remove(t.id, m.user_id);
  }

  async setRole(t: Team, m: TeamMember, role: TeamMember['role']): Promise<void> {
    await this.teams.setRole(t.id, m.user_id, role);
  }
}
