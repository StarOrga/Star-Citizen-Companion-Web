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

  /** Guards against double-wiring (subscription + timer) if init() re-runs. */
  private initialized = false;
  /** Guards against concurrent activate-and-reload from double clicks. */
  private applying = false;

  /**
   * Subscribe to version events and start polling. No-op when the service
   * worker is disabled (dev mode or unsupported browser) or already wired.
   */
  init(): void {
    if (this.initialized || !this.swUpdate.isEnabled) {
      return;
    }
    this.initialized = true;

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      // versionUpdates can emit outside the Angular zone; re-enter so the
      // signal write reliably schedules CD for the OnPush banner.
      .subscribe(() => this.zone.run(() => this.updateReady.set(true)));

    // A long-open tab would otherwise only check on reload. Poll outside the
    // Angular zone so the timer never keeps the zone unstable (which would
    // delay `registerWhenStable` and CD).
    void this.swUpdate.checkForUpdate();
    this.zone.runOutsideAngular(() => {
      setInterval(() => void this.swUpdate.checkForUpdate(), SwUpdateService.POLL_MS);
    });
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
