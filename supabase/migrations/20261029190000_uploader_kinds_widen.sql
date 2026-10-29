-- Uploader: more 3D / silhouette kinds for non-ship codex entities.
--
--  * asset_packages.kind gains 'armor' (FPS armor / clothing packages built from
--    the .cdf/.skin/.chr path, same as fps_weapon).
--  * codex_silhouettes.kind gains 'ammo' (ammunition entities whose AmmoParams
--    record carries a mesh). The old 'armor' value stays allowed but unused:
--    armor silhouettes are written as kind 'item' (they live in codex_items).
--
-- Both constraints were created inline, so Postgres named them
-- <table>_kind_check. Alpha phase: no data is touched, only the allowed set.

alter table public.asset_packages drop constraint if exists asset_packages_kind_check;
alter table public.asset_packages
  add constraint asset_packages_kind_check
  check (kind in ('ship', 'fps_weapon', 'item', 'armor'));

alter table public.codex_silhouettes drop constraint if exists codex_silhouettes_kind_check;
alter table public.codex_silhouettes
  add constraint codex_silhouettes_kind_check
  check (kind in ('ship', 'weapon', 'component', 'item', 'armor', 'ammo'));
