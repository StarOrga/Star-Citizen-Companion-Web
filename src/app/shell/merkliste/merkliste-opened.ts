// "Zuletzt geoeffnet" written from the page itself (concept gegenstand-weg D7).
// -----------------------------------------------------------------------------
// The search records only what it opened. A Codex detail page records itself here, in the same
// row shape and under the same key (`sc.search.recentRows`), so both dedupe and the panel reads
// one list. Deliberately no service: the pages that call it must not pull in the panel's stores.
// The rows stay on the device and, like the search's own write, are stored without a consent gate.

import type { PolyHitKind, PolySearchHit } from '../../codex/codex-poly-search';
import { hitTarget } from '../../codex/search/codex-search-model';
import { readRecentRows, rememberRow, type StoredRow } from '../fusion-bar/search-recent-rows';
import { typeOfKind } from './merkliste.model';

export interface OpenedPage {
  kind: string;
  className: string;
  title: string;
  manufacturerCode: string | null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The page counts as opened. Announced ships (no page of their own) and untyped kinds are not kept. */
export function noteOpenedPage(o: OpenedPage): void {
  if (!typeOfKind(o.kind) || o.kind === 'upcoming') return;
  const hit: PolySearchHit = {
    kind: o.kind as PolyHitKind,
    classNameSlug: o.className,
    nameLocalized: o.title,
    manufacturerCode: o.manufacturerCode,
    manufacturerName: null,
    size: null,
    grade: null,
    scope: 'equipment',
  };
  const row = {
    type: 'hit',
    id: `hit-${hit.kind}-${hit.classNameSlug}`,
    hit,
    target: hitTarget(hit),
    outside: false,
    owned: null,
    fit: null,
    signal: { recent: true, owned: false, popular: false },
  } as StoredRow;
  const s = storage();
  rememberRow(s, readRecentRows(s), row);
}
