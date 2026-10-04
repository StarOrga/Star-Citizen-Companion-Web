-- Uploader subtheme ledger
-- ---------------------------------------------------------------
-- Which uploader subtheme (texts, ships, components, weapons, items, other
-- catalog tables, silhouettes, 3D hulls — data-uploader/src/lib/subthemes.ts)
-- the server already holds for one game build, and the subtheme revision it was
-- produced with. The Data Uploader reads it before a run and leaves out every
-- subtheme whose (channel, patch, build) row carries its current revision: same
-- game data + unchanged uploader logic = nothing new to extract or upload.
--
-- Written by the uploader after a stage has fully landed (never before — a
-- half-uploaded subtheme must be uploaded again). Collaborator/admin only, the
-- same people the ingest functions accept. Pure bookkeeping: losing a row only
-- costs one extra upload, so no foreign key ties it to codex_builds.

create table if not exists public.uploader_subtheme_uploads (
  channel text not null,
  patch_version text not null,
  build_number text not null,
  subtheme text not null,
  revision int not null check (revision > 0),
  uploader_version text,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  primary key (channel, patch_version, build_number, subtheme)
);

comment on table public.uploader_subtheme_uploads is
  'Data Uploader: per game build, which subtheme the server holds at which uploader revision (skip unchanged subthemes).';

alter table public.uploader_subtheme_uploads enable row level security;
-- No policies: reads and writes go through the security-definer RPCs below.

create or replace function public.list_uploader_subthemes(
  p_channel text,
  p_patch_version text,
  p_build_number text
)
returns table (subtheme text, revision int, uploader_version text, uploaded_at timestamptz)
language sql security definer set search_path = public stable as $func$
  select u.subtheme, u.revision, u.uploader_version, u.uploaded_at
  from public.uploader_subtheme_uploads u
  where public.is_collaborator()
    and u.channel = upper(trim(p_channel))
    and u.patch_version = trim(p_patch_version)
    and u.build_number = trim(p_build_number);
$func$;

create or replace function public.record_uploader_subthemes(
  p_channel text,
  p_patch_version text,
  p_build_number text,
  p_revisions jsonb,
  p_uploader_version text default null
)
returns int
language plpgsql security definer set search_path = public as $func$
declare
  n int;
begin
  if not public.is_collaborator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(trim(p_channel), '') = '' or coalesce(trim(p_patch_version), '') = ''
     or coalesce(trim(p_build_number), '') = '' then
    raise exception 'channel, patch_version and build_number required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_revisions) is distinct from 'object' then
    raise exception 'p_revisions must be an object {subtheme: revision}' using errcode = '22023';
  end if;

  insert into public.uploader_subtheme_uploads as t
    (channel, patch_version, build_number, subtheme, revision, uploader_version, uploaded_by, uploaded_at)
  select upper(trim(p_channel)), trim(p_patch_version), trim(p_build_number),
         left(e.key, 64), (e.value #>> '{}')::int, left(p_uploader_version, 32), auth.uid(), now()
  from jsonb_each(p_revisions) e
  where (e.value #>> '{}') ~ '^[0-9]+$' and (e.value #>> '{}')::int > 0
  on conflict (channel, patch_version, build_number, subtheme) do update
    set revision = excluded.revision,
        uploader_version = excluded.uploader_version,
        uploaded_by = excluded.uploaded_by,
        uploaded_at = excluded.uploaded_at;
  get diagnostics n = row_count;
  return n;
end;
$func$;

revoke all on function public.list_uploader_subthemes(text, text, text) from public, anon;
revoke all on function public.record_uploader_subthemes(text, text, text, jsonb, text) from public, anon;
grant execute on function public.list_uploader_subthemes(text, text, text) to authenticated;
grant execute on function public.record_uploader_subthemes(text, text, text, jsonb, text) to authenticated;
