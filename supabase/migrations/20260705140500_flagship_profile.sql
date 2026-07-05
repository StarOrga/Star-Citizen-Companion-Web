-- ============================================================
-- 20260705140500_flagship_profile.sql
-- Flagship persistence: promote the user's pinned "standard ship" (Codex
-- Bridge hero, PR #86 Slice 2) from per-device localStorage to the profile —
-- unlocks cross-device sync (PR #86 follow-up / codex rethink decision.md).
--
-- flagship_ship_class soft-FKs codex_ships.class_name by its patch-stable
-- slug (same rationale as hangar_ships.ship_class_name in 20260613000000):
-- catalog rows are build-scoped and replaced wholesale per extractor run,
-- while the pin must survive build swaps. A NULL means "no flagship pinned".
-- The ship does NOT have to be in the user's hangar (a flagship can be
-- pinned from Bridge search results) — hence profiles, not hangar_ships.
--
-- RLS: covered by the existing profiles_self_read / _self_upsert /
-- _self_update policies from 00001 — no policy changes needed.
--
-- ADDITIVE: this migration drops nothing.
-- ============================================================

alter table public.profiles
  add column if not exists flagship_ship_class text;

comment on column public.profiles.flagship_ship_class is
  'The user''s single pinned standard ship (codex_ships.class_name soft FK). Drives the Codex Bridge hero. NULL = none pinned.';
