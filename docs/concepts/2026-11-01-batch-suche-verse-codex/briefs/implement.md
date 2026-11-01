# Implementation brief — batch concept 2026-11-01 (Suche, Verse-Stage, Codex-Konzepttreue)

Concept page: `docs/concepts/2026-11-01-batch-suche-verse-codex.html` (source `…/rounds/01.html`, `02.html`).
Decisions (every round, verbatim): `docs/concepts/2026-11-01-batch-suche-verse-codex-decisions.json`.
Original notes: `.claude/batch-2026-11-01T08-45-28-226Z.md`.
Branch: `claude/batch-d577a4` (this worktree). Repo rules: root `CLAUDE.md` (i18n for every string, real anchors,
one page frame, `[scTooltip]` not `title`, `ScConfirmService`, `logWarn/logError`, OnPush + signals, phone `--sc-float-bottom`).

**Every item below is accepted scope. Nothing may be dropped silently.** Each bundle returns an acceptance table:
item → done/partial/not done → evidence (file:line, test name, screenshot path). "Partial" or "not done" needs a reason.
Visual items need a screenshot of the real app (Playwright; signed-in via the test account per
`.claude/deep-knowledge/test-account.md` where the route needs auth) — a mock-data or not-opened check does not count as done.

## Verbatim user input (all rounds)

Notes (batch):
- #1 "das mehr im verse sollte nur dort stehen wenn gerade keine news (weil animation noch läuft etc.. so)!"
- #2 "warum wurden meine conccepte bzgl. z. b. codex nicht umgesetzt vooll, wie z. B. die holodeck animationen und der anderen elemente, fxi das! Und devops learn warum die qualität der umsetzung der letzten 10 konzepte so schelcht wurde - wesenltiche notizen, absprachen und entwicklungen wurden nicht berücksichtgit :/"
- #3 "der such rahmen ist nicht ersichtlich, auch die suche generell sieh etwas wie der suader altbacken aus - ich mag die inhalte aber die umrandungen etc..." — screenshot `.claude/batch-assets/2026-10-30T17-37-03-890Z-1.png`
- #4 "in verse beta schau mal unten, das ist zweizeilig, maximal verwirrend.. welle sollte voll hinpassen" — `.claude/batch-assets/2026-10-30T17-37-47-819Z-1.png`
- #5 "warum fehlen in galerie unten die anderen bilder mosiaci!? wir haben doch genügend bilder, einfach die nächsten aktuellen nehmen, am ende immer auf 7 kommen!" — `.claude/batch-assets/2026-10-30T17-38-27-959Z-1.webp`
- #6 "wenn oben in der subheader nicht alles belegt ist (z. B. filter, warum nicht die suche die verüfgbare breite ausnutzen bis vor apps? ! AUßerdem bitte wenn die suche hint abgeschnitten ist, ,dann ... machen! statt abgehakte buchstaben" — `.claude/batch-assets/2026-10-30T17-40-04-526Z-1.png`
- #7 "i8m subheader die breadcrumbb, sollte wenn das mittelere element oder die mitteleren elemente nicht passen, sie einfach als ... anzeigen. Sprich immer das erste element und immer das letzte, dazwischen wenn nicht vollästndig anzeigbar dann ..." — `.claude/batch-assets/2026-10-30T17-40-43-541Z-1.png`
- #8 "bei verse beta unten der planet ist erst so komisch der alte planet und wird dannn zum neuen planeten. Lieber direkt nur der neue planet. Dieser sollte auch von anfang schon da sein bei der animation. Gernelel die animation nochmal polishen von dem ersten besuch des tabs (wenn tab geschlossen oder reloaded,´dann gilt ddas als neuer besuch) von verse beta und wenn man rumschaltet hin und her (dann braucht nicht die volle cinematische animation spielen) - beides bitte polsihen! Zudem sieht das mit den balken oben und unten in schwarz leider noch hässlich aus... polishen!"

Round 1 (search design favourite **Schwebende Karte**):
- Pin on the bar: "Leiste ohne Kontur, nur Tiefe und runde Felder" → "super!"
- Pin "Sektionen als eigene Kacheln statt Trennlinien" → "ja sehr schön dezent und einfach anzusehen."
- Pin "Karte schwebt mit Abstand unter der Leiste" → "interessante idee können wir ausprobieren, …" + autofocus wish (see round 2 decision).
- User pin: "inhalte alle perfekt, aber irgendwie sieht es so fisselig aus und generell hat der subheader so viele helligkeiten durch wörter und damit fokuspunkte..."
- User pin: "welches design element könnte es aber modern, spaceig, 2956 machen!? ggf. die Suche auch einen kleinen dezenten ticken hervorheben in einer interessante weise"
- Letterbox: **Weicher Verlauf** (include; Vignette / dünne Balken / Unschärfe discarded).
- Tab switch: **Kurz-Auftakt ~1 s** (include; none / 2.5 s discarded).
- Codex: cx-anchors, cx-claims, cx-parallax, cx-countup, cx-sound, cx-polish, cx-dim — all include.
- Process: pr-keep, pr-brief, pr-evidence, pr-visual — all include.

Round 2 (bar favourite **Ruhige Leiste**):
- Pin "Marke und Pfad so stark gedimmt" → "Ne, das ist ok, aber die marke und icon sollten ja auch gleich sein wenn es den sub header nicht gibt sondern den header hmmm... Es stört mich eher das wir hier gefühlt 10 schriftfarben im header haben und 1-2 zu viele fonts...."
- Pin "Das Suchfeld atmet alle 5 s ganz leicht" → "sehr gut!"
- Open behaviour: **op-hybrid** include (op-char, op-mode, op-today discarded).

## B1 · Verse page — notes #1, #4, #5, #8 + cx-dim

Owns: `src/app/verse/pages/verse-briefing.component.ts`, `src/app/verse/pages/briefing/**`, their specs, i18n keys under `verse.*`.
- #1: `button.more-cue` (`briefing/verse-briefing.component.html` ~73-77, now only `[class.gone]="dock() === 'docked'"`) shows only while no news is visible (transmit empty / not yet shown / away, intro running).
- #4: PTU/Hotfix/Evocati row (`briefing-hub.component.html` ~70, `.ch-id` span "seit {n} Tagen · Welle {n}") stays on ONE line next to the stability chip at all page widths incl. 1280 and phone — layout fix, not smaller-than-floor font.
- #5: gallery mosaic always 1 feature + 6 tiles = 7. `hubGallery()` (`briefing-hub.ts` ~146, called in `verse-briefing.component.ts` ~369) only takes digest `kind==='gallery'` items → fill up to `HUB_GALLERY` (14 candidates) with the newest pictures from the gallery source the `/verse/gallery` page uses, dedupe by key; keep the broken-image fallback.
- #8a: the hub planet is the NEW planet from frame 0 — no old→new morph (current planet spec: `docs/concepts/2026-10-29-verse-planet-nachtseite.html` + `-decisions.json`).
- #8b: first visit = new tab OR reload → full cinematic intro. `claimIntro()` (`briefing/briefing.model.ts` ~196) only checks sessionStorage → also treat `performance.getEntriesByType('navigation')[0]?.type === 'reload'` as `full`. Polish the full intro.
- #8c: switching back within the session → **Kurz-Auftakt ~1 s**: planet + sky stand immediately; only title, search field and hub fade in staggered over 0–1 s; no camera move, no bars.
- #8d: letterbox → **Weicher Verlauf**: top/bottom gradient from background colour to transparent (~18 % height) that breathes away in ~1.2 s; no hard edge, no pure black (timeline in `briefing/verse-briefing-planet.scss` ~270).
- cx-dim: the dimming the user asked for in the planet concept ("Dimm effekt bitte auch bei allen texten") applies to ALL texts over the planet/stars, not only hero + hub columns.
- prefers-reduced-motion: no intro motion.
Verify: Karma specs (briefing-hub, planet-zone, verse-briefing, themes-first, briefing model claimIntro reload case), Playwright screenshots of the hub at 1280 and phone (mosaic 7, one-line wave row), intro frame 0 shows the new planet.

## B2 · Fusion bar (subheader + search) — notes #3, #6, #7 + round 1/2 design

Owns: `src/app/shell/fusion-bar/**` (fusion-bar.component.ts/scss, fusion-bar.model.ts, fusion-search.component.ts, search-context.ts, specs), the main header's brand block only as far as needed to make brand + icon identical, i18n keys under `fusionBar.*`.
- #6: without a toolbar/filters registered (`bar-toolbar.directive.ts`, `ShellChromeService.toolbar()`), the docked search grows up to the Apps button — drop the 520px cap there (`fusion-bar.component.scss` ~463-467), keep it when a toolbar is present. Cut-off placeholder ends in "…" (input placeholder + `.demo-ph`: nowrap, overflow hidden, text-overflow ellipsis).
- #7: breadcrumb always shows first and last part; the middle folds to "…" as soon as it does not fit COMPLETELY (width-based via ResizeObserver, not only count-based `foldTrail()` in `fusion-bar.model.ts` ~281); full path stays in the `[scTooltip]` (trailFolded/trailText) and the sr-only text.
- #3 + round 1: dropdown panel in the **Schwebende Karte** look: panel detached ~10 px under the bar, radius ~24, no outline border, brighter surface than the page, strong depth shadow, page behind softly dimmed (gradient scrim); sections ("Zuletzt gesucht", "Hier", "Bereiche") as inset tiles (own surface, radius ~16) instead of divider lines; chips as soft tags (radius ~10, filled, no outline, small square accent marker). Contents unchanged. Tokens only (`--sc-*`), no hex in components.
- Round 2 **Ruhige Leiste**: bar without outline, depth only, round fields; brand + path calm; the search field gets a subtle accent rim + glow that slowly breathes (~5 s, off under reduced motion) — "sehr gut!".
- Round 2 pin: brand name + icon in the subheader must be identical to the main header's (same logo, same type treatment) — check `src/app/shell/**` header brand and reuse one component/style.
- Round 2 pin: "gefühlt 10 Schriftfarben … 1-2 zu viele Fonts" → header + subheader use at most ONE display font + ONE body font and at most THREE text colour tokens (`--sc-fg-0` primary, `--sc-fg-1`, `--sc-fg-2`) plus the accent for the active/interactive one; audit fusion-bar + header styles and remove the extras. List before/after counts in the acceptance table.
- Round 2 **op-hybrid** open behaviour: on every page with the subheader the search field gets focus on load (desktop/pointer: fine only — NO autofocus on touch/coarse pointer, never on stage pages while the stage runs; a click elsewhere takes focus away normally). Focus alone does NOT open the panel (today `(focus)="openPanel()"`, fusion-search.component.ts ~148 — change). Click into the field, ↓ or Ctrl+K opens the panel with suggestions. Typing: on pages with a registered page search (`ShellChromeService.registerPageSearch` — codex-browse lists incl. FPS + upcoming, news-list, verse-patches) the page list filters live, the panel stays closed and a slim line under the field shows "Im ganzen Codex: N Treffer ↓" (↓ / click expands the panel); on all other pages the first character opens the panel with results. Ctrl+K and "/" keep working; Esc closes.
Verify: fusion-bar*.spec.ts + fusion-search specs (focus-not-open, first-char-open, page-search-strip, fold by width), Karma; Playwright at 1280/1600/phone on a codex detail page (long trail, context chip), a codex list page (filter + strip), a page without toolbar; screenshot of the open panel.

## B3 · Codex fidelity + process — note #2

Owns: `src/app/codex/codex-landing*`, `src/app/codex/landing/**`, the ship-page holodeck component(s) (`codex-holo-stage.component.ts` and its stage files), their specs, i18n keys under `codex.*`.
- cx-anchors: holotable callouts end at real hardpoint positions from the codex data (weapon/component mount on the 3D model); hull-zone fallback only when no position exists.
- cx-claims: the 7 claims per topic rotate every 7 s also while the hologram rotates (`landing/codex-landing-claims.ts`).
- cx-parallax: ship-page holodeck parallax (layers shift slightly with pointer/scroll; off under reduced motion) — accepted 2026-09-20 (`cine-parallax`), never built.
- cx-countup: ALL numbers in the ship-page holodeck strip count up on appearance, not only the four tiles (`cine-countup`).
- cx-sound: verify the holodeck sound toggle (`codex-holo-stage.component.ts` ~106) really plays sounds; add missing ones (quiet, default off).
- cx-polish: walk landing + ship holodeck in the real browser with real data (desktop + phone), compare against the accepted round wishes (holo stage: scan disc rising, emitter/beam, ring wave on switch, callouts drawing in, values flash, typewriter Kennung, "muss Spaß machen es anzusehen, realistisch, hochauflösend, kinoreif") and polish until they hold. Screenshots in the report.
Verify: codex-landing + holo-stage specs, Playwright screenshots (landing, ship page) signed in.

Process (do-learn — the session runs `/do-learn` after the bundles with these four rules, not an agent):
- pr-keep: never close a concept with `discard` before rounds + decisions.json are committed under `docs/concepts/`; one living spec per page (accepted / rejected / open) that the next concept continues.
- pr-brief: implementation briefs link the decisions and carry every comment and pin verbatim; the checklist of accepted items is generated, not summarised from memory.
- pr-evidence: one acceptance line with evidence per checklist item; an independent check agent (not the builder) compares pins against the result.
- pr-visual: screenshot gate before ship — signed in with the test account, implementation vs chosen mock; every deviation has a reasoned line; no real-data screenshot = not done.
