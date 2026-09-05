import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { StabilityPatchRow, StabilitySampleRow, StabilityVerdict, computeVerdict } from './patch-stability';

/** How many days of samples the board loads per line — the timeline never needs more. */
const SAMPLE_DAYS = 120;

/**
 * Rows → verdicts, one per patch line. Each line's window ends where the next
 * line went live; only the newest line can be "early".
 */
export function buildVerdicts(
  patches: StabilityPatchRow[],
  samples: StabilitySampleRow[],
  nowIso: string,
): Map<string, StabilityVerdict> {
  const sorted = [...patches].sort((a, b) => Date.parse(a.live_at) - Date.parse(b.live_at));
  const byLine = new Map<string, StabilitySampleRow[]>();
  for (const s of samples) {
    const list = byLine.get(s.patch_line) ?? [];
    list.push(s);
    byLine.set(s.patch_line, list);
  }
  const out = new Map<string, StabilityVerdict>();
  sorted.forEach((p, i) => {
    const next = sorted[i + 1];
    out.set(p.patch_line, computeVerdict(p, byLine.get(p.patch_line) ?? [], {
      now: nowIso,
      endAt: next ? next.live_at : null,
    }));
  });
  return out;
}

/**
 * The patch board's stability data: both tables, loaded once per visit through
 * the anon client (RLS grants public read). Quiet on failure — `unavailable`
 * flips and every consumer hides itself; a reader cannot act on "the sampler's
 * tables are unreachable".
 */
@Injectable({ providedIn: 'root' })
export class PatchStabilityService {
  private readonly sb = inject(SupabaseClientProvider);

  private readonly patches = signal<StabilityPatchRow[]>([]);
  private readonly samples = signal<StabilitySampleRow[]>([]);
  private readonly now = signal(new Date().toISOString());
  private inFlight: Promise<void> | null = null;

  private readonly _loaded = signal(false);
  private readonly _unavailable = signal(false);
  readonly loaded = this._loaded.asReadonly();
  readonly unavailable = this._unavailable.asReadonly();

  private readonly verdicts = computed(() => buildVerdicts(this.patches(), this.samples(), this.now()));

  /** Every line with a verdict, oldest first — the all-time chart's columns. */
  readonly allTime = computed<StabilityVerdict[]>(() =>
    [...this.verdicts().values()].sort((a, b) => Date.parse(a.liveAt) - Date.parse(b.liveAt)),
  );

  verdictFor(line: string): StabilityVerdict | null {
    return this.verdicts().get(line) ?? null;
  }

  patchRowFor(line: string): StabilityPatchRow | null {
    return this.patches().find((p) => p.patch_line === line) ?? null;
  }

  /** Load once; concurrent callers share the same request. */
  load(): Promise<void> {
    if (this.loaded()) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchAll().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async fetchAll(): Promise<void> {
    try {
      const since = new Date(Date.now() - SAMPLE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const client = this.sb.client;
      const [p, s] = await Promise.all([
        client.from('patch_stability_patches').select('*'),
        client.from('patch_stability_samples').select('*').gte('sampled_on', since).order('sampled_on', { ascending: true }),
      ]);
      if (p.error || s.error) {
        this._unavailable.set(true);
        return;
      }
      this.patches.set((p.data ?? []) as StabilityPatchRow[]);
      this.samples.set((s.data ?? []) as StabilitySampleRow[]);
      this.now.set(new Date().toISOString());
      this._unavailable.set(false);
      this._loaded.set(true);
    } catch {
      this._unavailable.set(true);
    }
  }
}
