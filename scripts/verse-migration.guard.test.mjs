// Static guards for 20261023100000_verse_briefing_cinematic.sql - the answer of the
// "Sternbild erkennen" challenge must not leak (security review 2026-10-23).
// No database here: these assert the SQL text keeps the invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20261023100000_verse_briefing_cinematic.sql', import.meta.url),
  'utf8',
);

/** Body of `create or replace function public.<name>(` up to its closing `$$;`. */
function fn(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `function ${name} missing`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  return sql.slice(start, close + 3);
}

test('claim_newship answers guess_first before comparing the class (no class oracle)', () => {
  const body = fn('verse_claim_newship');
  const gate = body.indexOf("return 'guess_first'");
  const compare = body.indexOf('lower(v_class) <> lower(');
  assert.ok(gate > 0 && compare > 0, 'both branches present');
  assert.ok(gate < compare, 'guess gate must run before the class comparison');
});

test('verse_earn_star refuses cx-newship, cx-guess and comet', () => {
  const body = fn('verse_earn_star');
  for (const key of ['comet', 'cx-guess', 'cx-newship']) {
    assert.match(body, new RegExp(`p_star_key = '${key}'`), key);
  }
});

test('the answer name comes from the distractors population, never from the class name', () => {
  assert.doesNotMatch(sql, /replace\(\s*v_class\s*,\s*'_'/, 'no class-name-derived answer name');
  const answer = fn('verse_guess_answer');
  const candidates = fn('verse_guess_candidates');
  for (const filter of [
    'not s.is_variant',
    "name_localized !~ '^[@!]'",
    "name_localized !~* '(edition|special|template)$'",
    'b.is_current',
  ]) {
    assert.ok(answer.includes(filter), `answer filter ${filter}`);
    assert.ok(candidates.includes(filter), `distractor filter ${filter}`);
  }
});

test('answer-bearing helpers are not executable by clients', () => {
  for (const sig of [
    'verse_guess_answer(text)',
    'verse_guess_candidates(text)',
    'verse_guess_state(uuid, text)',
    'verse_comet_state(uuid, text, timestamptz)',
  ]) {
    assert.ok(
      sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`),
      `${sig} must be revoked from clients`,
    );
  }
  assert.match(sql, /revoke select on public\.verse_constellations from anon, authenticated;/);
  assert.doesNotMatch(sql, /grant select \([^)]*class_name/);
});

test('streak: only LIVE lines before the newest LIVE patch can break the series', () => {
  const body = fn('verse_explorer_state');
  assert.match(body, /count\(\*\) filter \(where l\.live_at <= now\(\)\) over \(\)\)::int as n_live/);
  assert.match(body, /order by l\.live_at asc nulls last/, 'LIVE lines must sort before lines without a LIVE date');
  assert.ok(
    body.includes('elsif r.live_at is null or r.live_at > now() or r.ord >= r.n_live then'),
    'not-yet-LIVE lines and the newest LIVE line are exempt from the break branch',
  );
  assert.doesNotMatch(body, /elsif r\.ord = r\.n then/, 'the exemption must not hang on the last row overall');
});

test('every new table has RLS enabled', () => {
  for (const t of ['verse_patch_announcements', 'verse_constellation_guesses']) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
  }
});
