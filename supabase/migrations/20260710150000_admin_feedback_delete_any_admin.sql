-- Admin feedback board: allow any admin to delete any topic (was: own rows
-- only). Rationale: once a topic's handling/rejection is accepted, an admin
-- should be able to clear it — even if another admin authored it. The board
-- is already admin-only (is_admin() gates read/insert/update), so this only
-- widens delete within the admin group, not to anyone else.
--
-- Idempotent: drops both the legacy own-only policy and this one before
-- (re)creating, so a re-run (e.g. db:push after a ledger desync) is safe.

drop policy if exists admin_feedback_delete_own on public.admin_feedback;
drop policy if exists admin_feedback_delete on public.admin_feedback;

create policy admin_feedback_delete on public.admin_feedback
  for delete
  using (is_admin());
