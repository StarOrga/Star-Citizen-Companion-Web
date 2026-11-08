# Wave 1 contract — translation community seed schema

Migration: `supabase/migrations/20261108160000_translation_community_seed.sql` (pgTAP: `supabase/tests/database/translation_community_seed.test.sql`, written, not yet run — needs the local stack). Not applied to the cloud project.

**RPC arguments are `p_`-prefixed.** Use these exact names in `supabase.rpc(...)`.

## Tables

- `translation_settings` + `arbiter_model text default 'claude-haiku-5-5'`, `web_research_cap_usd numeric default 5`, `revise_margin int default 3`, `revise_budget_pct numeric default 2` (0..100), `promote_min_evidence int default 5`, `promote_min_agreement numeric default 0.9` (0,1]. All not null.
- `translation_languages` + `style jsonb not null default '{}'`. Approved: `de, it, ja, pt-BR, ru`.
- `translation_glossary`: `origin` ∈ `cig | ai | admin | mined | community`; new `evidence int not null default 0`.
- `translation_sources`: `id text pk`, `lang` (FK translation_languages), `name`, `repo_url`, `raw_url`, `resolver`, `license`, `license_kind` (`permissive | nc_sa | none`), `status` (`licensed | awaiting_permission | permitted | refused`), `attribution` (plain name), `game_folder`, `use_cig_table bool default true`, `enabled bool default true`, `last_seen_commit`, `last_synced_at timestamptz`, `coverage jsonb default '{}'` (seeded `{"text_pct":..}`), `created_at`.
  - Seed ids: `rjcncpt` (de), `dymerz-it`, `dymerz-ptbr`, `stdblue` (ja), `n1ghter` (ru) → `licensed`; `circuspes` (fr), `42kit` (zh-Hans), `thord82` (es) → `awaiting_permission`.
  - `stdblue`: `raw_url` null, `resolver = 'github-release:stdblue/StarCitizenJapaneseResources:global.ini'`. `42kit`: `raw_url = https://ini.42kit.com/data.zip`, `resolver = 'zip-entry:data/Localization/chinese_(simplified)/global.ini'`. `n1ghter`: `game_folder = korean_(south_korea)`, `use_cig_table = false`.
- `translation_override_alerts`: `id uuid pk`, `lang`, `key`, `build_id uuid` (FK codex_builds, nullable), `en_old`, `en_new`, `cig_old`, `cig_new`, `admin_text not null`, `status` (`open | kept | adopted | edited`, default open), `edited_text`, `resolved_by`, `resolved_at`, `created_at`. Unique partial index `(lang, key) where status='open'` → upsert `on conflict (lang, key) where status='open'`.
- `translation_cards`: `id`, `lang`, `kind` (`meta | wording | style`), `question`, `option_a` / `option_b` jsonb not null `{text, source}`, `context` jsonb `{key, en, neighbours, where, research}`, `spread int`, `reach int` (higher = more visible), `doubt numeric 0..1`, `fresh bool`, `kind_rank smallint` (generated: meta 0, wording 1, style 2), `dedupe_key text` (unique per `(lang, dedupe_key)` while not answered), `status` (`open | answered | skipped`), `answer` (`a | b | own`), `own_text`, `note`, `save_as_rule bool`, `impact int` (strings unified, set by the creator), `points int`, `answered_by uuid`, `answered_at`, `skipped_at`, `created_at`.
  - Queue: `status in ('open','skipped') order by (status='skipped'), spread desc, reach desc, kind_rank, doubt desc, fresh desc`.
- `translation_outreach`: `id`, `source_id` (FK translation_sources), `kind` (`notify | permission`), `message_lang text default 'de'`, `subject`, `body`, `status` (`draft | approved | sent | answered`), `approved_by`, `approved_at`, `sent_at`, `answer`, `answer_at`, `decision` (`granted | refused`), `created_at`.

## Who writes what

- Reads: authenticated admins select all new tables; anon nothing.
- Admins may update `translation_sources` (guarded: `status`, `id`, `lang` only via RPC / service role) and `translation_outreach` (guarded: `status`, `approved_by`, `approved_at`, `sent_at`, `answer`, `answer_at`, `decision`, `source_id`, `kind`) — i.e. admins can edit subject/body/message_lang of a draft.
- Cards and alerts: no direct admin insert/update/delete; admin writes only through RPCs.
- Creating cards, alerts and outreach drafts: service role only (edge functions write the tables directly; the RPCs check `is_admin()` via JWT and are NOT for the service role).
- An answered card has NO automatic effect on glossary/TM: the orchestrator reads `answer`, `own_text`, `note`, `save_as_rule` and applies them (own text → TM admin entry; save_as_rule → glossary row origin admin).

## RPCs (all `authenticated`, require `public.is_admin()`; errors 42501 rights, 22023 invalid input, P0002 not found / wrong state)

- `resolve_override_alert(p_alert_id uuid, p_resolution text, p_edited_text text default null)` → alert row; `kept | adopted | edited` (`edited` needs text); open alerts only.
- `answer_translation_card(p_card_id uuid, p_answer text, p_own_text text default null, p_note text default null, p_save_as_rule boolean default false)` → card row; `points = 10 + round(least(impact,500)/10.0)`; works on open or skipped; `own` needs text.
- `skip_translation_card(p_card_id uuid)` → card row (`skipped`, `skipped_at`).
- `translation_card_leaderboard()` → `table(answered_by uuid, points bigint, answers bigint, streak_days int)` by points desc.
- `translation_card_stats(p_lang text default null)` → one row `open_count int` (open + skipped), `answered_today int` (caller), `streak_days int` (caller); days in Europe/Berlin.
- `approve_translation_outreach(p_id uuid)` → outreach row, draft → approved; **protected admins only**.
- `mark_translation_outreach_sent(p_id uuid)` → approved → sent (manual mark; there is no send code).
- `record_translation_outreach_answer(p_id uuid, p_answer text, p_decision text)` → sent → answered; `granted` sets the source `permitted` (from awaiting_permission/refused; a licensed source stays licensed), `refused` sets `refused` + `enabled=false`.
