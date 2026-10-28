# Implement order — Verse: Hub & Unterseiten (approved in round 3)

The user clicked „Mit Feedback implementieren" on round 3. This file is the binding spec.
Visual reference: the concept page's round 3, fragment
`docs/concepts/2026-10-28-verse-unterseiten-struktur/rounds/03.html` (design `d1`, screens
`d1-s1` … `d1-s9`; its generator `gen-round03.cjs` shows the same markup in a readable form).
Background facts and earlier decisions: `briefs/02.md` (project facts) and `briefs/03.md`
(round-3 brief). Mock content (rank thresholds, crest motifs, preview names, version
numbers, sizes) is placeholder — use real data.

Project rules (root `CLAUDE.md`) apply in full: standalone + signals + OnPush, every
string via ngx-translate in `public/i18n/{de,en}.json`, navigations are real anchors, one
page frame (`--sc-page-max` / `--sc-page-gutter`, no page sets its own max-width/side
padding), red (`--sc-accent-hot`) only for elevated access, worse comparison = warning not
danger, no native dialogs/tooltips/selects (`[scTooltip]`, `<sc-select>`), errors via
`toErrorKey`, logging via `core/log.ts`, phones: floating bottom surfaces use
`--sc-float-bottom` / FAB-clear lanes, `dvh` for tall sheets, `prefers-reduced-motion` →
crossfade only.

## 1 · Terms
- „Sternbild" disappears from every UI string (de + en equivalents): use „Sternkarte"
  for the page AND per patch („Sternkarte {patch}", „Meine Sternkarten",
  „Community-Sternkarte"). The guess-track kind label becomes „Erkennen" (en: a matching
  plain word). Keep „Kartograph-Abzeichen" / „Kartograph · Rang n".
- Code identifiers (constellation*) stay; only user-facing strings change.

## 2 · Shell (header / subheader / profile)
- Remove the „Kartograph-Abzeichen" entry from the account dropdown
  (`shell.component.ts` ~286-295). It stays reachable via search and the Sternkarte.
- The user's Kartograph rank shows as a small crest on the profile avatar (corner badge,
  tooltip „Kartograph · Rang n", only once a rank exists).
- „Apps" menu in the header top right (main header AND the docked subheader, next to
  the avatar): lists SCC App (Companion-App, Windows installer via the existing
  `scc-app-latest` link) and Starscape (existing download target), each with icon, one
  line description, platform · version · size (where known). For collaborators/admins a
  third entry „Data Uploader" below, in the red elevated-access accent and labelled as
  such in words. Replaces the separate status-chip download link only if that is now
  redundant (keep the status chip's status function).
- Back to the Verse hub from a subpage = the existing logo / subheader back link only; no
  extra back button.

## 3 · Shared subpage frame (News, Patches, Galerie, Sternkarte)
- The real subheader (#841 fusion bar) on every subpage; no invented crumb/capsule
  subheader; the subheader search works on the subpage (on News it filters the news feed).
- Below it one shared page head, same on all four: planet emblem (64 px, the page's
  planet from the hub, never overlapping the header) · one slim line with a small page
  name (the page's only `h1`) and its subtitle · an actions/aside slot on the right with
  fine dividers, no boxes · a fixed gap under the head. No big repeated title block.
- Content below the head may differ per page (structure and style).
- No opaque boxes around page content; the scene background shows through. Behind a
  subpage there is no hub horizon/ground — deep space around that planet.
- The page builds up with a staged entrance animation (head, then sections rising in);
  reduced motion → simple fade.

## 4 · Transitions (hub ↔ subpages, subpage ↔ subpage)
- View Transitions API + scene poses (decided). Clicking a planet on the hub: the hub
  moves up and away like it does when scrolling down (same scroll-driven feel as today's
  scene planet), the camera moves to the target planet, the planet ends as the 64 px
  emblem in the page head, the subpage content rises in.
- Same motion for subpage → subpage (e.g. Patches → Sternkarte) and the reverse flight
  when going back to the hub via logo / subheader.
- Unsupported browser or reduced motion → crossfade.

## 5 · News
- No page title block beyond the shared head.
- First item: the hero card (newest item, ~1/3 viewport height), no own section heading.
- Feed directly below with filter chips: Alle · Comm-Link · YouTube · Spectrum ·
  Patch-Notes · Gemerkt. Filters (and the subheader search) apply to the feed only; the
  hero always shows the newest item.

## 6 · Patches
- Shared head; no separate KPI tile strip, no duplicated search field (search = subheader).
- Next-patch card with the patch monitor (live/test since, cadence state, ETA). The
  explanatory sentence („4.11 ist seit 9 Tagen im Test, üblich sind …") hides behind an
  info button top right in that card; the „Im PTU seit … – live voraussichtlich …" line
  is not needed as text — the line chart below shows it.
- Preparation checklist kept.
- Kometen-Tipp block: shows the community distribution (median, your tip marked once
  tipped). A right-aligned „Tipp abgeben →" link on the Kometen-Tipp heading line, only
  while the user has not tipped; it leads to the Sternkarte (tipping happens there).
  Once the release date is known, show the date instead of the distribution.
- Timeline = patch cards per line (like today's board cards with a content preview of
  the patch's headline items), sub-versions (PTU waves, hotfixes, x.y.z) visibly nested
  under their main version on a connecting rail. Every row (also sub-versions) carries
  stability.
- „Live" (stage) and stability must never look alike: stage = filled word/chip;
  stability = its own meter. Do NOT use a signal-strength (Funkstärke) glyph for quality
  — the user doubts it reads as quality; use a clearer quality mark (e.g. a short bar
  meter with a label / shield-check style), weak = warning amber.
- Clicking a patch opens the existing dossier.

## 7 · Galerie + app notification
- No inline app teaser in the gallery and none on the hub.
- App notification toast bottom right, styled like the existing unlock/star toast
  („Aufgabe erfüllt" look), above the feedback-launcher lane on phones. Collapsed to one
  line; the whole toast is clickable to expand (not just a tiny chevron) into the app
  info (what it does, platform/version/size, download link). Dismiss ×.
- Logic, for every public app (SCC App, Starscape; never the Data Uploader / admin apps):
  appears after the user has been on the relevant page ≥ 3 s (Galerie → Starscape; pick a
  fitting page for the SCC App, e.g. Patches or the hub); if ignored it comes again on
  later visits; after × it is snoozed for ~14 days (per app, per device, stored safely).

## 8 · Sternkarte (polish today's page, don't redesign)
- Keep today's structure and components (`explorer-page.component.ts`: header bar, star
  dome, comet track + guess track, series strip, „mehr" sheet, tour). Only restyle.
- Remove the big opaque `.map` box; the scene shows through.
- Map stars large and clear, drawn like today's constellation pictures themselves (the
  figure glyphs), so they never mix with background stars — no scene dimming trick.
- Header: only the current live patch with a dropdown (`sc-select`) for the others; the
  series strip below stays as is (liked). Actions stay in the head's actions slot.
- Shape name and rank as a caption at the map; drop the „7 / 12" star count in the head.
- Comet and guess track: today's versions, just without opaque boxes.
- New Kartograph crest ladder: each rank has its own crest; the current crest is a link
  to the badge page; show the previous three ranks (earned) and the next three (locked,
  dimmed) with where the user stands. Placement: below, at the top right of the star map
  area (the user: „eher darunter rechts oben von der Sternenkarte").

## Not in scope
- No changes to data pipelines / Supabase schema. Crest artwork may be simple generated
  SVG motifs per rank.
