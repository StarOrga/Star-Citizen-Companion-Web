import { PatchLineGroup } from '../../news/patch-notes';
import { StabilityVerdict } from '../../news/patch-stability';
import { PatchKpi, computePatchStats } from '../../news/patch-stats';

export type VerseKpiKey = 'lines' | 'leadTime' | 'cadence' | 'subCadence' | 'stable';

/** One bar of a tile's mini history: 0..100 height plus an optional tone. */
export interface VerseSparkBar {
  pct: number;
  tone?: 'ok' | 'warn' | 'bad';
  now?: boolean;
}

export interface VerseKpiTile {
  key: VerseKpiKey;
  /** The big number (already rounded). */
  value: number;
  /** Second number for ratio tiles ("3 / 5"). */
  of?: number;
  spark: VerseSparkBar[];
}

const SPARK_LEN = 6;

function sparkOf(kpi: PatchKpi | undefined): VerseSparkBar[] {
  if (!kpi) return [];
  const pts = kpi.points.slice(-SPARK_LEN);
  const max = Math.max(...pts.map((p) => p.value), 1);
  return pts.map((p, i) => ({ pct: Math.max(6, Math.round((p.value / max) * 100)), now: i === pts.length - 1 }));
}

/**
 * The five fact tiles of Patch News: patch lines in the archive, the latest
 * test phase, the usual time between main patches, the hotfix rhythm and how
 * many of the last five lines landed stable. A tile whose data is missing is
 * left out — the strip shows what it can prove.
 */
export function verseKpiTiles(
  groups: readonly PatchLineGroup[],
  verdicts: readonly StabilityVerdict[],
): VerseKpiTile[] {
  const kpis = computePatchStats(groups);
  const by = (k: PatchKpi['key']) => kpis.find((x) => x.key === k);
  const tiles: VerseKpiTile[] = [];

  const lines = groups.filter((g) => g.line);
  if (lines.length) tiles.push({ key: 'lines', value: lines.length, spark: [] });

  for (const key of ['leadTime', 'cadence', 'subCadence'] as const) {
    const kpi = by(key);
    if (!kpi) continue;
    const value = key === 'leadTime' ? kpi.latest : kpi.median;
    tiles.push({ key, value: Math.round(value), spark: sparkOf(kpi) });
  }

  const judged = verdicts.filter((v) => !v.insufficient && v.tone).slice(0, 5);
  if (judged.length) {
    const tone = (v: StabilityVerdict): VerseSparkBar['tone'] =>
      v.tone === 'green' ? 'ok' : v.tone === 'amber' ? 'warn' : 'bad';
    tiles.push({
      key: 'stable',
      value: judged.filter((v) => v.tone === 'green').length,
      of: judged.length,
      spark: [...judged].reverse().map((v) => ({ pct: 100, tone: tone(v) })),
    });
  }
  return tiles;
}
