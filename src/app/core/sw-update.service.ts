import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

/**
 * Surfaces ngsw "new version ready" events to the UI and performs the
 * activate-and-reload.
 *
 * Without this, ngsw downloads a new deploy in the background but never
 * activates it while any tab stays open — returning users keep seeing a stale
 * app shell (missing nav links, chunk-hash mismatches that bounce deep links
 * to /news). Wiring SwUpdate lets us prompt for a reload the moment a newer
 * build is ready.
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

  /** True once a newer version is fully downloaded and ready to activate. */
  readonly updateReady = signal(false);

  /** Poll interval for long-open tabs (desktop PWA stays open for hours). */
  private static readonly POLL_MS = 30 * 60 * 1000;

  /**
   * Startup grace window: a newer build that becomes ready this soon after the
   * app opens is treated as a *fresh open* and activated silently (see
   * {@link onVersionReady}). A build that lands later means the user is already
   * settled on the page, so it gets the deliberate reload prompt instead
   * (feedback 4f9fcff8).
   */
  private static readonly STARTUP_GRACE_MS = 10 * 1000;

  /**
   * sessionStorage flag marking that this browsing session already auto-reloaded
   * once for an update. It caps silent reloads at one per session so a
   * pathological "always ready" state can never trap the page in a reload loop —
   * any further ready build in the same session falls through to the prompt.
   */
  private static readonly AUTO_RELOAD_FLAG = 'sc.sw.autoReloaded';

  /** Guards against double-wiring (subscription + timer) if init() re-runs. */
  private initialized = false;
  /** Guards against concurrent activate-and-reload from double clicks. */
  private applying = false;
  /** Epoch ms of the last init() — the anchor for the startup grace window. */
  private startedAt = 0;

  /**
   * Subscribe to version events and start polling. No-op when the service
   * worker is disabled (dev mode or unsupported browser) or already wired.
   */
  init(): void {
    if (this.initialized || !this.swUpdate.isEnabled) {
      return;
    }
    this.initialized = true;
    this.startedAt = Date.now();

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      // versionUpdates can emit outside the Angular zone; re-enter so the
      // signal write reliably schedules CD for the OnPush banner.
      .subscribe(() => this.zone.run(() => this.onVersionReady()));

    // A long-open tab would otherwise only check on reload. Poll outside the
    // Angular zone so the timer never keeps the zone unstable (which would
    // delay `registerWhenStable` and CD).
    void this.swUpdate.checkForUpdate();
    this.zone.runOutsideAngular(() => {
      setInterval(() => void this.swUpdate.checkForUpdate(), SwUpdateService.POLL_MS);
    });
  }

  /**
   * React to a newer build being ready. A fresh open (a ready version within the
   * startup grace window) is activated and loaded silently, so the returning
   * user simply gets the newest site with no reload button. A version that lands
   * later — the user is already on the page and mid-task — instead raises the
   * prompt, so they choose when to reload without losing their view (feedback
   * 4f9fcff8). The once-per-session guard keeps a persistent "ready" state from
   * looping the page.
   */
  private onVersionReady(): void {
    const withinStartup = Date.now() - this.startedAt < SwUpdateService.STARTUP_GRACE_MS;
    if (withinStartup && !this.autoReloadedThisSession()) {
      this.markAutoReloaded();
      void this.applyUpdate();
      return;
    }
    this.updateReady.set(true);
  }

  /** Whether this browsing session already spent its one silent auto-reload. */
  private autoReloadedThisSession(): boolean {
    try {
      return this.window()?.sessionStorage.getItem(SwUpdateService.AUTO_RELOAD_FLAG) === '1';
    } catch {
      // sessionStorage can throw (private mode / disabled storage) — treat as
      // "not yet reloaded" so the feature degrades to always prompting.
      return false;
    }
  }

  /** Record that this session used its silent auto-reload. Best-effort. */
  private markAutoReloaded(): void {
    try {
      this.window()?.sessionStorage.setItem(SwUpdateService.AUTO_RELOAD_FLAG, '1');
    } catch {
      // Ignore — worst case is one extra silent reload if storage is unavailable.
    }
  }

  /** The document's default view, or null when running without a window (SSR). */
  private window(): (Window & typeof globalThis) | null {
    return this.document.defaultView;
  }

  /** Hide the prompt without reloading (update stays pending until next load). */
  dismiss(): void {
    this.updateReady.set(false);
  }

  /** Activate the downloaded version and hard-reload into it. */
  async applyUpdate(): Promise<void> {
    if (this.applying) {
      return;
    }
    this.applying = true;
    try {
      await this.swUpdate.activateUpdate();
      this.document.location.reload();
    } catch {
      // Activation failed (e.g. the new worker vanished) — allow a retry on
      // the next prompt instead of leaving the button silently inert.
      this.applying = false;
    }
  }
}
