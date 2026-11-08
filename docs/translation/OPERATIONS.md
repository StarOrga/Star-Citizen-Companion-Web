# Game-string translation — operations

Contract: [ARCHITECTURE.md](ARCHITECTURE.md). Functions: `supabase/functions/translate-orchestrator/`
(job state machine) and `supabase/functions/translation-overlay/` (signed-in delivery).

## Secrets

| Secret | Purpose |
|---|---|
| `TRANSLATE_ANTHROPIC_API_KEY` | The only key the orchestrator uses. Create it in its **own Console workspace** with a **spend limit at or below the monthly credit** and **auto-reload off**. Never reuse the `sc-events-sync` key. Absent: jobs end `failed` with `translate.no_api_key`. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (+ optional `R2_BUCKET`) | Already set for `ingest-catalog`; the orchestrator writes `translation-tm/`, `translation-overlay/` and temporary `translation-work/<job>/` objects with them. |

```
supabase secrets set TRANSLATE_ANTHROPIC_API_KEY=sk-ant-...
npm run functions:deploy
```

## Running a tick by hand

pg_cron calls `op: "tick"` every 10 minutes with the anon key; `ingest-catalog` also fires one
after enqueuing jobs. Manually (service role, or an admin JWT):

```
curl -X POST "$SUPABASE_URL/functions/v1/translate-orchestrator" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"op":"tick"}'
```

The response lists every open job with `from` and `to` status. One tick moves each job at most one
step; a batch usually takes minutes to hours, so expect many ticks per job. Nothing is spent unless
`translation_settings.enabled` is true.

## Approve, cancel, estimate

All with an admin JWT or the service role:

```
{"op":"approve","job_id":"<uuid>"}                      # awaiting_approval -> queued (overrides both caps)
{"op":"cancel","job_id":"<uuid>"}                       # any open job; in-flight batches are cancelled
{"op":"estimate","build_id":"<uuid>","lang":"de","mode":"delta","base_build_id":"<uuid>"}   # dry run, no writes
{"op":"start_full","build_id":"<uuid>","lang":"de"}     # whole-gap job, ALWAYS awaiting_approval
```

Modes: `delta` (automatic) translates only keys whose English is new or changed against the
previous build; unchanged untranslated back catalogue is never sent. No base build (or its R2
shards missing) ends the job `skipped` (`translate.no_base_build` / `translate.base_build_missing`).
`full` exists only through `start_full`.

## Failure keys (`translation_jobs.error`)

`translate.no_api_key` · `translate.english_missing` · `translate.lang_unknown` ·
`translate.plan_missing` · `translate.results_missing` · `translate.internal` (5 failed attempts of
one step) · `translate.nothing_to_do` (skipped).
A transient error (network, R2) only bumps `stats.attempts`; the next tick retries the same step.
A crash between the claim and the batch creation is retried after 15 minutes; in the worst case it
leaves one orphan batch (visible in the Console) that is paid but unused.

## Rough cost (batch prices: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok)

| Case | Order of magnitude |
|---|---|
| German full gap (`start_full`, tiered Opus for lore / Sonnet for the rest) | about 40 USD |
| Delta of one upload | about 1–5 USD |
| 5 % judge sample + one post-edit pass | a few percent on top |

The estimate stored on the job is a forecast (measured ratios: input ≈ 0.90 tokens/char, output
≈ 0.87 × English chars for German, Opus +30 % thinking). `spent_usd` and `translation_ledger` book
the real cost from each batch result's `usage` (cache read 0.1×, 1 h cache write 2×).
Ledger rows are written before the status moves on, so a crash can only over-count a month, never
under-count it.

## Community seed ops (concept 2026-11-08)

All with an admin JWT or the service role (`sync_sources` also with the publishable key, for pg_cron):

```
{"op":"import_seed","source_id":"rjcncpt"}   # pack -> TM (community), coverage, learning, republish latest overlay
{"op":"sync_sources"}                        # every enabled licensed|permitted source: upstream changed? re-import
{"op":"learn","lang":"de"}                   # learning backfill (hook; no-op until the learning module is wired)
{"op":"draft_outreach","source_id":"thord82"}# maintainer message draft (status draft; never sent by code)
```

- `import_seed` answers `409 translate.source_not_permitted` unless the source is `licensed` or `permitted`
  and enabled (fr / zh-Hans / es until a permission is recorded), `409 translate.no_live_build` /
  `translate.english_missing` without a published LIVE English table, `502 translate.source_*` when the
  upstream fetch fails (`source_fetch_<http status>`, `source_too_large`, `source_asset_missing`,
  `source_entry_missing`). Re-running it with an unchanged pack changes nothing.
- Cron `translate-orchestrator-sync-sources` runs `sync_sources` daily at 04:17 UTC
  (migration `20261108170000`); roll back with `select cron.unschedule('translate-orchestrator-sync-sources')`.
  The marker per source is stored in `translation_sources.last_seen_commit`; an optional
  `GITHUB_TOKEN` function secret raises the GitHub API rate limit (60/h unauthenticated is enough for 8 sources).
- The seed itself is token-free. The arbiter, revision, learning and research steps spend through the
  normal ledger and caps (arbiter model `translation_settings.arbiter_model`, web research
  `web_research_cap_usd`, default 5 USD per month).
- Memory: a pack is ~12 MB; it is decoded once and parsed line by line. The 42kit zip is downloaded whole
  (cap 120 MB) and only the one entry is inflated; if that ever hits the edge memory limit (546), stage the
  entry elsewhere or switch the source to the `StarCitizenToolBox` raw file.
- Outreach: `draft_outreach` creates or refreshes the single open draft of a source. Approval is
  `approve_translation_outreach` (protected admins only), sending is manual (copy, then
  `mark_translation_outreach_sent`); recording the answer `granted` sets an `awaiting_permission` source to
  `permitted`, after which `import_seed` works. Plan and recipient table: [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md).

### Cost of the seed

| Case | Order of magnitude |
|---|---|
| `import_seed` / `sync_sources` | 0 USD (no model call) |
| German with seed: the remaining AI gap (about 6 % uncovered text + ~2 400 placeholder rejects) | about 2–5 USD per language instead of about 40 USD |
| Arbiter pairwise comparison (Haiku class, batch, both orders) | cents per few thousand conflicts |
