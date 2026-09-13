# Appendix: open review-holds

> Read when: queue read (c) returned holds, or (e) returned an answered hold. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

## Surfacing open review-holds (the reaper's mirror image)

A sensitive/red item the routine parks for the admin lives as `in_progress`
**with** a `ship_ref` (its PR) — and after that, **nothing ever looks at it
again**: the reaper skips it by design (`ship_ref IS NOT NULL` — it is an
intentional hold, not an orphaned claim) and the `needs_input`-resume query
never sees it (it is `in_progress`, not `needs_input`). So a green, mergeable
review-hold PR can sit unnoticed for days until the admin happens to ask.

That is exactly what happened to PR #167 (feedback `10cd9fd7`): parked
`in_progress` + `ship_ref` on 2026-07-14 as "green build/tests but sensitive
(auth flow)", it stayed green and `MERGEABLE` for a day and surfaced only when
the admin asked "is anything still open?". The routine had *correctly* not
auto-merged it — but it had also never mentioned it again.

**Every cycle, after the reaper, list open review-holds and report them**
(never auto-merge — sensitive/red is a human call; only make them visible):

```sql
-- open review-holds: sensitive/red items parked for the admin (in_progress WITH a PR)
select id, ship_ref, processing_note, processed_at
from public.admin_feedback
where status = 'in_progress' and ship_ref is not null
order by processed_at asc;
```

Critically: an otherwise-empty `open`/`needs_input` queue is **not** "nothing to
do" while a hold is open. Report each hold — PR link, `processing_note`, age —
instead of taking the silent "No open feedback." stop, so a parked PR the routine
can't merge itself still nudges the admin to review/merge it.

### A hold decays — verify its state, don't just age it

Reporting "PR link + age" makes a claim about the hold's **existence**, not about
its **executability**. Those come apart: `main` keeps moving while the hold
stands still, and a hold can stop being mergeable — or stop being *deployable* —
without anything in `admin_feedback` changing. The age number cannot show that,
so a report built only from the SQL above reads as "still fine, just old" on
exactly the cycle where it has become "no longer works".

**PR #314 (feedback `40d2f925`), 2026-08-02.** Parked on 2026-07-30 as
"berührt auth/RLS + enthält eine noch nicht gepushte Migration". Correctly not
auto-merged — that call is the admin's. But over the 2.6 days it stood, two newer
migrations landed in `main` (`20260730173500_routine_heartbeat.sql`,
`20260731183000_profile_preferred_region.sql`), which made the hold's own
`20260730120000_protected_admins.sql` **out of order**: `db push` refuses a
version older than the newest applied one and demands `--include-all`. Merging it
would not have deployed it. Every cycle in between had dutifully reported "offen
seit X"; none had reported that it no longer runs.

**Every cycle, for each open hold, verify these three and report what you found**
— not just the row:

| Check | How | On decay |
|---|---|---|
| Mergeable + CI | `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup` | `UNKNOWN` means GitHub has not computed it yet — re-poll, never report `UNKNOWN` as if it were a verdict |
| Behind `main` | `git rev-list --count origin/<branch>..origin/main` | bring it up via `gh pr update-branch` (merge-in, **never** force-push) |
| Migration order | the hold's `supabase/migrations/` prefixes vs. the newest in `origin/main` | renumber to a current prefix — and fix the filename echoed in the file's own header comment and in any docs referencing it |

**Repair the mechanical decay; leave the decision alone.** The human call is
*whether to merge* (auth / RLS / secrets / payment, destructive migration, data
deletion) — nothing else about the hold is a decision. Keeping its branch
rebased and its migration applicable is maintenance, and doing it means the
admin's "ja, merge" is executable the moment he says it instead of starting a
fresh debugging round. Still **never** merge a hold, and never `db push` a held
migration: both are the thing being held.

**Past ~24 h, escalate into the thread, not just into the run report.** The run
report is a channel the admin does not routinely read; the board is the one he
looks at. So post a `is_system=true` reply on the hold's own topic naming the PR,
why it is held, the verified state, and the single question he has to answer:

```sql
insert into public.admin_feedback_messages (feedback_id, is_system, body)
values ('<id>', true, '<PR + why held + verified state + the one decision>');
```

Post it only when the verified state has **changed** since the last system reply
in that thread (or when there is none yet) — that converges, so a hold nudges on
real news instead of once per cadence tick. Do **not** flip the row to
`needs_input` to make it visible: that drops the `ship_ref` and turns a real
review-hold into a bare claim the reaper will then reopen.

### A human reply to a hold is an ANSWER — and no queue read could see it

The decay rule above assumes the only thing that happens to a hold is that time
passes. Something far more important can happen: **the admin replies in the
thread.** He has just answered the question the hold was parked for — and until
2026-08-02 nothing in this routine looked at that.

Trace the four queue reads against a held row (`in_progress`, `ship_ref` set):

- **(a)** reads `open` — a hold is not `open`.
- **(b)** reads `needs_input` whose newest message is human — a hold is not
  `needs_input`.
- **(d)** reads `shipped` whose newest message is human — a hold is not `shipped`.
- **(c)** reads holds — but selects only `id, ship_ref, processing_note,
  processed_at`. It never reads the thread, so a reply on a hold is invisible
  to it by construction.

`in_progress` + a human reply was therefore a **black hole**: the one status
where an admin answer produced no effect whatsoever. And it is the status the
routine *itself* chose for exactly the topics where it most wanted an answer.

**Feedback `40d2f925` / PR #314 is the case.** Parked 2026-07-30 17:20 as
"sensitive — auth/RLS". At **19:28 the same day** the admin replied with a
concrete steer: no user may self-promote to admin, a downgrade must go through
an e-mail confirmation, and only admins may appoint admins. That reply sat
unread for three days while every cycle reported the row as "review-hold, offen
seit X" — technically true and completely beside the point. What looked from the
board like a routine that had stopped working was a routine that could not see
the answer.

**The fix is a fifth queue read, (e), run with the others:**

```sql
-- (e) answered review-hold: in_progress topics whose newest message is human
select f.id, f.ship_ref, f.body, m.created_at as answered_at
from public.admin_feedback f
join lateral (
  select is_system, created_at from public.admin_feedback_messages m
  where m.feedback_id = f.id order by m.created_at desc limit 1
) m on true
where f.status = 'in_progress' and m.is_system = false
order by m.created_at asc;
```

Treat an (e) hit as **actionable work, ranked by the reply's age, not the row's**
— the admin has been waiting since he wrote it. Claim it exactly like a (d)
continuation, with `ship_ref` **cleared**:

```sql
update public.admin_feedback set status='in_progress', ship_ref=null, processed_at=now()
where id='<id>' and status='in_progress' and ship_ref is not null returning id;
```

Clearing `ship_ref` is the same load-bearing move as in a continuation: while the
routine owns the topic again it must look like an ordinary claim, so an
interrupted run leaves a bare `in_progress` the reaper heals instead of a fake
hold that strands forever. The PR link is not lost — it is in the thread's own
hold reply. Then read the **full thread**, implement the steer **on the existing
PR branch** (the work is already there; do not start a second PR), re-verify, and
finish normally: ship if the steer resolved what made it sensitive, or re-hold
with a fresh `ship_ref` and a reply saying what is still open.

The general shape, worth remembering beyond this one query: **every status the
routine can park a topic in needs a path back out that a human reply triggers.**
`needs_input` had (b), `shipped` had (d), the archived statuses had the reopen
trigger — `in_progress` had nothing, and that is precisely where the routine
parks the topics it most wants an answer on.
