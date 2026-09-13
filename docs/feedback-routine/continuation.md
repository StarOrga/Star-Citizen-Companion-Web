# Appendix: the post-ship review reply and continuations

> Read when: an item just shipped, query (f) owes a review reply, or query (d) /
> (e) handed you a continuation. Core contract: [`../feedback-routine.md`](../feedback-routine.md).

## Post-ship review & continue (the review step)

Shipping is **not** the end of the conversation. The moment a topic ships the
admin usually wants to **look at the change live**, and often has a follow-up
("close, but move it left"; "now do the same for X"). Two mechanisms make that a
first-class step of the routine instead of a dead end — and the loop is built to
**converge** (it never re-fires on the routine's own messages) and to **self-heal**
(an interrupted continuation is reaped and redone without ever double-shipping).

### 1) On every ship, post a review reply (per-item procedure step 5b)

After the ship UPDATE **and after the deploy is verified reachable** (see the
next subsection — that ordering is the whole point) — for a fresh ship **and** for
a continuation re-ship, and also when marking an already-merged PR shipped —
insert a `is_system=true` reply that (a) links the PR, (b) says in one line what
changed, (c) points at where to see it **live**, and (d) invites the admin to
reply in-thread to continue. The live pointer depends on the area:

- **web** (`src/`, `public/`) → `https://sc-companion.vercel.app` + the exact
  route/view the change touches (e.g. `/hangar`, the admin feedback panel), named
  only once the Production deployment for the merge SHA reports `success`.
- **migration / edge function** → it is live once `db push` / `functions deploy`
  ran; name where its effect shows.
- **desktop** (uploader / Starscape) → live only after the CI build + the
  `desktop_releases` row; point at the release/channel to update.

#### The review reply must not be posted before the change is reachable

**Merging is not shipping.** The squash-merge only *starts* the production build.
Telling the admin "live ansehen" one second later is a claim the routine has not
checked — and it has already burned us:

> Topic `ae9f8cba` (PR #534) merged at 22:46:06Z. The review reply went out at
> 22:46:42Z saying *"Vercel braucht nach dem Merge ~1 Min"*. The admin answered
> **75 seconds later**: *"ich sehe wieder nochh nix"*. He was right — and the truth
> was worse than the routine assumed: **30 minutes after the merge there was still
> no Production deployment carrying the merge SHA at all**, and production was two
> merges behind. The estimate was wrong twice over, because the four production
> deploys before it had taken 5.3 / 6.2 / 8.2 / 9.5 minutes. Never one.

**And then it burned us again, the same night, with the rules above already
written down** — which is why step 5b is no longer only prose:

> Topic `a33ba528` (PR #531) merged at 22:02:38Z. The review reply went out
> **68 seconds later**, again with *"Vercel braucht nach dem Merge ~1 Min"*, and
> again without the PWA caveat. The admin looked at 22:06:56Z and answered *"ich
> sehe live 0 unterschied?!"*. He was right: the Production deployment for the
> merge SHA did not report `success` until **22:12:10Z** — five minutes after he
> looked, nine and a half after the merge. The change itself was fine and is live.

Twice in one night is not forgetfulness, it is a **process defect**: at the end of
a long ship the correct reply costs a poll loop and the wrong one costs nothing,
so under pressure the wrong one wins every time. A rule that is only prose in a
2000-line runbook loses that race. So the rule now has a body:

```bash
npm run verify:ship-live -- --sha <merge-sha> --pr <PR-Link> \
  --changed "<ein Satz>" --route admin/feedback --probe <new i18n key>
```

`scripts/verify-ship-live.mjs` does the waiting and **prints the reply to post**.
It emits the ✅ wording *only* after it has observed the deployment `success` (and,
when `--probe` is given, seen the new string actually served); otherwise it prints
the ⏳ "merged, not live yet" reply and exits non-zero. The observed `HH:MM` and the
PWA caveat are baked into its output, so the correct reply is now the cheap one and
a ✅ nobody verified cannot be produced by accident. Pass `--route` **without** the
leading slash — Git Bash rewrites a leading-slash argument into a Windows path.

So step 5b runs as four rules, in this order:

1. **Wait for the production deployment that carries the merge SHA.** After the
   squash-merge *and* after every out-of-band deploy (`db push`, `functions
   deploy`, the `*-v<ver>` tag), poll until that deployment reports `success`,
   bounded at **15 minutes** (poll every ~30 s). Match on the **merge SHA** — "the
   site responds" proves nothing, the site was up the entire time it was serving
   the old build:

   `npm run verify:ship-live` (above) is the sanctioned way to do this — it polls
   on a 30 s interval to a 15-minute bound and hands you the finished reply. The
   calls it makes, if you ever need them by hand:

   ```bash
   SHA=$(git rev-parse origin/main)   # the squash-merge commit
   gh api "repos/StarOrga/Star-Citizen-Companion-Web/deployments?sha=$SHA&environment=Production" --jq '.[].id'
   gh api "repos/StarOrga/Star-Citizen-Companion-Web/deployments/<id>/statuses" --jq '.[0].state'
   # state: success | failure | in_progress
   ```

   An **empty deployment list is a negative result, not "still building"** — a
   production build can be skipped or never start, which is exactly what happened
   to #534. Keep polling to the timeout, then treat it as not-ready. Where a cheap
   content probe exists it is the stronger confirmation: fetch an **unhashed**
   asset the change touched, with the service worker bypassed, and grep for a
   string the merge introduced —
   `curl -s 'https://sc-companion.vercel.app/i18n/en.json?ngsw-bypass=true' | grep '<new key>'`.
2. **Only then post the reply — worded as a measured fact, never as a promise.**
   "ist live seit 22:53" is checkable and was observed; "Vercel braucht nach dem
   Merge ~1 Min" is a guess the admin has to test on our behalf. **Never state a
   deploy duration the routine did not measure**, and do not write "gleich", "in
   Kürze" or "~1 Min" at all.
3. **Not ready inside the timeout, or failed → post the other reply.** No
   "✅ Geshipped … live ansehen". Say that the merge landed and that the deployment
   is still building / failed, and link the deployment or CI run so the admin can
   watch it himself instead of reloading a page that cannot change yet. The topic
   still counts as **shipped** — the merge happened and the work is done; this rule
   governs the wording and the timing of the reply, it is **not** a reason to
   re-hold the item, skip the ship UPDATE, or leave it `in_progress`.
4. **Every web reply carries the PWA caveat — prominently, not as a footnote.**
   The app is a PWA: `ngsw` serves the **cached shell** to anyone who has been on
   the site before, which is always the admin. So even once the deployment is
   genuinely live he keeps seeing the old version until a hard reload
   (`Strg+Shift+R`) or `?ngsw-bypass=true`. This is a recurring source of "ich sehe
   nix" reports that look exactly like a failed deploy and are not one, so it
   belongs in **every** review reply for a `src/`/`public/` change — not only once
   something already looks wrong.

```sql
-- step 5b: post the review reply after the ship UPDATE *and* the verified deploy (service_role)
insert into public.admin_feedback_messages (feedback_id, is_system, body)
values ('<id>', true, '<review reply, markdown — PR link + what changed + verified live state + invite>');
```

Examples (German — the admin's language; the routine's system replies address the
admin directly). **Deployment verified `success`:**

> ✅ Geshipped in <PR-Link>. Geändert: <ein Satz>.
> Live seit <HH:MM> auf `https://sc-companion.vercel.app/<route>` — das Deployment
> für die Merge-SHA ist geprüft. Siehst du noch den alten Stand: die Seite ist eine
> PWA und liefert dir zuerst den gecachten — einmal `Strg+Shift+R`, oder
> `<route>?ngsw-bypass=true` aufrufen.
> Passt etwas nicht, oder willst du weiter dran arbeiten? Antworte einfach hier im
> Thread — die Routine nimmt das Thema dann automatisch wieder auf.

**Deployment still building after the timeout, or failed** — the merge is still a
ship, but the admin is *not* sent to look at something that is not there:

> ✅ Gemerged in <PR-Link>. Geändert: <ein Satz>.
> ⏳ Das Production-Deployment ist noch nicht durch (Stand <HH:MM>,
> <Deployment-/Run-Link>) — ich schicke dich bewusst nicht auf eine Seite, auf der
> die Änderung noch nicht drauf ist. Sobald es durch ist:
> `https://sc-companion.vercel.app/<route>`, und weil die Seite eine PWA ist dann
> einmal `Strg+Shift+R` (sonst zeigt sie dir den gecachten Stand).
> Passt etwas nicht, oder willst du weiter dran arbeiten? Antworte einfach hier im
> Thread — die Routine nimmt das Thema dann automatisch wieder auf.

### Review reply as a checkpoint — query (f)

The ✅ reply is posted only after the Production deployment for the merge SHA
was observed green, up to 15 minutes after the merge — and that polling is the
last thing a run does, exactly where a run dies when the usage limit hits
(2026-09-06 13:07Z: three PRs merged, the run died at 98 % mid-verification, no
reply ever posted). The reply must therefore not depend on the same run
surviving (concept 2026-09-13, 6d):

- The UPDATE that marks a topic `shipped` also sets `review_reply_pending =
  true` (migration `20260913131500`).
- The run that posts the review reply clears it in the same step
  (`update admin_feedback set review_reply_pending = false where id = <id>`).
- **Query (f)** — `status = 'shipped' and review_reply_pending`, oldest
  `shipped_at` first — is read **first thing in every working run**, before
  new items are claimed. For each hit the run **re-verifies the deployment**
  (`npm run verify:ship-live -- --sha <merge sha> --pr <url> …`; never trusts
  the old merge — Vercel may have rate-limited it) and posts the ✅ or the ⏳
  reply the dead run owed, then clears the flag. (f) counts as actionable work
  for the gate.

### 2) An admin reply to a shipped topic reopens it as a continuation

The queue read gains a fourth query, **(d)**: shipped topics whose newest thread
message is a **human** reply posted **after** `shipped_at`.

```sql
-- (d) continue-after-ship: shipped topics the admin replied to after the ship
select f.id, f.body, f.shipped_at, f.ship_ref
from public.admin_feedback f
join lateral (
  select is_system, created_at
  from public.admin_feedback_messages m
  where m.feedback_id = f.id
  order by m.created_at desc
  limit 1
) last on true
where f.status = 'shipped'
  and last.is_system = false
  and last.created_at > coalesce(f.shipped_at, f.processed_at, f.created_at)
order by f.created_at asc;
```

Because the routine's own review reply is `is_system=true`, a shipped topic
re-enters the queue **only** when a *human* posts after the ship — so the loop
converges: ship → review reply → quiet; admin replies → reopened → ship → review
reply → quiet.

### How a continuation is worked (the robust part)

A continuation is the same per-item procedure with three deltas, chosen so an
interrupted continuation self-heals exactly like a first-time item and **never
double-ships**:

- **Claiming clears `ship_ref`.**
  `update admin_feedback set status='in_progress', ship_ref=null, processed_at=now()
  where id=<id> and status='shipped'` (atomic single-flight; zero rows → another run
  took it, skip). Clearing `ship_ref` is load-bearing: it keeps the stale-claim
  reaper correct. A continuation in flight then looks exactly like any other
  interrupted claim (`in_progress`, `ship_ref IS NULL`), so if the run dies the
  reaper reopens it on a later tick — a bare `in_progress` is *never* misread as a
  review-hold and stranded. The previous PR link is not lost: it still lives in the
  thread's review reply. Claiming also flips the topic out of the Archive tab back
  into Active (`in_progress` = "In Arbeit"), so the admin sees the routine is on it.

- **Deterministic per-round branch** `feat/feedback-<short-id>-<trigger-msg-short>`,
  where `<trigger-msg-short>` is the first 8 chars of the id of the **triggering
  message** (the newest human reply newer than `shipped_at`). This is deterministic
  — a reaped redo recomputes the same branch and the STEP 3 idempotency check
  reconciles any PR the interrupted run already opened, unchanged — yet **distinct
  from the already-merged base branch** `feat/feedback-<short-id>`, so the base PR
  can never false-positive the "merged PR → mark shipped" short-circuit and skip the
  follow-up work. Each further round has a newer triggering message → a fresh branch,
  so multi-round back-and-forth stays clean.

- **Re-ship bumps `shipped_at`.** The green ship UPDATE sets `shipped_at=now()` and
  the new `ship_ref`, then posts a fresh review reply (step 5b). That pushes
  `shipped_at` past the triggering message, so query (d) no longer matches — unless
  the admin replied again meanwhile, which correctly starts the next round.

A continuation is otherwise a normal item: park it `needs_input` if the follow-up
needs a decision, hold it as a review-PR if it is sensitive/red, and count it toward
the batch cap and area-disjointness like any web item (its area is whatever files
the follow-up touches — usually the same subtree as the original, so two
continuations of the same feature serialise).

### Recognising a reaped continuation

After the reaper reopens a stranded continuation it is `status='open'` (not
`shipped`), so query (a) picks it up, not (d). It is still recognisable as a
continuation — and worked as one — by the same signal: **`shipped_at IS NOT NULL`
and a human message newer than `shipped_at`**. STEP 3's implementation therefore
checks that signal first: a continuation uses the continuation branch and does
**not** treat the already-merged base PR as "done"; a first-time `open` item
(`shipped_at IS NULL`) is unaffected.
