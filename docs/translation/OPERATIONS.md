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
