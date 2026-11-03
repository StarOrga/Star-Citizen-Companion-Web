// Why an entity of a build got no silhouette row (#842). The uploader's
// silhouette build writes one entry per skipped entity (`silhouettes/skips.json`)
// and sends the whole list in one `silhouette_skips` call; the admin coverage
// tile reads it back through `silhouette_coverage()`. Pure — unit tested in
// _silhouette-skips.test.mjs.

/** The reasons the uploader records (`sc_extract/silhouette_export.py` SKIP_*). */
export const SKIP_REASONS = ['no_mesh', 'convert_failed', 'empty'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

const KINDS = new Set(['ship', 'weapon', 'component', 'item', 'ammo']);
/** The same keep-set the extractor's class names use; anything else is junk. */
const CLASS_RE = /^[A-Za-z0-9_.\-]{1,200}$/;
/** One whole build stays far below this; more is a broken or hostile caller. */
export const MAX_SKIPS = 20_000;
const DETAIL_MAX = 300;

export interface SkipRow {
  build_id: string;
  kind: string;
  class_name: string;
  reason: SkipReason;
  detail: string | null;
}

/**
 * The uploader's skip entries as table rows for `buildId`. Drops entries with
 * an unknown kind / reason or an implausible class name, and keeps the LAST
 * entry per (kind, class_name) so a duplicate never breaks the insert.
 */
export function parseSkips(raw: unknown, buildId: string): SkipRow[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SKIPS) return null;
  const byKey = new Map<string, SkipRow>();
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    const kind = typeof o.kind === 'string' ? o.kind : '';
    const cls = typeof o.className === 'string' ? o.className : typeof o.class_name === 'string' ? o.class_name : '';
    const reason = typeof o.reason === 'string' ? o.reason : '';
    if (!KINDS.has(kind) || !CLASS_RE.test(cls)) continue;
    if (!(SKIP_REASONS as readonly string[]).includes(reason)) continue;
    const detail = typeof o.detail === 'string' && o.detail.trim() ? o.detail.trim().slice(0, DETAIL_MAX) : null;
    byKey.set(`${kind}\u0000${cls}`, { build_id: buildId, kind, class_name: cls, reason: reason as SkipReason, detail });
  }
  return [...byKey.values()];
}
