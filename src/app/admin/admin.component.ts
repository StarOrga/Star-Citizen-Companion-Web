import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { useAutoRefresh } from '../core/auto-refresh';
import { Role, RoleService } from '../auth/role.service';
import { AuthService } from '../auth/auth.service';
import { isDeleteBlocked, isProtectedAccount, isRoleChangeBlocked } from './admin-protection';
import { PeopleRow, mergePeopleRows } from './people-rows';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
// Pure function, no Angular dependency — the same "vor 3 Std." formatter the
// news surfaces use (and the `news.relative.*` keys it is documented to read).
import { relativeTime } from '../news/relative-time';
import { ModerationService } from '../social/moderation.service';
import {
  MODERATION_REASON_MAX,
  SUSPENSION_DURATIONS,
  SuspensionFields,
  isSuspended,
  isValidModerationReason,
} from '../social/moderation.types';

/**
 * Extends `SuspensionFields` (moderation.types.ts) rather than re-declaring
 * the four suspension columns `list_users_for_admin()` gained in migration
 * 20260904020000: `isSuspended()` stays the single definition of what
 * "suspended" means, and every one of those fields stays OPTIONAL, so this
 * page still renders against a DB that has not had that migration applied yet
 * (the app deploys on merge, the migration lands out of band afterwards).
 */
interface AdminUserRow extends SuspensionFields {
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

/**
 * One line of the single people list (feedback 5e2facd9) — either a real
 * account or a still-open invitation. The merge rule and the row shape live in
 * `people-rows.ts` so they can be tested without a TestBed.
 */
type AdminPeopleRow = PeopleRow<AdminUserRow, AllowedEmailRow>;

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
  imports: [ScDatePipe, ScSelectComponent, TranslateModule],
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
                  <sc-select
                    class="role-select"
                    [options]="roleOptions"
                    [allowEmpty]="false"
                    [value]="requestRole(r.id)"
                    (valueChange)="setRequestRole(r.id, asRole($event))"
                    [ariaLabel]="'admin.col.role' | translate"
                    [disabled]="accessBusy()" />
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
        Conspicuous accounts (feedback cf0ddf7d). Phase 1 surfaced who is
        being reported and why; phase 2 adds the decision the board owner
        signed off on, and it is a THREE-way one, not a yes/no:
          * warn      — the "grace period with info to the user" branch. The
                        account keeps every bit of access it has and simply
                        gets told, once, and has to acknowledge it.
          * suspend   — is_approved() goes false, live sessions are dropped,
                        and the next sign-in is met with the reason.
          * resolve   — no case (or handled elsewhere): close the reports so
                        the card stops asking. Dismissing is not a silent
                        delete; it stamps status + reviewer on the ledger.
        Both destructive-ish paths need a written reason, because that reason
        is what the affected user gets shown.
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
                    @if (isUserSuspended(f.user)) {
                      <span class="role-pill suspended">{{ 'admin.moderation.suspendedPill' | translate }}</span>
                    }
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

                  @if (isUserSuspended(f.user)) {
                    <p class="susp-note">
                      {{ 'admin.moderation.activeSince' | translate: { date: (f.user.suspended_at | scDate: 'datetime') } }}
                      @if (f.user.suspended_until) {
                        <span class="dot">·</span>
                        {{ 'admin.moderation.activeUntil' | translate: { date: (f.user.suspended_until | scDate: 'datetime') } }}
                      } @else {
                        <span class="dot">·</span>{{ 'admin.moderation.indefinite' | translate }}
                      }
                    </p>
                    @if (f.user.suspension_reason) {
                      <p class="susp-reason">{{ f.user.suspension_reason }}</p>
                    }
                  }

                  <div class="mod-actions">
                    @if (isUserSuspended(f.user)) {
                      <button type="button" class="sc-btn micro"
                              [disabled]="moderation.busy()" (click)="unsuspend(f.user)">
                        {{ 'admin.moderation.unsuspend' | translate }}
                      </button>
                    } @else {
                      <button type="button" class="sc-btn micro"
                              [disabled]="moderation.busy() || !canModerate(f.user)"
                              [title]="moderationLockReason(f.user)"
                              (click)="openModeration(f.user.id, 'warn')">
                        {{ 'admin.moderation.warn' | translate }}
                      </button>
                      <button type="button" class="sc-btn micro danger"
                              [disabled]="moderation.busy() || !canModerate(f.user)"
                              [title]="moderationLockReason(f.user)"
                              (click)="openModeration(f.user.id, 'suspend')">
                        {{ 'admin.moderation.suspend' | translate }}
                      </button>
                    }
                    <button type="button" class="sc-btn micro"
                            [disabled]="moderation.busy()" (click)="resolveReports(f.user, false)">
                      {{ 'admin.moderation.markReviewed' | translate }}
                    </button>
                    <button type="button" class="sc-btn micro ghost"
                            [disabled]="moderation.busy()" (click)="resolveReports(f.user, true)">
                      {{ 'admin.moderation.dismiss' | translate }}
                    </button>
                  </div>

                  @if (modTarget() === f.user.id) {
                    <div class="mod-form">
                      <label class="mod-field">
                        <span class="inline-label">
                          {{ (modMode() === 'warn' ? 'admin.moderation.warnReason' : 'admin.moderation.suspendReason') | translate }}
                        </span>
                        <textarea class="text-input" rows="3"
                                  [value]="modReason()"
                                  (input)="onModReason($event)"
                                  [attr.maxlength]="modReasonMax"
                                  [placeholder]="'admin.moderation.reasonPlaceholder' | translate"></textarea>
                      </label>
                      @if (modMode() === 'suspend') {
                        <label class="mod-field">
                          <span class="inline-label">{{ 'admin.moderation.duration' | translate }}</span>
                          <!-- modDaysValue, not modDays(): "indefinite" is
                               null in the model and '' in the DOM, and binding
                               the null straight in leaves the select matching
                               no option at all — visibly blank. -->
                          <select class="sc-select" [value]="modDaysValue()" (change)="onModDays($event)">
                            @for (d of durations; track d) {
                              <option [value]="d === null ? '' : d">
                                {{ d === null
                                    ? ('admin.moderation.durations.indefinite' | translate)
                                    : ('admin.moderation.durations.days' | translate: { days: d }) }}
                              </option>
                            }
                          </select>
                        </label>
                      }
                      <p class="hint small">{{ 'admin.moderation.reasonVisible' | translate }}</p>
                      @if (moderation.error(); as key) {
                        <p class="err">{{ key | translate }}</p>
                      }
                      <div class="mod-form-actions">
                        <button type="button" class="sc-btn micro primary"
                                [disabled]="moderation.busy() || !modReasonValid()"
                                (click)="submitModeration(f.user)">
                          {{ (modMode() === 'warn' ? 'admin.moderation.confirmWarn' : 'admin.moderation.confirmSuspend') | translate }}
                        </button>
                        <button type="button" class="sc-btn micro ghost" (click)="cancelModeration()">
                          {{ 'admin.moderation.cancel' | translate }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </li>
            }
          </ul>
          @if (modMsg(); as m) {
            <p class="mod-flash" role="status">{{ m | translate }}</p>
          }
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
          <sc-select
            class="role-select"
            [options]="roleOptions"
            [allowEmpty]="false"
            [value]="inviteRole()"
            (valueChange)="inviteRole.set(asRole($event))"
            [ariaLabel]="'admin.col.role' | translate"
            [disabled]="inviteBusy()" />
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

      <!--
        ONE people list (feedback 5e2facd9). The allowlist used to have its own
        card above this table, which meant every invited address that had since
        signed in was listed twice — once as an allowlist row reading "joined",
        once as the account it had become. The allowlist is now folded in here:
        an entry shows up only while it is still an OPEN invitation (no account
        on that address), carrying its own timer and a withdraw action, and it
        disappears from the list the moment it turns into an account row.
      -->
      <div class="invite-head people-head">
        <h2>{{ 'admin.people.title' | translate }}</h2>
        <p class="hint">{{ 'admin.people.subtitle' | translate }}</p>
      </div>

      @if (errorMsg()) {
        <div class="err">
          <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ errorMsg() }}
        </div>
      }
      @if (allowlistErrorMsg()) {
        <div class="err">
          <strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ allowlistErrorMsg() }}
        </div>
      }

      @if (peopleLoading()) {
        <div class="sc-card empty">{{ 'admin.loading' | translate }}</div>
      } @else if (people().length === 0) {
        <div class="sc-card empty">—</div>
      } @else {
        <div class="filter-bar sc-card">
          <input type="search"
                 class="filter-search"
                 [value]="search()"
                 (input)="search.set(asInput($event))"
                 [placeholder]="'admin.filter.searchPlaceholder' | translate"
                 [attr.aria-label]="'admin.filter.searchPlaceholder' | translate">
          <sc-select
            class="filter-role"
            [options]="roleFilterOptions"
            [allowEmpty]="false"
            [value]="roleFilter()"
            (valueChange)="roleFilter.set(asRoleFilterValue($event))"
            [ariaLabel]="'admin.col.role' | translate" />
          <span class="filter-count">
            {{ 'admin.filter.count' | translate: { shown: filteredSortedPeople().length, total: people().length } }}
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
              <!-- "Since", not "Joined": the same column dates an account's
                   sign-up and an open invitation's creation. -->
              <th class="sortable" (click)="toggleSort('joined')"
                  (keydown.enter)="toggleSort('joined')" (keydown.space)="$event.preventDefault(); toggleSort('joined')"
                  tabindex="0" [attr.aria-sort]="ariaSort('joined')" [class.active]="sortKey() === 'joined'">
                {{ 'admin.col.since' | translate }}<span class="sort-ind">{{ sortIndicator('joined') }}</span>
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
            @for (p of filteredSortedPeople(); track p.key) {
            @if (p.user; as u) {
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
                  @if (isUserSuspended(u)) {
                    <span class="role-pill suspended" [title]="u.suspension_reason ?? ''">
                      {{ 'admin.moderation.suspendedPill' | translate }}
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
                  <!-- Lifting a suspension is available on every row, not just
                       on a reported one: a suspension outlives the reports
                       that caused it, and the flagged-accounts card above is
                       empty once they are closed. Suspending itself stays up
                       there, where the evidence is. -->
                  @if (isUserSuspended(u)) {
                    <button class="sc-btn micro"
                            (click)="unsuspend(u)"
                            [disabled]="moderation.busy()"
                            [title]="u.suspension_reason ?? ''">
                      {{ 'admin.moderation.unsuspend' | translate }}
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
            } @else if (p.invite; as inv) {
              <!--
                An open invitation. No account exists yet, so everything an
                account row carries — reports, last seen, role changes, delete —
                has nothing to act on and reads as an em dash. What is left is
                exactly what the admin asked for: how long the invitation has
                been out, and the way to take it back.
              -->
              <tr class="invited-row">
                <td>
                  <span class="role-pill pending" [title]="'admin.people.invitedTitle' | translate">
                    {{ 'admin.people.invitedPill' | translate }}
                  </span>
                  <span class="invite-age">{{ inviteAge(inv.created_at) }}</span>
                </td>
                <td class="mono">
                  {{ inv.email }}
                  @if (inv.note) { <span class="invite-note">{{ inv.note }}</span> }
                </td>
                <td>
                  <span class="role-pill" [class]="inv.role">
                    {{ ('profile.roles.' + inv.role) | translate }}
                  </span>
                </td>
                <td><span class="muted-zero">—</span></td>
                <td [title]="inv.created_at | scDate: 'datetime'">{{ inv.created_at | scDate }}</td>
                <td><span class="muted-zero">—</span></td>
                <td class="actions">
                  <!-- The old card said it in a subline nobody re-read; here the
                       promise sits on the button that needs it. -->
                  <button type="button" class="sc-btn micro danger"
                          (click)="withdrawInvite(inv)"
                          [title]="'admin.people.withdrawTitle' | translate"
                          [disabled]="allowlistBusy()">
                    {{ 'admin.people.withdraw' | translate }}
                  </button>
                </td>
              </tr>
            }
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
    /* The pickers are sc-select components, not native selects — a native one
       draws its OPEN list through the OS, which lands as a bright system menu
       on this dark surface (feedback d93ddb05). Only the box size is set here;
       the control paints itself. */
    sc-select.filter-role { flex: 0 0 auto; width: 190px; }
    .filter-search:focus {
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
      .filter-search, sc-select.filter-role { flex: 1 1 100%; width: auto; }
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
    /* An open invitation is a lighter row than an account — it is a promise,
       not a member. Same grid, muted background, no hover emphasis of its own. */
    .table tbody tr.invited-row { background: rgba(251, 191, 36, 0.04); }
    .invite-age {
      display: block;
      margin-top: 4px;
      color: var(--sc-fg-2);
      font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .invite-note {
      display: block;
      margin-top: 2px;
      max-width: 240px;
      color: var(--sc-fg-2);
      font-family: var(--sc-font-body, inherit);
      overflow-wrap: anywhere;
      white-space: normal;
    }
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
      &.pending { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }
    }
    /* The pill is the row's only explanation of what "Eingeladen" means. */
    .invited-row .role-pill.pending { cursor: help; }
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
    /* A suspension is a state, not an error and not an elevated-access
       surface: --sc-warning. --sc-danger stays on the ACTION that creates it. */
    .role-pill.suspended { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }

    .susp-note { margin: 8px 0 0; color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }
    .susp-note .dot { margin: 0 5px; }
    .susp-reason { margin: 4px 0 0; font-size: 0.85rem; overflow-wrap: anywhere; }

    .mod-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .mod-form {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      background: var(--sc-bg-1);
    }
    .mod-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .mod-field .inline-label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .mod-field .text-input, .mod-field .sc-select {
      padding: 8px 10px;
      background: var(--sc-bg-0);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.88rem;
      width: 100%;
      box-sizing: border-box;
    }
    .mod-field .text-input:focus, .mod-field .sc-select:focus {
      outline: none;
      border-color: var(--sc-accent);
    }
    .mod-form .hint.small { margin: 0 0 10px; font-size: max(0.72rem, var(--sc-fs-floor)); }
    .mod-form .err { margin-bottom: 10px; font-size: 0.85rem; }
    .mod-form-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .sc-btn.micro.primary { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .sc-btn.micro.ghost { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .mod-flash {
      margin: 12px 0 0;
      padding: 8px 12px;
      border-radius: 4px;
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
      font-size: 0.85rem;
    }

    /* 48px, not 44: two overlapping scale(0.994) shell animations shave a
       hair off every measured box, so a 44px target measures 43. */
    @media (pointer: coarse) {
      .mod-actions .sc-btn, .mod-form-actions .sc-btn { min-height: 48px; }
      .mod-field .sc-select { min-height: 48px; }
    }
    @media (max-width: 560px) {
      .mod-actions .sc-btn, .mod-form-actions .sc-btn { flex: 1 1 100%; }
    }
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

    .invite-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    /* The people list has no card of its own (filter bar + table each are one),
       so its heading sits directly on the page background. */
    .people-head { margin-top: 4px; }
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
    /* The role picker leads the two decision buttons, so it gets a fixed box
       instead of stretching with the longest label. */
    sc-select.role-select { flex: 0 0 auto; width: 170px; }
    @media (max-width: 640px) {
      .req-actions { align-items: stretch; }
      sc-select.role-select { flex: 1 1 100%; width: auto; }
    }
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
    .invite-form input[type=email] {
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
    .invite-form input[type=email]:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .invite-form input[type=email]:disabled {
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
      .invite-form sc-select.role-select { width: auto; }
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

  // Open user reports (migration 20260903220000); the actions on them landed
  // with 20260904020000 — see `moderation` below.
  readonly reports = signal<UserReportRow[]>([]);
  readonly reportsErrorMsg = signal<string | null>(null);

  // ── Moderation (feedback cf0ddf7d phase 2) ────────────────────────────────

  readonly moderation = inject(ModerationService);
  readonly durations = SUSPENSION_DURATIONS;
  readonly modReasonMax = MODERATION_REASON_MAX;

  /** Which account's moderation form is open, and in which mode. */
  readonly modTarget = signal<string | null>(null);
  readonly modMode = signal<'warn' | 'suspend'>('warn');
  readonly modReason = signal('');
  /** `null` = indefinite. Kept as the parsed value, not the select's string. */
  readonly modDays = signal<number | null>(7);
  readonly modMsg = signal<string | null>(null);

  readonly modReasonValid = computed(() => isValidModerationReason(this.modReason()));

  /** `modDays()` as the `<option value>` strings — null (indefinite) is ''. */
  readonly modDaysValue = computed(() => {
    const d = this.modDays();
    return d === null ? '' : String(d);
  });

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

  /**
   * Accounts + still-open invitations, merged into the one list the admin
   * manages people in. An allowlist entry is dropped as soon as it has an
   * account behind it — `joined` is the RPC's own `auth.users` probe, the
   * email comparison is the belt-and-braces half for a row that predates it.
   */
  readonly people = computed<AdminPeopleRow[]>(() =>
    mergePeopleRows(this.users(), this.allowedEmails()),
  );

  /**
   * Both feeds are loaded in parallel; the page only claims to be loading
   * while it has nothing at all to show, so a background auto-refresh never
   * blanks a populated table.
   */
  readonly peopleLoading = computed(
    () => (this.busy() || this.allowlistBusy()) && this.people().length === 0,
  );

  readonly filteredSortedPeople = computed<AdminPeopleRow[]>(() => {
    const term = this.search().trim().toLowerCase();
    const roleF = this.roleFilter();
    const key = this.sortKey();
    const dir = this.sortDir();

    const filtered = this.people().filter((p) => {
      if (roleF !== 'all' && p.role !== roleF) return false;
      if (!term) return true;
      const haystack = [p.user?.display_name, p.user?.username, p.email, p.invite?.note]
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

    const val = (p: AdminPeopleRow): string | number | null => {
      switch (key) {
        // An invitation has no name yet — nulls-last keeps it out of the
        // alphabet instead of inventing a placeholder to sort on.
        case 'user': return p.user ? (p.user.display_name ?? p.user.username ?? null) : null;
        case 'email': return p.email;
        case 'role': return ROLE_RANK[p.role];
        // 0 is a real value here, not "missing" — a user with no reports must
        // not be pushed to the bottom by the nulls-last rule in cmp().
        case 'reports': return p.user ? this.reportCount(p.user) : 0;
        case 'joined': return p.since;
        case 'lastSeen': return p.user?.last_sign_in_at ?? null;
      }
    };

    return [...filtered].sort((a, b) => cmp(val(a), val(b)));
  });

  /**
   * The three role choices, shared by the access-request row and the register
   * form. `sc-select` translates `labelKey` itself, so these stay data.
   */
  readonly roleOptions: readonly ScSelectOption[] = [
    { value: 'viewer', labelKey: 'profile.roles.viewer' },
    { value: 'collaborator', labelKey: 'profile.roles.collaborator' },
    { value: 'admin', labelKey: 'profile.roles.admin' },
  ];

  /** Same three, prefixed by the "all roles" row the user table filters on. */
  readonly roleFilterOptions: readonly ScSelectOption[] = [
    { value: 'all', labelKey: 'admin.filter.allRoles' },
    { value: 'admin', labelKey: 'profile.roles.admin' },
    { value: 'collaborator', labelKey: 'profile.roles.collaborator' },
    { value: 'viewer', labelKey: 'profile.roles.viewer' },
  ];

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

  // Allowlist feed (C6). It has no table of its own any more — the open
  // entries are rows of the people list, see people().
  readonly allowedEmails = signal<AllowedEmailRow[]>([]);
  readonly allowlistBusy = signal(false);
  readonly allowlistErrorMsg = signal<string | null>(null);

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  asChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  /**
   * `sc-select` emits `string | null` because a filter may be cleared. Every
   * picker on this page runs with `allowEmpty=false`, so null cannot actually
   * arrive — these three keep the fallback explicit anyway rather than casting
   * a null into a role the rest of the page would then act on.
   */
  asRole(v: string | null): Role {
    return (v ?? 'viewer') as Role;
  }

  asRoleFilterValue(v: string | null): RoleFilter {
    return (v ?? 'all') as RoleFilter;
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

  /**
   * How long this invitation has been out — "vor 3 Tagen" / "3 days ago".
   * `allowed_emails` has no expiry column, so this is elapsed time since the
   * entry was added, not a countdown: the honest reading of the data we have.
   */
  inviteAge(iso: string): string {
    return relativeTime(iso, Date.now(), (key, params) => this.translate.instant(key, params));
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
    // No mail for an address that already has an account: `inviteUserByEmail`
    // refuses those, and there is nothing to invite them TO — they can already
    // sign in. The admin is told so explicitly below, because "accepted" would
    // otherwise read as "the applicant has been informed" when nobody was.
    const invited = !row.joined;
    this.accessBusy.set(true);
    this.accessMsg.set(null);
    const { data, error } = await this.sb.client.functions.invoke('invite-user', {
      body: { email: row.email, role, sendInvite: invited },
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
      text: this.translate.instant(
        invited ? 'admin.requests.accepted' : 'admin.requests.acceptedNoMail',
        { email: row.email },
      ),
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

  // ── Moderation actions (feedback cf0ddf7d phase 2) ────────────────────────

  isUserSuspended(u: AdminUserRow): boolean {
    return isSuspended(u);
  }

  /**
   * Mirrors `moderation_target()`'s server-side refusals so the button is
   * disabled instead of failing on click: never yourself, never another admin,
   * never a protected account. The RPC re-checks all three — this is the
   * explanation, not the enforcement.
   */
  canModerate(u: AdminUserRow): boolean {
    return u.id !== this.selfId() && u.role !== 'admin' && !this.isProtected(u);
  }

  moderationLockReason(u: AdminUserRow): string {
    if (this.canModerate(u)) return '';
    return this.translate.instant('admin.moderation.error.protected');
  }

  openModeration(userId: string, mode: 'warn' | 'suspend'): void {
    this.modMsg.set(null);
    this.moderation.error.set(null);
    this.modTarget.set(userId);
    this.modMode.set(mode);
    this.modReason.set('');
    this.modDays.set(7);
  }

  cancelModeration(): void {
    this.modTarget.set(null);
    this.modReason.set('');
    this.moderation.error.set(null);
  }

  onModReason(event: Event): void {
    this.modReason.set((event.target as HTMLTextAreaElement).value);
  }

  onModDays(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.modDays.set(raw === '' ? null : Number(raw));
  }

  async submitModeration(u: AdminUserRow): Promise<void> {
    if (!this.modReasonValid()) return;
    const warn = this.modMode() === 'warn';
    const ok = warn
      ? await this.moderation.warn(u.id, this.modReason())
      : await this.moderation.suspend(u.id, this.modReason(), this.modDays());
    if (!ok) return;
    this.modTarget.set(null);
    this.modReason.set('');
    this.modMsg.set(warn ? 'admin.moderation.flash.warned' : 'admin.moderation.flash.suspended');
    // Suspending is also a verdict on the reports that prompted it, so the
    // card must not keep asking about the same account afterwards.
    if (!warn) await this.moderation.resolveReports(u.id, false);
    await Promise.all([this.refresh(), this.refreshReports()]);
  }

  async unsuspend(u: AdminUserRow): Promise<void> {
    this.modMsg.set(null);
    if (!(await this.moderation.unsuspend(u.id))) return;
    this.modMsg.set('admin.moderation.flash.unsuspended');
    await this.refresh();
  }

  async resolveReports(u: AdminUserRow, dismiss: boolean): Promise<void> {
    this.modMsg.set(null);
    if (!(await this.moderation.resolveReports(u.id, dismiss))) return;
    this.modMsg.set(
      dismiss ? 'admin.moderation.flash.dismissed' : 'admin.moderation.flash.reviewed',
    );
    await Promise.all([this.refresh(), this.refreshReports()]);
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

  /**
   * Takes an open invitation back — the same `remove_allowed_email()` RPC the
   * old allowlist table's "Entfernen" button called, no new privileged path.
   * Only reachable on a row with no account behind it, which is why the
   * wording can promise plainly that nothing joined is affected.
   */
  async withdrawInvite(row: AllowedEmailRow) {
    const msg = this.translate.instant('admin.people.withdrawConfirm', { email: row.email });
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
