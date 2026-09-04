import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from './auth.service';
import { ImpersonationService } from './impersonation.service';

export type Role = 'admin' | 'collaborator' | 'viewer';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly imp = inject(ImpersonationService);

  private readonly _actualRole = signal<Role | null>(null);
  private readonly _approved = signal(false);
  private readonly _loaded = signal(false);

  /**
   * True once at least one `refresh()` has completed with a real profile
   * row (success). `_actualRole`/`_approved` only ever hold either the
   * initial defaults (never loaded) or the last KNOWN-GOOD values from such
   * a load — a transient read failure never overwrites them (see
   * `refresh()`'s error branch). This is what lets `identityUnknown` below
   * distinguish "never found out" from "found out, then a later blip
   * happened" without touching the values callers already trust.
   */
  private readonly _hasKnownGood = signal(false);

  /**
   * True only for the specific case a transient `profiles` read failure
   * (network error, RLS hiccup, 401 mid token-rotation, thrown fetch) hits
   * BEFORE any successful load has ever happened — i.e. we have no
   * known-good role/approval to fall back on and are, right now, genuinely
   * unable to say who this authenticated user is. Distinct from "not
   * approved" (a real, DB-confirmed fact) and from "not loaded yet" (normal
   * pre-boot state, see the constructor effect's comment) — see
   * `refresh()` for why laundering this into either of those is the bug.
   * Guards must fail closed on GRANTING access while this is true, but must
   * not treat it as authoritative enough to sign the user out.
   */
  private readonly _identityUnknown = signal(false);
  readonly identityUnknown = this._identityUnknown.asReadonly();

  /** The live, DB-derived real role — never shadowed by the preview overlay. */
  readonly realRole = this._actualRole.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /**
   * Effective role: the clamped preview target while one is active, else the
   * real role. `viewAs()` is already clamped against `realRole()`, so this
   * can never outrank it.
   */
  readonly role = computed<Role | null>(() => {
    const v = this.imp.viewAs();
    if (v === 'anon') return null;
    return v ?? this._actualRole();
  });

  /** True only when the account was invited by an admin (or is the bootstrap admin). */
  readonly approved = computed(() => (this.imp.viewAs() === 'anon' ? false : this._approved()));
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isCollaborator = computed(() => this.role() === 'admin' || this.role() === 'collaborator');

  constructor() {
    // Watches the REAL user (not the shadowed `auth.user()`), so the real
    // role stays loaded during an anon preview and exiting the preview
    // needs no round trip to the DB.
    effect(() => {
      // `auth.ready()` is the discriminator between "not signed in" and
      // "haven't found out yet". This effect fires the instant RoleService
      // is constructed — which is BEFORE `AuthService.init()`'s
      // `getSession()` promise resolves — so on that very first run
      // `realUser()` is `null` regardless of whether a session is about to
      // be restored. Reporting that as `setActualRole(null, true)` used to
      // make `ImpersonationService`'s self-heal treat "not loaded yet" as a
      // genuine sign-out and wipe a just-written `sc.viewAs` before the
      // reload that set it even got a chance to apply — "View as" then
      // silently never took effect. Deferring here only postpones the
      // self-heal decision; it can never widen `impersonationTargets()`,
      // since `viewAs()` itself stays clamped against `_actual()`/`anon`'s
      // pre-load exception in the meantime (see impersonation.service.ts).
      if (!this.auth.ready()) return;
      const user = this.auth.realUser();
      if (!user) {
        this._actualRole.set(null);
        this._approved.set(false);
        this._hasKnownGood.set(false);
        this._identityUnknown.set(false);
        this._loaded.set(false);
        this.imp.setActualRole(null, true);
        return;
      }
      // `refresh()` now settles `_loaded` (true or false) itself on every
      // path, including a thrown fetch — see its own comment. This `.catch`
      // stays only as a backstop against something unrelated throwing (e.g.
      // inside `imp.setActualRole`), so a bug there can't re-open the
      // `waitReady()`-never-settles failure mode this effect used to have.
      this.refresh().catch(() => null);
    });
  }

  async refresh(): Promise<void> {
    const user = this.auth.realUser();
    if (!user) {
      this._actualRole.set(null);
      this._approved.set(false);
      this._hasKnownGood.set(false);
      this._identityUnknown.set(false);
      this._loaded.set(false);
      this.imp.setActualRole(null, true);
      return;
    }
    // Auth is preview-shadowed, but the profile lookup itself always uses
    // whichever client `sb.client` currently resolves to for reads; the
    // real user id is passed explicitly so this always targets the real
    // account's row regardless of preview state.
    //
    // This effect re-runs on every `realUser()` identity change, which
    // includes every Supabase token refresh (a fresh `Session` object, new
    // reference, same user) — so this runs repeatedly through a normal
    // session, and a transient read failure (401 mid token-rotation, an RLS
    // hiccup, a network blip) is expected, not exceptional. A read FAILURE
    // is not a derived FACT: reporting it as `setActualRole('viewer', true)`
    // used to (a) make the self-heal see "role demoted to viewer" and wipe
    // an active preview, and (b) make `approvedGuard` see `approved() ===
    // false` and sign the real user out — both authoritative reactions to
    // information we don't actually have. `readProfile()`'s `try/catch`
    // also folds a THROWN fetch (offline, DNS, CSP) into the exact same
    // handling as a returned `{ error }` — previously only the latter was covered, and
    // the former left `_loaded` stuck at `false` forever (`waitReady()`
    // polling with no exit).
    let result = await this.readProfile(user.id);

    // A failure on the very FIRST load is the one that flips
    // `identityUnknown` — and `approvedGuard` has to fail closed on that,
    // stranding the navigation the user is on. The OAuth callback produces
    // exactly that shape: the read fired immediately after the PKCE code
    // exchange can come back 401 while the very next one, ~1s later,
    // succeeds (observed live 2026-08-30, 18:53:44 UTC — a Google sign-in
    // whose first `role,is_approved` read 401'd and left the app on an
    // empty screen until a manual reload). So retry briefly before
    // recording any verdict at all.
    //
    // Deliberately ONLY on the first load: once known-good data exists, the
    // branch below already absorbs a blip without changing anything, and
    // since `refresh()` re-runs on every token rotation, retrying there
    // would turn a routine 401 into a burst of requests for no gain.
    for (const delay of RoleService.FIRST_LOAD_RETRY_DELAYS_MS) {
      if (result && !result.error) break;
      if (this._hasKnownGood()) break;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      // A sign-out (or a user switch) while we waited makes this run stale:
      // the effect has already reset the signals for whoever is current
      // now, and writing this run's outcome would clobber that.
      if (this.auth.realUser()?.id !== user.id) return;
      result = await this.readProfile(user.id);
    }

    if (!result || result.error) {
      // Always settle `_loaded` — a failed read still resolves `waitReady()`
      // one way or another; hanging every guard indefinitely is strictly
      // worse than deciding "unknown" and letting the guard fail closed on
      // *this* navigation.
      this._loaded.set(true);
      if (!this._hasKnownGood()) {
        // The very first load ever failed: there is no known-good role or
        // approval to fall back on, so `_actualRole`/`_approved` stay at
        // their untouched initial defaults (null / false) — same shape as
        // "not loaded yet" — and we deliberately do NOT call
        // `imp.setActualRole()` here, so the self-heal does not run against
        // a role we never actually observed. `identityUnknown` is the only
        // signal that flips, so `approvedGuard` can fail closed on
        // *granting* access without laundering this into "confirmed
        // non-approved viewer" and signing the user out.
        this._identityUnknown.set(true);
      }
      // Else: we already have known-good values from a prior successful
      // load (this is the repeated-token-refresh case) — leave
      // `_actualRole`/`_approved` exactly as they are, and skip re-pushing
      // to `ImpersonationService`: its clamp already ran against the still
      // -current, still-correct values, and re-running it here would add
      // nothing but risk.
      return;
    }
    const { data } = result;
    const role: Role = (data?.['role'] as Role) ?? 'viewer';
    const approved = data?.['is_approved'] === true;
    this._actualRole.set(role);
    this._approved.set(approved);
    this._hasKnownGood.set(true);
    this._identityUnknown.set(false);
    this._loaded.set(true);
    this.imp.setActualRole(role, true);
  }

  /**
   * Backoff between retries of the very first `profiles` read (see
   * `refresh()`). Two extra attempts, ~1s of waiting in total — enough to
   * ride out the post-sign-in token race, and far short of
   * `WAIT_READY_TIMEOUT_MS`, which every guard is polling against
   * meanwhile.
   */
  private static readonly FIRST_LOAD_RETRY_DELAYS_MS = [250, 750];

  /**
   * One `profiles` read. A THROWN fetch (offline, DNS, CSP) folds into
   * `null` so callers handle it identically to a returned `{ error }`.
   */
  private async readProfile(
    userId: string,
  ): Promise<{ data: Record<string, unknown> | null; error: unknown } | null> {
    try {
      return await this.sb.realClient
        .from('profiles')
        .select('role, is_approved')
        .eq('id', userId)
        .maybeSingle();
    } catch {
      return null;
    }
  }

  /**
   * Max time to wait for `_loaded` before giving up and resolving anyway.
   * Without this, a caller that started waiting right as a sign-out reset
   * `_loaded` back to `false` (or any other path that never flips it back
   * to `true`) would poll forever — the same leak as the swallowed-rejection
   * bug this was written to fix, just from a different trigger. Callers
   * that care about *why* it resolved should check `loaded()` /
   * `identityUnknown()` afterward rather than trusting the promise settling
   * to mean "we know the role" (see `approvedGuard`).
   */
  private static readonly WAIT_READY_TIMEOUT_MS = 5000;

  waitReady(): Promise<void> {
    if (this._loaded()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      };
      const interval = setInterval(() => {
        if (this._loaded()) finish();
      }, 30);
      const timeout = setTimeout(finish, RoleService.WAIT_READY_TIMEOUT_MS);
    });
  }
}
