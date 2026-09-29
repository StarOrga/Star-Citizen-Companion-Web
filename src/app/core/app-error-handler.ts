import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AnalyticsService, pageviewUrl } from './analytics.service';
import { logError } from './log';

/** At most this many `$exception` events per page session. */
const MAX_REPORTS = 10;
const MAX_TEXT = 500;

/**
 * App-wide handler for every error nobody caught (audit plan D05, AUD-098).
 *
 * 1. Always logs `[app] unhandled error` with the route (query dropped, share
 *    tokens masked) — the console is the first place a bug report points to.
 * 2. Forwards a REDACTED copy to PostHog as `$exception`, and only through
 *    `AnalyticsService.captureException`, which is gated on the statistics
 *    consent. Each distinct `name:message` goes out once per page session, and
 *    no more than {@link MAX_REPORTS} in total, so a render loop that throws on
 *    every frame cannot flood the project.
 *
 * `Router` and `AnalyticsService` are resolved lazily inside `handleError`:
 * the ErrorHandler is created very early, and injecting them in the constructor
 * risks a DI cycle. `handleError` itself never throws.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);
  private readonly sent = new Set<string>();

  handleError(error: unknown): void {
    try {
      const route = this.route();
      logError('app', 'unhandled error', { route, error });
      this.forward(error, route);
    } catch {
      // Reporting must never become the next unhandled error.
    }
  }

  private route(): string {
    try {
      return pageviewUrl(this.injector.get(Router).url);
    } catch {
      return '';
    }
  }

  private forward(error: unknown, route: string): void {
    if (this.sent.size >= MAX_REPORTS) return;
    const err = error instanceof Error ? error : null;
    const name = err?.name || 'Error';
    const msg = err ? err.message : String(error);
    const dedupe = `${name}:${msg}`;
    if (this.sent.has(dedupe)) return;
    this.sent.add(dedupe);

    const safe = new Error(redactErrorText(msg));
    safe.name = name;
    safe.stack = redactErrorText(err?.stack ?? '');
    this.injector.get(AnalyticsService).captureException(safe, { $current_url: route, handled: false });
  }
}

const BEARER_PATH = /(\/shared\/loadout\/|\/hangar\/shared\/)[^/\s'")?#]+/g;
const BEARER_HEADER = /Bearer\s+[^\s'",]+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Strip what must not reach an analytics project from an error text: query
 * strings, share-link bearer segments (same prefixes as `maskBearerSegments`),
 * `Bearer` headers, JWTs and e-mail addresses. Capped at 500 characters.
 */
export function redactErrorText(text: string): string {
  return text
    .replace(/\?[^\s'")]*/g, '')
    .replace(BEARER_PATH, '$1:token')
    .replace(BEARER_HEADER, '***')
    .replace(JWT, '***')
    .replace(EMAIL, '***')
    .slice(0, MAX_TEXT);
}
