-- Starscape variant groups: one artwork, one tile — even when RSI crops it
-- three different ways (admin feedback fcd956cf).
--
-- ---------------------------------------------------------------------------
-- What was still broken
--
-- 20260802160000 added `phash`, a 256-bit dHash, and fetch-verse-news rejects a
-- candidate within 48 bits of a stored one. That works, and it is fully
-- backfilled: measured on 2026-09-03 every one of the 49 live rows carries a
-- correct hash and the CLOSEST pair in the table is 78 bits apart. There is no
-- near-duplicate left for it to find.
--
-- The gallery still showed the same picture several times, because RSI does not
-- republish the same FRAME — it publishes the same ARTWORK in different crops,
-- and a global layout hash cannot see through a crop:
--
--   13tm836w1fwe3 1920x1080 16:9  ┐ one Stingray render, three crops, spread
--   depg5suek1a91 3840x1646 21:9  ├ over three separate comm-links
--   tw49jmj248o8c 1280x720  16:9  ┘   (dHash distance 100, 97, 103)
--   b7qrao0tzzs4l 3840x1646 21:9  ┐ one Frontier Tensions render, the 21:9 one
--   y7g1jd5dfu5sz 5852x3292 16:9  ┘ carrying the burnt-in title (distance 105)
--   1gkpdd2d48bxy 1920x1080 16:9  ┐ one Orison window view (distance 115)
--   olr27seq5b4e4 3840x1646 21:9  ┘
--   nhnikqjd2gnjg 3840x1646 21:9  ┐ one ridge-line still, one copy wrapped in
--   vxbj4p6p1id9y 3840x1023 3.7:1 ┘ the comm-link HUD frame (distance 78)
--
-- supabase/functions/fetch-verse-news/variant-signature.ts is the crop-tolerant
-- signal that does see them: a 20px-tall RGB thumbnail plus a shift search that
-- scores luma correlation AND colour distance at the best alignment.
--
-- ---------------------------------------------------------------------------
-- Grouping, not deleting
--
-- No row is removed. `verse_wallpapers` holds hotlink metadata for artwork that
-- disappears from the RSI feed after a few weeks, and `?image=<id>` share links
-- resolve rows by id — a deleted row is unrecoverable and takes a live link
-- with it. Look-alikes are therefore GROUPED and given a role; consumers show
-- the representative and ignore the rest.
--
--   variant_role = 'single'    no look-alike; its own group (the default, so a
--                              row written by an older function build stays
--                              fully visible)
--                  'primary'   the group's representative — most pixels wins
--                  'ratio'     same artwork, GENUINELY different shape (>1.15x
--                              apart, e.g. 21:9 next to 16:9). Hidden from the
--                              flat gallery, offered to a client that wants the
--                              shape closest to its screen.
--                  'duplicate' same artwork, same shape, fewer pixels. Nothing
--                              shows it.
--
-- ALPHA-PHASE DATA POLICY: this migration drops nothing. It is additive only —
-- five nullable/defaulted columns, two indexes, no policy or grant changes (the
-- table-level `select` grant and the existing public-read policy already cover
-- new columns).

alter table public.verse_wallpapers
  add column if not exists width         integer,
  add column if not exists height        integer,
  add column if not exists thumb         text,
  add column if not exists variant_group text,
  add column if not exists variant_role  text not null default 'single';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'verse_wallpapers_variant_role_check'
  ) then
    alter table public.verse_wallpapers
      add constraint verse_wallpapers_variant_role_check
      check (variant_role in ('single', 'primary', 'ratio', 'duplicate'));
  end if;
end $$;

comment on column public.verse_wallpapers.width is
  'Largest known pixel width of the artwork: the original `source_url` header '
  'when it could be read, else the decoded cover. Used to pick the group '
  'representative (most pixels wins) and to match a client screen shape.';

comment on column public.verse_wallpapers.height is
  'Largest known pixel height of the artwork — see width.';

comment on column public.verse_wallpapers.thumb is
  'Crop-tolerant signature, `v1:<w>x<h>:<base64 rgb>` — a 20px-tall RGB '
  'thumbnail written by fetch-verse-news (variant-signature.ts). Null = not '
  'thumbnailable yet (undecodable format, or awaiting the crawler backfill); a '
  'null signature never matches, so such a row is always kept on its own.';

comment on column public.verse_wallpapers.variant_group is
  'Key shared by every crop of one artwork = the image_id of the group primary. '
  'Null means "not grouped yet"; treat it as the row''s own image_id.';

comment on column public.verse_wallpapers.variant_role is
  'single | primary | ratio | duplicate. Gallery and tray-app flat list show '
  'single + primary (one tile per artwork). ratio rows are alternative aspect '
  'ratios of the same artwork for a client that wants the closest shape to its '
  'screen; duplicate rows are same-shape lower-resolution copies nothing shows. '
  'Defaults to single so an ungrouped row is never hidden.';

-- The gallery page: `where variant_role in ('single','primary') order by
-- published_at desc`. Partial, because the hidden roles are a small minority
-- that no listing ever scans.
create index if not exists verse_wallpapers_visible_published_idx
  on public.verse_wallpapers (published_at desc nulls last)
  where variant_role in ('single', 'primary');

-- Resolving a whole group (a client picking the shape that fits its screen).
create index if not exists verse_wallpapers_variant_group_idx
  on public.verse_wallpapers (variant_group)
  where variant_group is not null;

-- The crawler fills width/height/thumb/variant_* on its own, a few rows per
-- crawl, so no data backfill runs here: it needs to decode images, which is the
-- one thing SQL cannot do. Until a row is reached it keeps variant_role
-- 'single' and stays visible — the pre-migration behaviour exactly.
