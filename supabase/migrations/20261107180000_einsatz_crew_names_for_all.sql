-- #938 round 2: every invitee of a shared Einsatz sees who accepted, who declined
-- and who took which slot, BY NAME (owner decision "all", against the
-- recommendation: this lifts the rule that a share does not introduce strangers).
-- NOT YET APPLIED: dry run + supabase/tests/database/einsatz_crew_names.test.sql first.
--
-- Re-created from 20261107120000_real_groups.sql (the LIVE version, group branch
-- included). Two changes only:
--   * 'taker' no longer needs friendship / a common group - only "not blocked
--     between viewer and taker" (a block hides a person in both directions).
--   * 'rsvps' is no longer owner-only: every viewer gets the named list, minus
--     anyone blocked with them. Fields are display name and handle, nothing more.
-- Suspended / unapproved accounts stay out through social_peer_ok() in `valid`.
-- Counts are unchanged (they never named anyone). The callers already refuse a
-- viewer without access, so a non-invitee still gets nothing.
create or replace function public.einsatz_crew_json(p_einsatz uuid, p_owner uuid, p_viewer uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with valid as materialized (
    select r.user_id, r.answer, r.slot_id, r.answered_at, p.display_name, p.username,
           (r.user_id = p_viewer or not public.is_blocked_between(p_viewer, r.user_id)) as named
    from public.einsatz_rsvps r
    join public.profiles p on p.id = r.user_id
    where r.einsatz_id = p_einsatz
      and public.social_peer_ok(r.user_id)
      and (r.user_id = p_owner or public.einsatz_access(p_einsatz, r.user_id))
  )
  select jsonb_build_object(
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'ord', s.ord,
        'label', s.label,
        'taken', v.user_id is not null,
        'mine', coalesce(v.user_id = p_viewer, false),
        'taker', case
          when v.user_id is not null and v.named
          then jsonb_build_object('user_id', v.user_id, 'display_name', v.display_name, 'username', v.username)
        end
      ) order by s.ord)
      from public.einsatz_crew_slots s
      left join valid v on v.slot_id = s.id
      where s.einsatz_id = p_einsatz
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'yes',   (select count(*) from valid where answer = 'yes'),
      'maybe', (select count(*) from valid where answer = 'maybe'),
      'no',    (select count(*) from valid where answer = 'no')
    ),
    'my_answer', (select answer from valid where user_id = p_viewer),
    'my_slot', (select slot_id from valid where user_id = p_viewer),
    'rsvps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'display_name', display_name, 'username', username,
        'answer', answer, 'slot_id', slot_id, 'answered_at', answered_at
      ) order by answered_at)
      from valid
      where named
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.einsatz_crew_json(uuid, uuid, uuid) from public, anon, authenticated;
