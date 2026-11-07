-- HQ Nachschub - exact amounts and the blueprint link of a material line.
--
-- A blueprint brings its material to Nachschub (concept "Gegenstand weg", A9). The recipe counts SCU
-- (0.36 Agricium), `qty` is a whole number >= 1, so the line used to say "1". Purely additive:
--
--   amount        exact quantity in `unit`, e.g. 0.36. Null = the line counts whole pieces in `qty`.
--   unit          'pcs' | 'scu', set together with amount (same units as hq_inventory_items.unit, so
--                 "Besorgt" writes the amount to the inventory unchanged). The client writes 'scu' only.
--   for_class_name  class name of the blueprint that brought this material line. Removing the blueprint
--                 from Nachschub takes the lines that point at it along; a line added on its own has
--                 none and stays. Soft reference to the codex, no FK (the codex is rebuilt per build).
--
-- `qty` keeps its meaning (pieces, 1..999). On an amount line it is the number of "portions" (one
-- blueprint's worth, the step of the -/+ buttons): amount = portions x portion, so the stepper never
-- rounds. A client that ignores `amount` still sees a valid whole-number line.
--
-- Alpha-phase data policy: nothing dropped. RLS, the sync trigger and the caps are column-agnostic and
-- unchanged; no RPC lists the columns of hq_supplies.

alter table public.hq_supplies
  add column if not exists amount         numeric,
  add column if not exists unit           text,
  add column if not exists for_class_name text;

alter table public.hq_supplies drop constraint if exists hq_supplies_amount;
alter table public.hq_supplies add constraint hq_supplies_amount
  check (amount is null or (amount > 0 and amount <= 1000000000));

alter table public.hq_supplies drop constraint if exists hq_supplies_unit;
alter table public.hq_supplies add constraint hq_supplies_unit
  check (unit is null or unit in ('pcs', 'scu'));

-- amount and unit belong together.
alter table public.hq_supplies drop constraint if exists hq_supplies_amount_pair;
alter table public.hq_supplies add constraint hq_supplies_amount_pair
  check ((amount is null) = (unit is null));

alter table public.hq_supplies drop constraint if exists hq_supplies_for_class_len;
alter table public.hq_supplies add constraint hq_supplies_for_class_len
  check (for_class_name is null or char_length(for_class_name) <= 200);

comment on column public.hq_supplies.amount is
  'Exact quantity in `unit` (e.g. 0.36 SCU of a blueprint material); null = whole pieces in qty.';
comment on column public.hq_supplies.unit is
  'pcs | scu, set iff amount is set; same units as hq_inventory_items.unit.';
comment on column public.hq_supplies.for_class_name is
  'Class name of the blueprint this material line was added for; removing that blueprint from Nachschub removes the line too. Null = added on its own.';
