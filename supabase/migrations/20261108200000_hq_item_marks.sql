-- HQ Bestand / Codex item page: a personal note and a pin per inventory ITEM (feedback item
-- "Note and pin for inventory items on the item page card", concept codex-kopf-besitz r2 d1-s4).
--
-- Why a table of its own and not columns on hq_inventory_items: one item's stock is split over
-- several rows (one per storage place, PK user_id/location/name), and desktop snapshots replace or
-- delete those rows wholesale. A note or pin belongs to the item for this user, so it is keyed by
-- (user_id, class_name) and survives a replaced snapshot, a moved stack or a zero stock.
--
-- pinned_rank: null = not pinned, 1..99 = pinned (lower first); the web hands out max + 1.
-- RLS: own rows only, same policy style as the other hq_* tables.
--
-- Alpha-phase data policy: purely additive, nothing dropped.

create table if not exists public.hq_item_marks (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  class_name  text        not null,
  note        text,
  pinned_rank smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, class_name),

  constraint hq_item_marks_class_len check (char_length(btrim(class_name)) between 1 and 200),
  constraint hq_item_marks_note_len  check (note is null or char_length(note) <= 500),
  constraint hq_item_marks_rank      check (pinned_rank is null or pinned_rank between 1 and 99)
);

comment on table public.hq_item_marks is
  'Personal note (<= 500) and pin (pinned_rank 1..99, null = unpinned) per user and item class_name, independent of where the stock lies. Private per user.';

drop trigger if exists hq_item_marks_updated_at on public.hq_item_marks;
create trigger hq_item_marks_updated_at before update on public.hq_item_marks
  for each row execute function public.set_updated_at();

alter table public.hq_item_marks enable row level security;
grant select, insert, update, delete on table public.hq_item_marks to authenticated;

drop policy if exists hq_item_marks_select_own on public.hq_item_marks;
create policy hq_item_marks_select_own on public.hq_item_marks for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists hq_item_marks_insert_own on public.hq_item_marks;
create policy hq_item_marks_insert_own on public.hq_item_marks for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists hq_item_marks_update_own on public.hq_item_marks;
create policy hq_item_marks_update_own on public.hq_item_marks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists hq_item_marks_delete_own on public.hq_item_marks;
create policy hq_item_marks_delete_own on public.hq_item_marks for delete to authenticated
  using ((select auth.uid()) = user_id);

-- New table for the web client: reload PostgREST's schema cache right away (PGRST205 otherwise).
notify pgrst, 'reload schema';
