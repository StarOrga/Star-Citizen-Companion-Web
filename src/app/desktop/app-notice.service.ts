import { Injectable } from '@angular/core';

/** Public desktop apps that may advertise themselves. Never the Data Uploader. */
export type NoticeApp = 'scc' | 'starscape';

/** Continuous presence on the page before the notice appears. */
export const APP_NOTICE_DELAY_MS = 3000;
/** How long a dismissal (x) silences the notice for that app on this device. */
export const APP_NOTICE_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

const key = (app: NoticeApp) => `sc.appNotice.${app}.snoozedUntil`;

/**
 * Per-device snooze state of the app notices. A notice that is merely ignored
 * stores nothing and so returns on the next visit; only the x writes a
 * timestamp. Storage may be unavailable (private mode, blocked) - then the
 * notice is simply never snoozed.
 */
@Injectable({ providedIn: 'root' })
export class AppNoticeService {
  isSnoozed(app: NoticeApp, now: number = Date.now()): boolean {
    try {
      const until = Number(localStorage.getItem(key(app)));
      return Number.isFinite(until) && until > now;
    } catch {
      return false;
    }
  }

  snooze(app: NoticeApp, now: number = Date.now()): void {
    try {
      localStorage.setItem(key(app), String(now + APP_NOTICE_SNOOZE_MS));
    } catch {
      /* storage unavailable: the snooze lasts for this visit only */
    }
  }
}
