# Parity — HQ Bestand (design `frachtdeck3`, round 3)

The checklist is `briefs/implement.md`; this file maps its visible lines to the binding mock. Mock = `rounds/03.html` (CSS prefix `d14-`, shared Frachtdeck parts `d10-` from `rounds/02.html`). Open the built page `docs/concepts/20261108-2135-hq-bestand.html`, tab "Runde 3", to see each screen. Viewport: desktop (the concept declared no phone form factor; X2 is checked on 375 px separately).

| Line | Mock screen | Mock selector(s) | What must match |
|---|---|---|---|
| F1 | a3-s1 Alles, a3-s2 Inventar | `.d10-tabs` | Four tabs incl. Alles, no SCU/counts on tabs, order Alles · Inventar · Hangar · Sammlung |
| F2 | a3-s1, a3-s9, a3-s10 | `.d10-tabs svg` | Same path icons as the search (`PATH_ICONS`) |
| F3/F4 | a3-s2 | `.d14-chips`, `.d14-sub` | "Alle" without number; empty options dimmed with 0, never hidden |
| F7 | a3-s4 Rüstung › Helm | `.d14-sub` | Sub-filter appears only after a kind is chosen; never three full-width chip rows |
| I1 | a3-s1, a3-s2 | `.d14-bays` | Bays = place + system, ≥ 3 letters of the name, width follows the filter |
| I2 | a3-s2 | `.d14-bays small` | Ship cargo labelled with the ship's place (deviation from mock on purpose: mock said "Frachtraum") |
| I3/I5 | a3-s2, a3-s5 | `.d14-crate` | Start-page box, "Ø Q" mark + range, only the reserved part hatched |
| I4 | a3-s5, a3-s6 | `.d14-spec` | Tooltip: "reserviert", amount, exact quality (not in the mock: added by R3 anno-a3-6) |
| I6 | a3-s5 Eisen nach Qualität | `.d14-spec`, `.d14-crate` | Bars per quality band, stacks as containers below |
| I7/I8 | a3-s6 Tabelle | `.d10-btn.sec` (Reservieren, Verkaufen) | Table mode, selection by highlight (not checkboxes), action bar |
| I10/I19 | a3-s3 Ort: Area18 | place `sc-select` | Grouped by system/planet, search, amounts, empty dimmed; sorted by amount |
| I11/I12/I13 | a3-s1 | `.d14-log`, `.d14-used` | Log at the top beside the bays, one connected list, 3 lines + expand, fewer words than the mock |
| I15 | a3-s7 Suche ohne Treffer | `.alt` | Four alternatives; also shown at ≤ 3 hits |
| D4/D5 | a3-s8 Aus dem Bestand planen | `.d14-mix` | Gather line + route; target "existing Nachschub" or new; no cross-Nachschub merge |
| H1/H2 | a3-s9 Hangar | `.d10-tabs`, ⋮ menu | Origin + role filters; "Importieren…" anchor |
| S1/S2 | a3-s10 Sammlung, a3-s2 | chips "Sets" | Kind filters; Sets as Inventar filter with tiles + "+ Set anlegen" |
