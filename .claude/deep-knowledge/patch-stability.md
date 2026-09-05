# Patch Stability Indicator — sources, quirks, formula location

Spec: `docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md`.
Sampler: `supabase/functions/patch-stability-sample/` (daily via pg_cron, migration `20260906130000`).
Formula: `src/app/news/patch-stability.ts` — the ONLY place. The DB stores raw numbers.

## Reading direction (changed 2026-09-05)

Every component measures BAD NEWS, so `score` is a PENALTY. Nothing user-facing
prints it: `stabilityPercent()` returns `100 − score`, and **every patch starts
at 100 % with bad news subtracting**. Bars are therefore taller when a patch ran
better; the component bars inside the panel are the one exception and are drawn
as explicit deductions (`−17`) in the warning colour. Colour is a traffic light
(`toneOf`): levels 1–2 green, 3 amber, 4–5 red — five hues were not readable as
a scale, and the two middle ones were indistinguishable.

## Sources (all public, verified 2026-09-05)

- **Spectrum forum 190048**: every LIVE patch has a `… LIVE Release Notes` thread and a
  `… LIVE - Hotfix Central …` thread. `POST /api/spectrum/forum/thread/nested` returns the
  first post (Draft.js) plus the **25 top-voted replies** with `votes.count`; the `page`
  parameter is IGNORED (every page returns the same 25), `nested_replies_ids` lists all ids.
  Hotfix Central lists each hotfix as a `blockquote` beginning `►M.D.YYYY:`; STARC ids inline.
  Hotfix Central threads before 4.9 were locked (0 replies) → HF reply metrics comparable
  from 4.9 on only. The release notes carry "contains over N bug and crash fixes … M of which
  originated from the issue council" — **4.8 and 4.9 have the identical sentence** (copy-paste),
  so it is display-only, never scored.
- **RSI status**: `https://status.robertsspaceindustries.com/issues/index.json` → `{pages:{…}}`,
  entries with `is:'issue'`; skip the `0001-01-01` sentinel. `severity` ∈ maintenance / degraded /
  partial / major / major-outage; `createdAt` is `'YYYY-MM-DD HH:MM:SS +0000 UTC'`, `resolvedAt`
  is `'YYYY-MM-DD HH:MM:SS'` (UTC). History back to 2020. "Live Deployment" maintenance rows mark
  exact deploy times.
- **CIG Known Issues**: Zendesk Help Center API
  `https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360056254754.json`
  — ONE evergreen article retitled per patch; entries are anchored `h2/h3` (`id="h_…"`) under
  `h1` sections. Not backfillable: Wayback snapshots all return the stale 3.22 body.

## Dead ends (don't retry without new evidence)

- Issue Council: login + backer wall, SPA shell, no JSON, no mirrors.
- Reddit `.json`: 403 for server IPs since 2026-05-28; `new.rss` still 200 but titles only.
- Comm-Link "full notes" page: SPA shell; wiki API 404s for patch-note ids.
- RSI telemetry XHR: not found; KB article about it is 401.
- No LLM classification (costs money — user decision 2026-09-05). Keyword sentiment was
  tried and rejected: "thank you for the fix" counted as a complaint.

## Operating

- `curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_URL/functions/v1/patch-stability-sample?force=1"` → run now.
- `…?backfill=1` (same header) → (re)register every LIVE line with its end-state (idempotent).
- A verdict needs ≥ 1 sample and ≥ 10 replies (`MIN_SAMPLES` / `MIN_REPLIES`); "early" = < 14 live days.
  The sample floor was 2 until 2026-09-05 — but the first sample already carries a
  velocity (replies ÷ days since LIVE, the same average the end-state path uses), so
  the second only meant a fresh patch showed nothing on the day people look hardest.
- **A superseded line always reads its end-state** (`final_*`), whether or not the
  sampler ever caught a day of it. That is the 4.9 fix: the sampler picked 4.9 up ten
  days AFTER 4.10 replaced it, so it had one stray daily sample on top of a complete
  end-state — the daily path then reported `insufficient` for a line we know
  everything about, and the board showed no stability for it at all. Verified against
  the live tables 2026-09-05: all 12 registered lines now resolve (4.9 → 78 %/green,
  4.10 → 54 %/amber), none `insufficient`.
- The all-time chart (`sc-stability-history`) sits on `patch-board.component.ts`, directly under `<sc-patch-monitor>` and above the search field — not next to any cadence KPIs (that band was removed with the old `patch-notes-section` host). Both it and the monitor hide themselves while a search is running.
- Surfaces that show a verdict: the all-time chart, the corner badge
  (`sc-stability-badge`) on every shipped board card and in the dossier hero, the row
  chip (`sc-stability-chip`), and the full panel inside an expanded LIVE note.
- Live velocity is measured as new replies per day across both threads; historical velocity is release-notes replies over the whole lifetime. The two are deliberately different bases, so older columns in the all-time chart read quieter than the newest one — don't "fix" that by making them match.
- The plain daily path (no query params) is unauthenticated and self-throttled (6 h) — that is what pg_cron calls; a failed throttle lookup fails CLOSED (skips).
