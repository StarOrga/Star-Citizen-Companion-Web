-- ============================================================
-- 20261008214500_list_share_links.sql
-- Holotable "Save & share" (issue #645): the owner's active share links of
-- ONE hangar config, so the share popover can list them (created at, copy,
-- revoke) and reuse the newest one instead of minting a duplicate.
--
-- WHAT THIS CREATES
--   public.list_share_links(p_config_id uuid) -> setof public.hangar_share_links
--   The caller's own links whose source_config_id is p_config_id and that
--   still work: not revoked, not expired. Newest first.
--
-- WHY AN RPC (the owner can already SELECT own rows through RLS)
--   One owner-only read path with the "still active" rule in SQL, next to
--   the other share RPCs (adopt_shared_loadout / peek_shared_loadout in
--   20260920160000_hangar_loadout_sharing.sql), instead of the client
--   re-deriving revoked/expired filters on a raw table read.
--
-- SECURITY
--   SECURITY DEFINER with an empty search_path (every name qualified).
--   Ownership is pinned to auth.uid() in the WHERE clause — a foreign
--   config id answers zero rows, never somebody else's tokens. The same
--   is_approved() gate the table's RESTRICTIVE approved_gate policy applies
--   (unapproved or suspended accounts read nothing). EXECUTE for
--   `authenticated` only; anon and PUBLIC are revoked.
--
-- Additive only: no table, policy or existing function changes.
-- ROLLBACK: drop function if exists public.list_share_links(uuid);
-- ============================================================

create or replace function public.list_share_links(p_config_id uuid)
returns setof public.hangar_share_links
language sql
stable
security definer
set search_path = ''
as $$
  select l.*
  from public.hangar_share_links l
  where l.created_by = auth.uid()
    and l.source_config_id = p_config_id
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
    and public.is_approved()
  order by l.created_at desc
  limit 50
$$;

revoke all on function public.list_share_links(uuid) from public, anon;
grant execute on function public.list_share_links(uuid) to authenticated;

comment on function public.list_share_links(uuid) is
  'Issue #645: the caller''s active (not revoked, not expired) share links of one of their hangar configs, newest first. Owner-only via auth.uid(); authenticated only.';
