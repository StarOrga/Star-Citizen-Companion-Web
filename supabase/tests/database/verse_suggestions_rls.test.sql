-- Kartograph suggestions + community aggregate (migration 20261009120000_verse_suggestions.sql).
--
-- Pins: only a Kartograph (rank >= 1 = a patch with all 7 stars) may suggest,
-- a suggester sees only their own rows and cannot change the status, admins
-- read everything and promote a suggestion into verse_pins, and the community
-- aggregate answers anon with counts only — never a user id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures (as the migration owner) ----------------------------------------
-- ...e011 plain explorer (rank 0), ...e012 Kartograph (rank 1), ...e013 admin.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000e0011', 'pgtap-verse-plain@example.test'),
  ('00000000-0000-4000-a000-0000000e0012', 'pgtap-verse-karto@example.test'),
  ('00000000-0000-4000-a000-0000000e0013', 'pgtap-verse-admin@example.test');

update public.profiles set role = 'admin', is_approved = true
where id = '00000000-0000-4000-a000-0000000e0013';

insert into public.verse_star_progress (user_id, patch_line, star_key)
select '00000000-0000-4000-a000-0000000e0012', 'pgtap-9.3', k
  from unnest(array['notes', 'archive', 'loadout', 'cx-newship', 'cx-keybinds', 'cx-changed', 'cx-blueprint']) k;
insert into public.verse_star_progress (user_id, patch_line, star_key)
values ('00000000-0000-4000-a000-0000000e0011', 'pgtap-9.3', 'notes');

-- Grants --------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.verse_suggestions', 'SELECT'), 'anon cannot read suggestions');
select ok(has_function_privilege('anon', 'public.verse_community_stars(text)', 'EXECUTE'),
  'anon may read the community aggregate');
select ok(not has_function_privilege('anon', 'public.verse_kartograph_rank()', 'EXECUTE'), 'anon has no rank');

-- Plain explorer (rank 0) ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0011","role":"authenticated"}', true);
select is(public.verse_kartograph_rank(), 0, 'plain explorer has rank 0');
select throws_ok($$ insert into public.verse_suggestions (item_url) values ('/verse/patches/pgtap-9.3') $$,
  '42501', null, 'rank 0 cannot suggest');

-- Kartograph (rank 1) -----------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0012","role":"authenticated"}', true);
select is(public.verse_kartograph_rank(), 1, 'a full constellation gives rank 1');
select lives_ok($$ insert into public.verse_suggestions (item_url, note) values ('/verse/patches/pgtap-9.3', 'read this') $$,
  'a Kartograph suggests a top item');
select lives_ok($ update public.verse_suggestions set status = 'pinned' $, 'an own update is filtered, not an error');
select is((select status from public.verse_suggestions where item_url = '/verse/patches/pgtap-9.3'), 'open',
  'a Kartograph cannot pin their own suggestion');
select throws_ok($$ select public.verse_promote_suggestion(gen_random_uuid(), 'x') $$,
  '42501', null, 'a non-admin cannot promote');

-- Plain explorer cannot see it --------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0011","role":"authenticated"}', true);
select is((select count(*)::int from public.verse_suggestions), 0, 'suggestions are private to their author');

-- Admin ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0013","role":"authenticated"}', true);
select is(public.verse_promote_suggestion(
            (select id from public.verse_suggestions where item_url = '/verse/patches/pgtap-9.3'), 'Read the 9.3 notes'),
          'suggestion:' || (select id from public.verse_suggestions where item_url = '/verse/patches/pgtap-9.3')::text,
          'an admin promotes a suggestion to a pin');
select is((select status from public.verse_suggestions where item_url = '/verse/patches/pgtap-9.3'), 'pinned',
  'the promoted suggestion is marked pinned');

-- Anon aggregate ------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((public.verse_community_stars('pgtap-9.3') -> 'stars' ->> 'notes')::int, 2, 'anon gets the count per star key');
select is((public.verse_community_stars('pgtap-9.3') ->> 'explorers')::int, 2, 'anon gets the explorer count');
select ok(position('0000000e001' in public.verse_community_stars('pgtap-9.3')::text) = 0,
  'the aggregate carries no user id');
reset role;

select * from finish();
rollback;
