-- One wishlist for every catalog item and every announced ship (concept
-- "Gegenstand weg", checklist A2; decision gw-up = one, owner: "vollstaendig
-- abloesen").
--
-- Until now two stores existed: search_wishlist (non-ship kinds) and
-- hangar_concept_ships (announced ships, free text, no class_name). This
-- migration makes search_wishlist the single store and replaces
-- hangar_concept_ships completely.
--
--   * search_wishlist gets the optional columns an announced ship needs:
--     name, manufacturer, rsi_url, notes. An announced ship is stored as
--     entity_kind = 'upcoming' with class_name = the ship name folded to
--     [a-z0-9] (the client's normalizeShipName), so a wish survives a changed
--     feed id.
--   * Every hangar_concept_ships row is copied over (user_id, name,
--     manufacturer, rsi_url, notes, created_at). A name that folds to the empty
--     string (no ASCII letters at all) is keyed 'upcoming-<row id>' so no
--     wish is lost.
--   * Ships of the live catalog keep hangar_ships.status = 'wishlist'
--     (ship_class_name is NOT NULL there, which only announced ships could not
--     satisfy - they never lived in hangar_ships).
--
-- ALPHA DATA POLICY: public.hangar_concept_ships is DROPPED here, with its
-- policies, the rsi_url allowlist constraint and its approved-gate policy
-- (20260805120000). The data is migrated first; nothing else references the
-- table (friend_overview, 20261105120000, only mentions it in a comment: the
-- concept wishlist stays out of `hangar` and a friend never saw it).
--
-- DEPLOY: apply with `npm run db:push`, then run `notify pgrst, 'reload schema'`
-- (new columns). Ship the client of the same release; an older client would
-- find the concept table gone.

alter table public.search_wishlist
  add column if not exists name         text check (name is null or char_length(trim(name)) between 1 and 80),
  add column if not exists manufacturer text,
  add column if not exists rsi_url      text,
  add column if not exists notes        text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'search_wishlist_rsi_url_allowlist'
      and conrelid = 'public.search_wishlist'::regclass
  ) then
    -- NOT VALID: gates every future write, leaves migrated rows unchecked
    -- (same reasoning as hangar_concept_ships_rsi_url_allowlist).
    alter table public.search_wishlist
      add constraint search_wishlist_rsi_url_allowlist
      check (public.is_rsi_pledge_ship_url(rsi_url)) not valid;
  end if;
end $$;

comment on table public.search_wishlist is
  'THE wishlist (owner-only): every catalog kind plus announced ships (entity_kind = upcoming, class_name = folded name, name/manufacturer/rsi_url/notes set). Ships of the live catalog use hangar_ships.status = wishlist. Separate from Nachschub (hq_supplies).';

-- Editing the note / link of an announced ship needs update.
drop policy if exists search_wishlist_update_own on public.search_wishlist;
create policy search_wishlist_update_own on public.search_wishlist
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update on public.search_wishlist to authenticated;

-- Migrate the announced-ship wishes.
insert into public.search_wishlist (user_id, entity_kind, class_name, created_at, name, manufacturer, rsi_url, notes)
select
  c.user_id,
  'upcoming',
  coalesce(nullif(left(lower(regexp_replace(c.name, '[^a-zA-Z0-9]', '', 'g')), 200), ''), 'upcoming-' || c.id::text),
  c.created_at,
  left(trim(c.name), 80),
  c.manufacturer,
  c.rsi_url,
  c.notes
from public.hangar_concept_ships c
on conflict (user_id, entity_kind, class_name) do nothing;

-- The old store goes (policies, constraint and gate policy go with the table).
drop table if exists public.hangar_concept_ships;
