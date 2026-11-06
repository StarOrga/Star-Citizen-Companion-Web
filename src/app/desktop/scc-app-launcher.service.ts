import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';

/** The URL the SCC-App registers for itself, see docs/contracts/scc-app-launch.md. */
export const SCC_APP_URI = 'star-citizen-companion://open';

/** How long a launch attempt waits for the browser or the app to take the focus. */
export const SCC_LAUNCH_WAIT_MS = 2500;

const LAUNCHED_BEFORE_KEY = 'sc.sccApp.launchedBefore';

/**
 * Starts the SCC-App from the browser.
 *
 * A browser never says whether a URL scheme has a handler. It only shows the effect: with a
 * handler, its "open this app?" prompt or the app itself takes the focus; without one, nothing
 * happens. So no focus change within the wait reads as "not installed".
 *
 * That reading is wrong in one case: a browser told to always allow the app, with a cold start
 * slower than the wait. Hence the remembered success, see {@link launchedBefore}: this browser
 * has seen the app answer, so the caller must not start a large download on a silent attempt.
 */
@Injectable({ providedIn: 'root' })
export class SccAppLauncherService {
  private readonly doc = inject(DOCUMENT);
  private inflight: Promise<boolean> | null = null;
  /** {@link launchedBefore} as a signal, so a button can follow it. */
  readonly remembered = signal(this.launchedBefore());

  /** Tries to start the app. Resolves true once something took the focus, false when nothing did. */
  launch(): Promise<boolean> {
    this.inflight ??= this.attempt().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Whether this browser has seen the app: it answered a launch, or its live signal came in here. */
  launchedBefore(): boolean {
    try {
      return localStorage.getItem(LAUNCHED_BEFORE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /**
   * Starts the installer download. The file comes as an attachment, so the same-tab navigation
   * leaves this page in place, and it needs no popup permission.
   */
  downloadInstaller(): void {
    const a = this.doc.createElement('a');
    a.href = SCC_INSTALLER_URL;
    a.rel = 'noopener noreferrer';
    a.hidden = true;
    this.doc.body.appendChild(a);
    a.click();
    a.remove();
  }

  /**
   * Hands the URI to the browser through a hidden frame: a top-level navigation to an unknown
   * scheme replaces the page with an error page in Firefox. `frame-src` in vercel.json admits it.
   */
  openUri(uri: string): () => void {
    const frame = this.doc.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.src = uri;
    this.doc.body.appendChild(frame);
    return () => frame.remove();
  }

  private attempt(): Promise<boolean> {
    const view = this.doc.defaultView;
    if (!view) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let removeFrame: () => void = () => undefined;
      const settle = (answered: boolean): void => {
        view.clearTimeout(timer);
        view.removeEventListener('blur', onFocusTaken);
        view.removeEventListener('pagehide', onFocusTaken);
        this.doc.removeEventListener('visibilitychange', onVisibility);
        removeFrame();
        if (answered) this.rememberLaunch();
        resolve(answered);
      };
      const onFocusTaken = (): void => settle(true);
      const onVisibility = (): void => {
        if (this.doc.visibilityState === 'hidden') settle(true);
      };
      const timer = view.setTimeout(() => settle(false), SCC_LAUNCH_WAIT_MS);
      view.addEventListener('blur', onFocusTaken);
      view.addEventListener('pagehide', onFocusTaken);
      this.doc.addEventListener('visibilitychange', onVisibility);
      removeFrame = this.openUri(SCC_APP_URI);
    });
  }

  /** Marks the app as known to this browser. */
  rememberLaunch(): void {
    this.remembered.set(true);
    try {
      localStorage.setItem(LAUNCHED_BEFORE_KEY, '1');
    } catch {
      /* Private window or blocked storage: the next silent attempt just downloads. */
    }
  }
}
