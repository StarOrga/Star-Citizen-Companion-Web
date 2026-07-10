-- Public (anon) read access for News + Codex browsing without login (#131).
--
-- Scope: ONLY the read-only catalog/content surfaces the public pages need —
-- the codex_* catalog tables, locale strings, ship-skin metadata, the public
-- bundle-stats view, and the codex_compatible_items RPC. Personal tables
-- (profiles, hangar_*, admin_*, telemetry, tokens) are NOT touched: their
-- self-only policies and explicit anon revokes stay exactly as they are.
--
-- Writes stay locked: every one of these tables already revokes
-- insert/update/delete/truncate from anon+authenticated (service-role-only
-- ingest) — this migration adds SELECT only.

do $$
declare t text;
begin
  foreach t in array array[
    'codex_builds','codex_manufacturers','codex_ships','codex_weapons',
    'codex_components','codex_items','codex_ammunition','codex_item_ports',
    'codex_entity_strings','codex_blueprints','codex_blueprint_ingredients',
    'codex_locale_strings','ship_skins'
  ] loop
    execute format('drop policy if exists %I on public.%I;', t || '_anon_read', t);
    execute format(
      'create policy %I on public.%I for select to anon using (true);',
      t || '_anon_read', t
    );
    execute format('grant select on public.%I to anon;', t);
  end loop;
end $$;

-- Hardpoint-compatibility RPC used by the codex detail page.
grant execute on function public.codex_compatible_items(uuid, text[], int, int) to anon;

-- Catalog staleness banner (client treats it as best-effort either way).
grant select on public.p4k_bundles_public_stats to anon;
