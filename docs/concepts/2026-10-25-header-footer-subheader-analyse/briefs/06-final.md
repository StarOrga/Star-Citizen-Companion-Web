# Round 6 brief: final report (Abschlussbericht)

Locale: de. Template `free`, section carries `data-final-report`. Follow
`templates-final-report.md` exactly: report body + close-out sheet. The page's
rounds 1–5 are frozen; round 5 (`beschriftung`, action implement) was the order.

## What was built (branch `claude/star-citizen-header-footer-analysis-d7b33d`, HEAD 7f8d83d1, not shipped)

All of it sits behind the new beta area `shell` (off by default). When beta is off, the app looks like today: QA checked /about at 2560 px and saw the old header, no bar and no chip. 127 files changed (+9688 / −133).

The work ran in four waves (auto-agents, full ceremony):
- W1: foundation, and the phone hand-off backend with 2 redteam rounds.
- W2: bar + search, footer + corners, Verse hub + transitions, overlays.
- W3: §12 follow-ups and seams.
- W4: QA.

Per spec section of `briefs/implement.md`:

- §0 Beta: the `shell` area. A beta chip sits top-right and docks into the bar row. It shows only for admins and collaborators, and says the role in words.
- §1 Layout contract: every route carries `data.layout`, read through `LayoutService`, with one shared frame. `route-layout.spec.ts` guards it.
- §2 Tokens: `--sc-space-1..8` (4/8/12/16/24/32/48/64), bar and footer heights, `scroll-padding-top`, and the hide/reveal timing. Reduced motion means no slide.
- §3 Widths: a `.sc-frame` grid with the tracks full, wide, narrow and measure.
- §4 Fusion bar: one capsule for all page types.
  - Hubs: the stage search line morphs into the bar once a threshold is passed.
  - Content pages: the bar hides and comes back on scroll-up.
  - Tool pages: the bar is persistent and the filters open as a drawer.
  - Codex kinds are segments in the bar, with the crumb collapsing into the active segment.
  - The section label sits next to the crumbs.
  - On phones the bar is at the bottom.
- §5 Search:
  - It uses the existing Codex index with context-weighted ranking and a context chip.
  - Each result has up to 3 quick-action icons and 1 button.
  - Ctrl+K and "/" open it.
  - From 4 words on it offers "Companion fragen", which goes to a placeholder page.
- §6 Footer: no background. The badge and wordmark sit bottom-left; on phones only the emblem shows. The disclaimer opens in a speech bubble. "Neuigkeiten" replaces the version number. On hubs the footer sits at the stage edge.
- §7 Verse hub:
  - A smaller dark planet with uneven lights.
  - News, Patches and Galerie as rotating holo labels.
  - A "Für dich" line that rotates only after 30 min away and never skips an unread item.
  - The countdown is gone; the "Live · stabil" kicker stays.
  - Sections below: patches in words, the gallery last, each with "→ Übersicht".
- §8 Transitions: one CSS camera scene. Verse is open sky, HQ descends with the hangar doors opening, Codex turns right with a planet rim left in view. All six directions are covered by a spec. Reduced motion uses a crossfade.
- §9 Overlays and anchors:
  - `/verse/news/:id`, `/verse/gallery/:imageId` and `/codex/upcoming/:id` share one overlay frame. Opening from the list shows the overlay; a direct load shows the full page.
  - Weapon swap: a comparison table with detail links and the current weapon pinned as baseline.
  - A share button (URL + current anchor) sits bottom-right.
- §10 Ship page: the Holotisch / Klassisch block is untouched. Only a share button was added, and the name row stays.
- §11 Phone hand-off ("Auf dem Handy weitermachen"):
  - A migration plus `handoff-create`, `handoff-redeem` and `handoff-revoke`.
  - The QR carries a 256-bit one-time code (60 s, only its SHA-256 is stored) in the URL fragment. The phone shows the masked account and signs in only on a tap. If a different account is signed in, a warning appears first (compared by user id).
  - The desktop shows "connected", lets you revoke, and lists the connected phones.
  - 2 redteam rounds; 7+12 risks were fixed.
- §12 Follow-ups:
  - Constellations became a star-map toggle (`?view=constellations`) and the old route redirects.
  - Logbook: a "?" button with 3 bullets and a tour.
  - An Upcoming teaser on the Codex landing.
  - Nachschub as a popup (task list × shopping cart).
  - Cinematic auth cards.
  - Lost pages surfaced: the badge in the profile menu and search, the extension in Download, keybinds and Einsätze as tiles.

## Tests
- typecheck 0 errors.
- lint 0 errors (199 existing warnings).
- Karma 4706/4706. QA found 18 red at first; all caused by the shell work (test stubs and one i18n leaf), all fixed.
- test:functions 242/242, test:gate 77/77.
- Production build green.
- Mobile gate on the public routes: 0 findings.
- Browser, real build, beta on:
  - /about at 375/768/1280/2560: the bar hides and comes back.
  - /set-password: the auth card renders.
  - /handoff with an invalid code: clean error, the code is stripped from the address bar.
- Seams check by measurement at 4 viewports with a simulated admin session: no overlaps.

## Shortfalls (not built, with reason — Zusammenfassung, NOT open points)
- §5:
  - Images and hangar contents are not searchable, because the search index only holds Codex data. App pages and your own ships lead in those contexts instead.
  - The result preview panel and the "swap weapon" action from the mock are missing.
  - The game-status chip from the old header is not shown with the beta on.
- §7: "Für dich" shows unread digest items, not personal hangar news; that data does not exist yet.
- §9:
  - The phone swap table scrolls horizontally with a sticky name column; there is no card layout.
  - The patch dossier keeps its own overlay markup, not the shared frame, and has no page mode on direct load.
  - Stable ids on the ship-page section headings are not audited, so the share link there may carry no anchor.
- §11: the email magic-link fallback was dropped. Redteam R1 found it would leave tokens in the URL with the app's PKCE client.
- §12:
  - Constellations animate only the build-up, with no dissolve-out.
  - The Nachschub list is stored in localStorage only.

## Open points (admission gate: real follow-ups the user decides)
1. Target for "Companion fragen" (today a placeholder page) — decision.
2. Store the Nachschub list server-side (needs a migration) — decision.
3. Extend the search index to gallery images and hangar contents — feature.
4. Check the disclaimer-in-a-speech-bubble against the current CIG Fankit FAQ before shipping — check.
5. Email fallback for the hand-off, redesigned (a fresh hand-off code mailed to your own address) — feature.

## Not verified by Claude (🧪 tests[])
- Signed-in routes in a real browser: Verse hub with planet and footer, Codex index drawer, news/gallery/upcoming overlays, the hand-off popup and the beta chip with real data. There was no test-account session in this session and port 4200 belonged to another session.
- Mobile gate with `--auth` (15 signed-in routes).
- Phone hand-off end to end on a real phone. This needs `db:push` and the functions deployed. It includes the open `verify_jwt` question: if the gateway returns 401 on create/revoke, set `verify_jwt = false`.
- iOS Safari and Firefox fallbacks; 2560 with the share button.

## Manual hand-offs (👉 handoffs[])
- `npm run db:push` for `20261026120000_handoff_codes.sql` BEFORE the merge that deploys the edge functions (CI deploys functions on merge).
- After deploy: a smoke test of create → redeem → revoke with a live session.

## Drift
The reality check before implementing: main moved 5 commits, including briefing #829 (constellation below the sun), which was not forcing. #829 was kept working in the hub.
