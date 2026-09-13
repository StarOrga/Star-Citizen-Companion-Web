/**
 * Tally of a 3D-livery upload run and the terminal progress frame it paints.
 *
 * The upload works per SHIP. Every ship the build produced ends in exactly one
 * of four buckets (see `skin-ingest.ts`):
 *
 *  - fresh   — objects PUT + catalog rows committed this run
 *  - cached  — already live from a prior run / earlier in this job (skipped
 *              the transfer, but IS on the server)
 *  - empty   — the build yielded no livery model for this ship, so there was
 *              nothing to send; the pipeline marks it done and moves on
 *  - failed  — sign / PUT / commit raised; the ship is NOT on the server
 *
 * The card's fraction used to be `live / ships.length` with a hard-coded
 * 100 % — so a run with 25 empty or failed ships ended as "251 / 276 (100 %)":
 * the numerator excluded them, the denominator included them, and the
 * percentage ignored both. This module owns the one reading everything paints
 * from: the denominator is what was actually ATTEMPTED (empty ships never
 * were), the percentage is derived from that same fraction, and skipped or
 * failed ships are named separately instead of vanishing into the gap.
 */

/** The subset of `SkinUploadResult` the tally reads. */
export interface SkinUploadTallyInput {
  ok: boolean;
  cached?: boolean;
  empty?: boolean;
}

export interface SkinUploadTally {
  /** Every ship the upload was handed. */
  total: number;
  /** Ships that had a livery to send — `total` minus `empty`. */
  attempted: number;
  /** Ships now live on the server: `fresh + cached`. */
  live: number;
  fresh: number;
  cached: number;
  /** Built no livery model; skipped, not failed. */
  empty: number;
  /** Attempted and lost — these are NOT live. */
  failed: number;
  /** `live / attempted`, floored; 100 when nothing needed sending. */
  pct: number;
}

export function tallySkinUpload(results: readonly SkinUploadTallyInput[]): SkinUploadTally {
  let fresh = 0;
  let cached = 0;
  let empty = 0;
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    else if (r.empty) empty++;
    else if (r.cached) cached++;
    else fresh++;
  }
  const total = results.length;
  const attempted = total - empty;
  const live = fresh + cached;
  const pct = attempted > 0 ? Math.floor((live / attempted) * 100) : 100;
  return { total, attempted, live, fresh, cached, empty, failed, pct };
}

/** Minimal translate signature — `lib/i18n.t` fits, tests pass a stub. */
export type SkinUploadTranslate = (key: string, params?: Record<string, string | number>) => string;

/** What the progress card is told once the upload stage has finished. */
export interface SkinUploadFrame {
  phaseLabel: string;
  current: number;
  total: number;
  overallPct: number;
  /** "25 skipped (no livery model) · 2 failed" — empty when nothing to say. */
  detail: string;
}

/**
 * The terminal frame for the progress card. `current / total` is
 * `live / attempted`, `overallPct` is the same fraction — the two can no
 * longer disagree — and the head label only says "uploaded" without a
 * qualifier when every attempted ship made it.
 */
export function skinUploadFrame(tally: SkinUploadTally, t: SkinUploadTranslate): SkinUploadFrame {
  const notes: string[] = [];
  if (tally.empty > 0) notes.push(t('skins.skippedNoModel', { n: tally.empty }));
  if (tally.failed > 0) notes.push(t('skins.failedCount', { n: tally.failed }));
  return {
    phaseLabel:
      tally.failed > 0
        ? t('skins.stepUploadDonePartial', { n: tally.failed })
        : t('skins.stepUploadDone'),
    current: tally.live,
    total: tally.attempted,
    overallPct: tally.pct,
    detail: notes.join(' · '),
  };
}

/**
 * The status line under the card. Fully successful runs keep the old
 * "3D skins done — N ship(s) live"; anything skipped or failed is spelled out
 * with the same numbers the card shows.
 */
export function skinUploadStatus(
  tally: SkinUploadTally,
  t: SkinUploadTranslate,
): { message: string; level: 'ok' | 'warn' } {
  const head =
    tally.failed > 0
      ? t('skins.partialStatus', { live: tally.live, attempted: tally.attempted, failed: tally.failed })
      : t('skins.done', { n: tally.live });
  const message = tally.empty > 0 ? `${head} · ${t('skins.noModels', { n: tally.empty })}` : head;
  return { message, level: tally.failed > 0 ? 'warn' : 'ok' };
}
