import { pickLocalized } from './codex.service';
import { BlueprintMissionSource, Lang } from './codex.types';

export interface BlueprintMissionRow {
  className: string;
  title: string;
  /** "Giver · Location"; '' when the data names neither. */
  meta: string;
  /** Route of the mission page. */
  link: readonly string[];
}

export interface BlueprintMissions {
  rows: readonly BlueprintMissionRow[];
  /** Missions beyond the ones the payload carries. */
  more: number;
}

const CLASS_RE = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * The readable form of a blueprint's `missionSource`. Old payloads hold null, and a payload is
 * data from outside the app: a row without a usable class or title is left out, and no row
 * leaves null, which is the plain state of the page and the Nachschub line.
 */
export function blueprintMissions(source: BlueprintMissionSource | null | undefined, lang: Lang): BlueprintMissions | null {
  if (!source || !Array.isArray(source.missions)) return null;
  const local = (t: { en: string; de: string } | null | undefined): string => (t ? pickLocalized({ ...t, key: '' }, lang) : '');
  const rows: BlueprintMissionRow[] = [];
  for (const m of source.missions) {
    const title = local(m?.title);
    if (!title || !CLASS_RE.test(m?.className ?? '')) continue;
    rows.push({
      className: m.className,
      title,
      meta: [local(m.giver), local(m.location)].filter(Boolean).join(' · '),
      link: ['/codex', 'mission', m.className],
    });
  }
  if (rows.length === 0) return null;
  const total = typeof source.total === 'number' ? source.total : rows.length;
  return { rows, more: Math.max(0, total - rows.length) };
}
