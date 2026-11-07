# Implement brief: backlog decisions of 2026-11-07

Generated from the submitted round 1 (`action: implement`, submission `sub-mw5q5g2t-0lbizxvs`).

- Payload: [20261107-0200-backlog-entscheidungen-decisions.json](../../20261107-0200-backlog-entscheidungen-decisions.json)
- Round: [rounds/01.html](../rounds/01.html)

## User comments, annotation answers and pins

None. Every note field, the general comment and the pin list were submitted empty. The decisions below are the whole input.

## Decisions as submitted

| Decision | Chosen option | Recommended | Deviates | Touched |
|---|---|---|---|---|
| d-goals, #895 | `progress`: "Fortschritt pro Blueprint in Planen zeigen" | progress | no | yes |
| d-runs, #900 | `verify`: "Erst einen echten Handelslauf aufzeichnen" | verify | no | yes |
| d-routes, #902 | `prices`: "Preis-Service sofort bauen" | follow | **yes** | yes |
| d-groups, #903 | `groups`: "Ja, echte Gruppen bauen" | social | **yes** | yes |
| d-shared, #938 | `einsatz`: "Ein geteilter Einsatz mit Crew-Zusagen" | einsatz | no | **no, preselection left as is** |
| d-em, #967 | `extract`: "Echte Werte aus dem Extraktor holen" | honest | **yes** | yes |
| d-radar, #842 | `aim`: "Aim-Assist-Reichweite zeigen, klar beschriftet" | gap | **yes** | yes |

Consequence texts the options carried, verbatim:

- progress: "Klein: eine Karte über den vorhandenen Zeilen, zum Beispiel 3 von 5 Materialien da. Keine Migration."
- verify: "Du handelst einmal mit der aktualisierten App, dann wird nach den echten Events gebaut. Bis dahin bleibt #900 offen."
- prices: "Warenpreise mit Quelle und Alter über einen Edge-Proxy. Nützlich, aber zunächst nur eine Kopie von UEX."
- groups: "Einladungscode, Rollen und RLS über Mitgliedschaft, vorab mit Sicherheitsprüfung. Groß."
- einsatz: "Baut auf `get_einsatz_crew` auf. Mittel, und das Ziel ist ein konkreter gemeinsamer Plan."
- extract: "Der saubere Weg, falls die Spieldaten sie enthalten. Braucht einen Uploader-Release und einen Data.p4k-Lauf."
- aim: "Eine Zahl ist da, aber nicht die, nach der Spieler beim Radar suchen."

## Checklist

Each builder returns one row per line it owns: item, `done` / `partial` / `not done`, evidence (file:line, test, screenshot). A line without evidence counts as `not done`.

### #895 Blueprint progress in Planen

- [ ] G1 HQ Planen shows one progress card per blueprint that has material lines in Nachschub, for example "3 of 5 materials".
- [ ] G2 The card reads the existing `hq_supplies` lines linked through `for_class_name` (`src/app/hq/data/item-path.service.ts`). No migration and no new table.
- [ ] G3 The card is a real anchor to the blueprint, and it renders empty and load-error states per the project rules.

### #900 Trade runs

- [ ] R1 No code. The issue records the decision: build only after a real trading run recorded `shop.purchase` and `shop.sale` events, including one purchase with quantity above 1. It stays open.

### #902 Commodity price service

- [ ] P1 An Edge Function proxies commodity prices from UEX. No key in the repo or client bundle. Responses carry source and age and are cached.
- [ ] P2 A service in the app exposes prices per commodity and terminal with source and age.
- [ ] P3 HQ Planen shows the prices, labelled as a community source with their age, with loading, empty and translated error states with retry.
- [ ] P4 Route and profit model and the comparison with own runs stay open in #902. They wait for #900 and are not built here.

### #903 Real groups

- [ ] H1 Security review of the planned RLS before the migration is applied: a `devops:redteam` pass on the design, findings closed before merge.
- [ ] H2 Group, membership and role tables, RLS by membership without recursive policies, a dropped legacy table only if documented in the migration comments.
- [ ] H3 Create a group, join through an invite code, rotate the code, leave, remove a member, delete a group. The last owner cannot leave a group without an owner.
- [ ] H4 An Einsatz can be shared with a group and members see it with crew slots and RSVPs. A non-member sees nothing, proven by a test running as that role.
- [ ] H5 The existing owner-private `friend_groups` and friend shares keep working unchanged.
- [ ] H6 UI in HQ or Social for all of H3 and H4, localized, using `scAction`, `ScConfirmService` for destructive steps.

### #938 Shared goal as a shared Einsatz

- [ ] S1 On the Social page a friend can be invited into a shared Einsatz as the shared goal, reusing `get_einsatz_crew`, `einsatz_crew_slots` and `einsatz_rsvps`.
- [ ] S2 Everyone involved sees who accepted, who declined and which slots are open.
- [ ] S3 No new goal entity and no metric target.

### #967 Stealth EM from the extractor

- [ ] E1 Check a real `Data.p4k` for idle and maximum EM source fields and record what exists, with the path of each field.
- [ ] E2 If they exist: the extractor writes them, `withPowerSignature` (`codex-power.ts`) and the axes (`codex-rank.ts`) read them, and `emIdle` and `emMax` show real values.
- [ ] E3 If they do not exist: nothing is invented. Report it as `needs-decision`, because the chosen option assumed the data exists.
- [ ] E4 Mining, salvage, medical and refuel stay out of scope.

### #842 Radar aim-assist range

- [ ] A1 Radar items carry the aim-assist range from `dataforge_extract.py`, and the UI labels it as aim-assist range, never as radar or detection range.
- [ ] A2 The acceptance criterion in the issue is reworded accordingly.
- [ ] A3 Cargo, radar export and silhouette skip reasons are confirmed by a real `Data.p4k` run.

## Independent check

Before the final report a `devops:qax` that built nothing compares this checklist with the diff and with screenshots of the real result. Its verdict wins over the builders' tables. Every `partial` or `not done` line becomes a shortfall.
