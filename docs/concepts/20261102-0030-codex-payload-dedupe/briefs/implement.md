# Implement brief — Codex-Payloads nur einmal speichern

Source: `docs/concepts/20261102-0030-codex-payload-dedupe-decisions.json` (round 1, action `implement`, version 1).

## User input, verbatim

- General note: (empty)
- Inline notes: none
- Pins: none
- Decisions (all touched, none flagged):
  - `d-weg` (single) → `views` — "Payload-Tabelle hinter gleichnamigen Views" (recommended)
  - `d-umfang` (multi) → `items, components, weapons, ships, blueprints, strings, small` — **deviates**: the small tables (Hersteller, Munition, Silhouetten) are added on top of the recommendation
  - `d-suche` (single) → `column` — "Gespeicherte Suchspalte auf der Zeilentabelle" (recommended)
  - `d-retention` (slider) → `3` Builds (recommended)

## Findings made while preparing the implementation (prod, 2026-11-02)

- `payload.source` equals `{channel, patch: patch_version, build: build_number}` on all 54 820 catalog rows → stored without it, the view adds it back.
- Entity strings: average value 94 B in a 277 B row. A separate value table would save ~2 MB, not 47 MB. But every string is `payload.{name,description,vehicleName}.{en,de}` (57 153/57 153 rows reproduced from the payloads, 0 differences; 80 keys exist in two kinds, and the table keeps the last-ingested kind) → `codex_entity_strings` becomes a view derived from the payloads, and the stored table goes.
- No view, function return type or FK binds the tables by OID; writers are ingest-catalog, `supabase/scripts/seed-codex.mjs` (direct mode) and `gen-codex-sql.mjs`.

## Checklist (accepted items)

1. [ ] `codex_payloads(sha, body)`: each JSON body stored once, sha256 of the body
2. [ ] items, components, weapons, ships, blueprints, manufacturers, ammunition: base table `*_rows` with `payload_sha`, view with the old name and the old columns (incl. `payload` with `source`)
3. [ ] silhouettes: shape (view_box, path, bbox, anchors, unresolved) as a blob, view `codex_silhouettes`
4. [ ] entity strings: deduplicated (as a view derived from the payloads, see finding)
5. [ ] search: stored `search_text` column + trigram index on the base table; `codex_search` / `codex_search_suggest` read it
6. [ ] retention 3: cron `prune_codex_builds(3)`, blob GC after the prune
7. [ ] writes: ingest-catalog `upsert` / `silhouettes` through `codex_upsert_rows()`; `strings` no-op; `carry`/`prune` on the base tables
8. [ ] codex pages unchanged (same names, columns, RPC results); RPCs under the 3 s/8 s timeouts
9. [ ] cron `vacuum full` jobs on the new names, `codex_payloads` included
10. [ ] tests green, docs (`supabase.md`, `storage.md`), ship
