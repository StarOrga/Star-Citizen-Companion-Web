-- Concept-ship wishlist (#135, MVP without spec simulation).
--
-- Unreleased / concept ships have NO catalog class_name (the codex is built
-- from the live game's Data.p4k), so they cannot live in hangar_ships —
-- ship_class_name is NOT NULL there by design (soft FK to codex_ships).
-- A separate table keeps the existing hangar schema and queries untouched.
-- Entries are user-authored metadata only (name, manufacturer, pledge link,
-- notes) and are always rendered with a "preliminary" badge; announced-spec
-- simulation is deliberately out of scope for the MVP (data-source and
-- freshness questions are tracked in the issue).

create table if not exists public.hangar_concept_ships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  manufacturer text,
  rsi_url     text,          -- pledge-store / announcement permalink
  notes       text,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

comment on table public.hangar_concept_ships is
  'Wishlist entries for unreleased/concept ships (#135) — user-authored, '
  'no catalog linkage, no spec data. Self-only RLS like the other hangar tables.';

alter table public.hangar_concept_ships enable row level security;

drop policy if exists hangar_concept_ships_self_select on public.hangar_concept_ships;
create policy hangar_concept_ships_self_select on public.hangar_concept_ships
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists hangar_concept_ships_self_insert on public.hangar_concept_ships;
create policy hangar_concept_ships_self_insert on public.hangar_concept_ships
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists hangar_concept_ships_self_update on public.hangar_concept_ships;
create policy hangar_concept_ships_self_update on public.hangar_concept_ships
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists hangar_concept_ships_self_delete on public.hangar_concept_ships;
create policy hangar_concept_ships_self_delete on public.hangar_concept_ships
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.hangar_concept_ships from anon;
