-- Nachschub-HQ audit bundle B2 (H2, AUD-14, H1 follow-up). Additive; 20261108130100 stays untouched.
--
-- H2: hq_supply_packages used hq_enforce_cap(40, 120). Archiving keeps deleted_at null, so every archived
-- Nachschub counted as "live": after ~40 finished ones nobody could create a new Nachschub, and tombstones
-- (kept 180 days) ate the 120 total just as fast. The active set is already bounded to 7 by the partial unique
-- index hq_supply_packages_active_slot_idx, so the cap only has to stop abuse of the archive: 300 live rows
-- (7 active + archive) and 1000 including tombstones. The client prunes nothing and shows a clear hint when
-- the cap is still hit (hq.nachschub.capReached).
drop trigger if exists hq_supply_packages_b_cap on public.hq_supply_packages;
create trigger hq_supply_packages_b_cap
  before insert or update on public.hq_supply_packages
  for each row execute function public.hq_enforce_cap(300, 1000);

-- H1 follow-up (not a replay fix: 20261108130100 itself is applied and unchanged). The NOT VALID check
-- hq_einsaetze_package_title_len (title <= 40 once package_id is set) is still enforced on every UPDATE of a row
-- that carries a package_id, and the app lets a user rename an Einsatz to up to 120 characters. A rename of an
-- Einsatz inside a Nachschub to 41..120 characters would therefore fail on the server and leave the dirty row
-- retrying forever. Clamp instead of reject: the server trims such a title to 40 characters before the check runs.
create or replace function public.hq_einsatz_package_title_clamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.package_id is not null and char_length(btrim(new.title)) > 40 then
    new.title := left(btrim(new.title), 40);
  end if;
  return new;
end;
$$;
revoke all on function public.hq_einsatz_package_title_clamp() from public, anon, authenticated;

drop trigger if exists hq_einsaetze_d_package_title on public.hq_einsaetze;
create trigger hq_einsaetze_d_package_title
  before insert or update on public.hq_einsaetze
  for each row execute function public.hq_einsatz_package_title_clamp();

notify pgrst, 'reload schema';
