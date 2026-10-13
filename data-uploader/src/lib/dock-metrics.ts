/**
 * Pure helpers behind the performance dock (`renderer/resource-dock.ts`):
 * the 60-second history that only the tooltips show (Ø / max), the split of a
 * bar into "the run" and "other programs", which disk budget is holding a run
 * back, and the "what does more of this speed up" levels per phase.
 *
 * No DOM, no Electron — tested in `test/dock-metrics.spec.ts`.
 */

import type { DriveRole } from './drive-load.js';
import type { ResourceLimits } from './resource-limits.js';

/** Samples kept per metric: one per second → the last minute. */
export const HISTORY_SIZE = 60;

/** Fixed-size ring of the latest values; `null` (not measured) is skipped. */
export class Ring {
  private readonly buf: number[] = [];
  private head = 0;

  constructor(private readonly size = HISTORY_SIZE) {}

  push(v: number | null | undefined): void {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (this.buf.length < this.size) this.buf.push(v);
    else this.buf[this.head] = v;
    this.head = (this.head + 1) % this.size;
  }

  get count(): number {
    return this.buf.length;
  }

  avg(): number | null {
    if (!this.buf.length) return null;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }

  max(): number | null {
    return this.buf.length ? Math.max(...this.buf) : null;
  }
}

/** A bank of rings addressed by metric id, created on first push. */
export class History {
  private readonly rings = new Map<string, Ring>();

  push(id: string, v: number | null | undefined): void {
    let r = this.rings.get(id);
    if (!r) {
      r = new Ring();
      this.rings.set(id, r);
    }
    r.push(v);
  }

  avg(id: string): number | null {
    return this.rings.get(id)?.avg() ?? null;
  }

  max(id: string): number | null {
    return this.rings.get(id)?.max() ?? null;
  }
}

/**
 * A bar split: the run's part from 0, other programs from there to the whole
 * value. Both in percent of the bar, clamped so they never exceed 100 together.
 */
export function splitBar(totalPct: number, runPct: number): { run: number; others: number } {
  const total = Math.max(0, Math.min(100, Number.isFinite(totalPct) ? totalPct : 0));
  const run = Math.max(0, Math.min(total, Number.isFinite(runPct) ? runPct : 0));
  return { run, others: total - run };
}

/** A drive's run part of its active time: active % × the run's byte share. */
export function driveRunPct(activePct: number | null, runSharePct: number | null): number {
  if (activePct === null || runSharePct === null) return 0;
  return (activePct * Math.max(0, Math.min(100, runSharePct))) / 100;
}

export type DiskLimitKey = 'readMBs' | 'writeMBs' | 'iops';

/**
 * The disk budget closest to its limit — the one that is holding the run back
 * when the governor reports `heldBack`. Ties go to read (the run's usual shape).
 */
export function bindingDiskLimit(
  run: { readMBs: number; writeMBs: number; iops: number },
  limits: Pick<ResourceLimits, DiskLimitKey>,
): DiskLimitKey {
  const keys: DiskLimitKey[] = ['readMBs', 'writeMBs', 'iops'];
  let best: DiskLimitKey = 'readMBs';
  let bestRatio = -1;
  for (const k of keys) {
    const lim = limits[k];
    const ratio = lim > 0 ? run[k] / lim : 0;
    if (ratio > bestRatio + 1e-9) {
      best = k;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Steps of a run, in the order the dock lists them. */
export const PHASES = ['codex', 'silhouettes', 'models'] as const;
export type Phase = (typeof PHASES)[number];

export type BoostSubject = 'cpu' | 'ram' | DriveRole;

/**
 * How much more of a resource speeds a step up, 1..3. Reflects what the step
 * does (see the boost tooltips): the codex reads the DataCore on mostly one
 * core but holds it in memory and reads the most from the game drive;
 * silhouettes and the 3D build convert meshes on every worker and write more.
 */
const BOOST: Record<Exclude<BoostSubject, 'both'>, readonly [number, number, number]> = {
  cpu: [1, 3, 3],
  ram: [3, 2, 2],
  game: [3, 2, 2],
  work: [1, 2, 3],
};

export function boostLevels(subject: BoostSubject): readonly [number, number, number] {
  if (subject !== 'both') return BOOST[subject];
  // One disk does both jobs: whichever role needs it more.
  const g = BOOST.game;
  const w = BOOST.work;
  return [Math.max(g[0], w[0]), Math.max(g[1], w[1]), Math.max(g[2], w[2])];
}

/** `2` → "●●○". */
export function dots(level: number, of = 3): string {
  const n = Math.max(0, Math.min(of, Math.round(level)));
  return '●'.repeat(n) + '○'.repeat(of - n);
}

/**
 * Pad a tooltip value to a fixed width so a live-updating tip never changes
 * size (the values sit in a monospace column).
 */
export function padCell(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}
