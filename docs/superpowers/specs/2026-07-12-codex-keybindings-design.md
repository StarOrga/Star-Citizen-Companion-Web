# Codex Keybindings — Design (2026-07-12)

## Goal

Extract the **complete** Star Citizen default keybindings from `Data.p4k` — every
actionmap and action, every device default, **including all localizations** —
store them in the Codex data model, upload them via the Data Uploader, and
surface them in the Codex behind a **subtle toggle** as a lean, searchable
reference.

## Approved scope

**Lean reference UI.** Categories (actionmaps) + search + device filter +
localized labels, read-only. A visual keyboard/gamepad diagram is explicitly
deferred to a possible v2. Extraction is always exhaustive regardless of UI depth.

## Source of truth

- **Bindings:** `Data/Libs/Config/defaultProfile.xml` in the P4K — the canonical
  default action profile (actionmaps → actions → per-device default bindings).
- **Labels:** action/category `UILabel`/`UIDescription`/`UICategory` are raw
  `@`-keys resolved against `Data/Localization/<lang>/global.ini`. Those tables
  are **already** extracted in full, for every discovered language, by
  `CodexExtractor.dump_localization()` into `codex_locale_strings`. Keybinding
  labels therefore resolve in every language with **no new translation work** —
  we store only the `@`-keys and resolve client-side, exactly as the rest of the
  Codex already does for ship roles / port labels.

## Architecture

### 1. Extraction (Python — `data-uploader/python/sc_extract/`)

- New `keybinds.py`: `parse_default_profile(xml_bytes) -> dict`.
  - Parse `<actionmap name UILabel UICategory>` → category rows.
  - Parse `<action name UILabel UIDescription ActivationMode>` → action rows.
  - Default bindings resolved from **both** forms: `<rebind device= input=>`
    children **and** device attributes on the action (`keyboard=` / `mouse=` /
    `gamepad=` / `joystick=`). Defensive: unknown devices ignored, malformed
    entries skipped.
  - **Unbound actions are kept** (completeness guarantee).
  - Store raw `@`-keys verbatim — no translation performed here.
  - Output shape:
    `{ "actionmaps": [{name, labelKey, categoryKey, sort}],
       "actions": [{actionmap, name, labelKey, descriptionKey, activationMode,
                    bindings: {keyboard, mouse, gamepad, joystick}}] }`.
- `CodexExtractor.dump_keybinds(p4k)`: locate the profile entry
  (case-insensitive suffix match on `libs/config/defaultprofile.xml`), read,
  parse, write `keybinds.json` to the extract dir, return the action count.
  Called from `run()`; emits `count("keybinds", n)`.
- `thresholds.py`: add a tolerant `keybinds` counter threshold.
- `extract.py`: include `keybinds` in `entity_counts` + the manifest.

### 2. Data model (migration `20260712_codex_keybinds.sql`)

`public.codex_keybinds`:

| column              | type  | note                                   |
|---------------------|-------|----------------------------------------|
| build_id            | uuid  | fk `codex_builds(id)` on delete cascade |
| actionmap           | text  | category / actionmap name              |
| action_name         | text  | action key (permalink within map)      |
| label_key           | text  | `@`-key for the action label           |
| description_key     | text  | `@`-key for the action description     |
| category_label_key  | text  | `@`-key for the actionmap label        |
| activation_mode     | text  | press / hold / …                       |
| binding_keyboard    | text  | promoted default binding (nullable)    |
| binding_mouse       | text  | promoted default binding (nullable)    |
| binding_gamepad     | text  | promoted default binding (nullable)    |
| binding_joystick    | text  | promoted default binding (nullable)    |
| payload             | jsonb | full action record (future-proof)      |
| sort                | int   | stable display order                   |

PK `(build_id, actionmap, action_name)`. Index `(build_id, actionmap, sort)`.
RLS mirrors the Codex convention: **anon + authenticated `select using (true)`**
(Codex is public since #131), writes revoked from anon/authenticated
(service-role only). Labels resolve via the existing `codex_locale_strings` +
`CodexService.resolveLocaleKeys` — no denormalized translations stored.

### 3. Uploader (Electron — `data-uploader/src/`)

- `main/catalog-bridge.ts`: after the catalog upsert, read `keybinds.json` and
  upsert into `codex_keybinds` for the build (mirror the existing per-entity
  upserts). Add `keybinds` to the default extraction scope (on).
- Summary UI reports the keybind count. New UI strings added to **all 7**
  `src/i18n/*.json` (de/en real, others English fallback — the existing pattern).
- `vitest` for the json → rows mapping.

### 4. Frontend (Angular — `src/app/codex/`)

- Route `/codex/keybinds` (public), placed **before** `/codex/:kind/:className`
  so the static segment is not consumed by the `:kind` wildcard (same rule the
  `blueprint` / `index` routes already follow).
- **Subtle entry point:** a second chip next to the existing `.index-link` in
  `codex-bridge.component.ts` scanner-row → `routerLink="/codex/keybinds"`,
  i18n key `codex.bridge.keybinds`. This is the "dezent irgendwo umschalten".
- `keybinds.component.ts` (+ keybind queries on a small service or an extension
  of `codex.service.ts`): load the current build's `codex_keybinds`,
  batch-resolve every `label_key` / `description_key` / `category_label_key`
  via `resolveLocaleKeys(currentLang)`, group by actionmap (localized category
  heading), render a per-action row with the localized label + the default
  binding for the selected device. Controls: a **device segmented filter**
  (keyboard / mouse / gamepad / joystick) choosing which binding shows, and a
  **search** box filtering by resolved label / binding (in-memory; ~1000 actions
  is trivial). Loading / empty / error states mirror the Bridge.
- i18n `codex.keybinds.*` in `public/i18n/{de,en}.json`.
- Types: `CodexKeybind` model in `codex.types.ts`; `codex_keybinds` row in
  `database.types.ts`.

### 5. Tests + verification

- Python `tests/test_keybinds.py`: a hand-written `defaultProfile.xml` fixture
  covering attribute-form bindings, `<rebind>`-child bindings, an unbound action,
  and multiple devices → assert parsed rows, `@`-key capture, device bindings,
  and that unbound actions survive.
- Uploader `vitest`: json → rows mapping.
- Angular spec: grouping, device filter, search, label resolution (mock service).
- **Manual real-P4K check** (per release, per the uploader README): confirm the
  `defaultProfile.xml` path and `@`-key coverage in `global.ini`.

## Risks / assumptions

- The exact `<rebind>` structure is verified against a real P4K at implementation
  time; the parser is defensive and fixture-covered until then.
- The app UI shows de/en (its supported languages); the **full** language data
  lives in `codex_locale_strings` and resolves for any language the app adds.
- Some actions have no default binding → rendered as "unbound".

## Out of scope (v2)

- Visual keyboard / gamepad diagram.
- The user's personal exported binds (`USER/.../actionmaps.xml`).
- Binding conflict detection.
