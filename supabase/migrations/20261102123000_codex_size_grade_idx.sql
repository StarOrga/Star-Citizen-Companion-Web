-- Search concept C8: "größe 3" / "klasse a" become chips and filter the per-kind
-- search (PostgREST .eq('size', n) / .eq('grade', 'A') on the codex_* views).
-- codex_weapons / codex_components / codex_items are VIEWS over *_rows tables
-- (20261102100000_codex_payload_dedupe). Weapons and components hold a few
-- thousand rows per build and already have (build_id, kind|weapon_class, size,
-- grade) indexes, so a build_id-narrowed size/grade filter is cheap. Items is
-- the big one (~40k rows) and its only filter index leads with attach_type, so
-- a size/grade-only filter would scan the whole build. Storage budget: one
-- small btree.
create index if not exists codex_items_size_grade_idx
  on public.codex_items_rows (build_id, size, grade);
