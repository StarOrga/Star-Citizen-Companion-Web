-- Make blueprint-ingredient ingest idempotent.
--
-- `ingest-catalog` op=`ingredients` used a plain INSERT, and the uploader's
-- resumable chunk sender persists its cursor BEFORE the call it guards — so a
-- run killed mid-flight replays exactly one chunk on resume. With no unique
-- constraint that replay silently duplicated recipe rows, and a crafting page
-- would list the same material twice. `clear_ingredients` only runs when a phase
-- starts from scratch, so it cannot clean that up either.
--
-- (build_id, blueprint_class_name, ingredient_index) is unique by construction:
-- catalog-map.ts `collectIngredients` numbers ingredients per blueprint from 0.
--
-- Additive only. No table, column or row is dropped or renamed. Verified safe
-- before shipping: the live project holds 3969 ingredient rows across the
-- current build and 0 duplicate (build_id, blueprint_class_name,
-- ingredient_index) groups, so the index has nothing to choke on.
--
-- ORDER OF DEPLOY: apply this migration BEFORE deploying `ingest-catalog`.
-- That function's `ingredients` op now upserts on this exact key, and
-- PostgREST needs the unique index to resolve the ON CONFLICT target.

create unique index if not exists codex_bp_ingredients_natural_idx
  on public.codex_blueprint_ingredients (build_id, blueprint_class_name, ingredient_index);

comment on index public.codex_bp_ingredients_natural_idx is
  'Natural key for the ingest upsert — lets a resumed uploader run replay a '
  'chunk without duplicating recipe rows.';
