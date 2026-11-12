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
  **Community packs are ingested since the decision of 2026-11-08** (concept
  `docs/concepts/20261108-1130-spieluebersetzung-community-seed.html`, replacing the earlier
  "never ingested" rule): only from sources with a licence or a recorded permission, see
  § Community seed. An **admin** correction beats everything, including CIG.
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

## Precedence (decided 2026-11-08, per key)

1. **Admin correction** — TM `o:'admin'` or a locked/admin glossary row. Always first, even over CIG
   (an admin text for a CIG-valid key is the one case where an overlay entry shadows CIG).
2. **CIG's own translation** of the current English (`isCigValid`) — taken blindly, unchecked. It is
   never part of the overlay; the app applies CIG's table itself.
3. **Every other key: community pack vs our AI**, decided per key by the guarded arbiter (below).
   The seed never overwrites a different non-admin TM entry; it reports it as a conflict.
4. **CIG changes the original text or its own translation of a key that carries an admin correction** →
   an admin alert with the diff (`translation_override_alerts`): English old/new, CIG old/new and the
   admin text; the admin keeps, adopts CIG or edits.

`_diff.ts` implements 1–2 for the overlay (`diffStrings`); `TmEntry.o` is `ai | cig | admin | community`,
community entries also carry `src` (source id) and `lic` (licence).

## Community seed (sources, import, sync)

- **Sources** are rows of `translation_sources` (licence kind `permissive | nc_sa | none`, status
  `licensed | awaiting_permission | permitted | refused`, `raw_url` or `resolver`, `game_folder`,
  `use_cig_table`, `last_seen_commit`, `coverage`). Only `licensed` / `permitted` and `enabled`
  sources are ever read; fr, zh-Hans and es stay `awaiting_permission` until an admin records
  `granted` on their outreach draft (status → `permitted`). Until then those languages show only CIG.
- **Resolvers:** plain `raw_url` · `github-release:<owner>/<repo>:<asset>` (GitHub
  `releases/latest` → asset) · `zip-entry:<path>` (zip from `raw_url`, only that entry inflated).
- **`op: import_seed`** parses the pack (`_pack.ts`: UTF-8/BOM/UTF-16, keys lower-cased, trailing `,P`
  stripped, `Frontend_PU_Version` captured as the pack header and not imported), filters it against the
  current LIVE build (`_seed.ts`: skip CIG-valid keys, blank / identical-to-English / `NOT FOUND` values,
  and values whose placeholder multiset differs from English — the QA gate of `_qa.ts`/`_mask.ts`),
  writes TM entries keyed by the sha256 of the CURRENT English (one per English text; most frequent
  translation wins), stores coverage on the source, calls the arbiter for conflicts and the learning step,
  and republishes `translation-overlay/<lang>/latest.json`. Idempotent. For a source with
  `use_cig_table = false` (ru) no key is skipped as CIG-valid.
- **Sync = "both"** (decision d-sync): AI deltas keep running right after each upload as before; a daily
  pg_cron call `op: sync_sources` compares each usable source's upstream marker (GitHub commit of the
  file / latest release tag + asset time / zip ETag) with `last_seen_commit` and re-imports changes. A
  later community value for a hash the TM already holds goes through the arbiter, never overwrites blindly.

## Consistency, arbiter, revision, learning, cards (contract level)

- **Arbiter (guarded)** per conflicting key, in order: admin wins; CIG valid → CIG wins; equal modulo
  whitespace/punctuation → keep the incumbent; the side failing QA/placeholders, whose hash is stale or
  that violates the glossary loses; otherwise a pairwise LLM comparison in **both orders** (position bias)
  with glossary and style consistency as a hard criterion. Both orders agree with confidence → winner;
  otherwise an admin card. Batch API, model `translation_settings.arbiter_model`, same ledger and caps.
- **Revision (hysteresis):** a challenger replaces an incumbent TM entry or glossary row only if it wins
  in both orders, the evidence margin (`revise_margin`, start 3) is met, the row is not admin/locked and
  the language's change budget (`revise_budget_pct`, start 2 % of its strings) is not exhausted. A
  glossary change propagates to every string with the term via `needs_retranslate`. CIG lines and admin
  rows never move.
- **Consistency by terms:** CIG term pairs are authoritative; community/AI lines whose English contains a
  CIG source term but whose target lacks the CIG target term are rewritten (one align batch). CIG lines
  never change.
- **Learning step** (`learningHooks.runLearning`, triggers `publish | seed | sync | backfill`): mine term
  candidates, do-not-translate names, per-language style statistics, few-shot from the whole TM, judge
  term corrections, Haiku pre-decisions, capped web research for open cards. A term becomes binding
  (origin `mined`) at ≥ 5 occurrences and ≥ 90 % agreement; below that or contradicting → card.
- **Cards** (`translation_cards`): the last resort when the arbiter or the learning step cannot decide;
  sorted by spread, reach, kind (meta < wording < style), doubt, fresh. An answer has no automatic effect;
  the orchestrator applies it (own text → TM admin entry, "save as rule" → admin glossary row).
- **Alerts** (`translation_override_alerts`, `_alerts.ts`): detected when a delta's base→current diff
  touches a key with an admin entry (TM `admin` for the OLD English hash or an admin glossary term in the
  string). One open alert per `(lang, key)`; a repeat keeps the original `en_old`/`cig_old`.
- **Outreach** (`translation_outreach`, `_outreach.ts`): deterministic drafts, no LLM, **no send code**.
  Approval only by a protected admin; sending is manual. Plan: [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md).

## Licences and credit

Credit is given **always in the same form for every source**, whatever the licence asks, as long as it is
licence-compliant: `Community-Übersetzung: <names> (<licences>) · KI-Ergänzung: SC Companion` (German text
for `de`, English text otherwise). The **NC-SA languages (de, ru) are published under CC-BY-NC-SA 4.0**
(`sources[].license` says so, including the AI supplement of such an overlay) and **SCC stays free for
them**. MIT sources (it, pt-BR, ja) keep the copyright and licence notice in `sources[]`.

## Data (Postgres — small rows only; the DB budget is tight)

| Table | Purpose |
|---|---|
| `translation_settings` (singleton, `id = 1`) | `enabled bool default false`, `upload_cap_usd numeric default 20`, `monthly_cap_usd numeric default 190`, `lore_model text`, `rest_model text`, `updated_at`, `updated_by` |
| `translation_languages` | `lang text pk` (short code as in `localization.py`), `cig_folder text`, `approved bool default false`, `approved_at`, `approved_by` |
| `translation_jobs` | `id uuid pk`, `build_id uuid → codex_builds`, `lang`, `mode text default 'delta'` (`delta · full`), `base_build_id uuid → codex_builds` (previous build of the channel, null for full), `status` (`estimating · awaiting_approval · queued · submitted · validating · post_editing · publishing · published · failed · cancelled · skipped`), `string_count int`, `estimate_usd numeric`, `spent_usd numeric default 0`, `batch_ids jsonb default '[]'`, `stats jsonb` (qa counts, judge score), `error text`, `created_at`, `updated_at`, `approved_by` |
| `translation_ledger` | `id`, `job_id → translation_jobs` (null for learning rows), `kind` (`job`, `learn`, `arbiter`, `align`, `haiku`, `web`), `lang` (job-less rows), `month date` (first of month, UTC), `usd numeric`, `created_at` — sum per month = spend, all kinds |
| `translation_glossary` | `id uuid pk`, `lang`, `source_term text`, `target_term text`, `category` (`term · label · unit · dnt`), `origin` (`cig · ai · admin`), `locked bool default false`, `needs_retranslate bool default false`, `updated_by`, `updated_at`; `unique (lang, lower(source_term))` |
| `translation_glossary_history` | `id`, `glossary_id`, `before jsonb`, `after jsonb`, `actor uuid`, `at` — written by trigger |
| `translation_sources` | community packs: licence, status, resolver, `last_seen_commit`, `coverage` (see § Community seed) |
| `translation_override_alerts` | B4 alerts, `open · kept · adopted · edited` |
| `translation_cards` | admin flash cards (last-resort questions) |
| `translation_outreach` | maintainer message drafts and their answers |

Exact columns, RLS and RPCs of the community tables: migration `20261108160000_translation_community_seed.sql`.

RLS: every table readable and writable by admins only (existing role helper);
service role for the edge functions. Nothing public.

## Data (R2, through the existing assets Worker / bucket helpers)

| Key | Content |
|---|---|
| `translation-tm/<lang>/index.json` + shards | translation memory: `{ "<sha256(en)>": { "t": "…", "o": "ai\|cig\|admin\|community", "m": "<model>", "at": "<iso>", "src": "<source id>", "lic": "<licence>" } }` (`src`/`lic` only for community entries), sharded by the first two hex chars of the hash |
| `translation-overlay/<lang>/<build_id>.json` | delivery overlay for one build: `{ "v": 1, "lang", "build_id", "generated_at", "count", "entries": { "<key>": { "h": "<sha256(en)>", "t": "…" } }, "sources": [{ "id", "name", "url", "license", "attribution" }], "attribution": "<one line>", "game_folder": "<Data/Localization folder or null>", "use_cig_table": true }` — community + AI + admin entries only, CIG keys excluded. The last four fields are the additive v1 extension (older clients ignore them); `ru` ships in `korean_(south_korea)` with `use_cig_table: false`. |
| `translation-overlay/<lang>/latest.json` | same shape, newest published build of that language |

R2 objects are written only by edge functions (service role); the overlay is served
to clients only through the `translation-overlay` function (sign-in required), never
as a public Worker path.

## Edge functions

| Function | Contract |
|---|---|
| `ingest-catalog` (changed) | keeps **all** languages in staging and the R2 locale publish (drop the de/en-only filter); after a **verified** publish, if `translation_settings.enabled`, inserts one `translation_jobs` row per approved language with status `estimating` (idempotent per `(build_id, lang)`), then fire-and-forget calls `translate-orchestrator` `{op:"tick"}` |
| `translate-orchestrator` (new, service role / admin JWT) | `op: "tick"` (also run by pg_cron every 10 min): advances every open job one step — `estimating` (diff vs TM, dedupe, chunk, cost estimate with measured ratios: input ≈ 0.90 tok/char incl. keys, German output ≈ 1.74× English tokens, Opus +30 % thinking) → `queued` or `awaiting_approval` → `submitted` (create batch) → `validating` (stream results, QA) → `post_editing` (one retry batch for failures) → `publishing` (TM + overlay to R2, ledger row) → `published`. Resumable at every step, idempotent (compare-and-set on `status`). `op: "approve" \| "cancel"` `{job_id}` (admin). `op: "estimate"` `{build_id, lang, mode}` dry run (admin). `op: "start_full"` `{build_id, lang}` (admin) creates a `full` job that always waits in `awaiting_approval`. |
| `translate-orchestrator` community ops (admin JWT / service role) | `op: "import_seed"` `{source_id}` (refuses `translate.source_not_permitted`) → `{source_id, lang, imported, skipped_cig, skipped_same, rejected_qa, conflicts, coverage}`; `op: "sync_sources"` (daily cron with the publishable key, or admin) → `{checked, changed, errors}`; `op: "learn"` `{lang}` (backfill); `op: "draft_outreach"` `{source_id}` → the `translation_outreach` draft row |
| `translation-overlay` (new, signed-in user) | `GET ?lang=de[&build_id=…]` → the overlay JSON (`latest` without `build_id`); 401 without a user JWT; 404 when the language has no published overlay |

## Room labels (`scc_room_*`, E14, holotisch concept 20261109-1745)

Room names of the deck plan go through the same pipeline, no hand-written table:

- **Uploader** (`sc_extract/ship_rooms.py` + `dataforge_extract._label_room`): every room row in
  `codex_ships.payload.decks[].rooms[]` carries `locKey` (the game's loc key, `@`-less, lower-cased)
  where the game has one. A room whose German is missing (no loc key, or CIG ships no German for it)
  also gets `labelKey = scc_room_<slug of the English label>`; the label is the game's English name or
  the humanized entity name (`humanize_room_key` = `humanizeRoomKey` in `deck-plan.ts`). Every such
  key/label pair is added to the build's **English** locale table (`localization/en.json` →
  `codex_locale_strings` → R2 shards). One key per distinct label, shared by every ship.
- **Orchestrator:** nothing special. The keys are new against the base build, so the next delta job
  translates them (Sonnet tier, TM dedupe by English text, so a community/CIG translation of the same
  English is reused for free); later builds hit the TM. Next to every `latest.json` it writes
  `translation-overlay/<lang>/rooms.json`, the overlay filtered to `scc_room_*` (same shape, a few kB).
- **Delivery:** `translation-overlay?lang=<lang>&ns=rooms` (signed-in, like the full overlay).
- **Web:** `RoomLabelTranslations.labels(lang)` (`src/app/codex/room-label-translations.ts`) →
  `buildDeckPlans(decks, lang, labels)`. Precedence per room: the game's own string of the language >
  the translation of `labelKey` > the English name > the humanized key. Signed out / nothing published
  = English.

Pure logic lives in importable modules next to the orchestrator
(`_mask.ts`, `_diff.ts`, `_chunk.ts`, `_cost.ts`, `_qa.ts`, `_prompt.ts`, `_pack.ts`, `_seed.ts`,
`_alerts.ts`, `_outreach.ts`; `_sources.ts` holds the DB-facing import/sync, `_hooks.ts` the seams for the
learning step and the arbiter) with
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
