-- HQ Bestand: reservations on an inventory row (feedback #304, "Lager wie am Tresen").
--
-- A reservation earmarks part of a row's amount for someone or something ("1 SCU an Spieler X",
-- "Verkauf"): available = qty - sum(reservations.amount). It lives as a jsonb array on the item
-- row itself, so it inherits the row's owner-only RLS and is cascade-deleted with it. Shape of
-- one entry: { "amount": number > 0, "note": text (<= 120), "at": ISO timestamp }.
--
-- A desktop snapshot that replaces a location's items (delete + insert) drops that location's
-- reservations with the rows; manual upserts leave the column untouched.
--
-- Alpha-phase data policy: purely additive, nothing dropped, no policy change.

alter table public.hq_inventory_items
  add column if not exists reservations jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hq_inventory_items'::regclass and conname = 'hq_inv_item_reservations_shape'
  ) then
    alter table public.hq_inventory_items
      add constraint hq_inv_item_reservations_shape
      check (jsonb_typeof(reservations) = 'array' and jsonb_array_length(reservations) <= 50
             and pg_column_size(reservations) <= 16384);
  end if;
end $$;

comment on column public.hq_inventory_items.reservations is
  'Reservations on this row: [{amount, note, at}], at most 50. Available = qty minus their amounts. Owner-only like the row.';
