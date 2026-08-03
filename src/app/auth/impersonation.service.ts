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
 *
 * Storage-access invariant: every `sessionStorage` touch is try/catch'd —
 * private mode / disabled storage / framed contexts can throw `SecurityError`
 * synchronously just from reading the `.sessionStorage` property, and this
 * service now sits on the Supabase provider's boot path (a throw here would
 * white-screen the whole app). When storage is unavailable we fail closed:
 * `targets()` reports none, so the UI never offers a preview that could not
 * survive its own reload.
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly document = inject(DOCUMENT);

  /**
   * Probed once at construction. `false` means every read/write below is a
   * guaranteed no-op — used to fail `targets()` closed rather than offering
   * a preview that can never persist across its own reload.
   */
  private readonly storageAvailable = this.probeStorageAvailable();

  /**
   * Untrusted value read from sessionStorage, pre-validated as a `ViewAs`
   * shape. Built from `readStored()`, which — critically — must never write
   * to `_stored` itself: this initializer runs *before* `_stored` exists, so
   * any write attempt during it throws (a garbage `sc.viewAs` value used to
   * crash every boot here; see `readStored()`).
   */
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

  /**
   * Fails closed to `[]` when storage is unavailable — offering a preview
   * that can never survive its own reload is worse than offering none.
   */
  readonly targets = computed(() =>
    this.storageAvailable ? impersonationTargets(this._actual()) : [],
  );

  readonly actualRole = this._actual.asReadonly();

  /**
   * No-op unless `target` is a member of `targets()` for the current real
   * role. Writes storage, then reloads — does NOT touch `_stored` itself.
   * The document that would observe the new value is about to be destroyed
   * by the reload; synchronously flipping `_stored` first would flip
   * `auth.user()` to null a beat early, in front of every effect that reads
   * it (e.g. `FeedbackDraftService`'s identity effect), dropping in-flight
   * drafts for no reason since the reload re-reads storage anyway.
   */
  enter(target: ViewAs): void {
    if (!this.targets().includes(target)) return;
    this.writeStorage(target);
    this.reload();
  }

  /**
   * Clears storage, then reloads — same "don't mutate before reload"
   * reasoning as `enter()`. Exception: if the clear did not actually take
   * effect (e.g. a silently no-op'ing `removeItem`), reloading would just
   * restore the same preview from storage and trap the user in it
   * permanently (escapable only by closing the tab). In that case, degrade
   * to an in-memory exit instead — at least this document is free of the
   * overlay — and skip the reload.
   */
  exit(): void {
    if (this.wipeStorageOnly()) {
      this.reload();
    } else {
      this._stored.set(null);
    }
  }

  /**
   * Reads and validates the persisted value. MUST NOT write to `_stored` —
   * it runs as part of `_stored`'s own field initializer, before the signal
   * exists. Wiping a garbage value here goes through `wipeStorageOnly()`
   * (storage-only, no signal touch), never through `clearStorage()`.
   */
  private readStored(): ViewAs | null {
    if (!this.storageAvailable) return null;
    let raw: string | null = null;
    try {
      raw = this.document.defaultView?.sessionStorage.getItem(VIEW_AS_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
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
    this.wipeStorageOnly();
    return null;
  }

  private writeStorage(value: ViewAs): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Write blocked (private mode / disabled storage) — the reload that
      // follows will simply read nothing back, so the preview never takes
      // effect. Nothing further to do here.
    }
  }

  /**
   * Removes the storage key WITHOUT touching any signal. Returns whether the
   * key is verifiably gone afterward (or was never reachable in the first
   * place) — callers that need the "reload is safe" guarantee (F4) check
   * this return value before reloading.
   */
  private wipeStorageOnly(): boolean {
    try {
      const store = this.document.defaultView?.sessionStorage;
      if (!store) return true;
      store.removeItem(VIEW_AS_STORAGE_KEY);
      return store.getItem(VIEW_AS_STORAGE_KEY) === null;
    } catch {
      return false;
    }
  }

  /**
   * Wipes storage AND reflects it in `_stored` immediately. Used only by the
   * self-heal path (`setActualRole`), which is not followed by a reload, so
   * the signal must be updated here for the demotion/self-heal to be visible
   * without a round trip.
   */
  private clearStorage(): void {
    this.wipeStorageOnly();
    this._stored.set(null);
  }

  private probeStorageAvailable(): boolean {
    try {
      return !!this.document.defaultView?.sessionStorage;
    } catch {
      return false;
    }
  }

  /**
   * Reload seam — a single overridable point so unit tests can stub it and
   * never trigger an actual navigation/reload.
   */
  protected reload(): void {
    this.document.defaultView?.location.reload();
  }
}
