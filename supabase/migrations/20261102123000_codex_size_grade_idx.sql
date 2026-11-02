-- Search concept C8: "größe 3" / "klasse a" become chips and filter the per-kind
-- search (PostgREST .eq('size', n) / .eq('grade', 'A')). The existing
-- *_filter_idx lead with kind/weapon_class/attach_type, so a size/grade-only
-- filter inside one build could not use them past build_id. These cover it.
create index if not exists codex_weapons_size_grade_idx    on public.codex_weapons    (build_id, size, grade);
create index if not exists codex_components_size_grade_idx on public.codex_components (build_id, size, grade);
create index if not exists codex_items_size_grade_idx      on public.codex_items      (build_id, size, grade);
