-- ============================================================
-- Verse News — video retention marker on the image cache (feedback e7082310)
--
-- Verse News keeps VIDEOS only for the recent windows (today / this week /
-- this month); anything older is neither served nor cached, because every kept
-- video also keeps a thumbnail in the `news-images` bucket and that bucket is
-- the project's scarcest online resource.
--
-- `verse_image_cache.source_key` is a SHA-1 of the source url, so a cached row
-- cannot be traced back to the kind of item it came from. This column is that
-- missing link: `fetch-verse-news` stamps the publish date of the video whose
-- thumbnail a row holds, and the retention sweep deletes exactly the stamped
-- rows (plus their storage objects) once that date leaves the window.
--
--   video_published_at IS NULL  → comm-link/patch artwork, or a row cached
--                                 before this shipped. NEVER touched by the
--                                 sweep (`< cutoff` cannot match NULL).
--   video_published_at < cutoff → expired video thumbnail, deleted next run.
--
-- Alpha-phase data policy: additive only — no table/column is dropped or
-- renamed, no existing row is modified by this migration.
-- ============================================================

alter table public.verse_image_cache
  add column if not exists video_published_at timestamptz;

comment on column public.verse_image_cache.video_published_at is
  'Publish date of the YouTube video this cached thumbnail belongs to. NULL = not a video image (article artwork or a pre-retention legacy row) and therefore out of scope for the retention sweep.';

-- Partial index: the sweep only ever scans the stamped rows.
create index if not exists verse_image_cache_video_published_idx
  on public.verse_image_cache (video_published_at)
  where video_published_at is not null;
