import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Role,
  ViewAs,
  clampViewAs,
  impersonationTargets,
  isViewAs,
} from './impersonation-policy';

/** sessionStorage key — tab-scoped, never localStorage/cookie/URL. */
export const VIEW_AS_STORAGE_KEY = 'sc.viewAs';

/**
 * Client-side, downgrade-only role-preview overlay ("View as").
 *
 * Deliberately has **zero service dependencies** beyond `DOCUMENT`: this
 * keeps `AuthService` / `SupabaseClientProvider` free of DI cycles (both of
 * them read `viewAs()`), and lets every existing component spec construct
 * this service without stubbing anything.
 *
 * Security invariant: `impersonationTargets()` from `./impersonation-policy`
 * is the only gate. This service never widens it — it only stores/clears a
 * *target* value and clamps it through that gate on every read.
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly document = inject(DOCUMENT);

  /** Untrusted value read from sessionStorage, pre-validated as a `ViewAs` shape. */
  private readonly _stored = signal<ViewAs | null>(this.readStored());

  /** Pushed in by RoleService — the live, DB-derived real role. Never persisted. */
  private readonly _actual = signal<Role | null>(null);
  private readonly _actualLoaded = signal(false);

  /**
   * Called by RoleService after every `refresh()` (and on sign-out) with the
   * live real role. Self-heals a demoted/logged-out/tampered overlay: once
   * the real role is known, any stored value outside its allow-list is wiped.
   */
  setActualRole(role: Role | null, loaded: boolean): void {
    this._actual.set(role);
    this._actualLoaded.set(loaded);
    if (loaded && clampViewAs(role, this._stored()) === null) {
      this.clearStorage();
    }
  }

  /**
   * Effective preview view. The `'anon'` pre-load case is a deliberate
   * exception: before the real role finishes loading, a stored `'anon'`
   * value is honored (it is rank-0 and therefore cannot elevate anyone).
   * Every other case is clamped against the live real role.
   */
  readonly viewAs = computed<ViewAs | null>(() => {
    const stored = this._stored();
    if (stored === 'anon' && !this._actualLoaded()) return 'anon';
    return clampViewAs(this._actual(), stored);
  });

  readonly active = computed(() => this.viewAs() !== null);
  readonly targets = computed(() => impersonationTargets(this._actual()));
  readonly actualRole = this._actual.asReadonly();

  /** No-op unless `target` is a member of `targets()` for the current real role. */
  enter(target: ViewAs): void {
    if (!this.targets().includes(target)) return;
    this.writeStorage(target);
    this._stored.set(target);
    this.reload();
  }

  exit(): void {
    this.clearStorage();
    this.reload();
  }

  private readStored(): ViewAs | null {
    const raw = this.sessionStorage()?.getItem(VIEW_AS_STORAGE_KEY) ?? null;
    if (raw === null) return null;
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not JSON — fall through with the raw string; isViewAs() rejects it
      // unless it happens to be one of the plain literal values.
    }
    if (isViewAs(parsed)) return parsed;
    // Untrusted/garbage value — wipe it immediately rather than carry it.
    this.clearStorage();
    return null;
  }

  private writeStorage(value: ViewAs): void {
    this.sessionStorage()?.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(value));
  }

  private clearStorage(): void {
    this.sessionStorage()?.removeItem(VIEW_AS_STORAGE_KEY);
    this._stored.set(null);
  }

  private sessionStorage(): Storage | undefined {
    return this.document.defaultView?.sessionStorage;
  }

  /**
   * Reload seam — a single overridable point so unit tests can stub it and
   * never trigger an actual navigation/reload.
   */
  protected reload(): void {
    this.document.defaultView?.location.reload();
  }
}
