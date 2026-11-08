-- Translation community seed + learning loop (migration 20261108160000_translation_community_seed.sql).
--
-- Pins: seed rows and approved languages, everything admin-only (anon/plain user see
-- nothing), trust fields (card points, source status, outreach approval) move through the
-- RPCs only, outreach approval needs a PROTECTED admin, a card answer computes
-- points = 10 + least(impact, 500) / 10, and a granted answer flips the source to permitted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Fixtures (as the migration owner) ----------------------------------------
-- ...e021 protected admin, ...e022 plain (unprotected) admin, ...e023 viewer.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000e0021', 'pgtap-tr-protected@example.test'),
  ('00000000-0000-4000-a000-0000000e0022', 'pgtap-tr-admin@example.test'),
  ('00000000-0000-4000-a000-0000000e0023', 'pgtap-tr-viewer@example.test');
update public.profiles set role = 'admin', is_approved = true
where id in ('00000000-0000-4000-a000-0000000e0021', '00000000-0000-4000-a000-0000000e0022');
insert into public.protected_admins (user_id, reason)
values ('00000000-0000-4000-a000-0000000e0021', 'pgtap');

insert into public.translation_cards (id, lang, kind, question, option_a, option_b, impact) values
  ('00000000-0000-4000-a000-0000000c0001', 'de', 'meta', 'q1', '{"text":"a","source":"ai"}', '{"text":"b","source":"community"}', 120),
  ('00000000-0000-4000-a000-0000000c0002', 'de', 'wording', 'q2', '{"text":"a","source":"ai"}', '{"text":"b","source":"community"}', 900),
  ('00000000-0000-4000-a000-0000000c0003', 'de', 'style', 'q3', '{"text":"a","source":"ai"}', '{"text":"b","source":"community"}', 5),
  ('00000000-0000-4000-a000-0000000c0004', 'de', 'style', 'q4', '{"text":"a","source":"ai"}', '{"text":"b","source":"community"}', 0);
insert into public.translation_override_alerts (id, lang, key, admin_text) values
  ('00000000-0000-4000-a000-0000000a0001', 'de', 'k_one', 'admin text'),
  ('00000000-0000-4000-a000-0000000a0002', 'de', 'k_two', 'admin text');
insert into public.translation_outreach (id, source_id, kind, subject, body) values
  ('00000000-0000-4000-a000-0000000b0001', 'thord82', 'permission', 's', 'b'),
  ('00000000-0000-4000-a000-0000000b0002', 'circuspes', 'permission', 's', 'b');

-- Seed ------------------------------------------------------------------------
select is((select count(*)::int from public.translation_sources), 8, 'eight sources are seeded');
select is((select array_agg(id order by id) from public.translation_sources where status = 'awaiting_permission'),
  array['42kit', 'circuspes', 'thord82'], 'fr, zh-Hans, es wait for permission');
select is((select game_folder || '/' || use_cig_table::text from public.translation_sources where id = 'n1ghter'),
  'korean_(south_korea)/false', 'ru ships in the korean slot without the CIG table');
select is((select array_agg(lang order by lang) from public.translation_languages where approved),
  array['de', 'it', 'ja', 'pt-BR', 'ru'], 'exactly de, it, pt-BR, ja, ru are approved');
select is((select enabled from public.translation_settings where id = 1), false, 'the pipeline stays disabled');
select is((select arbiter_model || '/' || revise_margin || '/' || promote_min_evidence from public.translation_settings where id = 1),
  'claude-haiku-5-5/3/5', 'new settings carry their defaults');
select lives_ok($$ insert into public.translation_glossary (lang, source_term, target_term, origin, evidence)
  values ('de', 'pgtap-term', 'x', 'mined', 6) $$, 'glossary accepts origin mined with evidence');

-- Grants ---------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.translation_cards', 'SELECT'), 'anon cannot read cards');
select ok(not has_function_privilege('anon', 'public.approve_translation_outreach(uuid)', 'EXECUTE'),
  'anon cannot call approve');

-- Viewer ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0023","role":"authenticated"}', true);
select is((select count(*)::int from public.translation_sources), 0, 'a viewer sees no sources');
select is((select count(*)::int from public.translation_cards), 0, 'a viewer sees no cards');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0001', 'a') $$,
  '42501', null, 'a viewer cannot answer a card');
select throws_ok($$ select * from public.translation_card_leaderboard() $$,
  '42501', null, 'a viewer cannot read the leaderboard');

-- Unprotected admin ------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0022","role":"authenticated"}', true);
select is((select count(*)::int from public.translation_sources), 8, 'an admin reads the sources');
select throws_ok($$ select public.approve_translation_outreach('00000000-0000-4000-a000-0000000b0001') $$,
  '42501', null, 'a non-protected admin cannot approve outreach');
select throws_ok($$ update public.translation_cards set points = 9999 where id = '00000000-0000-4000-a000-0000000c0001' $$,
  '42501', null, 'card points cannot be written directly');
select throws_ok($$ update public.translation_sources set status = 'permitted' where id = 'thord82' $$,
  '42501', null, 'a source status cannot be set directly');
select throws_ok($$ update public.translation_outreach set status = 'approved' where id = '00000000-0000-4000-a000-0000000b0001' $$,
  '42501', null, 'outreach status cannot be set directly');

-- Protected admin approves ---------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0021","role":"authenticated"}', true);
select lives_ok($$ select public.approve_translation_outreach('00000000-0000-4000-a000-0000000b0001') $$,
  'a protected admin approves outreach');
select is((select status || '/' || (approved_by = '00000000-0000-4000-a000-0000000e0021')::text
  from public.translation_outreach where id = '00000000-0000-4000-a000-0000000b0001'),
  'approved/true', 'approval is recorded with the approver');
select throws_ok($$ select public.approve_translation_outreach('00000000-0000-4000-a000-0000000b0001') $$,
  'P0002', null, 'only a draft can be approved');

-- Outreach flow as a plain admin -------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-0000000e0022","role":"authenticated"}', true);
select throws_ok($$ select public.mark_translation_outreach_sent('00000000-0000-4000-a000-0000000b0002') $$,
  'P0002', null, 'an unapproved draft cannot be marked sent');
select lives_ok($$ select public.mark_translation_outreach_sent('00000000-0000-4000-a000-0000000b0001') $$,
  'an approved draft is marked sent manually');
select lives_ok($$ select public.record_translation_outreach_answer(
  '00000000-0000-4000-a000-0000000b0001', 'Yes, go ahead', 'granted') $$, 'a granted answer is recorded');
select is((select status from public.translation_sources where id = 'thord82'), 'permitted',
  'a granted answer flips the source to permitted');

-- Cards -----------------------------------------------------------------------------
select is((select points from public.answer_translation_card('00000000-0000-4000-a000-0000000c0001', 'a')), 22,
  'impact 120 gives 10 + 12 points');
select is((select points from public.answer_translation_card('00000000-0000-4000-a000-0000000c0002', 'own', 'eigener Text', 'note', true)), 60,
  'impact is capped at 500 (10 + 50 points)');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0003', 'own') $$,
  '22023', null, 'an own answer needs a text');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0001', 'b') $$,
  'P0002', null, 'an answered card cannot be answered again');
select is((select status from public.skip_translation_card('00000000-0000-4000-a000-0000000c0003')), 'skipped',
  'a card can be skipped');
select is((select open_count || '/' || answered_today || '/' || streak_days from public.translation_card_stats('de')),
  '2/2/1', 'stats: two cards left (one skipped), two answered today, streak 1');
select is((select points || '/' || answers from public.translation_card_leaderboard() limit 1), '82/2',
  'leaderboard sums points and answers per admin');

-- Alerts -----------------------------------------------------------------------------
select throws_ok($$ select public.resolve_override_alert('00000000-0000-4000-a000-0000000a0001', 'edited') $$,
  '22023', null, 'edited needs a text');
select is((select status from public.resolve_override_alert('00000000-0000-4000-a000-0000000a0001', 'adopted')), 'adopted',
  'an alert is resolved by adopting CIG');

select * from finish();
rollback;
