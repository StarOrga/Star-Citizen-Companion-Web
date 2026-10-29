# Game-string translation (global.ini) — architecture

AI translation of Star Citizen's `global.ini` strings that CIG ships untranslated.
Decided in the concept `docs/concepts/2026-10-29-ki-spieluebersetzung.html`
(rounds 1–2). This file is the contract every part builds against.

## Ground rules (decided)

- **Off by default.** `translation_settings.enabled = false`. Only an admin turns the
  Claude API on; it then applies from the **next** finished data upload. Rationale: an
  initial translation may come in another way, after which only deltas run.
- **Languages need admin approval.** Seed: `de` approved, every other CIG language
  listed but not approved. Only approved languages are translated.
- **Trigger = content diff, never build novelty.** After `ingest-catalog` has verified
  the R2 locale publish of a build, it enqueues a job per approved language. The job
  translates only `(key, sha256(english))` pairs that the translation memory (TM) does
  not hold yet, deduplicated by English text. A re-upload costs nothing.
- **Deltas only — no initial full translation (user decision 2026-10-29, cost).**
  Every automatic job has `mode = 'delta'`: its candidates are only the keys whose
  English value is **new or changed against the previous build of the same channel**
  (`base_build_id`, read from its R2 locale shards), minus what the TM already holds
  and minus valid CIG translations. The untranslated back catalogue is never picked up
  by a delta. With no previous build to compare against, the job is `skipped`. A
  `mode = 'full'` job (the whole gap) exists only through the admin op `start_full`
  and always parks as `awaiting_approval` with its estimate, whatever the caps say.
- **Budget.** `upload_cap_usd` (default **20**) per upload, summed over all its
  languages; `monthly_cap_usd` (default **190**, the Max-20x monthly API credit minus a
  reserve) as a hard ledger per calendar month. An estimate above either cap parks the
  job as `awaiting_approval`; an admin approves or cancels it. Translation runs on its
  own secret `TRANSLATE_ANTHROPIC_API_KEY` (own Console workspace with a spend limit,
  auto-reload off), never the key `sc-events-sync` uses.
- **Models (tiered).** Lore / missions / dialogue keys (prefix regex
  `^(pu|dlg|mission|headhunters|covalex|hurston|shubin|foxwell|cfp|mg|human|dxsh|dxsm|ph)_`,
  case-insensitive) → `claude-opus-5-5`, `output_config.effort: "medium"`, thinking
  omitted (cannot be disabled on Opus 5.5). Everything else → `claude-sonnet-5-5`,
  `thinking: {type: "between_tools"}`, `effort: "low"`. Message Batches API only.
  Treat `stop_reason: "max_tokens"` and `"refusal"` as failed items.
- **Cost levers (all on).** Compact output schema (a JSON array of strings in input
  order, not `{i,s}` objects); requests grouped by key family (mission id / prefix) so
  the shared key prefix is sent once per group; system prompt (style guide + glossary)
  cached with `cache_control: {type: "ephemeral", ttl: "1h"}`; dedupe by English text;
  a **post-edit** pass (second batch) only for items that failed QA or the judge,
  never a higher effort.
- **Context sources, in priority order:** CIG's own translation of the language (TM +
  glossary + few-shot: the most similar CIG pairs per request) > key name + sibling
  strings of the same family > curated glossary > (later) starcitizen.tools snippets.
  Community packs are never ingested (licences). An **admin** glossary entry beats
  everything, including CIG.
- **Style (verified on CIG German):** informal "du"; proper names (manufacturers,
  ships, places, corporations, people) stay English; local number formatting
  (`40 %`, `26 800 REM`, decimal comma for de).
- **QA gates before publish:** placeholder tokens masked as `⟦n⟧` and restored, exact
  multiset match required (`~word(...)`, `<EMn>`, `<…>`, `%s/%ls/%d/%i/%f/%S`, literal
  `\n`, `[...]`); no real CR/LF in a value; glossary adherence; length ratio flag per
  prefix (short strings > 1.4× → post-edit with a "shorter" hint); no URL/markup the
  source lacks; a 5 % sample through an LLM judge (Opus 5.5) with back-translation.
  CIG's own value wins only when it is a real translation of the **current** English
  (skip `! … TRANSLATION NOT FOUND` markers and values identical to English).
- **Delivery = overlay, never CIG text.** We publish only our translations as
  `{key: {h: <sha256 of english>, t: <text>}}`. The SCC desktop app builds the
  `global.ini` locally: the user's own English file, then CIG's official table, then
  our overlay where `h` matches the local English. Download only for signed-in users,
  labelled "unofficial AI translation". The app lives in the separate repo
  `Star-Citizen-Companion-App`.

## Data (Postgres — small rows only; the DB budget is tight)

| Table | Purpose |
|---|---|
| `translation_settings` (singleton, `id = 1`) | `enabled bool default false`, `upload_cap_usd numeric default 20`, `monthly_cap_usd numeric default 190`, `lore_model text`, `rest_model text`, `updated_at`, `updated_by` |
| `translation_languages` | `lang text pk` (short code as in `localization.py`), `cig_folder text`, `approved bool default false`, `approved_at`, `approved_by` |
| `translation_jobs` | `id uuid pk`, `build_id uuid → codex_builds`, `lang`, `mode text default 'delta'` (`delta · full`), `base_build_id uuid → codex_builds` (previous build of the channel, null for full), `status` (`estimating · awaiting_approval · queued · submitted · validating · post_editing · publishing · published · failed · cancelled · skipped`), `string_count int`, `estimate_usd numeric`, `spent_usd numeric default 0`, `batch_ids jsonb default '[]'`, `stats jsonb` (qa counts, judge score), `error text`, `created_at`, `updated_at`, `approved_by` |
| `translation_ledger` | `id`, `job_id → translation_jobs`, `month date` (first of month, UTC), `usd numeric`, `created_at` — sum per month = spend |
| `translation_glossary` | `id uuid pk`, `lang`, `source_term text`, `target_term text`, `category` (`term · label · unit · dnt`), `origin` (`cig · ai · admin`), `locked bool default false`, `needs_retranslate bool default false`, `updated_by`, `updated_at`; `unique (lang, lower(source_term))` |
| `translation_glossary_history` | `id`, `glossary_id`, `before jsonb`, `after jsonb`, `actor uuid`, `at` — written by trigger |

RLS: every table readable and writable by admins only (existing role helper);
service role for the edge functions. Nothing public.

## Data (R2, through the existing assets Worker / bucket helpers)

| Key | Content |
|---|---|
| `translation-tm/<lang>/index.json` + shards | translation memory: `{ "<sha256(en)>": { "t": "…", "o": "ai\|cig\|admin", "m": "<model>", "at": "<iso>" } }`, sharded by the first two hex chars of the hash |
| `translation-overlay/<lang>/<build_id>.json` | delivery overlay for one build: `{ "v": 1, "lang", "build_id", "generated_at", "count", "entries": { "<key>": { "h": "<sha256(en)>", "t": "…" } } }` — our translations only, CIG keys excluded |
| `translation-overlay/<lang>/latest.json` | same shape, newest published build of that language |

R2 objects are written only by edge functions (service role); the overlay is served
to clients only through the `translation-overlay` function (sign-in required), never
as a public Worker path.

## Edge functions

| Function | Contract |
|---|---|
| `ingest-catalog` (changed) | keeps **all** languages in staging and the R2 locale publish (drop the de/en-only filter); after a **verified** publish, if `translation_settings.enabled`, inserts one `translation_jobs` row per approved language with status `estimating` (idempotent per `(build_id, lang)`), then fire-and-forget calls `translate-orchestrator` `{op:"tick"}` |
| `translate-orchestrator` (new, service role / admin JWT) | `op: "tick"` (also run by pg_cron every 10 min): advances every open job one step — `estimating` (diff vs TM, dedupe, chunk, cost estimate with measured ratios: input ≈ 0.90 tok/char incl. keys, German output ≈ 1.74× English tokens, Opus +30 % thinking) → `queued` or `awaiting_approval` → `submitted` (create batch) → `validating` (stream results, QA) → `post_editing` (one retry batch for failures) → `publishing` (TM + overlay to R2, ledger row) → `published`. Resumable at every step, idempotent (compare-and-set on `status`). `op: "approve" \| "cancel"` `{job_id}` (admin). `op: "estimate"` `{build_id, lang, mode}` dry run (admin). `op: "start_full"` `{build_id, lang}` (admin) creates a `full` job that always waits in `awaiting_approval`. |
| `translation-overlay` (new, signed-in user) | `GET ?lang=de[&build_id=…]` → the overlay JSON (`latest` without `build_id`); 401 without a user JWT; 404 when the language has no published overlay |

Pure logic lives in importable modules next to the orchestrator
(`_mask.ts`, `_diff.ts`, `_chunk.ts`, `_cost.ts`, `_qa.ts`, `_prompt.ts`) with
`node --test`/Deno tests, like the other functions.

## Web admin (`/admin/translations`, admin role, red admin accent)

- **Overview:** the enabled switch (off by default, explains "applies from the next
  upload"), both caps, month spend vs cap, languages with approve/revoke, jobs list
  (build, language, status, strings, estimate, spent, QA/judge stats) with approve /
  cancel for `awaiting_approval`.
- **Glossary editor:** search over source and target, filter by language, origin
  (CIG · KI · Admin) and category (term · label · unit · dnt), edit and lock an entry
  (admin entry wins), mark for retranslation (next job re-translates the strings that
  contain the term), history per entry with undo.

## Uploader

Reads `<channel dir>/build_manifest.id` (JSON: Branch, BuildId/RequestedP4ChangeNum …)
when present and sends it with the catalog `init` so the build carries the real
change number; stored as `codex_builds.game_build_manifest jsonb`.
