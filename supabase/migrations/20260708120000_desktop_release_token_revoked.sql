-- Auto-update fix: a release token's validity must NOT depend on is_current.
--
-- BUG: desktop-latest validated the incoming X-SC-Release-Token against
--   (release_token = ? AND is_current = true). The dr_dedupe_current trigger
--   flips every OTHER row to is_current = false the moment a newer release is
--   registered. So as soon as vN+1 ships, every already-installed vN build's
--   baked-in token points at a now-non-current row → 401
--   invalid_or_revoked_release_token → the old build can NEVER discover or
--   download the update. That is the exact opposite of what an updater must do.
--
-- FIX: token validity is now an explicit per-release revoke flag. Any known,
--   non-revoked release token may fetch the CURRENT release metadata (which is
--   public — it only points at the public Binaries GitHub release). Leaked
--   tokens can still be killed by setting token_revoked = true, preserving the
--   intent of the Codex 2026-05-24 HIGH 1 finding without breaking auto-update.
alter table public.desktop_releases
  add column if not exists token_revoked boolean not null default false;

comment on column public.desktop_releases.token_revoked is
  'When true, this release''s X-SC-Release-Token is rejected by desktop-latest '
  '(explicit kill-switch for a leaked token). Independent of is_current so that '
  'shipping a newer release does not silently revoke older builds'' update access.';
