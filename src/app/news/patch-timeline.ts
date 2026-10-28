import type { PatchNoteEntry, PatchStage } from './patch-notes';
import { levelOf, stabilityPercent, type StabilityLevel, type StabilityVerdict } from './patch-stability';
import type { StackCard } from './patch-stack';

/** One sub-version row (live note, hotfix, PTU wave, Evocati build) nested under its main version. */
export interface SubVersionRow {
  id: string;
  version: string;
  title: string;
  stage: PatchStage | null;
  hotfix: boolean;
  publishedAt: string;
  url: string;
  /** Surviving stability 0–100; null = no data (test builds, too early). */
  stability: number | null;
  level: StabilityLevel | null;
  /** Folded behind "earlier builds" by default (older test waves of a shipped line). */
  older: boolean;
}

const DAY_MS = 86_400_000;

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * The stability a LIVE sub-version ended on: the day score of its window's last
 * day (the next live note/hotfix, else the newest sampled day). A line without
 * daily samples gives its end-state to the main release-notes row only.
 */
function liveStability(
  entry: PatchNoteEntry,
  windowEnd: number | null,
  verdict: StabilityVerdict | null,
): { stability: number; level: StabilityLevel } | null {
  if (!verdict || verdict.insufficient) return null;
  if (verdict.days.length) {
    const end = windowEnd === null ? Infinity : windowEnd;
    const inWindow = verdict.days.filter((d) => ms(d.date) <= end);
    const day = inWindow[inWindow.length - 1] ?? verdict.days[0];
    // Published after the last sample: nothing to say yet.
    if (windowEnd === null && ms(day.date) + DAY_MS < ms(entry.item.publishedAt)) return null;
    const stability = stabilityPercent(day.score);
    return stability === null ? null : { stability, level: levelOf(day.score) };
  }
  if (!entry.hotfix && verdict.stability !== null && verdict.level !== null) {
    return { stability: verdict.stability, level: verdict.level };
  }
  return null;
}

/**
 * Sub-version rows of one patch line, newest first. Every row carries a
 * stability slot: LIVE builds read it from the line's daily verdict, test
 * builds have none yet (rendered as "noch früh"). On a line that has shipped,
 * all but the newest test wave start folded.
 */
export function subVersionRows(card: StackCard, verdict: StabilityVerdict | null): SubVersionRow[] {
  const entries = [...(card.group?.entries ?? [])].sort(
    (a, b) => ms(b.item.publishedAt) - ms(a.item.publishedAt),
  );
  const shipped = card.liveAt !== null;
  let seenTest = false;
  return entries.map((e, i) => {
    let st: { stability: number; level: StabilityLevel } | null = null;
    if (e.stage === 'live') {
      const newerLive = entries.slice(0, i).reverse().find((n) => n.stage === 'live');
      st = liveStability(e, newerLive ? ms(newerLive.item.publishedAt) : null, verdict);
    }
    const isTest = e.stage === 'ptu' || e.stage === 'evocati';
    const older = shipped && isTest && seenTest;
    if (isTest) seenTest = true;
    return {
      id: String(e.item.id),
      version: e.version,
      title: e.item.title,
      stage: e.stage,
      hotfix: e.hotfix,
      publishedAt: e.item.publishedAt,
      url: e.item.url,
      stability: st?.stability ?? null,
      level: st?.level ?? null,
      older,
    };
  });
}
