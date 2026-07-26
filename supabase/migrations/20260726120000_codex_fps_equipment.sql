-- Crafting: index the blueprint output lookup (part of #187).
--
-- ADDITIVE: this migration creates no table, drops nothing and renames nothing.
-- It adds a single index.
--
-- "Which materials does it take to craft this item?" resolves a blueprint by the
-- entity class it produces (codex_blueprints.output_class_name). That column
-- exists since 00010_codex_blueprints.sql, but every read so far went either via
-- class_name or via the codex_blueprint_ingredients reverse index, so the forward
-- lookup added for the FPS codex would be a sequential scan on every item
-- detail-page view.
--
-- No FPS-equipment table is needed: personal armour lives in codex_items
-- (attach_type IN Char_Armor_*) and FPS weapons in codex_weapons
-- (weapon_class = 'FPS'), both already carried by the existing pipeline.

create index if not exists codex_blueprints_output_idx
  on public.codex_blueprints (build_id, output_class_name);
