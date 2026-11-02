-- ============================================================
-- 20261102110000_codex_entity_strings_rpc.sql
-- Entity strings readable only per build + class
-- (concept docs/concepts/20261102-0030-codex-payload-dedupe, final report
-- Fund "Strings-View ohne Build-Filter teuer" = red-team finding R10).
--
-- WHY
--   Since 20261102100000 codex_entity_strings is a view that derives the
--   strings from codex_payloads (DISTINCT ON over a UNION ALL of six *_rows
--   tables). Filtered on build_id + entity_class_name it pushes down to the
--   (build_id, class_name) indexes (~2 ms). Any other PostgREST filter — or
--   none — derives every string of every build: ~100k payload
--   decompressions per request, an amplifier anyone with the public key
--   could fire.
--
-- HOW
--   codex_entity_strings_for(build, class) is the read path (the detail page
--   is its only caller); anon + authenticated lose SELECT on the view itself.
--   The service role (ingest, scripts) keeps it.
-- ============================================================

create or replace function public.codex_entity_strings_for(p_build_id uuid, p_class_name text)
returns table(entity_class_name text, entity_kind text, lang text, field text, value text, loc_key text)
language sql stable security definer set search_path = '' as $$
  select s.entity_class_name, s.entity_kind, s.lang, s.field, s.value, s.loc_key
    from public.codex_entity_strings s
   where p_build_id is not null and p_class_name is not null
     and s.build_id = p_build_id
     and s.entity_class_name = p_class_name
$$;
revoke all on function public.codex_entity_strings_for(uuid, text) from public;
grant execute on function public.codex_entity_strings_for(uuid, text) to anon, authenticated, service_role;

revoke select on public.codex_entity_strings from anon, authenticated;
