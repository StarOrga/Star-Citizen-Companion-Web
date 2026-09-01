import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { useAutoRefresh } from '../core/auto-refresh';
import { Role, RoleService } from '../auth/role.service';
import { AuthService } from '../auth/auth.service';
import { isDeleteBlocked, isProtectedAccount, isRoleChangeBlocked } from './admin-protection';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  role: Role;
  /**
   * Row exists in `public.protected_admins` (migration 20260802080000).
   * Optional so a client running against a pre-migration DB still parses.
   */
  protected?: boolean | null;
  /**
   * Open `user_reports` rows targeting this account (migration
   * 20260901181500). Optional so a client running against a pre-migration DB
   * still parses; `reportCount()` normalizes it to 0.
   */
  report_count?: number | null;
  created_at: string;
  last_sign_in_at: string | null;
}

/**
 * Row from `list_reports_for_admin()` — one OPEN user report.
 * Phase 1 is read-only: there is no RPC that resolves or acts on a report,
 * and no ban/grace-period action here (that decision is still with the admin).
 */
interface UserReportRow {
  id: string;
  target_id: string;
  target_name: string | null;
  target_username: string | null;
  reporter_id: string;
  reporter_name: string | null;
  reporter_username: string | null;
  category: string;
  reason: string | null;
  created_at: string;
}

/** A reported account, aggregated for the "conspicuous accounts" card. */
interface FlaggedUser {
  user: AdminUserRow;
  count: number;
  reports: UserReportRow[];
}

/** Row from the `list_allowed_emails()` RPC (C4/C6 — email allowlist). */
interface AllowedEmailRow {
  email: string;
  role: Role;
  note: string | null;
  created_at: string;
  consumed_at: string | null;
  /** `auth.users` row exists for this email — i.e. the invite has been used. */
  joined: boolean;
}

/**
 * Row from the `pending_access_requests()` RPC — an invite application filed
 * from the signed-out landing page (migration 20260816120000).
 */
interface AccessRequestRow {
  id: string;
  email: string;
  handle: string | null;
  message: string | null;
  created_at: string;
  /** The address is already on the allowlist (accepting is then a no-op + mail). */
  allowlisted: boolean;
  /** An `auth.users` row already exists for the address. */
  joined: boolean;
}

type SortKey = 'user' | 'email' | 'role' | 'reports' | 'joined' | 'lastSeen';
type SortDir = 'asc' | 'desc';
type RoleFilter = 'all' | Role;

type AllowlistSortKey = 'email' | 'role' | 'status' | 'added';
type AllowlistStatusFilter = 'all' | 'pending' | 'joined';

/** Register-form response contract (C5 — `invite-user` edge function). */
type RegisterStatus = 'allowlisted' | 'approved_existing' | 'invited';
interface RegisterResponse {
  status?: RegisterStatus;
  user_exists?: boolean;
  error?: string;
  message?: string;
}

/** Higher rank = "more privileged"; used for role-column sorting. */
const ROLE_RANK: Record<Role, number> = { admin: 3, collaborator: 2, viewer: 1 };

@Component({
  selector: 'sc-admin',
  standalone: true,
  imports: [ScDatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'admin.title' | translate }}</h1>
          <p class="hint">{{ 'admin.subtitle' | translate }}</p>
        </div>
      </header>

      <!--
        Invite applications from the signed-out landing page (feedback
        56f328ea). Deliberately quiet: no toast, no badge anywhere else in the
        app — it simply shows up here, where the admin manages access anyway.
        "Annehmen" is exactly the register form's happy path with an invite
        mail attached, because the last action was the admin's and the
        applicant has to be told.
      -->
      <div class="sc-card requests-card">
        <div class="invite-head">
          <h2>
            {{ 'admin.requests.title' | translate }}
            @if (accessRequests().length > 0) {
              <span class="req-count">{{ accessRequests().length }}</span>
            }
          </h2>
          <p class="hint">{{ 'admin.requests.subtitle' | translate }}</p>
        </div>

        @if (accessErrorMsg()) {
          <div class="err">
            <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ accessErrorMsg() }}
          </div>
        }

        @if (accessBusy() && accessRequests().length === 0) {
          <div class="empty">{{ 'admin.loading' | translate }}</div>
        } @else if (accessRequests().length === 0) {
          <div class="empty">{{ 'admin.requests.empty' | translate }}</div>
        } @else {
          <ul class="req-list">
            @for (r of accessRequests(); track r.id) {
              <li class="req">
                <div class="req-main">
                  <div class="req-line">
                    <span class="req-email">{{ r.email }}</span>
                    @if (r.handle) { <span class="req-handle">&#64;{{ r.handle }}</span> }
                    @if (r.joined) {
                      <span class="pill">{{ 'admin.requests.joined' | translate }}</span>
                    } @else if (r.allowlisted) {
                      <span class="pill">{{ 'admin.requests.allowlisted' | translate }}</span>
                    }
                  </div>
                  @if (r.message) { <p class="req-msg">{{ r.message }}</p> }
                  <p class="req-date">{{ r.created_at | scDate: 'datetime' }}</p>
                </div>
                <div class="req-actions">
                  <select [value]="requestRole(r.id)"
                          (change)="setRequestRole(r.id, asSelectRole($event))"
                          [attr.aria-label]="'admin.col.role' | translate"
                          [disabled]="accessBusy()">
                    <option value="viewer">{{ 'profile.roles.viewer' | translate }}</option>
                    <option value="collaborator">{{ 'profile.roles.collaborator' | translate }}</option>
                    <option value="admin">{{ 'profile.roles.admin' | translate }}</option>
                  </select>
                  <button type="button" class="sc-btn sc-btn-primary"
                          (click)="acceptRequest(r)" [disabled]="accessBusy()">
                    {{ 'admin.requests.accept' | translate }}
                  </button>
                  <button type="button" class="sc-btn req-decline"
                          (click)="declineRequest(r)" [disabled]="accessBusy()">
                    {{ 'admin.requests.decline' | translate }}
                  </button>
                </div>
              </li>
            }
          </ul>
        }

        @if (accessMsg(); as m) {
          <div class="invite-msg" [class.error]="m.kind === 'error'" [class.success]="m.kind === 'success'" role="status">
            {{ m.text }}
          </div>
        }
      </div>

      <!--
        Conspicuous accounts (feedback cf0ddf7d, phase 1). READ-ONLY on
        purpose: it surfaces who is being reported and why, so an admin can
        judge it. The decision itself — grace period vs. suspending the
        account and killing its sessions across products — is phase 2 and is
        still with the admin, so there is deliberately no action button here.
      -->
      @if (flaggedUsers().length > 0) {
        <div class="sc-card reports-card">
          <div class="invite-head">
            <h2>
              {{ 'admin.reports.title' | translate }}
              <span class="req-count">{{ flaggedUsers().length }}</span>
            </h2>
            <p class="hint">{{ 'admin.reports.subtitle' | translate }}</p>
          </div>

          @if (reportsErrorMsg()) {
            <div class="err">
              <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ reportsErrorMsg() }}
            </div>
          }

          <ul class="req-list">
            @for (f of flaggedUsers(); track f.user.id) {
              <li class="req flagged">
                <div class="req-main">
                  <div class="req-line">
                    <span class="req-email">{{ displayNameOf(f.user.display_name, f.user.username) }}</span>
                    <span class="pill danger-pill">
                      {{ 'admin.reports.count' | translate: { count: f.count } }}
                    </span>
                    <span class="role-pill" [class]="f.user.role">
                      {{ ('profile.roles.' + f.user.role) | translate }}
                    </span>
                  </div>
                  <ul class="report-lines">
                    @for (r of f.reports; track r.id) {
                      <li class="report-line">
                        <span class="rl-cat">{{ 'friends.report.categories.' + r.category | translate }}</span>
                        <span class="rl-by">
                          {{ 'admin.reports.by' | translate: { name: displayNameOf(r.reporter_name, r.reporter_username) } }}
                        </span>
                        <span class="rl-date">{{ r.created_at | scDate: 'datetime' }}</span>
                        @if (r.reason) { <span class="rl-reason">{{ r.reason }}</span> }
                      </li>
                    }
                  </ul>
                </div>
              </li>
            }
          </ul>
          <p class="hint deferred-note">{{ 'admin.reports.deferred' | translate }}</p>
        </div>
      }

      <div class="sc-card invite-card">
        <div class="invite-head">
          <h2>{{ 'admin.register.title' | translate }}</h2>
          <p class="hint">{{ 'admin.register.subtitle' | translate }}</p>
        </div>
        <form class="invite-form" (submit)="onRegisterSubmit($event)">
          <input type="email"
                 [value]="inviteEmail()"
                 (input)="inviteEmail.set(asInput($event))"
                 [placeholder]="'admin.register.emailPlaceholder' | translate"
                 [attr.aria-label]="'admin.register.emailPlaceholder' | translate"
                 [disabled]="inviteBusy()"
                 required>
          <select [value]="inviteRole()"
                  (change)="inviteRole.set(asSelectRole($event))"
                  [attr.aria-label]="'admin.col.role' | translate"
                  [disabled]="inviteBusy()">
            <option value="viewer">{{ 'profile.roles.viewer' | translate }}</option>
            <option value="collaborator">{{ 'profile.roles.collaborator' | translate }}</option>
            <option value="admin">{{ 'profile.roles.admin' | translate }}</option>
          </select>
          <label class="send-invite">
            <input type="checkbox"
                   [checked]="sendInvite()"
                   (change)="sendInvite.set(asChecked($event))"
                   [disabled]="inviteBusy()">
            {{ 'admin.register.sendInvite' | translate }}
          </label>
          <button type="submit"
                  class="sc-btn sc-btn-primary"
                  [disabled]="inviteBusy() || !inviteEmail().includes('@')">
            {{ inviteBusy() ? ('admin.register.sending' | translate) : ('admin.register.send' | translate) }}
          </button>
          <!-- C7: copy action, not a navigation — stays a <button>. -->
          <button type="button"
                  class="sc-btn share-btn"
                  (click)="copyShareLink()">
            {{ 'admin.share.button' | translate }}
          </button>
        </form>
        @if (inviteMsg(); as m) {
          <div class="invite-msg" [class.error]="m.kind === 'error'" [class.success]="m.kind === 'success'">
            {{ m.text }}
          </div>
        }
        @if (shareMsg(); as m) {
          <div class="invite-msg" [class.error]="m.kind === 'error'" [class.success]="m.kind === 'success'" role="status">
            {{ m.text }}
          </div>
        }
      </div>

      <div class="sc-card allowlist-card">
        <div class="invite-head">
          <h2>{{ 'admin.allowlist.title' | translate }}</h2>
          <p class="hint">{{ 'admin.allowlist.subtitle' | translate }}</p>
        </div>

        @if (allowlistErrorMsg()) {
          <div class="err">
            <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ allowlistErrorMsg() }}
          </div>
        }

        @if (allowlistBusy() && allowedEmails().length === 0) {
          <div class="empty">{{ 'admin.loading' | translate }}</div>
        } @else if (allowedEmails().length === 0 && !allowlistBusy()) {
          <div class="empty">—</div>
        } @else {
          <div class="filter-bar">
            <input type="search"
                   class="filter-search"
                   [value]="allowlistSearch()"
                   (input)="allowlistSearch.set(asInput($event))"
                   [placeholder]="'admin.filter.searchPlaceholder' | translate"
                   [attr.aria-label]="'admin.filter.searchPlaceholder' | translate">
            <select class="filter-role"
                    [value]="allowlistStatusFilter()"
                    (change)="allowlistStatusFilter.set(asAllowlistStatusFilter($event))"
                    [attr.aria-label]="'admin.allowlist.col.status' | translate">
              <option value="all">{{ 'admin.allowlist.status.all' | translate }}</option>
              <option value="pending">{{ 'admin.allowlist.status.pending' | translate }}</option>
              <option value="joined">{{ 'admin.allowlist.status.joined' | translate }}</option>
            </select>
            <span class="filter-count">
              {{ 'admin.filter.count' | translate: { shown: filteredSortedAllowlist().length, total: allowedEmails().length } }}
            </span>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th class="sortable" (click)="toggleAllowlistSort('email')"
                    (keydown.enter)="toggleAllowlistSort('email')" (keydown.space)="$event.preventDefault(); toggleAllowlistSort('email')"
                    tabindex="0" [attr.aria-sort]="ariaAllowlistSort('email')" [class.active]="allowlistSortKey() === 'email'">
                  {{ 'admin.col.email' | translate }}<span class="sort-ind">{{ allowlistSortIndicator('email') }}</span>
                </th>
                <th class="sortable" (click)="toggleAllowlistSort('role')"
                    (keydown.enter)="toggleAllowlistSort('role')" (keydown.space)="$event.preventDefault(); toggleAllowlistSort('role')"
                    tabindex="0" [attr.aria-sort]="ariaAllowlistSort('role')" [class.active]="allowlistSortKey() === 'role'">
                  {{ 'admin.col.role' | translate }}<span class="sort-ind">{{ allowlistSortIndicator('role') }}</span>
                </th>
                <th class="sortable" (click)="toggleAllowlistSort('status')"
                    (keydown.enter)="toggleAllowlistSort('status')" (keydown.space)="$event.preventDefault(); toggleAllowlistSort('status')"
                    tabindex="0" [attr.aria-sort]="ariaAllowlistSort('status')" [class.active]="allowlistSortKey() === 'status'">
                  {{ 'admin.allowlist.col.status' | translate }}<span class="sort-ind">{{ allowlistSortIndicator('status') }}</span>
                </th>
                <th class="sortable" (click)="toggleAllowlistSort('added')"
                    (keydown.enter)="toggleAllowlistSort('added')" (keydown.space)="$event.preventDefault(); toggleAllowlistSort('added')"
                    tabindex="0" [attr.aria-sort]="ariaAllowlistSort('added')" [class.active]="allowlistSortKey() === 'added'">
                  {{ 'admin.allowlist.col.added' | translate }}<span class="sort-ind">{{ allowlistSortIndicator('added') }}</span>
                </th>
                <th>{{ 'admin.allowlist.col.note' | translate }}</th>
                <th>{{ 'admin.col.actions' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (a of filteredSortedAllowlist(); track a.email) {
                <tr>
                  <td class="mono">{{ a.email }}</td>
                  <td>
                    <span class="role-pill" [class]="a.role">
                      {{ ('profile.roles.' + a.role) | translate }}
                    </span>
                  </td>
                  <td>
                    <span class="role-pill" [class.joined]="a.joined" [class.pending]="!a.joined">
                      {{ (a.joined ? 'admin.allowlist.status.joined' : 'admin.allowlist.status.pending') | translate }}
                    </span>
                  </td>
                  <td>{{ a.created_at | scDate }}</td>
                  <td class="note">{{ a.note ?? '—' }}</td>
                  <td class="actions">
                    <button class="sc-btn micro danger"
                            (click)="removeAllowedEmail(a)"
                            [disabled]="allowlistBusy()">
                      {{ 'admin.allowlist.remove' | translate }}
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="no-matches">{{ 'admin.filter.noMatches' | translate }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      @if (errorMsg()) {
        <div class="err">
          <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ errorMsg() }}
        </div>
      }

      @if (busy() && users().length === 0) {
        <div class="sc-card empty">{{ 'admin.loading' | translate }}</div>
      } @else if (users().length === 0 && !busy()) {
        <div class="sc-card empty">—</div>
      } @else {
        <div class="filter-bar sc-card">
          <input type="search"
                 class="filter-search"
                 [value]="search()"
                 (input)="search.set(asInput($event))"
                 [placeholder]="'admin.filter.searchPlaceholder' | translate"
                 [attr.aria-label]="'admin.filter.searchPlaceholder' | translate">
          <select class="filter-role"
                  [value]="roleFilter()"
                  (change)="roleFilter.set(asRoleFilter($event))"
                  [attr.aria-label]="'admin.col.role' | translate">
            <option value="all">{{ 'admin.filter.allRoles' | translate }}</option>
            <option value="admin">{{ 'profile.roles.admin' | translate }}</option>
            <option value="collaborator">{{ 'profile.roles.collaborator' | translate }}</option>
            <option value="viewer">{{ 'profile.roles.viewer' | translate }}</option>
          </select>
          <span class="filter-count">
            {{ 'admin.filter.count' | translate: { shown: filteredSortedUsers().length, total: users().length } }}
          </span>
          @if (filtersActive()) {
            <button type="button" class="sc-btn micro" (click)="clearFilters()">
              {{ 'admin.filter.clear' | translate }}
            </button>
          }
        </div>

        <table class="sc-card table">
          <thead>
            <tr>
              <th class="sortable" (click)="toggleSort('user')"
                  (keydown.enter)="toggleSort('user')" (keydown.space)="$event.preventDefault(); toggleSort('user')"
                  tabindex="0" [attr.aria-sort]="ariaSort('user')" [class.active]="sortKey() === 'user'">
                {{ 'admin.col.user' | translate }}<span class="sort-ind">{{ sortIndicator('user') }}</span>
              </th>
              <th class="sortable" (click)="toggleSort('email')"
                  (keydown.enter)="toggleSort('email')" (keydown.space)="$event.preventDefault(); toggleSort('email')"
                  tabindex="0" [attr.aria-sort]="ariaSort('email')" [class.active]="sortKey() === 'email'">
                {{ 'admin.col.email' | translate }}<span class="sort-ind">{{ sortIndicator('email') }}</span>
              </th>
              <th class="sortable" (click)="toggleSort('role')"
                  (keydown.enter)="toggleSort('role')" (keydown.space)="$event.preventDefault(); toggleSort('role')"
                  tabindex="0" [attr.aria-sort]="ariaSort('role')" [class.active]="sortKey() === 'role'">
                {{ 'admin.col.role' | translate }}<span class="sort-ind">{{ sortIndicator('role') }}</span>
              </th>
              <th class="sortable" (click)="toggleSort('reports')"
                  (keydown.enter)="toggleSort('reports')" (keydown.space)="$event.preventDefault(); toggleSort('reports')"
                  tabindex="0" [attr.aria-sort]="ariaSort('reports')" [class.active]="sortKey() === 'reports'">
                {{ 'admin.col.reports' | translate }}<span class="sort-ind">{{ sortIndicator('reports') }}</span>
              </th>
              <th class="sortable" (click)="toggleSort('joined')"
                  (keydown.enter)="toggleSort('joined')" (keydown.space)="$event.preventDefault(); toggleSort('joined')"
                  tabindex="0" [attr.aria-sort]="ariaSort('joined')" [class.active]="sortKey() === 'joined'">
                {{ 'admin.col.joined' | translate }}<span class="sort-ind">{{ sortIndicator('joined') }}</span>
              </th>
              <th class="sortable" (click)="toggleSort('lastSeen')"
                  (keydown.enter)="toggleSort('lastSeen')" (keydown.space)="$event.preventDefault(); toggleSort('lastSeen')"
                  tabindex="0" [attr.aria-sort]="ariaSort('lastSeen')" [class.active]="sortKey() === 'lastSeen'">
                {{ 'admin.col.lastSeen' | translate }}<span class="sort-ind">{{ sortIndicator('lastSeen') }}</span>
              </th>
              <th>{{ 'admin.col.actions' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (u of filteredSortedUsers(); track u.id) {
              <tr [class.is-self]="u.id === selfId()">
                <td>
                  <span class="user-name">{{ u.display_name ?? '—' }}</span>
                  @if (u.username) { <span class="user-handle">&#64;{{ u.username }}</span> }
                </td>
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
                  @if (isProtected(u)) {
                    <span class="role-pill protected" [title]="'admin.protectedTip' | translate">
                      {{ 'admin.protected' | translate }}
                    </span>
                  }
                </td>
                <td>
                  @if (reportCount(u) > 0) {
                    <span class="role-pill reported">{{ reportCount(u) }}</span>
                  } @else {
                    <span class="muted-zero">0</span>
                  }
                </td>
                <td>{{ u.created_at | scDate }}</td>
                <td>{{ u.last_sign_in_at ? (u.last_sign_in_at | scDate: 'datetime') : '—' }}</td>
                <td class="actions">
                  @if (u.role !== 'collaborator') {
                    <button class="sc-btn micro"
                            (click)="setRole(u.id, 'collaborator')"
                            [disabled]="busy() || roleLocked(u, 'collaborator')"
                            [title]="roleLockReason(u, 'collaborator')">
                      {{ 'admin.actions.promoteCollab' | translate }}
                    </button>
                  }
                  @if (u.role !== 'admin') {
                    <button class="sc-btn micro"
                            (click)="setRole(u.id, 'admin')"
                            [disabled]="busy() || roleLocked(u, 'admin')"
                            [title]="roleLockReason(u, 'admin')">
                      {{ 'admin.actions.promoteAdmin' | translate }}
                    </button>
                  }
                  @if (u.role !== 'viewer') {
                    <button class="sc-btn micro"
                            (click)="setRole(u.id, 'viewer')"
                            [disabled]="busy() || roleLocked(u, 'viewer')"
                            [title]="roleLockReason(u, 'viewer')">
                      {{ 'admin.actions.demoteViewer' | translate }}
                    </button>
                  }
                  <button class="sc-btn micro danger"
                          (click)="deleteUser(u)"
                          [disabled]="busy() || deleteLocked(u)"
                          [title]="deleteLockReason(u)">
                    {{ (u.id === selfId() ? 'admin.actions.leaveSelf' : 'admin.actions.delete') | translate }}
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="no-matches">{{ 'admin.filter.noMatches' | translate }}</td>
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

    .filter-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      flex-wrap: wrap;
    }
    .filter-search {
      flex: 1 1 220px;
      min-width: 160px;
      padding: 8px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.88rem;
    }
    .filter-role {
      padding: 8px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.88rem;
    }
    .filter-search:focus,
    .filter-role:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .filter-count {
      color: var(--sc-fg-2);
      font-size: 0.82rem;
      white-space: nowrap;
    }
    .no-matches { text-align: center; color: var(--sc-fg-2); padding: 24px !important; }
    @media (max-width: 640px) {
      .filter-search, .filter-role { flex: 1 1 100%; }
      /* Make the wide user table scroll horizontally instead of pushing the page. */
      .table {
        display: block;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        white-space: nowrap;
      }
      /* 720, not 640: the reports column (feedback cf0ddf7d) added a track. */
      .table thead, .table tbody { display: table; width: 100%; min-width: 720px; }
    }

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
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .table thead th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
    .table thead th.sortable:hover { color: var(--sc-fg-0); }
    .table thead th.active { color: var(--sc-accent); }
    .sort-ind { display: inline-block; width: 1em; margin-left: 4px; font-size: 0.8em; }
    .user-name { display: block; }
    .user-handle { display: block; color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); font-family: monospace; }
    .table tbody tr:hover { background: rgba(0, 212, 255, 0.04); }
    .table tbody tr.is-self {
      background: rgba(0, 212, 255, 0.06);
      box-shadow: inset 2px 0 0 var(--sc-accent);
    }
    .mono { font-family: monospace; font-size: 0.82rem; color: var(--sc-fg-1); overflow-wrap: anywhere; }
    .note { color: var(--sc-fg-2); max-width: 240px; overflow-wrap: anywhere; }
    .role-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: max(0.72rem, var(--sc-fs-floor));
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
      &.protected {
        background: rgba(167, 139, 250, 0.18);
        color: #a78bfa;
        margin-left: 6px;
        cursor: help;
      }
      &.joined { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.pending { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }
    }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    /* Conspicuous accounts (feedback cf0ddf7d) */
    .reports-card { display: flex; flex-direction: column; gap: 12px; }
    .reports-card .req.flagged { align-items: flex-start; }
    .danger-pill {
      background: rgba(248, 113, 113, 0.16) !important;
      color: var(--sc-danger) !important;
      border-color: var(--sc-danger) !important;
    }
    .report-lines { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .report-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      font-size: max(0.8rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .rl-cat { color: var(--sc-fg-0); font-weight: 600; }
    /* A report reason is user-supplied text: interpolated only, never
       innerHTML, and it wraps instead of stretching the card. */
    .rl-reason { flex: 1 1 100%; color: var(--sc-fg-1); overflow-wrap: anywhere; }
    .deferred-note { font-style: italic; }
    .role-pill.reported { background: rgba(248, 113, 113, 0.18); color: var(--sc-danger); }
    .muted-zero { color: var(--sc-fg-2); }

    .sc-btn.micro {
      padding: 4px 10px;
      font-size: max(0.7rem, var(--sc-fs-floor));
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

    .invite-card, .allowlist-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    /* Access requests (feedback 56f328ea) */
    .req-count {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--sc-accent);
      color: var(--sc-bg-0);
      font-size: 0.75rem;
      font-weight: 700;
      vertical-align: middle;
    }
    .requests-card .empty { padding: 20px; }
    .req-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
    .req {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
      padding: 12px 14px;
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.02);
    }
    .req-main { min-width: 0; flex: 1 1 320px; }
    .req-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .req-email { font-weight: 600; word-break: break-all; }
    .req-handle { color: var(--sc-fg-2); font-size: 0.85rem; }
    .pill {
      padding: 1px 8px;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      font-size: max(0.68rem, var(--sc-fs-floor));
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .req-msg {
      margin: 6px 0 0;
      color: var(--sc-fg-1);
      font-size: 0.88rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .req-date { margin: 6px 0 0; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .req-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .sc-btn.req-decline { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.req-decline:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }

    .invite-head h2 { margin: 0 0 4px; font-size: 1rem; }
    .invite-head .hint { margin: 0; }
    .invite-form {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
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
    .invite-form input[type=email] { flex: 1 1 220px; min-width: 180px; }
    .send-invite {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--sc-fg-1);
      font-size: max(0.8rem, var(--sc-fs-floor));
      white-space: nowrap;
    }
    .invite-form input[type=email]:focus,
    .invite-form select:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .invite-form input[type=email]:disabled,
    .invite-form select:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .share-btn { white-space: nowrap; }
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
      .invite-form { flex-direction: column; align-items: stretch; }
      .invite-form input[type=email] { flex: 1 1 100%; }
    }
  `],
})
export class AdminComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly roles = inject(RoleService);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  readonly users = signal<AdminUserRow[]>([]);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly selfId = computed(() => this.auth.user()?.id ?? null);

  // Open user reports (migration 20260901181500). Read-only in phase 1.
  readonly reports = signal<UserReportRow[]>([]);
  readonly reportsErrorMsg = signal<string | null>(null);

  /**
   * Accounts with at least one open report, most-reported first — the
   * "conspicuous accounts" surface the feedback asked for. Derived from
   * users() + reports(), so it needs no extra refresh cadence of its own.
   */
  readonly flaggedUsers = computed<FlaggedUser[]>(() => {
    const byTarget = new Map<string, UserReportRow[]>();
    for (const r of this.reports()) {
      const list = byTarget.get(r.target_id);
      if (list) list.push(r);
      else byTarget.set(r.target_id, [r]);
    }
    return this.users()
      .filter((u) => this.reportCount(u) > 0)
      .map((u) => ({ user: u, count: this.reportCount(u), reports: byTarget.get(u.id) ?? [] }))
      .sort((a, b) => b.count - a.count || a.user.created_at.localeCompare(b.user.created_at));
  });

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.busy() });
    useAutoRefresh(() => this.refreshAllowlist(), { enabled: () => !this.allowlistBusy() });
    useAutoRefresh(() => this.refreshAccessRequests(), { enabled: () => !this.accessBusy() });
    useAutoRefresh(() => this.refreshReports(), { enabled: () => !this.busy() });
  }
  readonly adminCount = computed(() => this.users().filter((u) => u.role === 'admin').length);

  // Client-side filter + sort state (no refetch — operates over users()).
  readonly search = signal('');
  readonly roleFilter = signal<RoleFilter>('all');
  readonly sortKey = signal<SortKey>('joined');
  readonly sortDir = signal<SortDir>('desc');

  readonly filtersActive = computed(
    () => this.search().trim() !== '' || this.roleFilter() !== 'all',
  );

  readonly filteredSortedUsers = computed<AdminUserRow[]>(() => {
    const term = this.search().trim().toLowerCase();
    const roleF = this.roleFilter();
    const key = this.sortKey();
    const dir = this.sortDir();

    const filtered = this.users().filter((u) => {
      if (roleF !== 'all' && u.role !== roleF) return false;
      if (!term) return true;
      const haystack = [u.display_name, u.username, u.email]
        .filter((v): v is string => !!v)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });

    const factor = dir === 'asc' ? 1 : -1;
    // Nulls always sort last, regardless of direction.
    const cmp = (a: string | number | null, b: string | number | null): number => {
      const aNull = a == null || a === '';
      const bNull = b == null || b === '';
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor;
      return String(a).localeCompare(String(b)) * factor;
    };

    const val = (u: AdminUserRow): string | number | null => {
      switch (key) {
        case 'user': return u.display_name ?? u.username ?? null;
        case 'email': return u.email;
        case 'role': return ROLE_RANK[u.role];
        // 0 is a real value here, not "missing" — a user with no reports must
        // not be pushed to the bottom by the nulls-last rule in cmp().
        case 'reports': return this.reportCount(u);
        case 'joined': return u.created_at;
        case 'lastSeen': return u.last_sign_in_at;
      }
    };

    return [...filtered].sort((a, b) => cmp(val(a), val(b)));
  });

  // Register-form state (C5/C6 — replaces the old plain invite form).
  readonly inviteEmail = signal('');
  readonly inviteRole = signal<Role>('collaborator');
  readonly sendInvite = signal(false);
  readonly inviteBusy = signal(false);
  readonly inviteMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  // C7 — share-link copy state (separate toast so it doesn't clash with the
  // register form's own success/error message).
  readonly shareMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Access-request queue state (feedback 56f328ea).
  readonly accessRequests = signal<AccessRequestRow[]>([]);
  readonly accessBusy = signal(false);
  readonly accessErrorMsg = signal<string | null>(null);
  readonly accessMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  /** Per-request role picker; absent = the `viewer` default. */
  private readonly requestRoles = signal<Record<string, Role>>({});

  // Allowlist table state (C6).
  readonly allowedEmails = signal<AllowedEmailRow[]>([]);
  readonly allowlistBusy = signal(false);
  readonly allowlistErrorMsg = signal<string | null>(null);
  readonly allowlistSearch = signal('');
  readonly allowlistStatusFilter = signal<AllowlistStatusFilter>('all');
  readonly allowlistSortKey = signal<AllowlistSortKey>('added');
  readonly allowlistSortDir = signal<SortDir>('desc');

  readonly filteredSortedAllowlist = computed<AllowedEmailRow[]>(() => {
    const term = this.allowlistSearch().trim().toLowerCase();
    const statusF = this.allowlistStatusFilter();
    const key = this.allowlistSortKey();
    const dir = this.allowlistSortDir();

    const filtered = this.allowedEmails().filter((a) => {
      if (statusF === 'pending' && a.joined) return false;
      if (statusF === 'joined' && !a.joined) return false;
      if (!term) return true;
      const haystack = [a.email, a.note].filter((v): v is string => !!v).join(' ').toLowerCase();
      return haystack.includes(term);
    });

    const factor = dir === 'asc' ? 1 : -1;
    const cmp = (a: string | number, b: string | number): number =>
      typeof a === 'number' && typeof b === 'number'
        ? (a - b) * factor
        : String(a).localeCompare(String(b)) * factor;

    const val = (a: AllowedEmailRow): string | number => {
      switch (key) {
        case 'email': return a.email;
        case 'role': return ROLE_RANK[a.role];
        case 'status': return a.joined ? 1 : 0;
        case 'added': return a.created_at;
      }
    };

    return [...filtered].sort((a, b) => cmp(val(a), val(b)));
  });

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  asChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  asSelectRole(e: Event): Role {
    return (e.target as HTMLSelectElement).value as Role;
  }

  asRoleFilter(e: Event): RoleFilter {
    return (e.target as HTMLSelectElement).value as RoleFilter;
  }

  asAllowlistStatusFilter(e: Event): AllowlistStatusFilter {
    return (e.target as HTMLSelectElement).value as AllowlistStatusFilter;
  }

  /** Default sort direction per column — recency columns start descending. */
  private defaultDir(key: SortKey): SortDir {
    return key === 'joined' || key === 'lastSeen' ? 'desc' : 'asc';
  }

  toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set(this.defaultDir(key));
    }
  }

  /** WCAG 4.1.2 — expose the current sort state to assistive tech via aria-sort. */
  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  sortIndicator(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? '▲' : '▼';
  }

  private defaultAllowlistDir(key: AllowlistSortKey): SortDir {
    return key === 'added' ? 'desc' : 'asc';
  }

  toggleAllowlistSort(key: AllowlistSortKey): void {
    if (this.allowlistSortKey() === key) {
      this.allowlistSortDir.set(this.allowlistSortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.allowlistSortKey.set(key);
      this.allowlistSortDir.set(this.defaultAllowlistDir(key));
    }
  }

  ariaAllowlistSort(key: AllowlistSortKey): 'ascending' | 'descending' | 'none' {
    if (this.allowlistSortKey() !== key) return 'none';
    return this.allowlistSortDir() === 'asc' ? 'ascending' : 'descending';
  }

  allowlistSortIndicator(key: AllowlistSortKey): string {
    if (this.allowlistSortKey() !== key) return '';
    return this.allowlistSortDir() === 'asc' ? '▲' : '▼';
  }

  clearFilters(): void {
    this.search.set('');
    this.roleFilter.set('all');
  }

  /**
   * C6 — "Registrieren": upserts the email onto the allowlist (and, per the
   * `invite-user` contract, approves an already-existing account or sends a
   * Supabase invite mail) via a single edge-function call. Body shape and the
   * discriminated `status` response are the C5 contract (core agent).
   */
  async onRegisterSubmit(e: Event) {
    e.preventDefault();
    const email = this.inviteEmail().trim();
    const role = this.inviteRole();
    if (!email.includes('@')) return;
    this.inviteBusy.set(true);
    this.inviteMsg.set(null);
    const { data, error } = await this.sb.client.functions.invoke('invite-user', {
      body: { email, role, sendInvite: this.sendInvite() },
    });
    this.inviteBusy.set(false);
    const payload = (data ?? {}) as RegisterResponse;
    if (error || payload.error) {
      this.inviteMsg.set({
        kind: 'error',
        text: payload.message ?? payload.error ?? error?.message ?? this.translate.instant('admin.register.unknownError'),
      });
      return;
    }
    const statusKey = payload.status ? `admin.register.status.${payload.status}` : 'admin.register.status.allowlisted';
    this.inviteMsg.set({
      kind: 'success',
      text: this.translate.instant(statusKey, { email }),
    });
    this.inviteEmail.set('');
    this.sendInvite.set(false);
    await Promise.all([this.refresh(), this.refreshAllowlist()]);
  }

  /**
   * C7 — copies the admin share link (public `/login` entry point + PostHog
   * UTM params, no PII) to the clipboard. Clipboard API first, `execCommand`
   * fallback for browsers/contexts without it (matches the pattern in
   * api-tokens.component.ts).
   */
  async copyShareLink(): Promise<void> {
    const url = this.shareLink();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = this.legacyCopy(url);

    this.shareMsg.set(
      ok
        ? { kind: 'success', text: this.translate.instant('admin.share.copied') }
        : { kind: 'error', text: this.translate.instant('admin.share.copyFailed') },
    );
    setTimeout(() => this.shareMsg.set(null), 3000);
  }

  private shareLink(): string {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}/login?utm_source=admin_share&utm_medium=referral&utm_campaign=access_invite`;
  }

  private legacyCopy(text: string): boolean {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
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

  /**
   * Founder account (`public.protected_admins`). The DB rejects every
   * demotion/un-approval/deletion of these rows regardless of who asks —
   * see migration 20260802080000_protected_admins.sql. The UI only
   * explains it up front.
   */
  isProtected(target: AdminUserRow): boolean {
    return isProtectedAccount(target);
  }

  roleLocked(target: AdminUserRow, newRole: Role): boolean {
    return isRoleChangeBlocked(target, newRole) || this.wouldStrandUs(target, newRole);
  }

  roleLockReason(target: AdminUserRow, newRole: Role): string {
    if (isRoleChangeBlocked(target, newRole)) return this.translate.instant('admin.protectedTip');
    if (this.wouldStrandUs(target, newRole)) return this.translate.instant('admin.lastAdminTip');
    return '';
  }

  deleteLocked(target: AdminUserRow): boolean {
    return isDeleteBlocked(target) || this.wouldStrandByDelete(target);
  }

  deleteLockReason(target: AdminUserRow): string {
    if (isDeleteBlocked(target)) return this.translate.instant('admin.protectedTip');
    if (this.wouldStrandByDelete(target)) return this.translate.instant('admin.lastAdminTip');
    return '';
  }

  async ngOnInit() {
    await Promise.all([
      this.refresh(),
      this.refreshAllowlist(),
      this.refreshAccessRequests(),
      this.refreshReports(),
    ]);
  }

  /** Open reports against `u`; 0 when the DB predates migration 20260901181500. */
  reportCount(u: AdminUserRow): number {
    return Number(u.report_count ?? 0);
  }

  displayNameOf(name: string | null, handle: string | null): string {
    return handle ?? name ?? '—';
  }

  requestRole(id: string): Role {
    return this.requestRoles()[id] ?? 'viewer';
  }

  setRequestRole(id: string, role: Role): void {
    this.requestRoles.update((m) => ({ ...m, [id]: role }));
  }

  async refreshAccessRequests() {
    this.accessBusy.set(true);
    this.accessErrorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('pending_access_requests');
    if (error) {
      this.accessErrorMsg.set(error.message);
    } else {
      this.accessRequests.set((data ?? []) as AccessRequestRow[]);
    }
    this.accessBusy.set(false);
  }

  /**
   * Accepting is the register form's happy path plus an invite mail: the
   * applicant made the first move but the *last* action is the admin's, so
   * unlike a self-serve signup they have to be told — `sendInvite: true`.
   * The row is only stamped `accepted` after the invite actually succeeded,
   * so a failed mail leaves the request in the queue instead of silently
   * dropping someone.
   */
  async acceptRequest(row: AccessRequestRow) {
    const role = this.requestRole(row.id);
    this.accessBusy.set(true);
    this.accessMsg.set(null);
    const { data, error } = await this.sb.client.functions.invoke('invite-user', {
      body: { email: row.email, role, sendInvite: !row.joined },
    });
    const payload = (data ?? {}) as RegisterResponse;
    if (error || payload.error) {
      this.accessBusy.set(false);
      this.accessMsg.set({
        kind: 'error',
        text: payload.message ?? payload.error ?? error?.message
          ?? this.translate.instant('admin.register.unknownError'),
      });
      return;
    }
    const { error: decideErr } = await this.sb.client.rpc('decide_access_request', {
      request_id: row.id,
      accept: true,
    });
    this.accessBusy.set(false);
    if (decideErr) {
      this.accessMsg.set({ kind: 'error', text: decideErr.message });
      return;
    }
    this.accessMsg.set({
      kind: 'success',
      text: this.translate.instant('admin.requests.accepted', { email: row.email }),
    });
    await Promise.all([this.refreshAccessRequests(), this.refreshAllowlist(), this.refresh()]);
  }

  /**
   * Declining is silent by design — nothing is sent to the applicant (there
   * is no relationship to end). The row is stamped rather than deleted so the
   * decision stays auditable; a genuine second application from the same
   * address is still possible, since only *pending* rows are unique.
   */
  async declineRequest(row: AccessRequestRow) {
    const msg = this.translate.instant('admin.requests.declineConfirm', { email: row.email });
    if (!window.confirm(msg)) return;
    this.accessBusy.set(true);
    this.accessMsg.set(null);
    const { error } = await this.sb.client.rpc('decide_access_request', {
      request_id: row.id,
      accept: false,
    });
    this.accessBusy.set(false);
    if (error) {
      this.accessMsg.set({ kind: 'error', text: error.message });
      return;
    }
    this.accessMsg.set({
      kind: 'success',
      text: this.translate.instant('admin.requests.declined', { email: row.email }),
    });
    await this.refreshAccessRequests();
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

  async refreshReports() {
    this.reportsErrorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('list_reports_for_admin');
    if (error) {
      this.reportsErrorMsg.set(error.message);
      return;
    }
    this.reports.set((data ?? []) as UserReportRow[]);
  }

  async refreshAllowlist() {
    this.allowlistBusy.set(true);
    this.allowlistErrorMsg.set(null);
    const { data, error } = await this.sb.client.rpc('list_allowed_emails');
    if (error) {
      this.allowlistErrorMsg.set(error.message);
    } else {
      this.allowedEmails.set((data ?? []) as AllowedEmailRow[]);
    }
    this.allowlistBusy.set(false);
  }

  async removeAllowedEmail(row: AllowedEmailRow) {
    const msg = this.translate.instant('admin.allowlist.removeConfirm', { email: row.email });
    if (!window.confirm(msg)) return;
    this.allowlistBusy.set(true);
    this.allowlistErrorMsg.set(null);
    const { error } = await this.sb.client.rpc('remove_allowed_email', { target_email: row.email });
    if (error) {
      this.allowlistErrorMsg.set(error.message);
      this.allowlistBusy.set(false);
      return;
    }
    await this.refreshAllowlist();
  }

  async deleteUser(u: AdminUserRow) {
    const isSelf = u.id === this.selfId();
    const msg = isSelf
      ? this.translate.instant('admin.delete.confirmSelf', { email: u.email })
      : this.translate.instant('admin.delete.confirmOther', { email: u.email });
    if (!window.confirm(msg)) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.sb.client.functions.invoke('delete-user', {
      body: { userId: u.id },
    });
    const payload = (data ?? {}) as { ok?: boolean; error?: string; message?: string; deletedSelf?: boolean };
    if (error || payload.error) {
      this.errorMsg.set(payload.message ?? payload.error ?? error?.message ?? this.translate.instant('admin.delete.failed'));
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
