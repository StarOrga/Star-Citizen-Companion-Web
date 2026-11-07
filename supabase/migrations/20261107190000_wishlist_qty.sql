-- Nachschub-HQ W1.1 - quantity on every wish (concept 20261107-1410-nachschub-hq, r1 "wunschlisten sollten
-- auch zaehler haben", r2 d2-shipqty = same as everything).
--
--   search_wishlist.qty   how many of it are wished (default 1, 1..999). Material gets a wishlist too.
--   hangar_ships.qty      a ship row carries a count as well: "2x Cutlass Black" on the wishlist, and a second
--                         copy in the Hangar (hangar_ships stays unique per (user, ship), the count is the copy).
--   hangar_ships.origin   Pledge / Ingame / Leihschiff as an attribute of the owned ship (null = unknown).
--
-- Purely additive, nothing dropped. Existing rows get qty 1. Policies are column-agnostic (update on
-- search_wishlist exists since 20261106140000; hangar_ships has its own owner policies).

alter table public.search_wishlist
  add column if not exists qty integer not null default 1;

alter table public.search_wishlist drop constraint if exists search_wishlist_qty;
alter table public.search_wishlist add constraint search_wishlist_qty check (qty between 1 and 999);

comment on column public.search_wishlist.qty is 'Wished quantity, 1..999 (cart counter).';

-- Material wished for a blueprint is grouped under it ("fuer Gallant craften"). The same material for two
-- blueprints is two wishes, so the blueprint joins the key: '' = wished on its own (every existing row).
alter table public.search_wishlist
  add column if not exists for_class_name text not null default '';

alter table public.search_wishlist drop constraint if exists search_wishlist_for_class_len;
alter table public.search_wishlist add constraint search_wishlist_for_class_len
  check (char_length(for_class_name) <= 200);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.search_wishlist'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) not like '%for_class_name%'
  ) then
    alter table public.search_wishlist drop constraint search_wishlist_pkey;
    alter table public.search_wishlist add primary key (user_id, entity_kind, class_name, for_class_name);
  end if;
end $$;

comment on column public.search_wishlist.for_class_name is
  'Blueprint (or crafted item) class this material is wished for; empty = wished on its own. Part of the key.';

alter table public.hangar_ships
  add column if not exists qty    integer not null default 1,
  add column if not exists origin text;

alter table public.hangar_ships drop constraint if exists hangar_ships_qty;
alter table public.hangar_ships add constraint hangar_ships_qty check (qty between 1 and 999);

alter table public.hangar_ships drop constraint if exists hangar_ships_origin;
alter table public.hangar_ships add constraint hangar_ships_origin
  check (origin is null or origin in ('pledge', 'ingame', 'loan'));

comment on column public.hangar_ships.qty is 'Copies wished or owned (second copy allowed), 1..999.';
comment on column public.hangar_ships.origin is 'pledge | ingame | loan (Leihschiff); null = not stated.';

notify pgrst, 'reload schema';
