import { Injectable, signal } from '@angular/core';

/**
 * Page-side half of the browser-extension handover (`browser-extension/`).
 *
 * The extension parses the ship list on the user's own RSI hangar page and
 * opens /hangar/import in a new tab. Its content script then answers this
 * service over `window.postMessage` — a same-origin, same-window channel.
 * Deliberately NOT an HTTP endpoint: no new route on the server, no token, no
 * service-role key, no RLS change. The ships are written afterwards by the
 * normal hangar service with the user's own Supabase session.
 */

/** Marker the extension's content script sets on <html> so the app can tell it is installed. */
const PRESENCE_ATTR = 'data-sc-companion-extension';

const APP = 'sc-companion-app';
const EXT = 'sc-companion-extension';

export interface ExtensionShip {
  name: string;
  ship_name: string | null;
  ship_code: string | null;
  entity_type: string;
}

export interface ExtensionHangarPayload {
  version: number;
  source: string;
  capturedAt: number;
  fingerprint: string;
  ships: ExtensionShip[];
}

function isPayload(value: unknown): value is ExtensionHangarPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['fingerprint'] === 'string' &&
    typeof v['capturedAt'] === 'number' &&
    Array.isArray(v['ships'])
  );
}

@Injectable({ providedIn: 'root' })
export class ExtensionBridgeService {
  /** True once the extension announced itself on this origin. */
  readonly installed = signal(this.detect());

  private detect(): boolean {
    return typeof document !== 'undefined' && document.documentElement.hasAttribute(PRESENCE_ATTR);
  }

  /** Extension version string, when installed. */
  version(): string | null {
    if (typeof document === 'undefined') return null;
    return document.documentElement.getAttribute(PRESENCE_ATTR);
  }

  /**
   * The content script runs at document_start, but the attribute can still lag
   * a tick behind a very early component. Re-check for a moment before
   * concluding "not installed".
   */
  async waitForExtension(timeoutMs = 800): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.detect()) {
        this.installed.set(true);
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    this.installed.set(this.detect());
    return this.installed();
  }

  /**
   * Ask the extension for the ship list it stashed. Resolves to null when no
   * extension answers or it has nothing pending — the page then explains the
   * file-import alternative instead of hanging.
   */
  requestPayload(timeoutMs = 2500): Promise<ExtensionHangarPayload | null> {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload: ExtensionHangarPayload | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(payload);
      };

      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const data = event.data as Record<string, unknown> | null;
        if (!data || typeof data !== 'object') return;
        if (data['source'] !== EXT || data['type'] !== 'hangar-import:payload') return;
        this.installed.set(true);
        finish(isPayload(data['payload']) ? data['payload'] : null);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', onMessage);
      this.post({ type: 'hangar-import:request' });
    });
  }

  /**
   * Tell the extension the fleet state was imported. That is what keeps the
   * update nudge quiet until the hangar actually changes again.
   */
  confirmImported(fingerprint: string, count: number): void {
    this.post({ type: 'hangar-import:committed', fingerprint, count });
  }

  /** User left without importing — drop the stashed payload. */
  discard(): void {
    this.post({ type: 'hangar-import:discard' });
  }

  private post(message: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    window.postMessage({ ...message, source: APP }, window.location.origin);
  }
}
