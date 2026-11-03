-- Search concept (docs/concepts/2026-11-02-suche-kontext-aktionen, parity B8/B11):
-- lean wishlist for every non-ship kind. Ships keep using hangar_ships.status =
-- 'wishlist'. Deliberately separate from the Nachschub storage (hq supplies /
-- SupplyItem.wanted) - the two never share rows.

create table if not exists public.search_wishlist (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_kind text not null check (char_length(entity_kind) between 1 and 40),
  class_name  text not null check (char_length(class_name) between 1 and 200),
  created_at  timestamptz not null default now(),
  primary key (user_id, entity_kind, class_name)
);

comment on table public.search_wishlist is
  'Search wishlist for non-ship codex kinds (owner-only). Ships use hangar_ships.status=wishlist; Nachschub (hq supplies) is a separate store.';

alter table public.search_wishlist enable row level security;

drop policy if exists search_wishlist_select_own on public.search_wishlist;
create policy search_wishlist_select_own on public.search_wishlist
  for select to authenticated using (user_id = auth.uid());

drop policy if exists search_wishlist_insert_own on public.search_wishlist;
create policy search_wishlist_insert_own on public.search_wishlist
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists search_wishlist_delete_own on public.search_wishlist;
create policy search_wishlist_delete_own on public.search_wishlist
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.search_wishlist from anon, authenticated;
grant select, insert, delete on public.search_wishlist to authenticated;
