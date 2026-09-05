# Reconciled approaches — Patch board rethink

Step 5 of `/tune-rethink`, 2026-09-04. Three code-blind lens agents returned one
approach each; this file re-reads them against the actual codebase.

Corridor recap: the whole `/news/patches` page may be rebuilt; sub-routes are
allowed; every capability in the brief survives (95 % rule — removals only with
the owner's approval); functionality changes only where they serve the design.

---

## What the code already gives us (shared migration surface)

All three approaches lean on the same data. None of it is new:

| Needed by the approaches | Already exists | Where |
|---|---|---|
| rail / strip stations (newest per ring) | `latestPerFacet()` | `src/app/news/patch-notes.ts` |
| "next Live in ~N days", next PTU, sub-patches, overdue flag, median + basis | `computePatchForecast()` | `src/app/news/patch-stats.ts:378` |
| per-version cadence clause ("34 d PTU→Live, 10 slower than median") | `computePatchStats()` → `PatchKpi.points[]` carries `label` = version | `src/app/news/patch-stats.ts:49` |
| version stream, "currently live" mark, wave folding | `groupPatchNotes()`, `groupWaves()` | `src/app/news/patch-notes.ts` |
| planned items per version, later lines | `RoadmapPayload.current / next / later`, `groupCardsByCategory()` | `src/app/news/roadmap.ts` |
| note contents on demand, bullet count, hit count | `RoadmapService.requestOutlines()`, `outlineSections()`, `outlineMatchCount()` | `roadmap.service.ts`, `patch-outline.ts` |
| search tokens + highlight | `tokenizeQuery()`, `highlightSegments()`, `matchesTokens()` | `patch-search.ts` |
| the note reader itself | `sc-patch-note-detail` | `patch-note-detail.component.ts` |

**So all three are re-compositions, not re-implementations.** The pure
functions and the detail component survive in every variant; what gets
rewritten is `patch-notes-section.component.ts` (736 lines, the band stack),
`patch-cadence.component.ts` (669 lines, the carousel — its chart markup can
be lifted into a static stack) and `patch-roadmap-band.component.ts` (399
lines, the two-column wall — its card markup survives inside a version block).

Two reality checks:

1. **"Search all contents" (approach C) is bounded by the edge function.**
   `RoadmapService` fetches outlines in batches (`SLUGS_PER_REQUEST`) with
   `MAX_CONCURRENT_REQUESTS = 2`, and `rsi-roadmap` caps upstream Spectrum
   fetches per request (`MAX_UPSTREAM_FETCHES`). Loading all ~100 notes is
   ~100 Spectrum reads — possible, but it is a deliberate user action with a
   progress line, never automatic. Cached outlines make the second run cheap.
2. **Sub-routes are cheap.** `app.routes.ts` is a flat table; `/news/patches/:line`
   and `/:line/:slug` are two entries plus `withComponentInputBinding`. The
   detail component already keys on the thread slug (`threadSlugOf(url)`).

---

## Approach Ⓐ — "One Strip, One List, One Control Bar"  (lens: product-value)

Three zones: a **status strip** of four ring tiles (Live · Hotfix · PTU ·
Evocati) each carrying *its own* forecast line underneath ("next Live ~in 6
wk"), a 40 px **"Release pace" disclosure** under it holding the three charts
stacked plus the window toggle, one sticky **control bar** (search + both chip
families inline + one page-wide Expand-all), and a **version list** where each
patch line is one card: notes first (newest Live note auto-expanded), then a
"Planned in this patch" summary row ("Ships 6 · Gameplay 5 · Core Tech 4")
that opens to the roadmap items. Search auto-expands anything with a hit.

- **Reaches:** rail-at-a-glance ✔ · 8 bands → 3 zones + one disclosure ✔ ·
  all capabilities placed ✔ · phone = same strip/bar/list reflowed ✔.
- **Migration:** lowest effort of the three. No tabs, no drawer, no routes
  (an optional `?line=` deep link only). The strip is `latestPerFacet()` +
  one `computePatchForecast()` row per tile.
- **Risk:** stacking notes *and* planned inside one card makes the open 4.10
  card long (25 notes + 17 items); the summary row mitigates but the current
  line still shows both. Folding "show all descriptions" into the page-wide
  Expand-all changes a capability's reach (needs approval).
- **Removal candidates (owner approval):** cross-link button (cap 9),
  separate "show all descriptions" switch, carousel mechanics.
- **Blast radius vs corridor:** `in-corridor`.

## Approach Ⓑ — "Pipeline Rail over Version Stream"  (lens: ux-design)

A **pipeline rail** (Evocati → PTU → Live → NEXT) with connectors carrying the
median transit, hotfix as a chip on the Live station, age-driven dimming,
collapsing to a 44 px strip on scroll. A **command bar** (search · Filter
popover with both chip groups + inline tokens · Expand all · "Cadence &
forecast" link). A card-free **version stream** where the version number is
the biggest type on the page and — the signature — **the cadence bar is drawn
on the version row itself**, so scrolling the stream *is* reading the chart.
Open version = segmented tabs **Notes / Plan / Timing**. Later roadmap lines
become ghost "PLANNED" rows at the top. Full charts + forecast in an on-demand
right **drawer** (phone: full-screen sheet).

- **Reaches:** the most composed answer to criterion 2 (one header idiom, one
  bar, rules not cards) · rail static ✔ · everything placed ✔ · phone plan
  is explicit (hero + 3-up strip, filter sheet, segmented tabs).
- **Migration:** medium-high. The row-baseline bar is a pure re-render of
  `PatchKpi.points` (one lookup per version). Tabs, popover, sticky-collapse
  and drawer are the new CSS/JS surfaces; the drawer can lift the existing
  chart markup wholesale. German label pinch point: station cards at ~180 px
  need `min-width` + wrap, not truncation.
- **Risk:** three tabs per version is one more decision per block than A/C
  ask the user to make; "Timing" as a tab may read as an empty tab for lines
  without measurements (4.5 and older). The 44 px collapsed strip needs an
  intersection observer — small but new.
- **Removal candidates (owner approval):** carousel mechanics, cross-link
  button, the "later" footnote (becomes PLANNED rows — a relocation).
- **Blast radius vs corridor:** `in-corridor`.

## Approach Ⓒ — "Rail, Bar, Stream, Reader"  (lens: enduser-feel)

Same rail/bar/stream skeleton, three distinct moves: (1) the forecast station
shows a **cycle meter** ("day 26 of a typical 38-day cycle") and a "How this is
estimated" link opening the charts *as evidence for the forecast*; (2) a
version block **opens on its most-alive facet** — future lines on Planned,
shipped lines on Notes — so there are no tabs; (3) opening a note enters a
**Reader** state: the note takes the full column, sibling blocks collapse to
headers, a sticky context strip carries version · ring · points · back, and
the URL becomes `/news/patches/4.10/<slug>`. Typing turns the stream into
**search mode**: ranked hit rows with context, grouped by version, plus an
honest coverage line "12 of 100 notes fully searched — [search all contents]"
with a determinate progress line.

- **Reaches:** strongest on the frustration ("the favourite feature gets the
  widest, quietest space") and on the hunter journey · rail static ✔ · one
  bar ✔ · all capabilities placed ✔ · phone: identical routes, each level a
  pushed screen.
- **Migration:** medium. Reader = a route + a layout state, the detail
  component is reused unchanged. Search mode = a new pure function over
  loaded outlines (hit rows with heading context) plus the existing
  `outlineMatchCount`. "Search all contents" = `requestOutlines(allSlugs)`
  with a progress signal — bounded by reality check 1.
- **Risk:** the only approach that adds behaviour (search-all, cycle meter,
  routes). All three serve the composition, but each is a real piece of work.
  The cycle meter's "day 26 of 38" needs the *start* of the current cycle,
  which is the last Live date — available from `PatchLineGroup.latestAt` of
  the live line.
- **Removal candidates (owner approval):** carousel mechanics, cross-link
  button, count pills on every header (one count line in the bar instead),
  equal weight for the stale Evocati card.
- **Blast radius vs corridor:** `in-corridor` (routes are explicitly allowed).

---

## Convergence — decided by all three, independent of the pick

1. **A rail/strip of the four rings is the page's masthead**, static, with the
   next-Live estimate at its end. The carousel dies as a mechanism; its slides
   survive as a static stack behind one disclosure/drawer.
2. **One sticky control bar** holds search, both chip families and the one
   expand switch. Filters reach the whole page.
3. **The version is the spine.** One block per patch line, one header idiom,
   the roadmap items live *inside* the version they belong to. The 1,186 px
   roadmap wall is gone as a layout.
4. **Stale rings are dimmed by age** (the 10-week Evocati card).
5. **Page head folds into the rail**; count pills on every band header go.
6. **The cross-link button becomes structurally redundant** (plan and notes
   share an object) — but it is a removal and therefore needs approval.

## Divergence — the actual decision

| | Ⓐ Strip · List · Bar | Ⓑ Pipeline Rail · Stream | Ⓒ Rail · Bar · Stream · Reader |
|---|---|---|---|
| Rail signature | forecast line per tile | connectors + median transit, 44 px collapse | cycle meter, "how estimated" |
| Charts live | 40 px disclosure under strip | on the row baseline + drawer | drawer opened from the forecast |
| Inside a version | notes, then planned summary (stacked) | tabs Notes / Plan / Timing | opens on most-alive facet, no tabs |
| Reading a note | in place | in place | Reader state, full column, own route |
| Search | narrows + auto-expands | narrows + auto-expands | search mode: hit rows + search-all |
| Filters | chips inline | popover + tokens | chips inline + 3-state expand |
| New behaviour | none | none | search-all, cycle meter, routes |
| Effort | low | medium-high | medium |
| Removals needing approval | 3 | 3 | 4 |

---

# Round 2 (2026-09-04, after the iteration-1 submission)

Owner feedback on round 1 (verbatim): „noch nicht integriert und gestaffelt
genug … gefühlt 100 Hauptelemente. Suche ok, Schnellauswahl ok, dann die
Patches, und in einen rein gehen → Popup mit allen Details nach Use Case.“
No removal approval was ticked. Direction changed fundamentally → new fresh
round with two lenses on a narrowed brief (three levels: board → one patch →
sections by use case).

## Ⓔ — "The Rail at Three Scales" (ux-design)

Board = Now Bar (three ring slots = status + ring filter) + one filter row +
patch cards with four atoms (name, micro rail, state sentence, note count).
Dossier = routed overlay (phone: sheet), header = the same rail at full size
with dates, sticky question jump bar, five sections named by question (Wo
steht er · Was ist neu · Was war geplant · Gefixt? · Tempo). Waves demoted to
a collapsed index under the in-patch search. Search: board scope → patch
cards annotated with hit counts; click carries the query into the dossier.

## Ⓕ — "Answer First, Menu Never" (enduser-feel)

Board = one control cluster (search + one chip row: rings, then lines) + patch
rows; the newest row is a hero row that absorbs the global status. Dossier
opens ON the answer: state line + the current note immediately; four sections
(Neu · Gefixt? · Geplant · Nächster); a next patch without notes opens on
Geplant. Waves = one line → build-chip grid, one chip loads one note. Phone:
question rail at the BOTTOM (thumb zone), in-patch search becomes a full-sheet
mode. Close = Esc/back/✕, board frozen, focus returns to the row.

## Convergence (both, independently)

Route-backed overlay/sheet with URL · board = one control cluster + patch
list · no tabs in the dossier, sections named by question, scroll-spy rail ·
absent sections are omitted (no empty states) · waves are a searchable
corpus, never a list · search scope = current level, query travels down ·
honesty labels inline (forecast, coverage) · carousel, roadmap wall, chip
double row, band count pills leave the board (contents survive in the
dossier).

## Divergence → concept page iteration 2, design Ⓖ (Abgleich)

Board status (Now Bar vs hero row) · first thing in the dossier (state
sentence section vs state line + note) · 5 vs 4 sections and their order ·
wave index vs chip grid · phone rail top vs bottom · "popup" literally
(modal without URL) vs routed overlay.

## Code reality (unchanged from round 1 + two additions)

- Routed overlay: `/news/patches/:line` (+ `?q=`) as a child route rendered
  over the board; `withComponentInputBinding` for the line param. The
  detail component (`sc-patch-note-detail`) renders the current note
  unchanged; roadmap card markup and the cadence bar markup are lifted into
  dossier sections.
- The rail at three scales = one new presentational component fed by
  `latestPerFacet()` + `PatchLineGroup` dates; the hero-row sentence is
  `computePatchForecast()` row `live` + hotfix count.
- "Search the remaining waves" = `requestOutlines(slugsOfLine)` — bounded by
  `MAX_CONCURRENT_REQUESTS = 2`, per-line (≤ 25 threads), so cheaper than
  round 1's page-wide "search all".

---

# Round 3 (2026-09-04, after the iteration-2 submission)

Owner on round 2: Ⓕ = right direction; board search → patch = "richtig
gut"; but (1) "verstehe die Stati nicht — Live ist überragend", (2) "Patch-
Auswahl neben der Suche macht keinen Sinn", (3) dossier "visuell eine
Katastrophe — Bilder, Kurztext, Langtext von der Roadmap ist doch super, dazu
Spectrum-Infos gut eingefügt", (4) new use case: "wie man sich vorbereitet —
was wird gelöscht und was nicht laut Spectrum". No approvals ticked.

Converging → no fresh round; reconciliation only. Iteration 3 = Ⓗ (list with
status WORDS, Live hero row, image-led dossier) + Ⓘ (lanes per ring as the
alternative answer to "status must be obvious") + Ⓙ feedback→answer map.

Code notes for the two new pieces:
- "Wie bereite ich mich vor?" = a pure extractor over the loaded outline:
  the lines under the "Important Build Info" heading (`Long Term
  Persistence: Preserved|Wipe`, `Starting aUEC: N`) plus a "Known Issues" /
  "Testing Focus" section if present. No new source; absent block → absent
  section. A Wipe flips the card amber and prepends "Wipe" to the board
  sentence.
- Note ↔ roadmap card matching = title-token similarity between
  `RoadmapCard.name` and outline bullet text (pure function, testable);
  unmatched bullets go to a "weitere Stichpunkte" line so nothing is lost.
- Board loses both chip families (removal → approval `approve3-chips`).

---

# Round 4 (2026-09-04, after the iteration-3 submission)

Owner on round 3: Ⓗ "viel besser"; fixes wanted: (1) patch order must be
monotonic, (2) 4.11 should be exciting but below Live, (3) vertical, showing
only next + current + last inactive, (4) dossier navigation should be the
settings-page table of contents (sticky rail + scroll-spy; phone: sticky pill
row), (5) "Wann kommt der nächste" — the three measurements are unrelated.
No approvals ticked (third time) → asked explicitly whether that means "keep".

Iteration 4 = ONE design Ⓚ: time stack (future → now → past, left spine,
three cards + "Ältere Patches" fold), dossier with the settings TOC rail
(`settings.component.ts` `.toc` pattern, reused 1:1), cadence as one cycle
timeline (previous Live → first test build → Live → hotfix ticks → today →
estimated next Live; the three KPIs are spans on that axis). Ⓛ = feedback →
answer map, 4 approvals, 3 questions (time direction, excitement level,
timeline clarity → implement?).

Code notes: the TOC rail is `SettingsComponent`'s `.toc` markup/CSS + its
scroll-spy (`activeGroup`, `tocHref`, IntersectionObserver) — extract into a
shared `sc-section-toc` before reuse. The cycle axis is a pure layout over
`PatchLineGroup` dates + `computePatchStats()` points + `computePatchForecast()`.
