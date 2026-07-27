-- ============================================================
-- Verse-news image cache — variant ladder columns
--
-- The first cache generation stored every source image TWICE at full RSI
-- resolution (`<hash>/post.<ext>` + `<hash>/cover.<ext>`, byte-identical for
-- most sources, PNGs up to 9.2 MB each). 496 objects reached 809 MB — nearly the
-- entire 1 GB storage quota — to serve tiles rendered at ~320 CSS px.
--
-- `fetch-verse-news` now decodes each source once and stores a ladder of really
-- different sizes instead: `<hash>/w400.<ext>`, `<hash>/w800.<ext>` and
-- `<hash>/w<top>.<ext>` where <top> is the source width capped at 1600. The whole
-- ladder is derivable from the top width, so the feed hands the client one url
-- and the browser builds a truthful `srcset` from it.
--
-- These columns are what makes the migration of the existing objects safe and
-- resumable (scripts/news-image-compact.mjs):
--   top_width IS NULL  → legacy row, objects are still the post/cover pair,
--                        the edge function keeps serving `cover.<ext>`
--   top_width = 0      → single undecodable object stored verbatim as `w0.<ext>`
--   top_width > 0      → compacted ladder, `ext` is the RE-ENCODED extension
--                        (jpg, or png when the source had real transparency)
--
-- Alpha-phase data policy: additive only — no column is dropped, no data lost.
-- ============================================================

alter table public.verse_image_cache
  add column if not exists top_width int,
  add column if not exists bytes     bigint;

comment on column public.verse_image_cache.top_width is
  'Largest stored variant width. NULL = legacy post/cover pair, 0 = single undecodable passthrough object.';
comment on column public.verse_image_cache.bytes is
  'Total bytes of all stored variants for this source — lets us track the bucket footprint without listing storage.';

-- Lets the backfill/cleanup script page through the not-yet-compacted rows
-- cheaply, and stays useful afterwards as the "everything migrated?" check.
create index if not exists verse_image_cache_legacy_idx
  on public.verse_image_cache (cached_at)
  where top_width is null;
