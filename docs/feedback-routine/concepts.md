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
the engine's bridge protocol, and the Angular route `/concept/<id>` frames it
through the app's static loader `/concept-frame/<id>.html`.

### Why the loader (#330)

The first version framed the function URL directly. That never rendered in
production: Supabase serves every `text/html` GET response of an edge function
on the default `*.supabase.co` domain as `Content-Type: text/plain` with
`content-security-policy: default-src 'none'; sandbox` (checked live on
2026-11-10), so the admin saw the html **source**. `srcdoc`/`blob:` are no way
out either — such documents inherit the app's CSP, which forbids inline
scripts. So the document is rendered on the **app origin**:

1. `/concept/<id>` mints the ticket and frames
   `/concept-frame/<id>.html#<encoded ticketed function URL>`.
2. `vercel.json` rewrites `/concept-frame/:file` to `public/concept-frame.html`
   and gives that path its own header set (CSP with `script-src 'self'
   'unsafe-inline'`, `connect-src https://*.supabase.co`, `frame-ancestors
   'self'`, `X-Frame-Options: SAMEORIGIN`, `no-store`, `noindex`); the app's
   main rule excludes the path and allows `frame-src 'self'`.
3. The loader checks that the fragment is our own `concept-page` URL for the
   id in its path, fetches it as text (no credentials) and writes it into
   itself with `document.write`. The concept's own `<meta>` CSP applies on top.
4. The function bakes the **absolute** function URL and the ticket into the
   injected shim, so `/decisions`, `/reload`, `/heartbeat`, `/draft` (also
   `location.origin + '/heartbeat'`) go to the function (CORS `*`).
   `location.reload()` reloads the loader, which fetches the new iteration.

The path ends in the concept id on purpose: the engine keys its
`localStorage` on `location.pathname`, so each concept keeps its own state.
The fragment never reaches a server, so the ticket stays out of Vercel's logs.
The heartbeat Worker inside the engine fetches the app origin and fails
quietly; the main-thread poll (shimmed) keeps the pill green. Local `ng serve`
does not apply the rewrite — check a hosted page on a deployment.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Table `concept_pages` | `supabase/migrations/20260914160000_concept_pages.sql` | `html`, `decisions` (what the page submitted), `draft` (note mirror), `submitted_at`, `processed_at`, `reload_counter`. Admin-only SELECT, **no client write policy** — the routine and the function write with the service role |
| Edge function `concept-page` | `supabase/functions/concept-page/` | `POST /ticket` (admin JWT → 12-h HMAC ticket + document URL), `GET /:id?t=` (the html with the shim injected), `/:id/decisions`, `/reload`, `/heartbeat`, `/draft`, `/attachments` (501) — the exact protocol the concept engine expects from the local bridge |
| Angular route `/concept/:id` | `src/app/admin/concepts/` | `roleGuard('admin')`; mints the ticket with the session and frames the loader `/concept-frame/<id>.html#<function URL>`. Back link to `/admin/feedback`, "open in new tab" (same loader URL) |
| Loader | `public/concept-frame.html` + `vercel.json` (rewrite + own headers) | Fetches the ticketed document as text and writes it into its app-origin document (#330) |
| Routine tooling | `scripts/routine-gate.mjs concept-publish` / `concept-read` | Publish/republish a page, read the submission back |

The **link shape** the admin sees is always `https://versecompanion-alpha.vercel.app/concept/<uuid>`.
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

   prints `{"id":"<uuid>","url":"https://versecompanion-alpha.vercel.app/concept/<uuid>"}`.
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
POSTs the engine payload to `/decisions`; the function stores it, stamps
`submitted_at` **and echoes the submit into the topic's thread** — one
`admin_feedback_messages` row, `is_system = false`, `author_id` = the admin the
ticket was minted for (the ticket is `<id>.<uid>.<exp>.<hmac>`, so every ticketed
request knows who acts). The body is a compact German summary
(`**Konzept abgeschickt:** „<title>" — <action> (<n> Entscheidungen, <m>
Notizen)` + up to 8 `label → value` bullets + the notes, capped at 2000 chars,
built by `supabase/functions/concept-page/echo.ts`). Because it is a HUMAN
message, the queue's queries **(b)** (`needs_input`, newest message human) and
**(d)** (`shipped`, human reply after `shipped_at`) fire on the next run —
nobody has to type into the thread any more. The run then reads the full
payload and, once it has acted, marks it processed:

```
node scripts/routine-gate.mjs concept-read --id <uuid>
node scripts/routine-gate.mjs concept-read --id <uuid> --mark-processed
```

The echo is posted only for a real submit (`submitted === true`), only when the
row has a `feedback_id`, and never for the engine's replay of a submission the
row already holds (same `submission_id`, or — iterate/implement carry none —
the identical payload while the row is still unprocessed — after
`--mark-processed` the same answer again is a new submit); a replay also leaves
`submitted_at`/`processed_at` alone. The insert is best effort: a failed echo is logged, the submission is
still durable, and the manual path below still works.

**Manual fallback** (no echo, e.g. a page published without `--feedback`, or an
echo that failed): a run has to look on its own —

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
  is always `submitted_at is not null and processed_at is null`. Without the
  echo the routine's queue does **not** see it; check it as part of the topic's
  continuation (query (d)/(b) fire when the admin writes in the thread — ask
  him to, in the reply that posts the link).

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

- The ticket is `base64url(<id>.<uid>.<exp>.<hmac-sha256(<id>.<uid>.<exp>, service-role key)>)`,
  12 h, bound to one id and to the minting admin (`uid`), constant-time compared. Whoever holds a ticketed URL
  can read and write **that** concept until it expires — which is why the
  routine posts only the `/concept/<id>` link.
- The stored html is trusted (routine-written). Page POST bodies land in
  jsonb, capped at 1 MB, never rendered as markup.
- Response headers on the function's document: `Cache-Control: no-store`,
  `X-Robots-Tag: noindex` (the platform replaces the content type and CSP, see
  above). The loader path has its own header set in `vercel.json`; the app's
  CSP allows `frame-src 'self'`.
- The loader iframe keeps `allow-same-origin`: the engine needs `localStorage`.
  That gives the concept html the app origin — acceptable only because the html
  is routine-written trusted content (never browser input). Never publish html
  from anywhere else through `concept-publish`.
