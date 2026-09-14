# Concept pages on the website

Appendix to [`../feedback-routine.md`](../feedback-routine.md). Read it when the admin
asks for a concept page, a concept iteration, or answers one — or when a topic is
too open for a text reply and needs the interactive `/concept` format.

## Why this exists

Admin feedback #224 (`dbdb2ffe`): the routine had posted a text-only concept into
the thread, and the admin asked for a link on the website — reachable only by
admins, and only through the link posted in the thread — on which he can work
through the concept exactly like the local `docs/concepts/*.html` pages
(choices, notes, submit). The local pages need a Python bridge on his machine;
the routine has none. So the page is **hosted**: the html lives in
`public.concept_pages`, the `concept-page` edge function serves it and answers
the engine's bridge protocol, and the Angular route `/konzept/<id>` frames it.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Table `concept_pages` | `supabase/migrations/20260914160000_concept_pages.sql` | `html`, `decisions` (what the page submitted), `draft` (note mirror), `submitted_at`, `processed_at`, `reload_counter`. Admin-only SELECT, **no client write policy** — the routine and the function write with the service role |
| Edge function `concept-page` | `supabase/functions/concept-page/` | `POST /ticket` (admin JWT → 12-h HMAC ticket + document URL), `GET /:id?t=` (the html with the shim injected), `/:id/decisions`, `/reload`, `/heartbeat`, `/draft`, `/attachments` (501) — the exact protocol the concept engine expects from the local bridge |
| Angular route `/konzept/:id` (alias `/concept/:id`) | `src/app/admin/concepts/` | `roleGuard('admin')`; mints the ticket with the session and renders the document in an iframe. Back link to `/admin/feedback`, "open in new tab" |
| Routine tooling | `scripts/routine-gate.mjs concept-publish` / `concept-read` | Publish/republish a page, read the submission back |

The **link shape** the admin sees is always `https://sc-companion.vercel.app/konzept/<uuid>`.
Never post the function URL (it carries the ticket) — the app mints a fresh one on
every open.

## Publishing a concept (routine side)

1. Build the page in `docs/concepts/<date>-<slug>.html` from the newest committed
   page as donor (engine verbatim, content replaced — see memory
   `concept-page-donor-pattern`). Keep the `<meta http-equiv="Content-Security-Policy">`
   line: `connect-src 'self' … https://*.supabase.co` is what lets the hosted
   page reach the function. Every choice must be inside a `[data-decision]`
   container (`data-label` = its title) with a radio group `name="dec-<id>"`,
   every free text a `textarea[data-comment]` — that is what
   `collectDecisionDecisions()` + `allFields` pick up.
2. From the **primary checkout** (the token lives there):

   ```
   node scripts/routine-gate.mjs concept-publish \
     --file docs/concepts/2026-09-14-layout-bewaffnung.html \
     --title "Layout Bewaffnung — Erstiteration" \
     --feedback <admin_feedback.id>
   ```

   prints `{"id":"<uuid>","url":"https://sc-companion.vercel.app/konzept/<uuid>"}`.
3. Post the `url` as a SYSTEM reply in the topic's thread and park the topic
   `needs_input` (the admin has to act). Say in one line what the page asks.
4. **Iteration:** edit the html, run `concept-publish --id <uuid> --file … --title …`.
   That replaces the html and bumps `reload_counter`; a page that is open in the
   admin's browser polls `/reload` every 3 s and reloads itself — the same
   behaviour as the local bridge after Claude appends an iteration. Same id,
   same link, nothing new to post (a short "Iteration 2 ist drin" reply is
   still polite).

## Reading the answer back

The page's submit (`Zur nächsten Iteration` / `Mit Feedback implementieren`)
POSTs the engine payload to `/decisions`; the function stores it and stamps
`submitted_at`. Nothing pushes it to the routine — a run has to look:

```
node scripts/routine-gate.mjs concept-read --id <uuid>
node scripts/routine-gate.mjs concept-read --id <uuid> --mark-processed
```

- `decisions.submitted === true` and a `submitted_at` newer than the last
  iteration → the admin answered. `decisions.action` is `iterate` or `implement`.
- `decisions.decisions[]` lists every `[data-decision]` block with its label;
  the chosen radio values sit in `decisions.allFields` under `dec-<id>`;
  free text in `decisions.comments[]` (`{id, text}`).
- `--mark-processed` sets `processed_at`. The page polls `/decisions` every 5 s,
  sees `_processed_at` newer than its submit and — once `/reload` advanced or
  after 5 min — returns its panel to "ready". So: read, **then** republish the
  next iteration, **then** mark processed (or mark processed right away when
  the answer closes the concept).
- A new submit resets `processed_at` to null, so "submitted and not processed"
  is always `submitted_at is not null and processed_at is null`. The routine's
  queue does **not** see it yet; check it as part of the topic's continuation
  (query (d)/(b) fire when the admin also writes in the thread — ask him to,
  in the reply that posts the link).

## What the hosted page cannot do (v1)

- **Attachments**: `/attachments` answers 501; the page shows its own
  "nicht unterstützt" copy and keeps the note text. Images still go through the
  feedback thread.
- **Finalize wizard** (issues / ship / dispose): the engine still renders it on
  a final-report iteration, and the payload lands in `decisions` like any other
  — but nothing runs it. Treat `action: 'finalize'` as a plain decision.
- The "Claude verbunden" pill is always green: the function answers
  `/heartbeat` itself. It means "the page can save", not "a run is live".

## Security notes

- The ticket is `base64url(<id>.<exp>.<hmac-sha256(<id>.<exp>, service-role key)>)`,
  12 h, bound to one id, constant-time compared. Whoever holds a ticketed URL
  can read and write **that** concept until it expires — which is why the
  routine posts only the `/konzept/<id>` link.
- The stored html is trusted (routine-written). Page POST bodies land in
  jsonb, capped at 1 MB, never rendered as markup.
- Response headers on the document: `Cache-Control: no-store`,
  `X-Robots-Tag: noindex`, `Content-Security-Policy: frame-ancestors <app origins>`.
  The app's own CSP (`vercel.json`) allows `frame-src https://*.supabase.co`.
