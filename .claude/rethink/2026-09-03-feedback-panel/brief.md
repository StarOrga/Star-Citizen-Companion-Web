# Rethink Brief — Feedback panel of a small web app (2026-09-03)

This brief is deliberately free of implementation details. It is the ONLY
context the fresh-phase ideation receives.

## What the product is

A hobby-scale companion web app for a space game, run by one developer-admin
("the admin"), with a handful of collaborators and a growing number of
ordinary signed-in users ("viewers"). The app has a built-in feedback system
with an unusual twist: an automated developer routine (an AI coding agent on
the admin's PC, running every ~20 minutes) picks up open feedback topics,
implements them, ships them, and writes back into the topic's thread. When
the routine cannot decide something, it asks the admin a question in the
thread and parks the topic until the admin answers.

So the "team" behind the feedback board is mostly a machine, and the admin's
job on the board is steering: raise topics, answer the routine's questions,
sign off shipped results, release user-filed topics to the routine, redirect a
topic into a GitHub issue, or decline it with a reason the user gets to read.

## Three audiences

1. **Viewer** (any signed-in user): writes feedback (text, Markdown,
   screenshots, tags the app area it is about), later sees what became of it
   with a coarse status only: "in progress" / "question for you" / "done" /
   "not done (with reason)". Can answer a question the team explicitly asked
   them. Never sees the admin-to-routine conversation. Sees a "news" badge
   when something on one of their topics changed.
2. **Collaborator**: today identical to a viewer on this surface.
3. **Admin** (the target of this rethink, by far the most important): opens
   the board from a floating button on any page as a docked chat-style
   window (roughly 480 by 680 px, resizable, maximizable to near-fullscreen)
   or as a full page. Everything below is about the admin's surface.

## What the admin surface must let the admin do

Every capability below must survive, but may be re-shaped, merged, renamed or
extended.

Raise and write
- Create a new topic in seconds (text, Markdown, pasted or dropped
  screenshots, optional app-area tag pre-filled from the page they are on);
  drafts survive a reload and are account-bound.
- Reply into any topic's thread; a reply on a finished topic reopens it.

React to what waits on the admin
- Answer the routine's open question on a topic. This is the single most
  frequent action; the routine cannot continue until it is answered.
- Sign off a shipped result or an issue hand-off: "accept, done" or "resume
  the conversation" (a reply that also sends the topic back to the routine's
  queue).
- Release a user-filed topic to the routine (user topics are held back until
  an admin looks at them).
- Answer or message the author of a user-filed topic through a separate,
  user-visible channel; optionally mark that message as a question that parks
  the topic until the user answers.

Steer and decide (rare, deliberate)
- Order a GitHub issue for a topic instead of an implementation. Undoable
  while the routine has not delivered yet.
- Decline a user-filed topic with a mandatory reason (six canned reasons
  pre-fill the text); the user reads it.
- Delete an admin's own topic.

Find and scan
- See active topics vs. finished ones (finished = signed off, issue-created,
  declined, legacy-rejected), with a link to the PR or issue on finished ones.
- Distinguish admin-raised topics from user-filed ones; a marker says when a
  user topic still waits for release.
- Narrow by status, by author, by "mine / other admins / all", by kind of
  pending step ("questions" vs. "sign-offs").
- Full-text fuzzy search across topic text, thread replies, author, and
  stable topic numbers (#123); results explain when the hit is inside the
  thread rather than the title.
- Expand or collapse a topic (the resting state is a one-line head: number,
  title, status pills, author); expand or collapse all at once.
- Every topic has a stable number the admin can quote back.
- Threads fold to "first message ... last message" with a count of hidden
  ones in between.

Understand the state
- Per topic, which of these it is in: to-do (waiting for the routine),
  routine is working, question open for the admin, question open for the
  user, answered (routine has to pick it up again), waiting for the admin's
  sign-off (shipped or handed to an issue), continued after ship, done,
  issue created, declined, rejected. Today these are shown as a row of
  same-looking pills and the admin says they do not read as a chain.
- See whether the routine's PC is currently reachable (the board title is
  tinted green, red or grey).
- A small celebration when the routine shipped something since the last look.
- A progress/analytics view: share done this month and all time, counts per
  stage, median time to ship, question rate, ships per week over 12 weeks,
  and an annotated lifecycle map with live counts. The admin is happy with
  this view; it may stay as it is or be re-homed, but must not be lost.

## Today's admin surface, in one paragraph (no implementation detail)

Three top-level views. An "Overview": a list of topics with two segmented
switches (active/finished and admins/users), a search pill, a "filters"
disclosure that reveals status chips and author chips, a totals line, dated
groups of collapsible cards, and a "new topic" bar at the bottom. A
"Work-through" run: one card at a time with a progress rail, skip/done, swipe
on touch, and two chip rows above it for scope and kind; it ONLY contains the
routine's open questions and pending sign-offs. And "Progress": the
analytics. On the live board today the Work-through run was EMPTY while the
Overview held six active topics. The run has nothing most of the time, the
overview has everything.

## The gap (in the admin's words, paraphrased)

- Function and the window's footprint are "95 percent perfect". Do not touch
  the shell.
- Inside: "partly awful". Too cluttered. Filters are fiddly (tiny chips) and
  some are hard to reach. The three views look nice but do not get used,
  because Work-through and Overview differ too little in practice.
- The status and dimension model is itself confusing: too many equal-looking
  dimensions (active/finished, admins/users, status, author, scope, kind) and
  inside them statuses that do not read as a chain.
- Explicit ask: question the whole concept. Does Work-through vs. Overview
  even make sense? What does a viewer want, a collaborator, an admin? The
  admin is the audience that matters most.

## Success criteria (agreed)

1. The first topic is visible immediately. The controls step back behind the
   content.
2. One click to act: whatever waits on the admin is the first thing in reach,
   with the answer box right there, without filtering or scrolling.
3. (implied) The state of a topic reads as a chain, a place on a path, not as
   a pile of pills.
4. (implied) Fewer, bigger, reachable controls instead of chip rows.

5. (added by the admin mid-run) "What's new?": see what the routine shipped
   recently, grouped by day and with the LAST day on top, so the admin can
   go and look at the new things in the app instead of just reloading the
   page and guessing. Today the finished pile is only a flat archive.

## Biggest frustration

Opening the board and not being able to tell at a glance what to do next.
The work is hidden behind the wrong view and behind filters.

## Hard no-gos

- Keep every capability listed above (re-shaping is fine, losing is not).
- The window shell stays: floating button, docked size, resize, maximize.
- Localised UI (German and English), touch-friendly targets, works in the
  480 by 680 docked window AND near-fullscreen AND on a phone as a full
  sheet.

## Demolition corridor (agreed with the admin)

The panel's interior may be torn down completely: views/tabs, toolbar,
filters, card anatomy, run layout, status presentation, all of it. The status
vocabulary may be regrouped or renamed as long as every distinct state above
stays distinguishable. The shell (button, docking, sizing) and the
viewer-facing panel stay as they are unless an approach needs a small,
justified change there (flag it).
