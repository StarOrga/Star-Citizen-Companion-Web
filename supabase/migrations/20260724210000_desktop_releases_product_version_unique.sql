-- 20260724210000_desktop_releases_product_version_unique.sql
-- Scope the desktop_releases version uniqueness to the product.
--
-- `desktop_releases` became multi-product in 20260724000000_desktop_releases_product.sql
-- (uploader + starscape), but its UNIQUE constraint was still on `version` ALONE.
-- Two products version independently, so their version strings inevitably collide:
-- registering Starscape 0.3.3 failed against the data-uploader's 0.3.3 from
-- 2026-05-24 (`desktop_releases_version_key`), leaving the built + mirrored
-- Starscape binary unregistered and the public gallery page pinned to 0.3.2.
--
-- The earlier migration already anticipated this ("both products share the
-- `version` text column") and hardened promote_desktop_channel to resolve only
-- uploader rows — but it did not relax the constraint itself. This does.
--
-- NOT destructive: no table, column, or row is dropped. The swap only WIDENS
-- what is accepted (every row valid under UNIQUE (version) is still valid under
-- UNIQUE (product, version)), so it cannot fail on existing data and loses
-- nothing. Nothing depends on global version uniqueness — no `on conflict
-- (version)` exists anywhere, and both resolvers (starscape_latest_release,
-- promote_desktop_channel) already filter by product.

alter table public.desktop_releases
  drop constraint if exists desktop_releases_version_key;

alter table public.desktop_releases
  add constraint desktop_releases_product_version_key unique (product, version);
