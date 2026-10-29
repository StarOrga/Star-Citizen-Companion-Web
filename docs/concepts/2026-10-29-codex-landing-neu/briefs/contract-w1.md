# Contract W1 — data layer of the Codex landing

Wave 2 builds the UI against this. Service: `src/app/codex/landing/codex-landing-data.service.ts` (`CodexLandingDataService`, root, signals). Types: `codex-landing-data.types.ts` (same folder).

## Conventions
- Every async method **resolves, never rejects**. On failure it sets `error` (an `errors.*` key via `toErrorKey`) and returns the empty value (`null` / `[]` / empty filmstrip). Render an error state with retry when `error()` is set and the data is empty, not the empty state.
- Display text (name, manufacturer, role) is already in the app language. Numbers stay numbers; units are hints.
- Scope guard: no i18n keys were added by W1. Wave 2 adds: `errors.*` already exist via `describeError`; new keys wave 2 must create for the labels: `codex.landing.value.<key>` for each `LandingValue.key` it chooses to show (keys are payload paths, e.g. `flight.scmSpeed`, `hull.hp`, `armorHp`, `cargoScu`, `crew.size`, `hull.mass`; non-ships emit `weaponParams.<k>` / `stats.<group>.<k>`), and `codex.landing.overview.<id>` for `role|size|manufacturer|type|part|class`.

## Types (exports of `codex-landing-data.types.ts`)
- `LANDING_CATEGORIES = ['ship','fpsWeapon','armor','component','tool']` (= rotation order), `LandingCategory`.
- `LandingItem { category, kind: CodexKind, className, name, eyebrow:{manufacturer,descriptor}, detailRoute: string[] /* ['/codex', kind, className] */, imageUrl: string|null /* RSI render, ships only for now */, previewUrl: string|null /* datamined codex-previews render, NOT RSI */, overview: LandingOverviewField[] /* 3 fields per brief A5 */, topValues: LandingValue[] /* <= 7 */ }`
- `LandingOverviewField { id: 'role'|'size'|'manufacturer'|'type'|'part'|'class'; value: string|null }` — ship `size` is always `null` (no ship size class in the data; wave 2 hides or derives it).
- `LandingValue { key; value: number; unit: 'm/s'|'hp'|'scu'|'kg'|null }`
- `LandingPaint { id, name, imageUrl, rsiUrl|null, recencyAt, isNew }` — only paints WITH an RSI image exist in this type.
- `FilmstripTile { id, name, manufacturer, imageUrl|null, route: string[], isNew }`, `Filmstrip { tiles, more /* for "+ N weitere" */, total }`
- `PatchSummaryView { patchVersion, lines: string[] /* 1..3 */, generatedAt, patchNotesUrl /* always set */, patchNotesIsThread }`
- `RSI_PATCH_NOTES_OVERVIEW_URL`, `FilmstripMoreQuery` (facts for the Codex search link; param names are wave 2's).

## Service API
| Member | Returns | Notes |
|---|---|---|
| `error` | `Signal<string\|null>` | last failure key |
| `rotationItems()` | `Promise<LandingItem[]>` | newest per category, rotation order; categories with no data omitted |
| `newestItem(category)` | `Promise<LandingItem\|null>` | memoised per build + category |
| `paintsFor(className, shipName?)` | `Promise<LandingPaint[]>` | newest first (stable; selection never reorders); `isNew` = younger than 30 days (`NEW_PAINT_DAYS`); matches `class_name` OR normalised ship name; `[]` for non-ships |
| `flightReadyFilmstrip(limit=12)` | `Promise<Filmstrip>` | new-this-patch ships first, then the rest; tile route `['/codex','ship',className]` |
| `announcedFilmstrip(limit=12)` | `Promise<Filmstrip>` | `UpcomingShipsService.concept()` (feed order = RSI's, no dates); route `['/codex','upcoming',id]` |
| `loadPatchSummary()` | `Promise<PatchSummaryView\|null>` | fills `patchSummary`; call again on language switch; `null` = hide the News button |
| `patchSummary` | `Signal<PatchSummaryView\|null>` | |
| `newsUnread` | `Signal<boolean>` | summary exists, signed in (any role), prefs loaded, patch not yet seen |
| `markNewsSeen()` | `void` | writes `profiles.ui_prefs['codex.newsSeen'] = patchVersion` via `set_ui_pref` (all devices) |

"Newest" definition: ships = first ship the previous LIVE build lacked (build diff), else first ship; other categories = first candidate whose class_name the previous build lacked, else the first candidate (name-sorted). "Flight-ready": every game-data ship is flying by definition; variants/AI templates are excluded. `tool` = ship utility heads (`TractorBeam`, `TowingBeam`, `SalvageHead`, constant `TOOL_ATTACH_TYPES`) — change the constant if "Werkzeug" should also cover FPS tools.
Search link for "+ N weitere": link to the Codex index with `kind=ship`, flight-ready, sort newest (`FilmstripMoreQuery`); the index must support those params (wave 2).

## Backend (not deployed — shipping is a separate step)
- Migration `supabase/migrations/20261029130000_codex_landing_data.sql`: `codex_builds.patch_summary jsonb` ({de[],en[],model,generated_at}, check <= 3 lines each); `codex_build_diff_digest(uuid)` (service role only); table `rsi_ship_paints` (URL + metadata, public read, service write). **News-seen state needs no migration**: it uses the existing `profiles.ui_prefs` + `set_ui_pref` RPC (granted to every `authenticated` user incl. viewer, own row).
- Edge function `codex-patch-summary` (service role): called from `ingest-catalog` `finalize` after the response; idempotent (`exists` unless `force`), graceful (`no_key`, `empty_diff`, `model_failed` leave `patch_summary` null). Secret: `ANTHROPIC_API_KEY` (already used by `sc-events-sync`); model `claude-sonnet-5-5`, override secret `CODEX_SUMMARY_MODEL`. Backfill the live build by POSTing `{build_id, force:true}` with the service key.
- Edge function `rsi-paints-sync` (service role, manual / scheduled call): crawls the RSI store skins listing, upserts `rsi_ship_paints`, maps paints to `class_name` by ship name against the LIVE build. Paints without an RSI https image are never stored.

## Open points / unverified
- The RSI store GraphQL query and the skin product id (190, secret `RSI_SKIN_PRODUCT_ID`) follow the pledge store's own request shape from memory; unauthenticated probing returned a server error, so the first real run decides. The parser is tolerant: a wrong shape stores 0 paints instead of failing.
- No scheduler wired for `rsi-paints-sync` (add a pg_cron/GitHub schedule after the first successful manual run).
- Migration and digest RPC were NOT dry-run (no headless DB access from this agent); run in `begin ... rollback` before `db push`. `codex_build_diff_digest` walks payloads to depth 4 for ships/weapons/components/items; watch its 25 s timeout on the real data.
- Top values for non-ship categories are generic payload scalars (no curated list); wave 2 may re-order or curate by key.
