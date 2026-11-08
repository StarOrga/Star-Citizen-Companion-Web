import { Injectable, signal } from '@angular/core';

const KEY = 'sc.hq.nachschub.minQuality';

/** A whole quality 1..1000 or null (the minimum a Nachschub line must meet, e.g. "Eisen Q ≥ 700"). */
export function parseMinQuality(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : null;
}

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const q = parseMinQuality(v);
      if (q !== null) out[k] = q;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The minimum quality of a Nachschub line (I15 "wünschen + einplanen" with "Eisen Q ≥ 700"). `hq_supplies` has no column
 * for it and migrations are out of scope for this change, so it lives per line id in this browser (localStorage) until a
 * `min_quality` column exists: it shows in the picker and in Planen, but does not sync to other devices.
 */
@Injectable({ providedIn: 'root' })
export class NachschubMinQualityStore {
  private readonly map = signal<Readonly<Record<string, number>>>(read());

  /** The line's minimum quality, null when none was set. */
  get(lineId: string): number | null {
    return this.map()[lineId] ?? null;
  }

  set(lineId: string, quality: number | null): void {
    const q = parseMinQuality(quality);
    const next = { ...this.map() };
    if (q === null) delete next[lineId];
    else next[lineId] = q;
    this.map.set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage full or blocked: the value stays for this session
    }
  }
}
