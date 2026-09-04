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
   * Set when `enter()`'s write did not verifiably persist (private mode,
   * full quota, disabled storage — `probeStorageAvailable()` only checks the
   * property exists, not that `setItem` actually works). Without this, the
   * unconditional reload that used to follow a swallowed write error landed
   * the user back on a byte-identical page with zero feedback — "picking a
   * target changes nothing". Cleared at the start of every `enter()` call.
   */
  private readonly _enterFailed = signal(false);
  readonly enterFailed = this._enterFailed.asReadonly();

  /**
   * Called by RoleService after every `refresh()` (and on sign-out) with the
   * live real role. Self-heals a demoted/logged-out/tampered overlay: once
   * the real role is known, any stored value outside its allow-list is wiped.
   */
  setActualRole(role: Role | null, loaded: boolean): void {
    // Captured before the write: `true` means the real role was ALREADY
    // resolved in this document, so anything healed now is a mid-session
    // change (a demotion), not the first resolution after a boot. Only the
    // former can damage anything — see the reload condition below.
    const wasResolved = this._actualLoaded();

    this._actual.set(role);
    this._actualLoaded.set(loaded);
    if (!loaded) return;

    const stored = this._stored();
    // Nothing stored → nothing to heal. This early return is also what makes
    // the reload below provably non-looping: after a heal the key is gone, so
    // the next document lands here with `stored === null` and stops.
    if (stored === null) return;
    if (clampViewAs(role, stored) !== null) return;

    const wiped = this.clearStorage();

    // The one transition that must not happen in place. `supabase.client.ts`
    // documents that every anonClient↔realClient toggle is followed by a full
    // reload; the other two togglers (`enter()`/`exit()`) honor it, this path
    // used not to. Healing out of `'anon'` synchronously flips `sb.client`
    // back to `realClient` and `auth.user()` from null to the real user in
    // front of every effect that reads them — FeedbackDraftService sees the
    // uid change and resets, discarding in-flight drafts, and any request
    // still in flight on the anon client lands its result after the swap.
    //
    // Narrow on purpose — three conditions, each excluding a case where the
    // reload would cost more than it buys:
    //
    // `stored === 'anon'` — the only value that puts `sb.client` on the anon
    //   client at all. Healing out of `viewer`/`collaborator` swaps nothing.
    // `role !== null` — a sign-out has no real session to swap TO;
    //   `auth.user()` goes null → null, nobody sees an identity change, and
    //   reloading would fire on every single sign-out.
    // `wasResolved` — at boot nothing is in flight yet, so the in-place heal
    //   of a stale value is harmless; reloading there would put an extra full
    //   reload in front of anyone carrying a stale key. The damage this guards
    //   is strictly mid-session: an admin previewing as a visitor gets demoted,
    //   and healing flips `auth.user()` from null to that real user and
    //   `sb.client` from anon to real in front of every effect reading them —
    //   FeedbackDraftService sees the uid change and resets, discarding
    //   in-flight drafts, and any request still on the anon client lands its
    //   result after the swap.
    //
    // `wiped` last: reloading with the key still present would heal, reload,
    // heal, forever. When the wipe did not take, `clearStorage()` has already
    // cleared `_stored` in memory, so this document is at least free of the
    // overlay — the same degradation `exit()` falls back to.
    if (stored === 'anon' && role !== null && wasResolved && wiped) this.reload();
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

  /**
   * Whether a preview is resolved and in force. Correct for DISPLAY — the
   * banner, the account-menu sections — but NOT sufficient as a block; see
   * `activeOrPending`.
   */
  readonly active = computed(() => this.viewAs() !== null);

  /**
   * A preview target is stored, but the real role has not arrived yet, so the
   * clamp cannot resolve it. `viewAs()` is `null` in this window (except for
   * the `'anon'` pre-load exception, which is rank-0 and safe to honour
   * early), and therefore `active()` reads `false` — for a `viewer` or
   * `collaborator` preview that lasts the whole `profiles` round trip.
   */
  readonly previewPending = computed(() => this._stored() !== null && !this._actualLoaded());

  /**
   * The check for consumers that use the preview as a BLOCK rather than as a
   * display flag — privileged writes and token handoffs that must not run
   * under an overlay. Failing open for the length of a network round trip is
   * not acceptable there: the only reason those call sites were previously
   * safe is that their routes happen to carry `approvedGuard`, whose
   * `waitReady()` serialises the round trip. That is a property of the
   * routing table, not of the code — a route added without that guard would
   * lose the block silently. This makes the block independent of it.
   */
  readonly activeOrPending = computed(() => this.active() || this.previewPending());

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
   * role. Writes storage, verifies the write actually stuck, then reloads —
   * does NOT touch `_stored` itself. The document that would observe the new
   * value is about to be destroyed by the reload; synchronously flipping
   * `_stored` first would flip `auth.user()` to null a beat early, in front
   * of every effect that reads it (e.g. `FeedbackDraftService`'s identity
   * effect), dropping in-flight drafts for no reason since the reload
   * re-reads storage anyway.
   *
   * Mirrors `exit()`'s degrade-instead-of-reload reasoning (F4), but in the
   * opposite direction: a write that did not stick must NOT be followed by a
   * reload — the page would come back byte-identical with no explanation.
   * Surface `enterFailed()` instead so the UI can tell the user.
   */
  enter(target: ViewAs): void {
    if (!this.targets().includes(target)) return;
    this._enterFailed.set(false);
    if (this.writeStorage(target)) {
      this.reload();
    } else {
      this._enterFailed.set(true);
    }
  }

  /** Lets the UI dismiss the `enterFailed()` notice without another attempt. */
  clearEnterFailed(): void {
    this._enterFailed.set(false);
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

  /**
   * Writes storage and reads it back to confirm the value is verifiably
   * persisted. Returns `false` on a thrown write (private mode / disabled
   * storage) AND on a silent no-op `setItem` (full quota in some browsers)
   * — same "don't trust the call succeeded, check the read-back" shape as
   * `wipeStorageOnly()`.
   */
  private writeStorage(value: ViewAs): boolean {
    const encoded = JSON.stringify(value);
    try {
      const store = this.document.defaultView?.sessionStorage;
      if (!store) return false;
      store.setItem(VIEW_AS_STORAGE_KEY, encoded);
      return store.getItem(VIEW_AS_STORAGE_KEY) === encoded;
    } catch {
      return false;
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
   * self-heal path (`setActualRole`). A demotion out of a non-`anon` preview
   * is not followed by a reload, so the signal must be updated here for the
   * heal to be visible without a round trip.
   *
   * Returns whether the key is verifiably gone — `setActualRole` needs that
   * answer before it may reload (see the loop argument there).
   */
  private clearStorage(): boolean {
    const wiped = this.wipeStorageOnly();
    this._stored.set(null);
    return wiped;
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
