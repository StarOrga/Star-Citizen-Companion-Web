-- AI teaser titles for the Verse hero's patch story ("Neues in 4.10.3" is the
-- fallback, a teaser replaces it where one exists).
--
-- verse_digest() is deliberately NOT touched: its newest definition
-- (20261028120000_patch_channel_builds.sql) already carries the full versions
-- (patch.channels, build:<channel>:<version> item keys), the client builds the
-- title text from those. Teasers are a separate, tiny public-read table the
-- client reads once; written only by the patch-teaser edge function (service role).
--
-- Alpha policy: new table, nothing dropped.
-- ROLLBACK: drop table public.patch_teasers;

create table if not exists public.patch_teasers (
  version       text primary key,
  title_de      text not null check (char_length(title_de) between 1 and 44),
  title_en      text not null check (char_length(title_en) between 1 and 44),
  model         text,
  generated_at  timestamptz not null default now()
);

alter table public.patch_teasers enable row level security;

drop policy if exists patch_teasers_public_read on public.patch_teasers;
create policy patch_teasers_public_read on public.patch_teasers
  for select using (true);

revoke insert, update, delete, truncate on public.patch_teasers from anon, authenticated;
grant select on public.patch_teasers to anon, authenticated;

comment on table public.patch_teasers is
  'AI teaser titles (<= 44 chars, DE + EN) per full patch version, written by patch-teaser. Fallback in the client: "Neues in <version>".';

notify pgrst, 'reload schema';
