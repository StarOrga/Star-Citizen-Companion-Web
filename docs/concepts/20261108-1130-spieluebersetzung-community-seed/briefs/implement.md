# Implement brief — Spielübersetzung: Community-Seed und Lernschleife

Concept: `docs/concepts/20261108-1130-spieluebersetzung-community-seed.html` (rounds in
`docs/concepts/20261108-1130-spieluebersetzung-community-seed/rounds/`), decisions:
[`../20261108-1130-spieluebersetzung-community-seed-decisions.json`](../20261108-1130-spieluebersetzung-community-seed-decisions.json).
Repo: SC Companion web (`P:/Projects/Star-Citizen-Companion-Web`, worktree
`.claude/worktrees/beta-alpha-download-auth-bbc26c`, branch `claude/sc-translations-automated-learning-6008c4`).
Read the root `CLAUDE.md` rules first (scAction, ngx-translate, no native dialogs, toErrorKey, logWarn/logError, OnPush, signals).
Contract docs to update: `docs/translation/ARCHITECTURE.md`, `docs/translation/OPERATIONS.md`.

Later rounds override earlier ones. Where a note overrides the picked option, the note wins (marked below).

## Facts measured in the concept session (LIVE 4.10.2, do not re-measure)

- English `global.ini`: 90 946 keys, 6,77 Mio. chars. CIG German table: 18 462 keys really translated (~20 % text). Overlay today: empty (`translation_settings.enabled=false`, 0 jobs, 0 glossary rows).
- Community packs (raw URLs verified 2026-11-08):
  | lang | source id | raw URL | licence | text coverage | status |
  |---|---|---|---|---|---|
  | de | `rjcncpt` | `https://raw.githubusercontent.com/rjcncpt/StarCitizen-Deutsch-INI/main/live/global.ini` | CC-BY-NC-SA-4.0 | 94,3 % | licensed (comply) |
  | it | `dymerz-it` | `https://raw.githubusercontent.com/Dymerz/StarCitizen-Localization/main/data/Localization/italian_(italy)/global.ini` | MIT | 93,3 % | licensed |
  | pt-BR | `dymerz-ptbr` | `…/data/Localization/portuguese_(brazil)/global.ini` (same repo) | MIT | 93,6 % | licensed |
  | ja | `stdblue` | GitHub release asset `global.ini` of the latest release of `stdblue/StarCitizenJapaneseResources` (e.g. tag `v4.10-ja_JP-alpha-4.10-LIVE`) — resolve via `GET /repos/stdblue/StarCitizenJapaneseResources/releases/latest` | MIT | 88,9 % | licensed |
  | ru | `n1ghter` | `https://raw.githubusercontent.com/n1ghter/StarCitizenRu/master/data/Localization/korean_(south_korea)/global.ini` | CC-BY-NC-SA-4.0 (+ special permission for CIG only) | 95,3 % | licensed; the game has NO russian folder — the pack ships in the `korean_(south_korea)` slot |
  | fr | `circuspes` (via Dymerz) | `…/Dymerz/…/french_(france)/global.ini`, upstream traduction.circuspes.fr („Copyright © Traduction communautaire francophone de StarCitizen 2026“, no licence) | none | 97,8 % | awaiting_permission |
  | zh-Hans | `42kit` | `https://ini.42kit.com/data.zip` → `data/Localization/chinese_(simplified)/global.ini`; also `StarCitizenToolBox/LocalizationData` (no licence) | none | 97,9 % | awaiting_permission |
  | es | `thord82` | `https://raw.githubusercontent.com/Thord82/Star_citizen_ES/main/global.ini` — `COPYRIGHT.md`: personal use only, redistribution/incorporation needs express prior permission | all rights reserved | 57,4 % | awaiting_permission |
- Packs are UTF-8 with BOM, `key=value` per line, first line `Frontend_PU_Version=…` (rjcncpt asks that this attribution line is kept). Keys may carry a `,P` suffix (normalise like the uploader's localization parser). ~2 400 German pack lines have a placeholder multiset different from English → the existing QA gate (`_qa.ts`/`_mask.ts`) must reject those lines; they fall into the AI gap.
- CIG vs rjcncpt: of 13 799 keys both translate, 10 280 differ — style, not errors (pack = „Hybrid“ German with English game terms, upper-case UI). With the CIG-first rule this needs no arbitration.
- Cost model (OPERATIONS.md): German full AI gap ≈ 40 USD; with seed ≈ 2–5 USD per language. Caps: 20 USD/upload, 190 USD/month. Key: `TRANSLATE_ANTHROPIC_API_KEY` (API credit, own workspace).
- Existing code to build on: `translate-orchestrator/_glossary.ts` (`deriveCigLabels`, `deriveAiTerms`, `mergeGlossary`, `newRows`), `_prompt.ts` (`STYLE`, `buildSystem`, `buildFewShotIndex`, `pickSimilar`, `judgeParams`), `_diff.ts` (`TmEntry.o: 'ai'|'cig'|'admin'`, `isCigValid`, `diffStrings`), `_io.ts` (TM shards in R2, `makeOverlay`), `_machine.ts` (state machine, 5 % judge with Opus 5.5), `translation-overlay/index.ts`, migration `20261029180000_translation_pipeline.sql`, admin UI `src/app/admin/translations/*` (glossary editor exists), `public.protected_admins` (migration `20260802080000_protected_admins.sql`).
- The SCC desktop app is a SEPARATE repo (`P:/Projects/Star-Citizen-Companion-App`, `modules/core/src/core/translation/translation-service.js`, `LANGUAGES` lists only German, UI label „inoffizielle KI-Übersetzung“). It is NOT part of this web implement; it gets its own session. This repo only defines and serves the overlay contract below.

## Precedence (final, from the round-1 briefing note — overrides d-order)

1. Admin correction (TM `o:'admin'`, or locked admin glossary row) — always first.
2. CIG's own translation of the current English (`isCigValid`) — taken **blindly, unchecked**.
3. For every other key: community pack vs our AI, decided per key by the guarded arbiter (below).
4. When CIG changes the original (English) text **or** its own translation of a key that carries an admin correction: an admin alert with the diff (English old/new, CIG old/new, the admin text) so the admin can keep, adopt CIG or edit.

## Overlay contract v1 extension (web serves it; the app session consumes it)

`translation-overlay/<lang>/<build|latest>.json` keeps `{ v:1, lang, build_id, generated_at, count, entries:{ key:{h,t} } }` and ADDS (additive, backwards compatible):
- `sources: [{ id, name, url, license, attribution }]` — every source that contributed ≥1 entry, plus `{ id:'scc-ai', name:'SC Companion KI', … }` when AI entries exist.
- `attribution: "<one line>"` — uniform format for every language, licence-compliant (d2-license note: same form always): e.g. `Community-Übersetzung: <names> (<licences>) · KI-Ergänzung: SC Companion` in the target language? → keep it in the UI language of the target (de text for de, en text otherwise) and short; the app writes it into `Frontend_PU_Version` and the language picker.
- `game_folder` — the `Data/Localization/<folder>` to write (ru → `korean_(south_korea)`), and `use_cig_table: boolean` (false for ru: the korean slot's CIG table is Korean, not Russian).
- Entries stay „ours only“ in the sense of the old contract: CIG keys are never in the overlay (the app applies CIG itself); community + AI + admin entries are.

## Checklist (one line per accepted item — owners in brackets)

### A · Seed and sources [core]
- [ ] A1 Migration (alpha policy; document in the migration comment): `translation_sources` (id text pk, lang, name, repo_url, raw_url/resolver, license spdx-ish text, license_kind `permissive|nc_sa|none`, status `licensed|awaiting_permission|permitted|refused`, attribution text, game_folder, use_cig_table, enabled, last_seen_commit, last_synced_at, coverage jsonb) seeded with the 8 rows of the table above; RLS admin-only like the other translation tables.
- [ ] A2 `translation_languages`: approve `de, it, pt-BR, ja, ru` (d-langs minus the three awaiting permission; d-nopack=skip keeps es/ko/pl/fr/zh unapproved until a source is permitted). Settings `enabled` stays false (admin switches it).
- [ ] A3 `TmEntry.o` gains `'community'`; TM entries carry optional `src` (source id) and `lic`. Precedence in `_diff.ts`/overlay build follows § Precedence (admin > CIG blind > arbiter result).
- [ ] A4 Orchestrator op `import_seed {source_id}` (admin JWT / service role): refuses unless source status is `licensed` or `permitted`; streams/parses the pack (mind the edge memory limit: ~12 MB files, no full-copy duplication), normalises keys, skips keys with a valid CIG value, skips pack values identical to English/blank/`NOT FOUND`, runs the placeholder/QA gate, writes TM entries keyed by sha256 of the CURRENT English with `o:'community'`, `src`, `lic`, `at`; stores coverage stats on the source row; then triggers the learning step (C) and republishes `latest` overlay for that language. Idempotent.
- [ ] A5 Daily sync (d-sync = **both**): pg_cron calls op `sync_sources`; for every enabled licensed/permitted source compare upstream commit/release (GitHub API) with `last_seen_commit`; on change re-import (A4 path). AI deltas keep running immediately after each upload as today; a later community value for the same hash goes through the arbiter (B2) instead of overwriting blindly.
- [ ] A6 Overlay build adds `sources`, `attribution`, `game_folder`, `use_cig_table` (§ Overlay contract) — `translation-overlay` serves it unchanged otherwise.

### B · Consistency, arbiter, revision [core]
- [ ] B1 d2-base = **terms**: the learning step derives CIG term pairs (CIG is authoritative) and finds community/AI TM lines whose English contains the source term but whose target lacks the CIG target term → only those lines are rewritten by the AI (one align batch with the term hint), CIG lines never change. Mixed style elsewhere is accepted.
- [ ] B2 d2-arbiter = **guarded**: per key, in order — admin wins; CIG valid → CIG wins unchecked; then community vs AI: equal modulo whitespace/punctuation → keep incumbent; side failing QA/placeholders loses; side whose hash is stale loses; side violating the glossary loses; else pairwise LLM comparison **in both orders** (position bias, Zheng et al. 2023) with consistency to glossary + style as a hard criterion; both orders agree with confidence → winner; disagreement or low confidence → admin card (D). Batch API, model from settings (default Haiku-class for pairwise, cheap); ledger + caps as every other spend.
- [ ] B3 d2-revise = **hysteresis**: a challenger replaces an incumbent TM entry / glossary row only if it wins the pairwise comparison in both orders AND, for glossary terms, evidence(new) ≥ evidence(old) + margin (start: 3) AND the row is not locked/admin AND the language's change budget for this release (start: 2 % of its strings) is not exhausted; a glossary change propagates to every string with the term via `needs_retranslate`, never one string alone. CIG lines and admin-locked rows never move (CIG changes only with a CIG patch). Margin and budget are settings columns, not constants.
- [ ] B4 Admin alert on CIG change (briefing note): table `translation_override_alerts` (lang, key, en_old, en_new, cig_old, cig_new, admin_text, status `open|kept|adopted|edited`, resolved_by/at); created by the orchestrator when a delta's base→current diff touches a key that has an admin entry (TM `o:'admin'` for the old hash, or an admin glossary row the string uses).

### C · Learning step (d-learn = all seven) [core + aix]
- [ ] C0 A deterministic `learning` phase runs after every publish, after every seed import/sync, and once as a backfill (`op: learn {lang}`); token-free parts first. Results go to `translation_glossary` / a per-language style record / cards.
- [ ] C1 `mine`: short pairs (≤ 4 words) from TM (cig, community, admin, ai) → term candidates with votes.
- [ ] C2 `dnt`: proper names from the codex DB (manufacturers, ships, locations — use the existing codex tables) confirmed by being kept verbatim in ≥ 90 % of pairs → `dnt` rows.
- [ ] C3 `style`: regex stats per language (du/Sie, decimal comma, `40 %` spacing, quote marks, upper-case UI share per key prefix) → stored per language (e.g. `translation_languages.style jsonb`) and injected into `buildSystem` instead of / on top of the static `STYLE` map.
- [ ] C4 `fewshot`: `buildFewShotIndex`/`pickSimilar` draw from the whole TM (admin > cig > community > ai), not only CIG pairs.
- [ ] C5 `judge`: the 5 % judge also returns term corrections; they become glossary candidates instead of being dropped.
- [ ] C6 `haiku`: candidates with two competing variants and no clear majority get a Haiku batch pre-decision (cents); confident → resolved (origin `mined`), else → card.
- [ ] C7 `web`: online research only for the top open cards of kind meta/wording (e.g. starcitizen.tools in the target language) via the Messages API web search tool, hard monthly cap in settings (`web_research_cap_usd`, default 5), findings attached to the card as context. Never runs when the cap is reached.
- [ ] C8 d-promote = **auto**: a learned term becomes binding (origin `mined`) at ≥ 5 occurrences and ≥ 90 % agreement; below that or contradicting → card. Glossary origins gain `mined` and `community`; admin rows still win; admins can edit the glossary per language at any time (exists — keep it).

### D · Admin cards („Karteikarten“) [core + frontend]
- [ ] D1 Table `translation_cards` (lang, kind `meta|wording|style`, question, option_a {text, source}, option_b {text, source}, context jsonb {key, en, neighbours, where, research}, spread int, reach int, doubt numeric, fresh bool, status `open|answered|skipped`, answer `a|b|own`, own_text, note, save_as_rule bool, impact int, answered_by, answered_at); RLS admin. Cards are created ONLY as last resort (arbiter disagreement/low confidence, learning conflicts) — never for clear cases.
- [ ] D2 Priority order (d2-card-order): **spread, reach, kind, doubt, fresh** — sort by strings affected, then visibility (UI/HUD before lore), then kind (meta before wording before style — the user's ranking), then AI doubt, then current-patch.
- [ ] D3 Card form (d2-card-form, all six): choose A or B · „beides falsch“ with own text (becomes an admin entry) · note as hint for the AI · save the answer as a glossary/style rule (applies everywhere) · context (key, neighbour lines, English original, where in the game) · skip (to the end of the list).
- [ ] D4 Motivation (d2-gamify = quiet **plus the note „gern auch rangliste und punkte!“**): show impact („Diese Antwort hat N Strings vereinheitlicht“), daily goal, streak — AND points per answer (weighted by impact) with a leaderboard among admins. Admin area only.
- [ ] D5 Admin page `/admin/translations` gets: Karteikarten (queue + card), Quellen (sources: licence, status, coverage, last sync, „Seed importieren“, „Jetzt abgleichen“), Anfragen (outreach, E), Hinweise (override alerts with diff, B4: keep / adopt CIG / edit). All strings via ngx-translate (de + en), `scAction`, `<sc-select>`, `ScConfirmService`, `toErrorKey`, error state with retry, red admin accent per the colour rule.

### E · Licences and outreach [core + frontend + docs]
- [ ] E1 d2-license = **ok** + note: attribution is ALWAYS done in the same form for every source, whatever the licence asks, as long as it is licence-compliant. NC-SA languages (de, ru): their overlay is published under CC-BY-NC-SA 4.0 and SCC stays free for them — state this in `ARCHITECTURE.md` and in the overlay `sources[].license`.
- [ ] E2 d2-unlicensed = **draft**: fr, zh, es get a permission-request draft; `import_seed` refuses them until an admin records the answer `granted` (status → `permitted`). Until then those languages show only CIG (consistent with d-nopack = skip).
- [ ] E3 d2-drafts (all five): table `translation_outreach` (source_id, kind `notify|permission`, language of the message, subject, body, status `draft|approved|sent|answered`, approved_by/at, sent_at, answer, answer_at, decision `granted|refused`); drafts are generated deterministically from templates per licence kind (NC-SA/MIT: information + how we credit; none: request for permission), contain what we use (coverage, key count, how credited), are written in the maintainer's language; **approval only by a protected admin** (`public.protected_admins`), sending is **manual only** (copy text + mark as sent) — there is NO send code path; answers and permissions are logged.
- [ ] E4 New doc `docs/translation/PUBLIC-RELEASE.md` (the „final public release plan“): before promoting SCC beyond friends, inform every maintainer (table: maintainer, language, licence, channel, kind of message — who is informed how), drafts only, protected-admin approval, never automatic; notes that Korean and Polish are still missing and must be caught up; Thord82 must be asked (his COPYRIGHT.md requires express permission); fr/zh permission requests. Drafts may be prepared now; sending happens later at the public release, as agreed.
- [ ] E5 `ARCHITECTURE.md` updated: the rule „Community packs are never ingested“ is replaced (decision 2026-11-08, this concept); precedence, sources, learning step, arbiter, hysteresis, cards, alerts, overlay v1 extension. `OPERATIONS.md`: new ops (`import_seed`, `sync_sources`, `learn`, outreach), cron, costs.

### F · Tests and gates [all]
- [ ] F1 `node --test`/Deno tests for every new pure module (pack parser, seed import filter, arbiter rules incl. both-order agreement, hysteresis rule incl. budget, style stats, card priority sort, outreach templates) — `npm run test:functions` green.
- [ ] F2 Karma specs for the new admin views (cards answer flow, sources, outreach approve disabled for non-protected admins, alerts) — `npm test` green, `npm run typecheck`, `npm run lint`, `npm run build` green.
- [ ] F3 Migration applies cleanly (`supabase db reset` locally or a dry run); no destructive change to existing tables beyond widening check constraints.

## Not in this implement (separate session, other repo)
- SCC app: `LANGUAGES` for it/pt-BR/ja/ru (+ fr/zh when permitted), ru via `korean_(south_korea)` with `use_cig_table=false`, attribution line into `Frontend_PU_Version`, picker label from overlay `sources`/`attribution` instead of „inoffizielle KI-Übersetzung“.

## Verbatim — every decision and comment of every round

### Runde 1 — Entscheidungen
- d-seed (Startbestand) → "seed"
- d-license (Umgang mit Lizenzen) → "comply" (abweichend von Empfehlung "ask")
- d-langs (Sprachen mit Seed) → ["de","it","ptbr","ja","fr","zh","ru"] (abweichend von Empfehlung "de it ptbr ja")
- d-learn (Lernbausteine) → ["mine","dnt","style","fewshot","judge","haiku","web"] (abweichend von Empfehlung "mine dnt style fewshot judge")
- d-promote (Freigabe gelernter Begriffe) → "auto"
- d-sync (Spätere Community-Updates) → "both" (abweichend von Empfehlung "grace")
- d-order (Vorrang der Quellen) → "cig"
- d-credit (Herkunft sichtbar machen) → "both"
- d-nopack (Sprachen ohne Paket) → "skip" (abweichend von Empfehlung "ai")

### Runde 1 — Kommentare wörtlich
- **Allgemein:** „Btw, wir sollten generell auch nochmal einen konsistenz mechanismus drin haben, beei den verschiedensten quellen und co. sollte wissenschaftlich belegt sich für konsistenz in den meisten fällen entschieden werden,a ber auch ggf. manchmal, dass auch alte einträge geändert werden und aktualsiiert, damit wir nicht nur z. B. auf  alten wording oder phrasierung etc. beharren für immer. Überlege dir da einen ausgeklügelten mechanismus der wissenschaftlich belegft ist.“
- **d-license-note:** „aber bitte notiere irgendwo im final public release plan, also wenn wir mit der app mehr als nur bekannte werben, dass wir dann die maintainer informieren, dabei alle je nach lizenz entsprechende ansprache aber nur mit freigabe durch geschützte admins und nur entwürfe, keine automatischen absendugnen .“
- **d-promote-note:** „Gern auch in scc web für admins in der ü+bersetzung eine art karteikarten mit auswahl machen a oder b und/oder notiz. Sprich man kann der ki übersetzung input geben wenn die ki übersetzungh nicht weiterkommt und nachfragt, dann kann der admin wählen zwischen a oder b option, präferiert meta fragen aber zur not auch zum wording oder ganz zur not auch zum stil und ggf. eine notiz als zusätzlichen hinweis ergänzen. Wie eine gamification die den admin dazu animiert mal hin und wieder die übersetzung zu verbessern. Dabie bitte priorisierte liste, damit die wichtigsten vorne stehen und wie gesagt, das ist nur last resort wenn die ki nicht weiterkommt oder sich extrem unsicher ist ! Genau, das glossar kann ja zusätzlich durch admins jederzeit angepasst werden für die sprachen“
- **d-order-note:** „Also ich würde das klassifizieren lassen, manchmal steht community direkt nach admin, manchmal ganz am ende hinter ki, ich würde die ki entscheiden lassen wo es nach admin seinen platz einnimmt bzgl. der spezifischen übersetzung, denn das mag für einen key so sein, für einen andernen key keinen sinn machen, naja und wenn selbst die ki nicht entscheiden kann was das beste ist (auch konsistenz der eigenen übersetzung warend), dann legt es die entscheidung dem admin vor“
- **d-nopack-note:** „Gern als hinweis beim public release bewerbend auch rein, dass wir hier nochmal nachholen müssen (insb. koreanisch und polnisch). Aber bei thord82 fragen, warum? Verlangt das seine lizenzbestimmung? Wenn nicht nutzen wir es und dann wenn public releasee schreiben wir ihn an!? so wie bei den anderen auch.“
- **briefing-note:** „cig eigene geht immer vor! also die blind übernehmen, nur für admin korrekturen oder so ist das ok, wobei ewnn cig dann den original text updated soll in scc web für  die admins ein hinweis erscheinen, dass diese übersetzung im original angpesst wurde und ggf. die änderung die sie gemacht haben nicht mehr stimmt (da sollte auch das original diff stehen, damit sie bewreteen können ob sie ihre änderung ggf. ändern )“

### Runde 2 — Entscheidungen
- d2-license (Lizenzregel Deutsch und Russisch) → "ok"
- d2-unlicensed (Pakete ohne Erlaubnis) → "draft"
- d2-drafts (Inhalt der Anfrage-Entwürfe) → ["lic","stats","lang","approve","log"]
- d2-base (Angleichung der Paket-Zeilen an CIG) → "terms"
- d2-arbiter (Schiedsrichter pro Key) → "guarded"
- d2-revise (Revision bestehender Einträge) → "hysteresis"
- d2-card-order (Sortierung der Kartenliste) → ["spread","reach","kind","doubt","fresh"]
- d2-card-form (Aufbau einer Karteikarte) → ["ab","own","note","rule","ctx","skip"]
- d2-gamify (Motivation der Kartenliste) → "quiet"

### Runde 2 — Kommentare wörtlich
- **d2-license-note:** „Lass uns die namensnennung einfach immer machen in gleicher form, egal was ide lizenz sagt, solange es lizenzkonform ist ! Und auch in den bewerbungen festgehalten wer wie infomriert wird, diese dann aber erst später wie ebsprochen“
- **d2-gamify-note:** „gern auch rangliste und punkte!“
