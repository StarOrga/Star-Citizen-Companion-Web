# Implementation spec — App shell redesign (Fusion bar + page types), behind a beta switch

Source of truth: the concept page `docs/concepts/2026-10-25-header-footer-subheader-analyse.html`
(rounds 1–5, fragments in `docs/concepts/2026-10-25-header-footer-subheader-analyse/rounds/`),
decisions log `docs/concepts/2026-10-25-header-footer-subheader-analyse-decisions.json`.
Visual reference: round 4 design **`fusion`** (rounds/04.html, screens d4-s1…d4-s6) for the bar,
round 5 design **`beschriftung`** (rounds/05.html, screens d9-s1…d9-s4) for the hub's planet zone,
round 3 (rounds/03.html, `mk-*`) for search-active, weapon comparison, hand-off, beta chip,
main-page transitions and footer anatomy. Read the mock markup/CSS there; build it with app tokens.

User's mandate: „Setze das alles für den Beta-Mode um … mach das ganze Layout top Tablet und
Mobile fit, ein Genuss mit frischer Innovation … nix bleibt übrig.“ Everything below ships behind
the beta switch; with the switch off the app behaves exactly as today.

Project rules apply (CLAUDE.md): standalone + signals + OnPush, all strings via ngx-translate
(de + en keys), real anchors for navigation (`isPlainLeftClick` for overlays), no native dialogs /
tooltips / selects, errors via `toErrorKey`, logging via `core/log.ts`, `--sc-accent-hot` only for
elevated access, `--sc-warning` for worse comparison values, phones: nothing under the feedback
launcher, `dvh` for viewport-tall surfaces, no API keys in the client.

## 0. Beta gate
- New beta area `shell` in `core/beta.service.ts` (default off), toggled in the beta chip.
- The beta chip moves to the TOP-RIGHT corner, compact chip → expands to the area toggles; visible
  only to admins and collaborators (red elevated accent allowed). Phone: in the top strip.

## 1. Layout contract (prerequisite)
- Route data `layout: 'cinematic' | 'content' | 'tool' | 'overlay' | 'plain'` on every route
  (mapping confirmed in rounds 1–3, see decisions.json iteration 1 `seitentypen` + iteration 2
  `seitentypen2`). The shell derives bar state, footer mode and width track from it — replaces the
  URL string checks (`isVerseHome`, `isCodexSubpage`, `betaAreaOf`) when `shell` beta is on.
- One shared frame for shell + public layout (no duplicated `.content` rules).

## 2. Tokens & space
- 8-px spacing scale; define the missing `--sc-space-*`; ONE value per type for header→bar and
  bar→content; no page root sets its own top padding/max-width.
- Header/bar and footer heights as tokens; `scroll-padding-top` tied to the bar height (WCAG 2.4.11).
- Hide/reveal thresholds: hide after ~1 bar height down, reveal after 5–10 px up, 200–300 ms,
  reduced-motion → no slide.

## 3. Widths
- Tracks: `full` (stages edge to edge), `wide` (tools: fluid, side gutter clamp(16px,2.5vw,64px),
  extra preview column from ~2200 px: Codex index → selected ship, hangar → loadout), `narrow`
  (content: clamp(720px, 60%, 1040px), never wider; from 1600 px rail + context columns beside it),
  `measure` (≤ 70ch prose). Phone: all full width with 12–16 px gutter. CSS-grid named lines, no
  100vw hacks.

## 4. Fusion bar (header ⇄ subheader as ONE capsule) — rounds 3/4
- One bar for all page types. Subheader = always search („Suche integral“).
- Cinematic hubs (Verse / Codex / HQ landing): no subheader; the stage's search line morphs into
  the capsule at a scroll threshold, played once (not scroll-scrubbed); logo + main nav migrate into
  the capsule.
- Content pages: capsule with crumbs (left) + search; hides on scroll down, reveals on scroll up /
  focus. Section-in-view label sits LEFT next to the crumbs.
- Tool pages: capsule stays (compact, persistent); filters fold OUT OF the search as a drawer — the
  drawer IS the tool toolbar and stays pinned with the bar.
- Codex kinds (Schiffe / Waffen / Komponenten / FPS / Blueprints / Upcoming / Keybinds) as segments
  in the bar; the crumb collapses into the active segment on transition.
- Search context shown as a filter/crumb chip inside the field. Hotkey hint (Ctrl+K, "/") shown in
  the unfocused field; works from everywhere.
- Phone: bar at the bottom under the thumb.
- Sexy/premium MobiGlas feel, but keep today's background and centred typography.

## 5. Search — round 2/3
- Context-weighted ranking (not hard filtering): gallery → images first, ship page → its
  components/weapons first, Codex index → ships, HQ → own hangar; everything still findable;
  top-x per group.
- Per result up to 3 quick-action icons + 1 button action, by result type.
- „Companion fragen“ offered from 4 words on (target not decided: render the offer and route to a
  placeholder/stub — report as open).
- Animated focus/reveal, results appear progressively, selection animates.

## 6. Footer — rounds 3/4/5
- No background, no line. „Made by the Community“ badge + wordmark bottom-LEFT, never overlapping
  the planet; click/hover/focus opens a speech-bubble popover with the fan-site disclaimer.
  „Neuigkeiten“ (release notes, with the new-dot) instead of the version; legal links.
- Hubs: footer at the stage's bottom edge, scrolls along (not fixed); other pages: end of document,
  compact (phone ≤ 120 px). No footer next to infinite scroll — add „Mehr laden“ where needed.
- CAUTION: verify the disclaimer-in-a-popover against the current CIG Fankit FAQ before shipping.

## 7. Verse hub (briefing β) — round 5 C „Planetenbeschriftung“
- Planet: smaller, intrudes less, a DARK planet with uneven city/activity lights, sophisticated and
  catchy without heavy detail.
- The three gates (News · Patches · Galerie, today's `sc-briefing-moon` data) become holo labels
  projected on the planet's terminator; they rotate one after another (never two at once).
- One personal news line in the planet zone; rotates after ≥ 30 min unfocus/closed, never skips an
  unread one.
- No „Countdown 4.4“ eyebrow; keep the „Live 4.3.1 · stabil 82 %“ kicker (Verse only).
- Hub sections below: News, Patches preview (qualitative labels like „wenige bekannte Probleme“,
  number small; flexible count), Galerie LAST with image previews; „→ Übersicht“ link per section.

## 8. Main-page background transitions — rounds 3/4
- One CSS layer scene; camera moves only when the target is a main page: Verse = open sky/planet,
  HQ = descend to the planet, hangar on the planet with opening doors, Codex = turn right keeping a
  strip of the planet visible. All six routes work (incl. HQ ↔ Codex). Reduced motion → crossfade.
  Sub-pages keep their main page's background, static.

## 9. Overlays & anchors — rounds 2/3
- Overlay and page share one route (intercepting pattern): `/verse/news/:id`, `/verse/gallery/:imageId`,
  `/verse/patches/:line` with ONE shared overlay frame (✕, title row, prev/next); refresh/share =
  full page, Back closes.
- Popups: no back bar, ✕, fixed responsive takeover (desktop centred sheet, tablet sheet, phone
  full screen).
- Codex component/weapon swap popup → comparison TABLE of all candidates matching the filter set
  (type chips Ballistisch / Laser / Distortion / Alle, size, manufacturer …), sortable columns (DPS,
  Alpha, Range, Ammo/Heat, Power), inline value bars, current weapon pinned as baseline with deltas
  (better = accent, worse = `--sc-warning`), select = equip, a detail-page icon link per row, no
  „Ganze Seite öffnen“.
- Anchors on every long page; a sticky share button that silently shares URL + current anchor.

## 10. Ship detail page — HARD RULE
- The Holotisch / Klassisch content block stays EXACTLY as it is (no recategorising, no new
  sections). Only frame, background, spacing, bar and popups change. The name row above it stays
  for now („erstmal nicht“). No section nav; sticky share with anchor applies.

## 11. Phone hand-off „Auf dem Handy weitermachen“ — rounds 2–4 (security-sensitive)
- Round button bottom-LEFT (desktop/tablet, signed-in users; hidden on phones); popup grows out of
  it, small, three steps left→right (1 scan → 2 confirm → 3 phone opens this page).
- QR encodes a one-time code (~60 s, single use) exchanged server-side by an Edge Function for a NEW
  session on the phone; desktop shows „Handy verbunden“ + revoke. Target = current URL.
  Fallback in the same popup: magic link via email (Supabase). NEVER put a refresh/session token in
  the QR. Needs a migration + edge function → pre-mortem/redteam.

## 12. Page-type mapping follow-ups — round 1/2 notes
- Constellations: no separate page — a toggle state of the star-map panel (panel turns/dissolves
  and rebuilds); old route redirects.
- Logbuch → behind a help button as an inline tutorial (3 bullets, then step-by-step highlights).
- Upcoming: cinematic teaser on the Codex landing + the list stays a tool page.
- HQ Nachschub panel → popup variant (task list × shopping cart).
- Auth cards (set-password, unavailable, desktop/uploader auth): cinematic but simple, focused.
- Lost pages surfaced: badge via profile menu + search, release notes via footer „Neuigkeiten“,
  extension in the download area, keybinds + Einsätze as landing tiles.

## Delivery
- Several PRs are fine (contract+tokens first, then bar, then hub/footer/transitions, then overlays/
  search, then hand-off). Each green on typecheck, lint, Karma, build, mobile gate.
- Shortfalls are reported with their reason, never silently dropped.
