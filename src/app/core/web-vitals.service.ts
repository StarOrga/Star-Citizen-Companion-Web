import { Injectable, NgZone, inject } from '@angular/core';
import { AnalyticsService } from './analytics.service';

/**
 * Real-user page-load metrics (docs/performance-plan.md): how fast the page
 * the visitor opened actually became usable on THEIR device and connection —
 * the lab profile in scripts/perf/ cannot see that.
 *
 * Collected with the browser's own PerformanceObserver (no library), sent ONCE
 * per page load as a `web_vitals` event when the page is hidden or left —
 * through `AnalyticsService.capture`, so nothing leaves the browser without
 * statistics consent. Only the first path segment is reported, never ids.
 */
export interface WebVitalsReport {
  /** First path segment of the page the visit started on, e.g. `/codex`. */
  readonly area: string;
  readonly navigation: string;
  readonly ttfb: number | null;
  readonly fcp: number | null;
  readonly lcp: number | null;
  readonly cls: number;
  readonly inp: number | null;
  readonly long_tasks: number;
  readonly long_task_ms: number;
  readonly connection: string | null;
}

/** First path segment only: `/codex/ship/AEGS_Gladius` → `/codex`. */
export function areaOf(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
}

/**
 * Cumulative Layout Shift as defined by web.dev: shifts without recent input,
 * grouped into session windows (gap < 1 s, window < 5 s); the largest window.
 */
export function clsFromShifts(shifts: readonly { startTime: number; value: number }[]): number {
  let best = 0, current = 0, windowStart = 0, last = -Infinity;
  for (const s of shifts) {
    if (s.startTime - last < 1000 && s.startTime - windowStart < 5000) {
      current += s.value;
    } else {
      current = s.value;
      windowStart = s.startTime;
    }
    last = s.startTime;
    best = Math.max(best, current);
  }
  return Math.round(best * 1000) / 1000;
}

/**
 * Interaction to Next Paint: the longest interaction, ignoring one outlier per
 * 50 interactions (the web.dev approximation of the 98th percentile).
 */
export function inpFromInteractions(durations: readonly number[]): number | null {
  if (!durations.length) return null;
  const sorted = [...durations].sort((a, b) => b - a);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(durations.length / 50))]);
}

@Injectable({ providedIn: 'root' })
export class WebVitalsService {
  private readonly analytics = inject(AnalyticsService);
  private readonly zone = inject(NgZone);
  private started = false;
  private sent = false;

  private lcp: number | null = null;
  private fcp: number | null = null;
  private readonly shifts: { startTime: number; value: number }[] = [];
  /** Longest duration per interaction id. */
  private readonly interactions = new Map<number, number>();
  private longTasks = 0;
  private longTaskMs = 0;

  /** Called once from AppComponent. A no-op where the browser has no PerformanceObserver. */
  init(): void {
    if (this.started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
    this.started = true;
    const area = areaOf(location.pathname);
    this.zone.runOutsideAngular(() => {
      this.observe('largest-contentful-paint', (e) => (this.lcp = Math.round(e.startTime)));
      this.observe('paint', (e) => {
        if (e.name === 'first-contentful-paint') this.fcp = Math.round(e.startTime);
      });
      this.observe('layout-shift', (e) => {
        const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) this.shifts.push({ startTime: shift.startTime, value: shift.value });
      });
      this.observe('longtask', (e) => {
        this.longTasks++;
        this.longTaskMs += Math.round(e.duration);
      });
      this.observe(
        'event',
        (e) => {
          const id = (e as PerformanceEntry & { interactionId?: number }).interactionId;
          if (id) this.interactions.set(id, Math.max(this.interactions.get(id) ?? 0, e.duration));
        },
        { durationThreshold: 40 },
      );
      const flush = () => this.send(area);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
      addEventListener('pagehide', flush);
    });
  }

  private observe(type: string, onEntry: (e: PerformanceEntry) => void, extra: Record<string, unknown> = {}): void {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true, ...extra });
    } catch {
      // This browser does not know the entry type: that metric stays empty.
    }
  }

  private send(area: string): void {
    if (this.sent) return;
    this.sent = true;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const report: WebVitalsReport = {
      area,
      navigation: nav?.type ?? 'navigate',
      ttfb: nav ? Math.round(nav.responseStart) : null,
      fcp: this.fcp,
      lcp: this.lcp,
      cls: clsFromShifts(this.shifts),
      inp: inpFromInteractions([...this.interactions.values()]),
      long_tasks: this.longTasks,
      long_task_ms: this.longTaskMs,
      connection: connection?.effectiveType ?? null,
    };
    this.analytics.capture('web_vitals', { ...report });
  }
}
