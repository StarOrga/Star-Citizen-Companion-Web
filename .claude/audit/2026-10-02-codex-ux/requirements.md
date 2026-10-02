# Codex Design & UX Audit — Requirements Catalog

Scope: all Codex pages (`src/app/codex/**`), routes `/codex`, `/codex/index`, `/codex/fps`,
`/codex/keybinds`, `/codex/upcoming`, `/codex/upcoming/:id`, `/codex/set/:id`,
`/codex/blueprint/:className`, `/codex/bridge`, `/codex/:kind/:className`.

| ID | Requirement | Source | Acceptance signal |
|---|---|---|---|
| REQ-1 | Search on every Codex page works without gross mistakes: finds what a player types (names, partial names, manufacturer, German/English), sane ranking, clear empty/no-result state with a way out, no stale/lost state | User 2026-10-02: "viele haben grobe schnitzer, insbesondere die suche!" | Typing a known item name finds it as the first hits on each search surface; empty state offers reset; URL keeps `q` |
| REQ-2 | Selecting gear for an FPS set is discoverable and works end to end (open set → pick a slot → find + choose an item → it is equipped and persisted/visible) | User: "wie wähle ich für mein fps set was aus" | A first-time user can equip an item into a set slot from the set page without guessing; picker has search and clear affordances |
| REQ-3 | Full design + UX audit across all Codex pages (layout, consistency, states, a11y, mobile) | User: "Komplett einen design und ux audit" | Findings with evidence per page; safe fixes applied |
| REQ-4 | Full Codex test suite | User: "inkl. voller test suite für codex" | Every Codex page/flow has specs incl. search + selection flows; `npm test` green |
| REQ-5 | Holodeck-only ship view, 3D component hotspots | #711 (0.115.0) | Ship detail renders holodeck, hotspots navigable |
| REQ-6 | Holodeck motion system, projection layer and 3D | #705 | Motion respects reduced-motion; projection renders |

Implicit (CLAUDE.md): navigations are anchors; no native dialogs/select/title; errors translated with retry
state; all strings i18n (de/en); one page frame (no page max-width); red only for elevated access;
OnPush + signals.
