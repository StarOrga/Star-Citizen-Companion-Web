# Implement brief: batch Verse, Codex, Search, Stock, Phone

Decisions: [../../20261105-1510-batch-verse-codex-hq-mobile-decisions.json](../../20261105-1510-batch-verse-codex-hq-mobile-decisions.json)
Original notes, verbatim: `.claude/batch-2026-11-05T14-06-25-895Z.md` (worktree root)
Round fragment: `rounds/01.html`

Agents: read your note and every attachment with the Read tool before changing anything. Return one row per checklist line you own: item → done / partial / not done → evidence (file:line, spec, screenshot). A line without evidence counts as not done. Commit only your own owned paths (`git commit -m "wip(<scope>): <what>" -- <paths>`), retry on an index lock, never push or ship. Project rules in `CLAUDE.md` bind (i18n DE + EN, real anchors, one page frame, no native dialogs, translated errors).

## User's words on the page, verbatim (round 1)

- Decision "Inhalt des Patches-Hero" (no option picked, the note is the answer): "[Frage 1] Nein, es soll so bleiben wie heute der hero, eldiglich der text im textteil des heroes soll angepasst werden! Dort dann das wort live rein und entweder Neues zu... oder gern auch einen ki generierten teaser titel dafür..."
- Decision "Admin-Eintrag am Handy" (option `account`): "[Frage 1]  Lass usn das dgenerell ins accoutn menü verschieben! das admin menüpunkt!"
- General comment, about the concept page itself, not the app: "Btw, rechts bei der analyse sind scrollbar abschneidend zu den chatinhalten - dabei sollte ein ganz kleines bisschen platz ist. Seieh anbei, das frage label z. B. funktioniert nicht immer, unklar, wwann es rein kommt und dann auch noch falschen link..." Attachment: `.claude/concepts/20261105-1510-batch-verse-codex-hq-mobile/attachments/265e62eca6292cd214fa95cc01a13bcd9bba7d92c41a898a0fd5d4b88fd2e522.png`. Not part of this app's scope; the session reports it.

## Decisions

| Decision | Value | Status |
|---|---|---|
| d-hero | none, see the note | own answer |
| d-future | roadmap | chosen |
| d-announced | preview | NO answer recorded; the recommendation is the named default, the final report says so |
| d-tabs | active | chosen |
| d-sc | app | chosen |
| d-overview | totals, places, recent, ships, cats | chosen, `cats` beyond the recommendation |
| d-views | place, name, qty | chosen, `age` not chosen |
| d-forms | both | chosen |
| d-admin | account, generally | chosen, deviates from the recommendation |
| d-filter | bar | chosen |
| d-landing | table-first | chosen |
| d-exceptions | bar, hqbar, stage, admin-table | chosen, `plan-list` NOT chosen |

## Checklist

### B1 Verse hero (note #1). Owns `src/app/verse/pages/briefing/`, new migration or edge code if needed
Attachment: `P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\keen-borg-305ff2\.claude\batch-assets\2026-11-05T12-03-37-982Z-1.webp`
Note #1, verbatim: "Wenn ich patches im hero auf verse news sehe in der beta... dann wirkt das so leer, nix aussagend, gar nicht nach news. Ich würde erwarten "Neues in 4.10.3" Also auch mit dem drittenversionstitle. Oder sogar eine ki zhusammenfassung, maximal zeichenlänge geetreu, die 4.10.3 xyz beschreibt oder neues zu 4.11 / 5.0 etc... also auch zukünftige patches. Dabei sollte erwähnt werden ob live, ptu, evocati usw... Bitte pepp das nohcmal auf !"
- [ ] B1.1 The hero's layout stays exactly as today: no new chips, no bullet list, no added body block. Only the title text of a patch item changes.
- [ ] B1.2 That text names the channel in words (LIVE, PTU, Evocati, Hotfix as applicable).
- [ ] B1.3 That text carries the full three-part version ("Neues in 4.10.3"), not the patch line "4.10", where the version is known.
- [ ] B1.4 An AI teaser title replaces "Neues in …" where one exists; "Neues in …" is the fallback. Hard character limit that fits the hero's title without clipping.
- [ ] B1.5 Future patches (4.11, 5.0 …) appear, sourced from roadmap and patch notes (`rsi-roadmap`), marked as planned.
- [ ] B1.6 Strings localized DE + EN under `verse.briefing.*`.
Findings: `verse_digest()` sets title = patch_line, summary = null (`supabase/migrations/20261025121000_verse_digest_gallery_per_series.sql:31`, re-check the newest definition in `20261028120000_patch_channel_builds.sql`). `build:` items are filtered to ptu/eptu; `patch_channel_builds` has hotfix, ptu, evocati. `kickerVersion()` in `briefing-hub.ts:185`. `codex-patch-summary` is the pattern for an AI call (Anthropic key as Edge secret, fails gracefully to null); it only takes build diffs. `rsi-roadmap` answers planned content for the current and next patch; its live response is unverified. Hero title: `verse-briefing.component.html` around line 50-60 uses `st.item.title`. Migrations: never repeat `create extension pg_cron`; a new RPC needs `notify pgrst, 'reload schema'`; give a unique version prefix. Do NOT deploy; the ship does that.

### B2 Codex landing (notes #2, #3, decision d-landing). Owns `src/app/codex/landing/`, `src/app/codex/codex-landing.component.*`
Attachments: `P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\keen-borg-305ff2\.claude\batch-assets\2026-11-05T12-39-07-144Z-1.png` and `P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\keen-borg-305ff2\.claude\batch-assets\2026-11-05T12-39-57-580Z-1.png`
Note #2, verbatim: "lass uns machen, dass wenn man hier draufdrückt es sich nur auf dieser seite öffnet in codex landing page und nicht man auf die subseite kommt! Außer man klickt auf das kleine pfeilchen jeweils! Zudem die kategorien gern horizontal oben machen anklickbar und die aktuelle kategorie immer den namen zeigen. prüfe, dass auch die namen dann horizontal dareinpassen mit den icons!"
Note #3, verbatim: "warum wird hier nicht das icon in der mitte etwas kleiner angezeigt, damit es nicht abgeschnitten ist, oder wenn verfügbar die silhouette wie sonst auch! Also nciht nru für schiffe!"
- [ ] B2.1 Plain left click on a list entry puts that entry on the holotable of this page and holds it.
- [ ] B2.2 Each entry has its small arrow, a real anchor to the subpage. The entry stays an anchor too, gated with `isPlainLeftClick`, so Ctrl/middle click still opens the subpage.
- [ ] B2.3 Announced ships (d-announced, default `preview`): clicking puts name and category icon on the table, without values; the arrow opens the upcoming page.
- [ ] B2.4 Categories are a horizontal, clickable bar at the top of the list: icons, the active category with its name; the others name in a tooltip (d-tabs `active`).
- [ ] B2.5 Fit verified in DE and EN for every category at the real list width, and on a phone.
- [ ] B2.6 The icon in the table centre is smaller and never clipped, in every state.
- [ ] B2.7 Items with a silhouette show it, for weapon, component, item and armor too, like elsewhere; without one the icon stands in.
- [ ] B2.8 Leader lines and dots still land on the figure at the new size.
- [ ] B2.9 Phone order of the landing: title, holotable, list, values, news mark (d-landing `table-first`).
Findings: `codex-landing-codex-pane.component.ts:78` entry anchor; `newestItem` in `codex-landing-data.service.ts:350` only loads the newest per category, so loading a chosen entry by id is new; `LandingCodexEntry` has id, name, route, announced; `pick()/held` in `codex-landing.component.ts:234`. 3D only at `codex-landing-holotable.component.html:13`; `.sil` at `codex-landing-holotable.component.scss:98-107`; silhouettes via `CodexService.silhouette(kind, className)` (`codex.service.ts:1611`), kinds ship, weapon, component, item, armor, and how `codex-browse.component.ts:257` renders one. `codex-landing-values.ts:121` anchors. Phone order: `codex-landing.component.scss:161-176`. Karma renders at 749 px, so media-query assertions test the phone branch.

### B3 Search (notes #4, #5). Owns `src/app/shell/fusion-bar/fusion-search*`, `src/app/codex/search/search-cta.ts`, `src/app/codex/search/codex-search-engine.ts`
Attachment: `P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\keen-borg-305ff2\.claude\batch-assets\2026-11-05T12-50-21-228Z-1.png`
Note #4, verbatim: "die drei icons standard sollten, erst wunschliste, dann nachschub und zuletzt bestand sein in der reihenfolge!"
Note #5, verbatim: "Wenn man zuletzt gesucht idris hat und dann auf daas zuletzt gesucht idris klickt und dann aus der suche raus geht, dann ist man auf einmal in codex landing page, obwohl man weiterhin z. b,. in verse sein wollte wo man war. Bitte gehe alle szenarien durhc und schaue ob man durch suchinteraktiontnbe auch einfach rausgehen oder suche clearen an der stelele bleibt bzw. auf die apssende unterseite kommt"
- [ ] B3.1 Icon order everywhere these three appear: Wunschliste, Nachschub, Bestand (Hangar in the Bestand position for ships).
- [ ] B3.2 Clicking a recent term from any page does not navigate; a regression spec proves the root cause first.
- [ ] B3.3 Every search interaction walked and listed with its outcome: recent term click, Escape, click outside, clear, X, Enter on a term, result row, "all in index", CTA, new-tab click, on Verse, Codex, HQ, Admin. Leaving or clearing stays on the page; a deliberate open goes to the fitting subpage. Each scenario has a spec or a named reason.
- [ ] B3.4 Modified clicks on a recent term still open in a new tab.
Findings: order at `fusion-search.component.ts:365-388`, comment `search-cta.ts:278`. Probable cause of #5, unproven: `<a [routerLink]="['/codex']" [queryParams]="{q:term}">` (`fusion-search.component.ts:397-399`, target line 1035) while `onTermClick` only calls `ev.preventDefault()`; RouterLink's own click listener navigates regardless. Other paths: `openResultsPage` line 1440, NavigationEnd clears the term line 899, hub registration line 918.

### B4 HQ stock (note #7). Owns `src/app/hq/stock/` and a new popup in it
Note #7, verbatim: "Im bestand in hq wenn man etwas hinzufügt, dann wird die seite leider scrollable, das ist schrott. Ich wü+rde eher sagen,, lass uns für den Bestand ein popup aufmachen und dort eine suche mit filtern ähnlich zu sc mit lazy loading und grundsortierung nach ort bzw. ortsfrei aber auch andere ansichten. im bestand sleber sollte dann nur eine übersicht angezegit werden mit schnell links (die das popup filtern) damit die seite nicht scrollable wird!"
- [ ] B4.1 The stock page is an overview that does not scroll, also after adding something, on desktop and phone.
- [ ] B4.2 Overview: totals (items, places; a click opens everything); largest five places plus "ortsfrei"; places with a stand older than seven days; the cards Schiffe, Sets, Erspieltes kept; categories (d-overview, all five).
- [ ] B4.3 Quick links open the popup prefiltered and are real controls with the right semantics.
- [ ] B4.4 Popup with search and filter chips and result rows like the app's own search (d-sc `app`).
- [ ] B4.5 Lazy rendering while scrolling inside the popup.
- [ ] B4.6 Default grouping by place, place-free items as their own group; views: by item with all places beneath, by quantity (d-views). No age view.
- [ ] B4.7 "Wo liegt …?" and the capture form move into the popup; a page button opens "Hinzufügen" directly (d-forms `both`).
- [ ] B4.8 Error and empty states stay: translated errors with retry, signed-out text.
Findings: `hq-stock.component.ts` 447 lines, capture form line 219; `hq-stock-find.ts` reusable; pattern `hq-supplies-popup.component.ts` on `sc-overlay-frame [popup]="true"`; `inv.items()` loads all rows at once (`hq-inventory.service.ts:134`), so lazy means render windowing; rows have name, class_name, qty, unit, so categories (B4.2) need a mapping, e.g. from class_name. State honestly how far that mapping reaches. Paged HQ scroll: `hq-page-scroll.ts`. No native select or tooltip (check-native-ui).

### B5 Phone and Admin (note #6, d-admin, d-filter, d-exceptions). Owns `src/app/shell/main-header/`, `src/app/shell/shell.component.ts`, `src/app/shell/fusion-bar/fusion-bar.component.*`, `src/app/codex/codex-browse.component.ts`, `src/app/hq/plan/map/hq-plan-map.component.ts`, `src/app/hq/hq-page-bar.component.ts`. Runs after B1-B4
Note #6, verbatim: "Die mobile seite beta sieht noch sehr anders, teilweise anders soritert als die desktop seite aus. Die darf ruhig wo sinnvoll mobile angepasst sein, aber z. B. dass admin sachen im admin menüpunkt sind sollte schon so gemacht werdnen. Gern die ganze mobile handy seite nohcmal auditieren das sie genau die elemente bis auf wenige sinnvolle ausnahemn, z. B. suche und subheader etc. von der desktop sseite nimtm"
- [ ] B5.1 The Admin entry moves into the account menu generally, desktop AND phone: no Admin slot in the nav, no sub-row entry. It is red and says admin-only in words (`CLAUDE.md`: Red means elevated access). Check the "API-Tokens" and other admin entries sit together with it.
- [ ] B5.2 `/codex/index` on a phone has only the bar's filter; the `.filter-fab` and its sheet go with the shell on, every facet stays reachable in the bar's panel (d-filter).
- [ ] B5.3 Exceptions kept: subheader as bottom bar, HQ tabs at the bottom, stacked Verse stage, admin table as cards.
- [ ] B5.4 The Plan map's phone text list (`hq-plan-map.component.ts:247-249`) was NOT kept as an exception: the phone shows the map like desktop, usable by touch. Say so plainly if that cannot work.
- [ ] B5.5 Observed in a real signed-in phone viewport, not only from code: HQ page bar and fusion bar at the bottom edge (`hq-page-bar.component.ts:34-44`, `fusion-bar.component.scss:910-925`), fixed if they collide; plus the pages the audit skipped: gallery, explorer, keybinds, FPS, upcoming.
- [ ] B5.6 Differences found only in the browser are listed; those not covered by an exception are aligned with desktop or named.
Findings: `main-header.component.ts:84-94`, `:213-216`, `:274-279`, `:333-335`; account menu is one template at `shell.component.ts:296-330`; `.filter-fab` at `codex-browse.component.ts:164, 337, 543-575`. The earlier audit is code-derived only: the pane had no session on a new origin. See `.claude/deep-knowledge/test-account.md` for signed-in browsers. Legacy shell (flag off) is out of scope.

## Shared trap

`public/i18n/{de,en}.json` is touched by every bundle. Add keys only in your own namespace.
