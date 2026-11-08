import { Injectable, signal } from '@angular/core';
import { logWarn } from '../../../core/log';
import { STEP_KINDS, type StepKind } from '../../../shared/step/sc-step.component';

export const ROUTE_FILTER_KEY = 'sc.hq.routeFilter';
/** Keys kept (oldest forgotten first), so the store cannot grow without bound. */
const KEEP = 60;

/** The key of one route's filter: a Nachschub, or one Einsatz of it. */
export function routeFilterKey(nachschubId: string | null, einsatzId: string | null): string {
  return `${nachschubId ?? '-'}:${einsatzId ?? '-'}`;
}

/** Hidden kinds that really are step kinds, in legend order. */
export function sanitizeKinds(raw: unknown): StepKind[] {
  const list = Array.isArray(raw) ? raw : [];
  return STEP_KINDS.filter((k) => list.includes(k));
}

/**
 * Which action kinds a route graphic hides (r4 s3-a3: "pro Route bzw. Nachschub-Einsatz"). Remembered per route key
 * in this browser; an unknown key shows everything.
 */
@Injectable({ providedIn: 'root' })
export class RouteFilterStore {
  private readonly map = signal<Readonly<Record<string, readonly StepKind[]>>>(this.read());
  /** Reactive view: read inside a computed to follow changes. */
  readonly all = this.map.asReadonly();

  hidden(key: string): ReadonlySet<StepKind> {
    return new Set(this.map()[key] ?? []);
  }

  set(key: string, hidden: ReadonlySet<StepKind>): void {
    const kinds = sanitizeKinds([...hidden]);
    const next: Record<string, readonly StepKind[]> = { ...this.map() };
    delete next[key];
    if (kinds.length) next[key] = kinds;
    const entries = Object.entries(next);
    const trimmed = Object.fromEntries(entries.slice(Math.max(0, entries.length - KEEP)));
    this.map.set(trimmed);
    try {
      localStorage.setItem(ROUTE_FILTER_KEY, JSON.stringify(trimmed));
    } catch (err) {
      logWarn('hq', 'route filter write failed', err);
    }
  }

  private read(): Record<string, readonly StepKind[]> {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ROUTE_FILTER_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, readonly StepKind[]> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const kinds = sanitizeKinds(v);
        if (kinds.length) out[k] = kinds;
      }
      return out;
    } catch {
      return {};
    }
  }
}
