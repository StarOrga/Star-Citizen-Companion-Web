// Pinned silhouette columns (Holotable outline contract). An uploader field that
// is not listed is dropped, not blindly forwarded. `edges` is the optional inner
// edge path (SVG path d, same 0..1000 viewBox as `path`, non-ship kinds only);
// it lives in the shape blob (migration 20261108222000), rows without it ingest as before.
export const SILHOUETTE_COLUMNS = [
  'build_id', 'channel', 'patch_version', 'build_number',
  'kind', 'class_name', 'view_box', 'path', 'edges', 'bbox', 'anchors',
  'unresolved', 'meta', 'generated_at', 'content_sha',
] as const;

export function sanitizeSilhouetteRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SILHOUETTE_COLUMNS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}
