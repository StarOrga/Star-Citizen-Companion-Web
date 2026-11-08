# Implement brief — batch feedback: Codex, HQ, rights colours

Decisions: [../../20261108-1830-batch-feedback-codex-hq-decisions.json](../../20261108-1830-batch-feedback-codex-hq-decisions.json)
Notes (verbatim, archived): `.claude/batch-2026-11-08T17-28-19-904Z.md` (worktree root)
Screenshots: `docs/concepts/20261108-1830-batch-feedback-codex-hq/assets/` — open the one of your bundle with Read BEFORE any change.

Base: branch `claude/batch-4f25ee`, which already contains main (2f18ea76) AND the whole parallel batch `claude/batch-fd9db5` (a50370ef, PR #1024 in flight). Do NOT rebuild what fd9db5 already did — read it first (`git log 2f18ea76..a50370ef`).

## The user's own words (notes, verbatim)

- #1 „schau mal die data uploader cpu anzeige funktioniert imme rnoch nicht, bitte voll robust machen !“ — assets/… see `.claude/batch-assets/2026-11-08T15-13-19-792Z-1.png` (dock: CPU 100 %, Uploader 18 %, andere 82 %; Task Manager at the same moment: 81 % total, Data Uploader 16,6 %)
- #2 „lass uns das ansehen als streichen als text dort in rot durchgestrichen. Außerdem lass uns eine Farbe für collaborateur einführen, vllt. orange, das heißt alle elmente die admins + collaborateujrs sehen, aber nicht viewer, die bekommen diese farbe, z. B. etwas zwischen rot und blau, abgeschwächtes rot / orange, aber matter als das rot, nicht so eye catching“ — assets/2026-11-08T15-40-42-602Z-1.png
- #3 „Hintegrund ist, ich will nirgendnwo auf der gesamten website die hinweise nur für admin und collaborateuure oder nur für admin... sondern das soll implizit klar werden durch die beiden farben“
- #4 „Wir haben doch die such detailseite, also wenn ich nicht suche und dort das popup habe sondern wenn ich die übersicht mit allen netiäten habe und links den filter usw. Können wir das bitte als zweite seite unter codex einführen? Mit dem gleichen scrollverhalten wie bei verse wenn man zu mehr im verse runterscrollt. Mehr in Codex sollte es dann dort heißen, natürlich dann mit subheader und nicht dem haupt header, eigentlich genauso wie in verse außer das der view content diese detailseite dann ist. Andere seiten die daruaf verlinken dann auch gern neu dahin führen“
- #5 „bitte companion hier raus nehmen aus dem button, einfach app downloaden. Außerdem bei der event anzeige, einfach erste zeile offene events zweite zeile events nenennen , aber nicht in ersrte zeiele reinschreiben und auch keine dritte ziele machen, auch ke9in überlauf oder ... !“ — assets/2026-11-08T16-06-14-646Z-1.png
- #6 „warum ist scc app verbundne grün, obwohl unter der ersten hq seite direkt steht das sie nicht verbunden ist! check das nochmla, das sollte synchron sein zur hq startsetie !“ — assets/2026-11-08T16-11-36-113Z-1.png
- #7 „mach hier oben mal die sternenkarte in klein die aktuelle statt so eines runden icons... Außerdem nennnen wir unten alles komet obwohl wir ja sagen, die sonne ist die assoziation mit dem patch und patch zeitpunkt... Außerdem warum gesetzt - wartet auf live... wir sind doch schon drüber und unser tipp war quatsch...“ — assets/2026-11-08T16-15-16-791Z-1.webp
- #8 „Warum ist das datenblatt rechts nicht immer so groß wie links auch und bitte nicht scrollable, wenn dann kann der nutzer auf den button klicken um dort rein zu gehen“ — assets/2026-11-08T16-34-52-055Z-1.webp
- #9 „in den letzten 24h hast du hier informationen rausgenommen und die informatione auch fnichth gut dargestellt (leiste rechts hatte graphen) Infomraitenon mussten nicht im kleinen kasten gescrollt werden, roll das zumindest teilweise back und führe auch für alle nicht schiffe die klasssiche vs holotisch variante ein. Klassische = vor 24h und holotisch die aktuelle darstellung für diese nicht schiffe codex sachen! Bitte ändere die klassische nciht“ — assets/2026-11-08T17-25-55-245Z-1.png

## Concept comments (round 1, verbatim)

- d-more-codex: „exakt so wie mehr in verse! vom mechanismus“

## Decisions (round 1 — all recommendations kept except d-sun-name)

| Decision | Value |
|---|---|
| d-collab-tone | Kupfer gedämpft `#c27a5a` |
| d-hint-a11y | visible text gone, kept as sr-only + `[scTooltip]` |
| d-rule | rewrite CLAUDE.md rule to two colours without visible text |
| d-more-codex | scroll on /codex exactly like „Mehr im Verse“ (same mechanism), own URL for the lower part, old links redirect there |
| d-datasheet | show the most important values that fit, rest via the button; same height as left, never scroll |
| d-classic | restore the non-ship detail page as of 2026-11-07 ≈ 18:00, frozen afterwards; Holotisch = second view |
| d-holo-back | Holotisch gets back: graphs in the right rail + no scrolling inside the small box (NOT the Top-3 block) |
| d-default-view | Klassisch first, afterwards the last chosen view is remembered |
| d-conn | only the SCC Companion app counts as "Companion-App verbunden"; start page and Jetzt read the same source |
| d-event-line | line 1 „{{n}} offene Events“, line 2 as many full names as fit, then „+N“; no date, no third line, no ellipsis |
| d-sun-name | **„Patch-Tipp“** (user deviated from „Sonnen-Tipp“) — replaces „Komet“ in all UI texts |
| d-fd9db5 | merged into this branch (done); adapt its b5 changes in the spirit of #9 |
| d-minimap | yes: the real current star-map shape as a small graphic in the header, no circle; recognised stars glow |

## Checklist (one line per accepted item — each agent returns done / partial / not done + evidence)

### B1 Uploader CPU (#1) — files: data-uploader/src/main/resources.ts, data-uploader/src/lib/resource-limits.ts, data-uploader/src/lib/dock-metrics.ts, sysmon sampler, dock renderer
- [ ] C1 Root cause found why total shows 100 % while Task Manager shows 81 % (resources.ts:851 takes sys.cpuPct from sysmon/PDH; check counter: "% Processor Utility" vs "% Processor Time", normalisation/cap, "andere" = total − uploader). Prior attempts #916, #919 failed — write down why.
- [ ] C2 Fix matches Task Manager within ±5 pp under load; robust fallback when sysmon/PDH is missing or stalls (stale sample detection), never a frozen or 100 % value.
- [ ] C3 Uploader specs cover the counter math and the fallback (data-uploader test suite green).

### B2 Rights colours (#2, #3) — files: src/styles.scss (new token, e.g. `--sc-accent-collab: #c27a5a`), profile menu / „Ansehen als“, every „Nur Admin“ / „Nur Admin & Collaborator“ hint in templates + public/i18n/{de,en}.json, CLAUDE.md rule
- [ ] C4 New token for admin+collaborator surfaces; red stays admin-only; cyan stays for everyone.
- [ ] C5 Every element visible to admin+collaborator but not viewer uses the new colour (menu entries, nav, Data Uploader, „Ansehen als“ group…).
- [ ] C6 No visible „Nur Admin“ / „Nur Admin & Collaborator“ / „nur für Admins“ text anywhere on the site; meaning kept as sr-only text + `[scTooltip]`. Known keys: de.json adminOnly (~173), restricted (~183), ~1050, ~3975, ~4506, ~6736, ~6896, ~7000, ~7913 — sweep for more.
- [ ] C7 CLAUDE.md „Red means elevated access“ rewritten: two colours, no visible words, a11y via sr-only/tooltip.

### B3 „Mehr in Codex“ (#4) — files: codex routing, the overview/browse page (filter left), new lower section on /codex, links pointing to the overview. After B4.
- [ ] C8 Same mechanism as „Mehr im Verse“ (verse-briefing.component.ts, briefing-dock.ts, verse-briefing-planet.scss, i18n verse.more): scrolling down on /codex moves into the overview; label „Mehr in Codex“; subheader instead of main header in the lower part.
- [ ] C9 Lower part has its own URL (deep link) and restores filters from the URL.
- [ ] C10 Every link that used to open the overview leads to the new place (e.g. „Alle Raumschiffe“, search „alle Ergebnisse“, crumbs).

### B4 Codex landing data sheet (#8) — files: src/app/codex/landing/codex-landing-values-pane.component.*, landing grid
- [ ] C11 Data sheet always as tall as the left Codex column; never scrolls.
- [ ] C12 Rows by priority — as many as fit; the rest only via the „Zur …-Seite“ button. Layout matrix QHD / Full HD / laptop / phone.

### B5 Codex detail Klassisch / Holotisch for non-ships (#9) — files: codex-detail.component.ts, codex-weapon-detail.component.ts, src/app/codex/holo/, codex-analysis-panels, codex-detail-holo-toggle.spec.ts
- [ ] C13 „Klassisch“ = the non-ship detail page as of 2026-11-07 ≈ 18:00 (main before #995 7d08c169; candidates touching it: #995, #996, #1001, #1005 and fd9db5-b5), reconstructed from git and then left unchanged.
- [ ] C14 „Holotisch“ = today's view, for ALL non-ships (missiles, weapons, components, gear); toggle like the ship toggle.
- [ ] C15 Holotisch gets back the graphs in the right rail and no scrolling inside the small values box. Top-3 block NOT restored.
- [ ] C16 First visit opens Klassisch; afterwards the last chosen view is remembered (same prefs mechanism as ships, codex-prefs.service.ts).
- [ ] C17 Checked on MISL_S02_IR_NOVP_Rattler, one weapon, one component.

### B6 HQ start + connection status (#5, #6) — files: src/app/hq/start/hq-start-tiles.component.ts, src/app/hq/now/hq-live-ticker.component.ts, src/app/hq/now/hq-now.component.ts, hq i18n
- [ ] C18 Button text „App downloaden“ (de.json downloadCta ~6214, en accordingly).
- [ ] C19 Event marker: line 1 „{{n}} offene Events“ only; line 2 as many full event names as fit, then „+N“; no date, no third line, no overflow, no ellipsis (hq-start-tiles.component.ts ~165–167, key hq.events.marker).
- [ ] C20 „Companion-App verbunden“ only when the SCC Companion app is connected — not Starscape (today hq-live-ticker.component.ts:72 and hq-now.component.ts:471 read conn.stateFor('starscape')). Start page, Jetzt pill and Jetzt hint box read ONE shared source and always agree.

### B7 Star map (#7) — files: src/app/verse/starmap/explorer-page.component.ts, comet-track.component.ts, starmap i18n
- [ ] C21 Tip after its day reads „daneben“ instead of „gesetzt · wartet auf LIVE“ — verify a5f8f44a (from fd9db5) covers the screenshot case (4.11 tip Sa 31 Okt, today 8 Nov, patch renamed 4.11→5.0).
- [ ] C22 Every UI „Komet“/„Kometen“ wording becomes „Patch-Tipp“ (starmap.comet.*, Patch News Kometen-Tipp, briefing, rules, toasts, aria) — de + en.
- [ ] C23 Header: the real current star-map shape as a small graphic instead of the round icon, no circle; recognised stars glow; no more than the big map reveals.

## Rules for every agent

- Project CLAUDE.md applies (i18n for all strings, scAction, no native dialogs/tooltips, tokens, errors via toErrorKey, real anchors for navigation).
- Never touch another bundle's files. Shared file `public/i18n/{de,en}.json`: add/change only your own keys.
- Return an acceptance table: checklist id → done / partial / not done → evidence (file:line, spec name, screenshot path).
