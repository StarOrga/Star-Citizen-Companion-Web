import { logWarn } from './log';
import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import type { PostHog } from 'posthog-js';
import { environment } from '../../environments/environment';
import { ConsentService } from './consent.service';

/** Opt-in areas of the Verse hub β switch (one per menu item). */
export type VerseBetaArea = 'briefing' | 'news' | 'patches' | 'gallery' | 'starmap';

/**
 * Typed Verse hub product events and their properties. Properties carry no
 * personal data — keys, kinds and positions only.
 */
export interface VerseEventProps {
  /** A briefing top-list entry was opened. */
  verse_top_open: { key: string; kind: string; rank: number; pinned: boolean };
  /** One of the three jump gates was opened. */
  verse_door_open: { door: 'news' | 'patches' | 'gallery' };
  /** The per-menu-item β switch was flipped. */
  verse_beta_toggle: { area: VerseBetaArea; enabled: boolean };
  /** A Starscape image was shared. */
  starscape_share: { image_id: string; channel: 'native' | 'copy' };
  /** An Explorer star was earned (sun = comet hit). */
  verse_star_earned: { patch_line: string; star_key: string; sun?: boolean };
}

export type VerseEvent = keyof VerseEventProps;

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
  /** Feature flags as last reported by PostHog; empty until consent + load. */
  private readonly flagValues = signal<Readonly<Record<string, boolean | string>>>({});
  /** Flags, but only while statistics consent holds — never read before it. */
  readonly flags = computed(() => (this.consent.statisticsAllowed() ? this.flagValues() : {}));
  /** Guards against a second concurrent lazy-load while the first is in flight. */
  private loading = false;
  private routerBound = false;

  /** Set by `captureLanding()`, applied by whichever `enable()` call actually
   *  finishes loading the client — see that method for the race this avoids. */
  private pendingLandingUtm: Record<string, string> | null = null;
  /** One-shot guard — `captureLanding()` must register the UTM props at most once. */
  private landingCaptured = false;

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

  /** Typed Verse hub event; same consent gate as `capture()`. */
  captureVerse<E extends VerseEvent>(event: E, properties: VerseEventProps[E]): void {
    this.capture(event, properties as Record<string, unknown>);
  }

  /**
   * A PostHog feature flag, or `undefined` without consent, without a loaded
   * client, or when the flag is unknown. Reactive (reads a signal).
   */
  featureFlag(key: string): boolean | string | undefined {
    return this.flags()[key];
  }

  /**
   * Sends an already-redacted `$exception` (see `AppErrorHandler`). Same gate as
   * `capture()`: nothing leaves the browser without statistics consent.
   * PostHog's own `capture_exceptions` autocapture stays off on purpose — it
   * would ship raw messages and URLs past the redaction.
   */
  captureException(error: Error, properties?: Record<string, unknown>): void {
    if (!this.consent.statisticsAllowed()) return;
    this.client?.captureException(error, properties);
  }

  /**
   * C7 — one-shot landing-page UTM capture. Called once from `AppComponent`
   * init (alongside `init()`). Reads `utm_source`/`utm_medium`/`utm_campaign`
   * from the CURRENT `location.search` at call time and, once `statistics`
   * consent is granted, registers them as PostHog super-properties so every
   * event from this session — not just the first pageview — carries them.
   *
   * Deliberately independent of `pageviewUrl()`: that function keeps
   * stripping the query string from `$current_url` on every pageview, so the
   * UTM params never persist in any STORED page URL — only as these
   * explicitly-registered event properties.
   *
   * No-op without a configured key, without any UTM params on the URL, or
   * (guarded by `landingCaptured`) after the first successful registration.
   */
  captureLanding(): void {
    if (!this.configured) return;
    const utm = readUtmParams(typeof location !== 'undefined' ? location.search : '');
    if (Object.keys(utm).length === 0) return;

    effect(
      () => {
        if (this.landingCaptured || !this.consent.statisticsAllowed()) return;
        this.landingCaptured = true;
        this.pendingLandingUtm = utm;
        if (this.client) this.applyPendingLandingUtm();
        else void this.enable();
      },
      { injector: this.injector },
    );
  }

  private applyPendingLandingUtm(): void {
    if (this.pendingLandingUtm && this.client) {
      this.client.register(this.pendingLandingUtm);
      this.pendingLandingUtm = null;
    }
  }

  private async enable(): Promise<void> {
    if (this.client) {
      this.client.opt_in_capturing();
      this.applyPendingLandingUtm();
      return;
    }
    // A second concurrent caller (e.g. `captureLanding()` racing `init()`'s own
    // consent effect) cannot re-enter the load below, but the in-flight call
    // still owns setting `this.client` and applies any pending UTM props once
    // it finishes — see the two `applyPendingLandingUtm()` calls below.
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
      posthog.onFeatureFlags((_flags, variants) => this.flagValues.set({ ...variants }));
      this.bindRouter();
      this.applyPendingLandingUtm();
    } catch (error) {
      // Blocked by an ad-blocker, offline, or chunk load failure. Analytics is
      // strictly optional — never let it break the app.
      logWarn('analytics', 'posthog load failed', error);
      this.client = null;
    } finally {
      this.loading = false;
    }
  }

  private disable(): void {
    this.flagValues.set({});
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
  return origin + maskBearerSegments(routerUrl.split(/[?#]/)[0]);
}

/**
 * Share links carry their whole authorisation in the path (`/shared/loadout/<token>`,
 * `/hangar/shared/<token>`); a pageview must not ship that bearer to PostHog.
 * The segment after these prefixes is replaced by a fixed placeholder so the
 * route still groups in Web Analytics without the secret.
 */
const BEARER_PATH_PREFIXES = ['/shared/loadout/', '/hangar/shared/'] as const;

export function maskBearerSegments(path: string): string {
  for (const prefix of BEARER_PATH_PREFIXES) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      if (!rest) return path;
      const slash = rest.indexOf('/');
      return prefix + ':token' + (slash >= 0 ? rest.slice(slash) : '');
    }
  }
  return path;
}

/**
 * Extracts only the three standard UTM params from a `location.search`-style
 * query string, as plain string properties for `posthog.register()`. Absent
 * params are simply omitted (never `null`/`undefined` entries) — used by
 * `AnalyticsService.captureLanding()` (C7).
 */
export function readUtmParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}
