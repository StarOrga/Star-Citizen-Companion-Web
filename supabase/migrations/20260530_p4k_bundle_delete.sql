-- 20260530 · Phase 2 — Hard-delete a bundle (admin-only)
-- Adds a destructive counterpart to set_bundle_disabled: admins can now remove
-- a bundle row entirely, not just deactivate it. Use deactivation for the normal
-- "hide from listings" flow; delete is for mistaken/garbage uploads.
--
-- Referential note: diff_summary on later bundles stores a prev_id inside JSON
-- (not a FK), so deleting a row never violates a constraint, but a successor's
-- diff may reference a now-gone bundle. Acceptable in alpha — diffs are
-- informational and recomputed on the next upload.

create or replace function public.delete_p4k_bundle(
  bundle_id uuid
)
returns void
language plpgsql security definer set search_path = public as $func$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  delete from public.p4k_bundles where id = bundle_id;
end;
$func$;

grant execute on function public.delete_p4k_bundle(uuid) to authenticated;
