# Appendix: `needs_input`, the per-topic chat and one-tap options

> Read when: an item cannot be driven to a terminal state and has to be parked,
> or queue read (b) returned an answered `needs_input` topic. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

## Non-verifiable / decision-needed items → `needs_input`, never a bare `in_progress`

`in_progress` is a **transient** state, legitimate only while a run is actively
implementing an item *or* while it holds a real review-hold PR (`ship_ref` set).
An item the routine **cannot itself drive to a terminal state** must be parked as
`needs_input` (with a system reply) — never left sitting in `in_progress`. Two
classes qualify:

- **A missing external resource the routine cannot supply** (e.g. a readme.io
  API key). Native/desktop and uploader changes are NOT in this class any more:
  they have their own verify paths in the Scope table (green CI build, headless
  release) and are shipped like everything else — parking them was the
  2026-07-23 starvation cause.
- **It needs an admin decision** — a product/UX call with no sensible default,
  auth/RLS/secrets/privacy, a destructive migration.

**Rule:** a persistent `in_progress` with `ship_ref IS NULL` is an anti-pattern.
`in_progress` is valid only *with* a `ship_ref`; otherwise park it `needs_input`
so it leaves the active queue and the admin can see it's on them.

**Why this is load-bearing (the 2026-07-23 starvation).** The queue is
oldest-first and a run admits only a small batch (up to 3 disjoint-area items).
A bare `in_progress` item (`ship_ref IS NULL`) the routine can't finish jams the
**head** of the queue: the reaper reopens it every ~30 min (it looks orphaned —
see the reaper's `ship_ref IS NULL` guard), oldest-first re-admits it first, and
a usage-limit abort then never reaches the newer, immediately-shippable items
behind it. Three trivially-actionable
feedback-panel web items (`c5b6b13c`, `d6e6fd5f`, `69f3f015`) sat
`processed_at = NULL` for >22 h behind exactly such an item (`a5783bed`, a
wallpaper-app change left `in_progress` + "npm-gate cannot verify") — surfacing
to the user as "3 days, nothing happened".

## Per-topic chat: `needs_input` + system replies

Each topic (`admin_feedback` row) carries a thread in
`public.admin_feedback_messages`. Humans post via RLS (`is_system=false`,
`author_id=self`); the routine posts **system** replies as `service_role`
(`is_system=true`, `author_id=null`) — service_role bypasses RLS.

**Parking an item for a decision** (instead of `rejected`):

```sql
-- 1) ask the question in the thread
insert into public.admin_feedback_messages (feedback_id, is_system, body)
values ('<id>', true, '<the question / rationale / options, markdown>');
-- 2) park the topic
update public.admin_feedback
set status = 'needs_input', processing_note = '<one-line why parked>', processed_at = now()
where id = '<id>';
```

Keep the system reply concrete: state what's blocking, list the options or the
exact decision needed, and (when relevant) link the GitHub issue you opened for
the deeper discussion.

### One-tap answer options (`[[A|B]]`)

When the Rückfrage is a choice between a few discrete answers, END the system
reply with one line that contains nothing but the options marker:

```
Soll das Panel die Farbe behalten oder auf den Standard zurück?

[[Erhalten|Zurücksetzen]]
```

The panel then renders one button per option under the question (concept
2026-09-04, decision r2-options); a click posts the option's text — verbatim,
as a normal human reply — so the resume query above picks the topic up exactly
as it would after a typed answer. The rules are narrow on purpose and mirrored
word for word by `parseAnswerOptions` in `feedback.types.ts`:

- the marker is the **last non-empty line** of the message — a `[[…]]`
  anywhere else is prose and renders as written;
- **two to four** options, `|`-separated, each **1–40 characters**; no line
  breaks and no `|`, `[` or `]` inside a label (that is what the parser
  rejects) — and keep labels plain text, because a label is rendered as a
  button caption, not as markdown;
- word each option as a complete answer you can act on without the question
  ("Erhalten", not "A"); the prose above must still state the question and the
  options in full sentences, because the marker is invisible in SQL and in the
  run report;
- only on the Rückfrage that parks a topic `needs_input` — never on the
  post-ship review reply or a review-hold escalation (nothing resumes those);
- the free-text box stays under the buttons, so an option is never the only
  way to answer. Without the marker nothing changes.

**Resuming a `needs_input` topic.** Each run, after the `open` queue, also pick
up `needs_input` topics whose **latest thread message is human** (the admin
answered — `is_system=false` and newer than the last system reply):

```sql
select f.id
from public.admin_feedback f
join lateral (
  select is_system
  from public.admin_feedback_messages m
  where m.feedback_id = f.id
  order by m.created_at desc
  limit 1
) last on true
where f.status = 'needs_input' and last.is_system = false;
```

For each, read the full thread, then act on the admin's answer: implement (→
ship, `status='shipped'`), or ask a follow-up (post another system reply, stay
`needs_input`). The routine never sets `rejected` (see Guardrails) — an admin
who wants a topic gone deletes it. The stale-claim reaper never touches
`needs_input` (it filters on
`status='in_progress'`), so a parked topic waits patiently for the answer.

## User-submitted feedback (viewers & collaborators) — see [`user-feedback.md`](user-feedback.md)

Non-admins never see the admin panel, so until now they had no way to send
feedback at all; their topics ride this same board and this same chat.
