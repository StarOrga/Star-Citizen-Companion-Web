import { Injectable, Injector, effect, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import type { PostHog } from 'posthog-js';
import { environment } from '../../environments/environment';
import { ConsentService } from './consent.service';

/**
 * Anonymous product analytics via PostHog (issue #139).
 *
 * Two independent gates, both of which must be open before anything happens:
 *  1. `environment.posthog.key` is non-empty. Empty is the shipped default —
 *     the admin supplies the key separately, and until then this service is a
 *     no-op and the posthog-js chunk is never even fetched.
 *  2. The user opted into the `statistics` consent category. It defaults to
 *     off, so a fresh visitor sends nothing.
 *
 * Revoking consent at runtime opts out, resets the distinct id, and lets
 * `ConsentService` purge PostHog's localStorage keys — no reload needed.
 *
 * Privacy posture (deliberate, matches the "no cookies, no tracking-by-default"
 * promise the storage notice makes):
 *  - `persistence: 'localStorage'` — PostHog's default is cookies; we never set one.
 *  - `autocapture: false` — no blanket click/input capture; only explicit events.
 *  - session recording and heatmaps off, `person_profiles: 'never'` — we never
 *    identify a user, so events stay anonymous.
 *  - EU ingest host (admin decision: EU/Germany).
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly consent = inject(ConsentService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private client: PostHog | null = null;
  /** Guards against a second concurrent lazy-load while the first is in flight. */
  private loading = false;
  private routerBound = false;

  /** Whether a key is configured at all — false ships until the admin adds one. */
  private get configured(): boolean {
    return environment.posthog.key.trim().length > 0;
  }

  /**
   * Called once from AppComponent. Sets up the consent reaction; the library
   * itself loads lazily, only if and when consent is actually granted.
   */
  init(): void {
    if (!this.configured) return;
    // Explicit injector: init() is called from ngOnInit, outside an injection context.
    effect(
      () => {
        if (this.consent.statisticsAllowed()) void this.enable();
        else this.disable();
      },
      { injector: this.injector },
    );
  }

  /**
   * Records a product event. Safe to call unconditionally from feature code:
   * it is a no-op without a key, without consent, or before the lazy load
   * finished.
   */
  capture(event: string, properties?: Record<string, unknown>): void {
    if (!this.consent.statisticsAllowed()) return;
    this.client?.capture(event, properties);
  }

  private async enable(): Promise<void> {
    if (this.client) {
      this.client.opt_in_capturing();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    try {
      const { default: posthog } = await import('posthog-js');
      posthog.init(environment.posthog.key, {
        api_host: environment.posthog.host,
        persistence: 'localStorage',
        autocapture: false,
        capture_pageview: false, // routed manually — Angular navigations are not page loads
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        enable_heatmaps: false,
        person_profiles: 'never',
      });
      this.client = posthog;
      this.bindRouter();
    } catch {
      // Blocked by an ad-blocker, offline, or chunk load failure. Analytics is
      // strictly optional — never let it break the app.
      this.client = null;
    } finally {
      this.loading = false;
    }
  }

  private disable(): void {
    if (!this.client) return;
    this.client.opt_out_capturing();
    this.client.reset();
  }

  /**
   * Pageviews for Angular route changes (the SPA has exactly one real page
   * load). `router.events` only fires on *future* navigations, so we also emit
   * one for the page already open when the library finished loading — otherwise
   * the landing page, the single most common pageview, is never captured.
   */
  private bindRouter(): void {
    if (this.routerBound) return;
    this.routerBound = true;
    this.capturePageview(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.capturePageview((e as NavigationEnd).urlAfterRedirects);
    });
  }

  private capturePageview(routerUrl: string): void {
    this.capture('$pageview', { $current_url: pageviewUrl(routerUrl) });
  }
}

/**
 * Turns an Angular router URL into the absolute `$current_url` a pageview needs.
 *
 * Absolute is not cosmetic: PostHog derives `$host` and `$pathname` by parsing
 * `$current_url`, and Web Analytics groups pageviews by host. A bare router path
 * (`/codex/ships`) parses to an empty host, so those pageviews are silently
 * dropped from Web Analytics ("No pageview events detected"). Prefixing the
 * origin restores the host; we still strip the query string and fragment, which
 * can carry tokens or search terms we have no reason to collect.
 */
export function pageviewUrl(routerUrl: string, origin: string = location.origin): string {
  return origin + routerUrl.split(/[?#]/)[0];
}
