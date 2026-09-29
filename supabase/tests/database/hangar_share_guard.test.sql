-- hangar_ship_configs_share_guard (AUD-350, REQ-35).
--
-- The sharing columns of hangar_ship_configs are write-gated by a trigger
-- (20260920160000_hangar_loadout_sharing.sql), re-created with the AUD-005
-- exception in 20260928231143_delete_paths_and_log_retention.sql (plan D02):
--   - a client may not set them on INSERT (only adopt_shared_loadout may),
--   - follows_owner may flip true -> false once, never back,
--   - source_config_id / owner_user_id are immutable, EXCEPT the one-way null
--     the FK action `on delete set null` writes when the owner deletes the
--     source config (the copy then forks irreversibly),
--   - an own edit of a followed copy forks it.
-- The guard reads the transaction-local GUC hangar.internal_write, not the
-- role, so the fixture writes as postgres with the GUC switched on and every
-- case below runs with it switched off again.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Fixture ------------------------------------------------------------------
-- owner ...a001, recipient ...a002. profiles rows come from on_auth_user_created.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-00000000a001', 'pgtap-share-owner@example.test'),
  ('00000000-0000-4000-a000-00000000a002', 'pgtap-share-recipient@example.test');

insert into public.hangar_ships (id, user_id, ship_class_name) values
  ('00000000-0000-4000-b000-00000000b001', '00000000-0000-4000-a000-00000000a001', 'PGTAP_Ship'),
  ('00000000-0000-4000-b000-00000000b002', '00000000-0000-4000-a000-00000000a002', 'PGTAP_Ship');

-- Owner configs: c001 (followed by c003), c002 (followed by c004, deleted below).
insert into public.hangar_ship_configs (id, user_id, hangar_ship_id, name) values
  ('00000000-0000-4000-c000-00000000c001', '00000000-0000-4000-a000-00000000a001',
   '00000000-0000-4000-b000-00000000b001', 'Owner A'),
  ('00000000-0000-4000-c000-00000000c002', '00000000-0000-4000-a000-00000000a001',
   '00000000-0000-4000-b000-00000000b001', 'Owner B'),
  -- The recipient's own, never-shared config.
  ('00000000-0000-4000-c000-00000000c005', '00000000-0000-4000-a000-00000000a002',
   '00000000-0000-4000-b000-00000000b002', 'Own');

-- Following copies — only the trusted path (adopt_shared_loadout) may write these columns.
select set_config('hangar.internal_write', 'on', true);
insert into public.hangar_ship_configs
  (id, user_id, hangar_ship_id, name, source_config_id, follows_owner, owner_user_id,
   shared_channel, shared_patch_version) values
  ('00000000-0000-4000-c000-00000000c003', '00000000-0000-4000-a000-00000000a002',
   '00000000-0000-4000-b000-00000000b002', 'Owner A', '00000000-0000-4000-c000-00000000c001',
   true, '00000000-0000-4000-a000-00000000a001', 'LIVE', '4.3.0'),
  ('00000000-0000-4000-c000-00000000c004', '00000000-0000-4000-a000-00000000a002',
   '00000000-0000-4000-b000-00000000b002', 'Owner B', '00000000-0000-4000-c000-00000000c002',
   true, '00000000-0000-4000-a000-00000000a001', 'LIVE', '4.3.0');
select set_config('hangar.internal_write', 'off', true);

-- INSERT ---------------------------------------------------------------------
select throws_ok($$
  insert into public.hangar_ship_configs (user_id, hangar_ship_id, name, source_config_id)
  values ('00000000-0000-4000-a000-00000000a002', '00000000-0000-4000-b000-00000000b002',
          'Sneaky', '00000000-0000-4000-c000-00000000c001')
$$, '42501', null, 'a client INSERT may not point a config at a foreign source');

select throws_ok($$
  insert into public.hangar_ship_configs (user_id, hangar_ship_id, name, follows_owner)
  values ('00000000-0000-4000-a000-00000000a002', '00000000-0000-4000-b000-00000000b002',
          'Sneaky', true)
$$, '42501', null, 'a client INSERT may not create a following copy');

-- follows_owner --------------------------------------------------------------
select throws_ok($$
  update public.hangar_ship_configs set follows_owner = true
  where id = '00000000-0000-4000-c000-00000000c005'
$$, '42501', null, 'follows_owner false -> true is refused on a never-shared config');

select lives_ok($$
  update public.hangar_ship_configs set name = 'Mine now'
  where id = '00000000-0000-4000-c000-00000000c003'
$$, 'the recipient may edit her following copy');

select is(
  (select follows_owner from public.hangar_ship_configs where id = '00000000-0000-4000-c000-00000000c003'),
  false, 'an own edit forks the copy');
select isnt(
  (select forked_at from public.hangar_ship_configs where id = '00000000-0000-4000-c000-00000000c003'),
  null, 'the fork is stamped');

select throws_ok($$
  update public.hangar_ship_configs set follows_owner = true
  where id = '00000000-0000-4000-c000-00000000c003'
$$, '42501', null, 'a forked copy can never follow again (false -> true)');

-- Immutable provenance -------------------------------------------------------
select throws_ok($$
  update public.hangar_ship_configs set source_config_id = '00000000-0000-4000-c000-00000000c002'
  where id = '00000000-0000-4000-c000-00000000c003'
$$, '42501', null, 'source_config_id cannot be pointed at another config');

select throws_ok($$
  update public.hangar_ship_configs set owner_user_id = '00000000-0000-4000-a000-00000000a002'
  where id = '00000000-0000-4000-c000-00000000c003'
$$, '42501', null, 'owner_user_id cannot be changed to another account');

select throws_ok($$
  update public.hangar_ship_configs set shared_patch_version = '9.9.9'
  where id = '00000000-0000-4000-c000-00000000c003'
$$, '42501', null, 'shared_patch_version is immutable');

-- AUD-005 (D02): the FK action's one-way null -------------------------------
select lives_ok($$
  delete from public.hangar_ship_configs where id = '00000000-0000-4000-c000-00000000c002'
$$, 'the owner can delete a config somebody follows');

select is(
  (select source_config_id from public.hangar_ship_configs where id = '00000000-0000-4000-c000-00000000c004'),
  null, 'the follower copy survives with its source nulled');
select is(
  (select follows_owner from public.hangar_ship_configs where id = '00000000-0000-4000-c000-00000000c004'),
  false, 'a copy that lost its source forks');

select throws_ok($$
  update public.hangar_ship_configs set source_config_id = '00000000-0000-4000-c000-00000000c001'
  where id = '00000000-0000-4000-c000-00000000c004'
$$, '42501', null, 'the null is one-way: a detached copy cannot be re-attached');

select * from finish();
rollback;
