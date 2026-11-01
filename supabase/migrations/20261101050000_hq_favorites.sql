-- HQ (beta) - favourites (plan section 3.6, D22): max 3 ships + 3 FPS sets.
--
-- Checked the hangar tables first (20260613000000_hangar.sql):
--   * Ships: hangar_ships.pinned_rank (1..3, unique per user via hangar_ships_pin_unique)
--     IS the ship favourite and already caps it at three. HQ reads "pinned_rank is not null"
--     as the star; no new column and no trigger for ships.
--   * FPS sets: hangar_role_loadouts had no flag -> add `favorite` + a <= 3 per user trigger.
--     Applies to all role loadouts (fps/mining/salvage/medical/engineering): HQ shows every
--     hangar_role_loadouts row as an "FPS set" (D16).
--   * Ship loadouts (hangar_ship_configs) are not favourited themselves; Top 3 ranks a
--     ship config by "its ship is pinned" (D24).
--
-- Alpha-phase data policy: additive column with a default, nothing dropped.

alter table public.hangar_role_loadouts
  add column if not exists favorite boolean not null default false;

comment on column public.hangar_role_loadouts.favorite is
  'HQ favourite star (D22). At most 3 per user (trigger hangar_role_loadouts_favorite_cap).';

create or replace function public.hangar_role_loadouts_favorite_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.favorite and (tg_op = 'INSERT' or not old.favorite) then
    perform pg_advisory_xact_lock(hashtextextended('hangar_role_loadouts_fav:' || new.user_id::text, 0));
    if (select count(*) from public.hangar_role_loadouts
         where user_id = new.user_id and favorite and id <> new.id) >= 3 then
      raise exception 'hangar_role_loadouts: at most 3 favourite FPS sets' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.hangar_role_loadouts_favorite_cap() from public, anon, authenticated;

drop trigger if exists hangar_role_loadouts_favorite_cap on public.hangar_role_loadouts;
create trigger hangar_role_loadouts_favorite_cap
  before insert or update of favorite on public.hangar_role_loadouts
  for each row execute function public.hangar_role_loadouts_favorite_cap();

create index if not exists hangar_role_loadouts_user_fav_idx
  on public.hangar_role_loadouts (user_id) where favorite;
