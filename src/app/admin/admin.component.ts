import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { Role, RoleService } from '../auth/role.service';
import { AuthService } from '../auth/auth.service';

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  created_at: string;
  last_sign_in_at: string | null;
}

@Component({
  selector: 'sc-admin',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'admin.title' | translate }}</h1>
          <p class="hint">{{ 'admin.subtitle' | translate }}</p>
        </div>
        <button class="sc-btn" (click)="refresh()" [disabled]="busy()">
          {{ 'admin.refresh' | translate }}
        </button>
      </header>

      <div class="sc-card invite-card">
        <div class="invite-head">
          <h2>{{ 'admin.invite.title' | translate }}</h2>
          <p class="hint">{{ 'admin.invite.subtitle' | translate }}</p>
        </div>
        <form class="invite-form" (submit)="onInviteSubmit($event)">
          <input type="email"
                 [value]="inviteEmail()"
                 (input)="inviteEmail.set(asInput($event))"
                 [placeholder]="'admin.invite.emailPlaceholder' | translate"
                 [disabled]="inviteBusy()"
                 required>
          <select [value]="inviteRole()"
                  (change)="inviteRole.set(asSelectRole($event))"
                  [disabled]="inviteBusy()">
            <option value="viewer">{{ 'profile.roles.viewer' | translate }}</option>
            <option value="collaborator">{{ 'profile.roles.collaborator' | translate }}</option>
            <option value="admin">{{ 'profile.roles.admin' | translate }}</option>
          </select>
          <button type="submit"
                  class="sc-btn sc-btn-primary"
                  [disabled]="inviteBusy() || !inviteEmail().includes('@')">
            {{ inviteBusy() ? ('admin.invite.sending' | translate) : ('admin.invite.send' | translate) }}
          </button>
        </form>
        @if (inviteMsg(); as m) {
          <div class="invite-msg" [class.error]="m.kind === 'error'" [class.success]="m.kind === 'success'">
            {{ m.text }}
          </div>
        }
      </div>

      @if (errorMsg()) {
        <div class="err">
          <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ errorMsg() }}
        </div>
      }

      @if (users().length === 0 && !busy()) {
        <div class="sc-card empty">—</div>
      } @else {
        <table class="sc-card table">
          <thead>
            <tr>
              <th>{{ 'admin.col.user' | translate }}</th>
              <th>{{ 'admin.col.email' | translate }}</th>
              <th>{{ 'admin.col.role' | translate }}</th>
              <th>{{ 'admin.col.joined' | translate }}</th>
              <th>{{ 'admin.col.lastSeen' | translate }}</th>
              <th>{{ 'admin.col.actions' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr [class.is-self]="u.id === selfId()">
                <td>{{ u.display_name ?? '—' }}</td>
                <td class="mono">{{ u.email }}</td>
                <td>
                  <span class="role-pill" [class]="u.role">
                    {{ ('profile.roles.' + u.role) | translate }}
                  </span>
                  @if (u.role === 'admin' && adminCount() === 1) {
                    <span class="role-pill last-admin" [title]="'admin.lastAdminTip' | translate">
                      {{ 'admin.lastAdmin' | translate }}
                    </span>
                  }
                </td>
                <td>{{ u.created_at | date:'shortDate' }}</td>
                <td>{{ u.last_sign_in_at ? (u.last_sign_in_at | date:'short') : '—' }}</td>
                <td class="actions">
                  @if (u.role !== 'collaborator') {
                    <button class="sc-btn micro"
                            (click)="setRole(u.id, 'collaborator')"
                            [disabled]="busy() || wouldStrandUs(u, 'collaborator')"
                            [title]="wouldStrandUs(u, 'collaborator') ? ('admin.lastAdminTip' | translate) : ''">
                      {{ 'admin.actions.promoteCollab' | translate }}
                    </button>
                  }
                  @if (u.role !== 'admin') {
                    <button class="sc-btn micro" (click)="setRole(u.id, 'admin')" [disabled]="busy()">
                      {{ 'admin.actions.promoteAdmin' | translate }}
                    </button>
                  }
                  @if (u.role !== 'viewer') {
                    <button class="sc-btn micro"
                            (click)="setRole(u.id, 'viewer')"
                            [disabled]="busy() || wouldStrandUs(u, 'viewer')"
                            [title]="wouldStrandUs(u, 'viewer') ? ('admin.lastAdminTip' | translate) : ''">
                      {{ 'admin.actions.demoteViewer' | translate }}
                    </button>
                  }
                  <button class="sc-btn micro danger"
                          (click)="deleteUser(u)"
                          [disabled]="busy() || wouldStrandByDelete(u)"
                          [title]="wouldStrandByDelete(u) ? ('admin.lastAdminTip' | translate) : ''">
                    {{ (u.id === selfId() ? 'admin.actions.leaveSelf' : 'admin.actions.delete') | translate }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; }
    .table { width: 100%; padding: 0; border-collapse: collapse; overflow: hidden; }
    .table th, .table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--sc-border);
      font-size: 0.88rem;
      vertical-align: middle;
    }
    .table thead th {
      background: var(--sc-bg-2);
      font-family: var(--sc-font-display);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .table tbody tr:hover { background: rgba(0, 212, 255, 0.04); }
    .table tbody tr.is-self {
      background: rgba(0, 212, 255, 0.06);
      box-shadow: inset 2px 0 0 var(--sc-accent);
    }
    .mono { font-family: monospace; font-size: 0.82rem; color: var(--sc-fg-1); }
    .role-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.admin { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.collaborator { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.viewer { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
      &.last-admin {
        background: rgba(251, 191, 36, 0.18);
        color: var(--sc-warning);
        margin-left: 6px;
        cursor: help;
      }
    }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .sc-btn.micro {
      padding: 4px 10px;
      font-size: 0.7rem;
      letter-spacing: 0.04em;
    }
    .sc-btn.micro.danger {
      color: var(--sc-danger);
      border-color: var(--sc-danger);
    }
    .sc-btn.micro.danger:hover:not(:disabled) {
      background: var(--sc-danger);
      color: var(--sc-bg-0);
    }

    .invite-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .invite-head h2 { margin: 0 0 4px; font-size: 1rem; }
    .invite-head .hint { margin: 0; }
    .invite-form {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 10px;
    }
    .invite-form input[type=email],
    .invite-form select {
      padding: 8px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.88rem;
    }
    .invite-form input[type=email]:focus,
    .invite-form select:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .invite-msg {
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.84rem;
    }
    .invite-msg.success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
    }
    .invite-msg.error {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
    }
    @media (max-width: 640px) {
      .invite-form { grid-template-columns: 1fr; }
    }
  `],
})
export class AdminComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly roles = inject(RoleService);
  private readonly auth = inject(AuthService);

  readonly users = signal<AdminUserRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly selfId = computed(() => this.auth.user()?.id ?? null);
  readonly adminCount = computed(() => this.users().filter((u) => u.role === 'admin').length);

  // Invite form state
  readonly inviteEmail = signal('');
  readonly inviteRole = signal<Role>('collaborator');
  readonly inviteBusy = signal(false);
  readonly inviteMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  asSelectRole(e: Event): Role {
    return (e.target as HTMLSelectElement).value as Role;
  }

  async onInviteSubmit(e: Event) {
    e.preventDefault();
    const email = this.inviteEmail().trim();
    const role = this.inviteRole();
    if (!email.includes('@')) return;
    this.inviteBusy.set(true);
    this.inviteMsg.set(null);
    const { data, error } = await this.sb.client.functions.invoke('invite-user', {
      body: { email, role },
    });
    this.inviteBusy.set(false);
    const payload = (data ?? {}) as { ok?: boolean; error?: string; message?: string };
    if (error || payload.error) {
      this.inviteMsg.set({
        kind: 'error',
        text: payload.message ?? payload.error ?? error?.message ?? 'unknown error',
      });
    } else {
      this.inviteMsg.set({
        kind: 'success',
        text: `${email} → ${role} eingeladen.`,
      });
      this.inviteEmail.set('');
      await this.refresh();
    }
  }

  /**
   * Would changing this user's role strand the system without any admin?
   * Returns true when target IS the last remaining admin AND the new role
   * would remove their admin status. Defensive UI-side check — the DB has
   * the same guard in `set_user_role()` and rejects the call regardless.
   */
  wouldStrandUs(target: AdminUserRow, newRole: Role): boolean {
    return target.role === 'admin' && newRole !== 'admin' && this.adminCount() === 1;
  }

  /**
   * Would deleting this user leave the system without any admin? Mirrors the
   * server-side check in the `delete-user` Edge Function — UI just hides the
   * button proactively so the user never gets a confusing 409.
   */
  wouldStrandByDelete(target: AdminUserRow): boolean {
    return target.role === 'admin' && this.adminCount() === 1;
  }

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('list_users_for_admin');
    if (error) {
      this.errorMsg.set(error.message);
    } else {
      this.users.set(((data ?? []) as AdminUserRow[]));
    }
    this.busy.set(false);
  }

  async deleteUser(u: AdminUserRow) {
    const isSelf = u.id === this.selfId();
    const msg = isSelf
      ? `Dein Account (${u.email}) wird endgültig gelöscht. Auch deine Uploads + Bundles verschwinden. Du wirst danach ausgeloggt. Sicher?`
      : `${u.email} wirklich endgültig löschen? Auch deren Uploads + Bundles verschwinden. Nicht rückgängig machbar.`;
    if (!window.confirm(msg)) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client.functions.invoke('delete-user', {
      body: { userId: u.id },
    });
    const payload = (data ?? {}) as { ok?: boolean; error?: string; message?: string; deletedSelf?: boolean };
    if (error || payload.error) {
      this.errorMsg.set(payload.message ?? payload.error ?? error?.message ?? 'delete failed');
      this.busy.set(false);
      return;
    }
    if (payload.deletedSelf) {
      // Sign out and bounce to login — local session is now stale.
      await this.auth.signOut();
      return;
    }
    await this.refresh();
  }

  async setRole(userId: string, newRole: Role) {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { error } = await this.sb.client.rpc('set_user_role', {
      target_id: userId,
      new_role: newRole,
    });
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
    } else {
      // If we just changed our own role, refresh local role signal
      if (userId === this.selfId()) await this.roles.refresh();
      await this.refresh();
    }
  }
}
