import { Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from '../auth/auth.service';
import {
  AccountStatusRow,
  clearAccountStatus,
  isMissingFunction,
} from './moderation.types';

/**
 * The signed-in user's own moderation state (migration 20260904020000).
 *
 * Why this is a service of its own and NOT three more columns on
 * `RoleService`'s `profiles` read: that read is the app's identity path.
 * Widening its `select` would make every client that ships BEFORE the
 * migration is applied ask for columns the DB does not have yet — PostgREST
 * answers 400, `RoleService` reports `identityUnknown`, and `approvedGuard`
 * fails closed for EVERYBODY. The app deploys on merge and the migration is
 * applied out of band afterwards, so that window is guaranteed to happen.
 * A separate RPC lets the whole feature degrade to "nothing known" instead
 * (see `unavailable`), which is the only safe failure mode for a lockout
 * mechanism.
 *
 * A suspension is enforced server-side regardless of this service:
 * `is_approved()` is false for a suspended account, so every RESTRICTIVE RLS
 * gate in the schema already denies it. This is the part that makes the
 * client NOTICE — and, more importantly, that can say WHY.
 */
@Injectable({ providedIn: 'root' })
export class AccountStatusService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private readonly _status = signal<AccountStatusRow>(clearAccountStatus());
  private readonly _loaded = signal(false);
  private readonly _unavailable = signal(false);

  readonly status = this._status.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /**
   * The RPC is not there (pre-migration DB, or a transient failure on the
   * very first read). Consumers must treat this as "no moderation state
   * known" and never as a denial.
   */
  readonly unavailable = this._unavailable.asReadonly();

  readonly suspended = computed(() => this._status().suspended === true);
  readonly suspensionReason = computed(() => this._status().suspension_reason);
  readonly suspendedUntil = computed(() => this._status().suspended_until);

  /** The newest warning the user has not clicked away yet, or `null`. */
  readonly warning = computed(() => {
    const s = this._status();
    return s.warning_id ? { id: s.warning_id, reason: s.warning_reason, at: s.warning_at } : null;
  });

  /**
   * Survives the forced sign-out on purpose: it is what the login page reads
   * to tell the user why he was just dropped. Cleared only when a session
   * loads clean again.
   */
  private readonly _notice = signal<{ reason: string | null; until: string | null } | null>(null);
  readonly suspensionNotice = this._notice.asReadonly();

  private inFlight: Promise<void> | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private lastUserId: string | null = null;

  constructor() {
    effect(() => {
      if (!this.auth.ready()) return;
      const user = this.auth.realUser();
      if (!user) {
        this.stopPolling();
        this.lastUserId = null;
        this._status.set(clearAccountStatus());
        this._loaded.set(false);
        return;
      }
      // `realUser()` changes identity on every token rotation. Only a real
      // account switch should reset what we already know.
      if (this.lastUserId === user.id) return;
      this.lastUserId = user.id;
      this._loaded.set(false);
      void this.refresh();
      this.startPolling();
    });
  }

  /**
   * Resolves once a verdict exists — a real one, or `unavailable`. Guards
   * await this; it never rejects and never hangs on a failed read.
   */
  async ensureLoaded(): Promise<void> {
    if (this._loaded()) return;
    if (!this.auth.realUser()) return;
    await this.refresh();
  }

  /** One read. Concurrent callers share the in-flight request. */
  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async read(): Promise<void> {
    const user = this.auth.realUser();
    if (!user) return;
    try {
      const { data, error } = await this.sb.realClient.rpc('my_account_status');
      if (error) {
        // "Function does not exist" = the DB has not had migration
        // 20260904020000 applied yet. `loaded` is set so guards stop
        // re-asking on every navigation, but the POLL deliberately keeps
        // running: that window closes when the migration is applied, minutes
        // to hours after the deploy, and a tab that was already open must not
        // stay blind to moderation until someone reloads it. One 404 every
        // three minutes is not worth a stale client.
        //
        // Anything else is a blip: leave `loaded` false so the next
        // navigation retries.
        if (isMissingFunction(error.message, (error as { code?: string }).code)) {
          this._unavailable.set(true);
          this._loaded.set(true);
        }
        return;
      }
      // A user switch that completed while this read was in flight makes the
      // result stale — writing it would attribute one account's suspension
      // to another.
      if (this.auth.realUser()?.id !== user.id) return;

      const row = ((data ?? []) as AccountStatusRow[])[0] ?? clearAccountStatus();
      this._status.set(row);
      this._unavailable.set(false);
      this._loaded.set(true);
      if (row.suspended) {
        this._notice.set({ reason: row.suspension_reason, until: row.suspended_until });
      } else {
        this._notice.set(null);
      }
    } catch {
      // Thrown fetch (offline, CSP, DNS): identical handling to a returned
      // error — say nothing, deny nothing.
    }
  }

  /** Marks the current warning as seen. Never blocks the UI on the result. */
  async acknowledgeWarning(): Promise<void> {
    const w = this.warning();
    if (!w) return;
    try {
      await this.sb.realClient.rpc('acknowledge_warning', { action_id: w.id });
    } catch {
      // Best effort: the banner is dismissed locally either way, and the
      // next refresh re-surfaces it if the write did not land.
    }
    this._status.update((s) => ({ ...s, warning_id: null, warning_reason: null, warning_at: null }));
  }

  /** Called by the guard right before it drops a suspended session. */
  rememberNotice(): void {
    const s = this._status();
    this._notice.set({ reason: s.suspension_reason, until: s.suspended_until });
  }

  clearNotice(): void {
    this._notice.set(null);
  }

  /**
   * A suspension can land while the user is sitting on a page, and the
   * requirement is that he is thrown out then, not on his next navigation.
   * Outside the Angular zone so it cannot keep change detection (or a test's
   * `whenStable`) awake.
   */
  private startPolling(): void {
    if (this.pollHandle !== null || typeof window === 'undefined') return;
    this.zone.runOutsideAngular(() => {
      this.pollHandle = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        this.zone.run(() => void this.refresh());
      }, AccountStatusService.POLL_MS);

      // A hidden tab SKIPS its ticks (no point spending a request on a tab
      // nobody is looking at), which would otherwise leave it up to three
      // minutes stale the moment it comes back — right when the user starts
      // clicking again. Catching the transition back to visible closes that
      // gap without polling in the background.
      if (typeof document !== 'undefined' && !this.visibilityBound) {
        this.visibilityBound = true;
        document.addEventListener('visibilitychange', () => {
          if (document.hidden || !this.auth.realUser()) return;
          this.zone.run(() => void this.refresh());
        });
      }
    });
  }

  private visibilityBound = false;

  private stopPolling(): void {
    if (this.pollHandle === null) return;
    clearInterval(this.pollHandle);
    this.pollHandle = null;
  }

  /**
   * Three minutes: short enough that "and is thrown out of all current
   * sessions" is true in practice, long enough that it is one request per
   * user per three minutes and nothing to rate-limit over.
   */
  private static readonly POLL_MS = 180_000;
}
