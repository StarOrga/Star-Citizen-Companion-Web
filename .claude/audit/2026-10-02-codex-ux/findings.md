# Codex Design & UX Audit — consolidated findings (2026-10-02)

Sources: lens-static.md (S), lens-live.md (L), lens-tests.md (T). Status: **fixed** (with spec), **open** (reason).

## Search (REQ-1)

| ID | Sev | Finding | Status |
|---|---|---|---|
| S03/S04 | high | Five search boxes, five matching rules; "p4ar", "p4 ar", umlauts, double spaces, `_` missed | fixed — shared `codex-search.ts` dialect on index, Bridge, terminal, Ctrl+K, FPS, keybinds, picker, upcoming |
| S01/L02 | high | Alphabetical results; exact name below liveries/skins | fixed — exact > prefix > word run > substring, maker-stripped ship names, base before skins |
| S02 | high | Terminal truncated to 6/kind before ranking | fixed — over-fetch ×4, rank, then truncate |
| L03 | high | Duplicate cards (landing, Ctrl+K) | fixed — per-kind dedupe |
| L04 | high | "P4-AR" returned a Caterpillar BIS | fixed — server superset re-checked with the shared matcher |
| L05 | high | German words (Gewehr, Helm, Rüstung) found nothing | fixed — DE→EN search synonyms (server + client); FPS also matches the payload's German names |
| L01 | crit | Landing hit cards covered by an unstyled pin star | fixed |
| L07 | high | Index empty state hid "found in other category" | fixed — category anchors lead the empty state |
| L08 | high | FPS search silent about the other tab | fixed — "in Rüstung suchen" anchor |
| L13 | high | Bridge scrolled sideways (4000px) | fixed — verified headless Chromium 1440/390 |
| S05 | med | FPS search ignored manufacturer | fixed |
| S09/T | low | Bridge/terminal clear raced an in-flight search | fixed |
| L16 | med | Two clear "×" per field | fixed |
| L17 | med | Keybinds lost `q` on reload/back | fixed |
| L27/L28 | low | Bridge empty text, untrimmed `q` | fixed |
| L06 | high | No typo tolerance ("Gladus") | open — needs a pg_trgm `similarity()` RPC + migration (not done unattended) |
| L05b | — | Server-side German *names* (not only words) | open — `name_localized` is English only; needs a search column/index migration |
| S06 | med | "Also found in" gated to ≥3 chars | kept — trigram index can't help below 3 chars |
| L15 | med | Arrow keys from terminal into results | open — M, keyboard model for the hit grid |
| L18/L19 | med | Keybind names half DE/EN, raw ids; item names differ across pages | open — data/localisation work |
| L33 | low | Typing replaces the history entry | open — product decision |

## FPS set selection (REQ-2)

| ID | Sev | Finding | Status |
|---|---|---|---|
| S11/L10 | high | Slot tiles said only "offen", armour tiles had no visible slot name, text cut on mobile | fixed — slot label, "+ Auswählen" / "Ändern", 2-line clamp + tooltip |
| S12 | med | No confirmation after equip | fixed — sticky "✓ … ausgerüstet · Zurück zum Set" bar |
| S13/L11 | high | Equip button cryptic ("IN SLOT: HELM"), below the fold, toggles to remove silently | fixed — "Als Helm ausrüsten" / "Aus Helm entfernen", ≥44px touch, compact band |
| L12 | high | Reset in equip mode dropped the slot filter | fixed |
| L21 | med | Armour tiles had no clear control | fixed — clear + undo shared with weapons |
| L32 | low | Back link always to /codex | fixed — "Zurück zum Hangar" when coming from the Hangar |
| — | — | Empty set had no hint | fixed — one flow hint until the first piece |
| L09 | high | No "add to set" from FPS list / item detail; sets only creatable in Hangar | open — L effort, new controls; needs a decision on the entry point |
| L20 | med | Armour equip jumps back, weapon equip stays; `slot=` vs `equipSlot=` | open — flow unification |
| L22 | med | Tile count 677 vs list 644 | open — needs data check of filters |
| L14 | high | FPS mobile: filters fill the first screen | open — structural (collapsible filters) |

## Other pages (REQ-3)

| ID | Sev | Finding | Status |
|---|---|---|---|
| S18 | low | Swap picker load failure had no retry | fixed |
| S17 | low | Danger red on non-destructive hovers | fixed |
| L25 | med | Weapon detail showed "WeaponPersonal", "Medium" | fixed — worded via i18n |
| L30 | low | Upcoming: raw "industrial", "MINING / REFINING" | fixed — role labels DE/EN + Title Case fallback |
| L31 | low | Touch targets < 44px | fixed in index/FPS/bridge/set/landing pin |
| S15 | med | Three hand-rolled dialogs instead of `[scDialog]` | open — they already trap/escape/return focus; refactor risk |
| L23 | med | Bridge "Frisch in diesem Patch" is alphabetical | open — feed from build diff |
| L24 | med | Landing for a new user: empty hangar panel, no CTA | open |
| L26 | med | Gladius Kampf-Profil empty / "0 im Modell" (headless WebGL?) | open — verify in a real browser |
| L29 | low | Blueprint: doubled ingredient name, units | open |

## Tests (REQ-4)

Codex specs: 1666 → 1763 (all green, 0 skipped). Full app suite green. New: shared search dialect, service token/synonym/post-filter, poly ranking, landing pin + clear race, keybinds URL/dialect, picker retry, upcoming roles, detail facts, upcoming-grid search, index/FPS/bridge empty states, set page tiles/clear/back link.
