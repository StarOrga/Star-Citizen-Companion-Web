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
