// Extra search sources next to the Codex index: patches and gallery images
// (concept 2026-11-02, C11). Pure mappers and matchers; the fetching lives in
// the engine / signals service. Missions come from the `search_missions` RPC
// (codex_missions, migration 20261103130000).

import type { PatchLineGroup } from '../../news/patch-notes';
import { matchesTokens, tokenizeQuery } from '../../news/patch-search';
import type { SearchTarget } from './codex-search-model';
import type { SearchResultRow } from './search-result-model';

export type PatchMatch = Omit<Extract<SearchResultRow, { type: 'patch' }>, 'cta' | 'icons'>;
export type GalleryMatch = Omit<Extract<SearchResultRow, { type: 'gallery' }>, 'cta' | 'icons'>;
export type MissionMatch = Omit<Extract<SearchResultRow, { type: 'mission' }>, 'cta' | 'icons'>;

/** A row of the `search_missions(p_query, p_limit)` RPC (one per distinct title). */
export interface MissionRpcRow {
  class_name: string;
  title: string | null;
  type_name: string | null;
  giver_name: string | null;
  location_name: string | null;
  reward_amount: number | null;
  variants: number | null;
  total: number | null;
}

export interface SourceResult<T> {
  rows: T[];
  total: number;
}

/** A row of the `search_gallery(p_query, p_limit)` RPC. */
export interface GalleryRpcRow {
  image_id: string;
  title: string | null;
  series: string | null;
  published_at: string | null;
  preview_url: string | null;
}

/**
 * Patch lines whose version, line or channel word matches the term. Patch
 * CONTENT (the bullet points) stays on the patch page's own search; the bar
 * finds the patch itself: "4.9", "4.8.2", "ptu", "hotfix".
 */
export function searchPatches(term: string, lines: readonly PatchLineGroup[], limit = 5): SourceResult<PatchMatch> {
  const tokens = tokenizeQuery(term);
  if (tokens.length === 0) return { rows: [], total: 0 };
  const rows: PatchMatch[] = [];
  for (const g of lines) {
    const channels = [...new Set(g.entries.flatMap((e) => [e.stage, e.hotfix ? 'hotfix' : null, e.facet]))].filter(Boolean);
    const versions = g.entries.map((e) => e.version).filter(Boolean);
    const hay = ['patch', g.line, ...versions, ...channels].join(' ');
    if (!matchesTokens(hay, tokens)) continue;
    rows.push({
      type: 'patch',
      id: `patch-${g.line}`,
      line: g.line,
      title: g.line,
      version: versions[0] ?? g.line,
      publishedAt: g.latestAt,
      target: patchTarget(g.line),
    });
  }
  return { rows: rows.slice(0, limit), total: rows.length };
}

export function patchTarget(line: string): SearchTarget {
  return { link: ['/verse', 'patches', line], queryParams: null };
}

export function galleryTarget(imageId: string): SearchTarget {
  return { link: ['/verse', 'gallery', imageId], queryParams: null };
}

/** "Alle N" for the patch / gallery group. */
export function sourceMoreTarget(group: 'patch' | 'gallery', term: string): SearchTarget {
  const q = term.trim();
  return { link: ['/verse', group === 'patch' ? 'patches' : 'gallery'], queryParams: q ? { q } : null };
}

export function mapGalleryRows(rows: readonly GalleryRpcRow[] | null | undefined): SourceResult<GalleryMatch> {
  const out: GalleryMatch[] = [];
  for (const r of rows ?? []) {
    if (!r?.image_id) continue;
    out.push({
      type: 'gallery',
      id: `gallery-${r.image_id}`,
      imageId: r.image_id,
      title: r.title?.trim() || r.image_id,
      series: r.series?.trim() || null,
      publishedAt: r.published_at ?? null,
      previewUrl: r.preview_url ?? null,
      target: galleryTarget(r.image_id),
    });
  }
  return { rows: out, total: out.length };
}

export function missionTarget(className: string): SearchTarget {
  return { link: ['/codex', 'mission', className], queryParams: null };
}

export function mapMissionRows(rows: readonly MissionRpcRow[] | null | undefined): SourceResult<MissionMatch> {
  const out: MissionMatch[] = [];
  let total = 0;
  for (const r of rows ?? []) {
    const title = r?.title?.trim();
    if (!r?.class_name || !title) continue;
    total = Math.max(total, r.total ?? 0);
    out.push({
      type: 'mission',
      id: `mission-${r.class_name}`,
      className: r.class_name,
      title,
      typeName: r.type_name?.trim() || null,
      giver: r.giver_name?.trim() || null,
      location: r.location_name?.trim() || null,
      reward: typeof r.reward_amount === 'number' && r.reward_amount > 0 ? r.reward_amount : null,
      variants: Math.max(1, r.variants ?? 1),
      target: missionTarget(r.class_name),
    });
  }
  return { rows: out, total: Math.max(total, out.length) };
}
