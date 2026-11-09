# Designer brief — Ladeschirm & Nicht gefunden (round 1)

Repo: `P:/Projects/Star-Citizen-Companion-Web/.claude/worktrees/scc-web-autonomous-analysis-ffdf4c`
(Angular PWA "Verse Companion", a Star Citizen companion; dark space UI, cyan accent).

## The user's ask (verbatim)

> Lass uns loadings screen, not found screen
> Devops concepten visuell! Gern die agents eine gute vairante ala beta style designen lassen.

"Beta style" = the look of the opt-in **β "shell"** redesign (header capsule / fusion bar,
glass "sub" surfaces). Read before designing:

- `src/styles.scss` — tokens, especially `--sc-accent` (#52c1e6 cyan), `--sc-holo` (#8fe3ff),
  the `--sc-sub-*` glass family (fill, edge gradient, sheen, trace, bloom), `--sc-bar-h`,
  `--sc-float-shadow`, fonts (`--sc-font-display` = Orbitron-like headings).
- `src/app/shell/fusion-bar/` (the β header capsule) and `src/app/shell/public-layout.component.ts`
  (the β capsule on public pages) — draw this chrome around screens 2–4 **faithfully but
  dimmed** (it is context, not the topic; do not redesign it).
- `src/index.html` lines 71–310 — TODAY's boot splash (ring arc + "Verse Companion" word +
  sliding bar on #050810). Your screen 1 replaces it.
- `src/app/shared/not-found/not-found.component.ts` — today's "id does not exist" card on
  detail pages (title, one line, "Zurück zu …" anchor). Today an unknown URL has **no** 404
  page at all: `app.routes.ts` `{ path: '**', redirectTo: 'verse' }` silently lands on /verse.

Project rules that the design must respect (they will be implemented in Angular):
one `primary` action max per page; secondary actions are pills; navigations are real links;
red (`--sc-accent-hot`) only for admin surfaces, `--sc-danger` only for errors/destructive —
so a 404 is NOT red; all text German in the mock; no native dialogs; reduced-motion must be
honoured (say in an annotation what the still frame looks like).

## What you design

ONE design direction (you get your motto below), as **four screens, same labels, same order**
in all three designs (the reviewer compares page by page):

1. `Start` — first paint before Angular boots (static HTML/CSS only in reality: no fonts
   guaranteed, no JS animation libs; CSS keyframes are fine). Full window, no shell.
2. `Seite lädt` — inside the β shell: a lazy route / its data is loading (e.g. a Codex
   ship page). Shows how the content area loads (skeleton, scan, whatever your direction says)
   while the shell stays usable.
3. `Lädt zu lange` — same, after ~8 s with no answer: a calm hint + one way out
   (Erneut versuchen) + a secondary way (zur Startseite / Status). Not an error yet.
4. `Nicht gefunden` — unknown URL inside the β shell: a real 404 page. Show the URL the
   reader typed (e.g. `/codex/schiffe/carrack-x`), suggestions (search / "Meintest du …" /
   main areas: Verse, Codex, HQ), one primary way home. Make it a little delightful in your
   direction's language, never cute-silly, never red.

Wire it as a click-dummy: an element on screen 1 → screen 2, on 2 → 3, on 3 "Erneut versuchen"
→ 2, on 4 nothing is required but the home link may go to screen 2. Use
`data-screen-link="dN-sK"` on the clickable element (K = 1..4).

## Hard markup rules (the page engine clones screens into phone frames)

- Your design id is `dN` (given below). Every class you use starts with `dN-` (root class
  `dN`). Every CSS selector is prefixed `:is([data-design], .design-ov-scale) .dN` — e.g.
  `:is([data-design], .design-ov-scale) .dN .dN-ring{…}`. Keyframes named `dN-…`.
- Root `.dN{position:relative;height:100%;min-height:600px;overflow:hidden;…}` and reset
  buttons/links inside it (see the reference file's `.vk` reset lines).
- Inside screen bodies: **no** `<script>`, `<canvas>`, `<style>`, `<iframe>`, no `id`
  attributes, no `vh`/`vw` units, no `position:fixed`, no `#id` selectors. Inline SVG is fine.
  No external fonts/images (self-contained page, CSP blocks them).
- Phone: add rules under `@container device (max-width: 520px){ … }` (same prefix) so all four
  screens work at 390 px width (shell capsule at the bottom on phones, as in public-layout).
- Mark every element you want to ask about with `data-m="dN-<name>"`.
- No captions or explanatory text in the mock — only UI.

Reference for the exact style of a previous concept round (read the first ~60 lines of CSS
and one screen; do not copy its look):
`docs/concepts/20261108-1545-codex-kopf-besitz/rounds/01.html` and its generator
`docs/concepts/20261108-1545-codex-kopf-besitz/gen-r1.js`.

## Output — exactly one file

Write `docs/concepts/20261109-1545-ladeschirm-nicht-gefunden/parts/dN.html` (LF line endings,
write it with the Write tool), in exactly this shape:

```
<!-- meta {"motto":"2–5 Wörter","traits":["Unterschied 1","Unterschied 2","Unterschied 3"],"icon":"<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\">…</svg>"} -->
<style>
…all CSS, prefixed as above…
</style>
<template data-screen="1">…screen 1 body markup (root element <div class="dN">…)…</template>
<template data-screen="2">…</template>
<template data-screen="3">…</template>
<template data-screen="4">…</template>
<!-- annos [
 {"screen":1,"side":"bottom","target":"[data-m=\"dN-ring\"]","x":30,"y":30,"q":"Frage …"},
 …
] -->
```

- `meta` and `annos` are single JSON values (valid JSON; escape quotes).
- traits = three things that distinguish YOUR direction from the other two (see their
  mottos below), in plain German, the UI thing named first.
- annos: 4–7 in total across your screens, ranked by how much the answer changes the design;
  German questions the user can answer in a sentence ("… Passt das, oder …?"); side ∈
  top|bottom|left|right; x/y = pin position in % of the screen.

Do not create or edit any other file. Do not run the concept build. When done, reply with
the file path and 3 lines on your direction.

## The three directions (make them excessively different)

- **d1 · "Holo-Scan"** — the hologram language of the app's holotable: a wireframe ship /
  object being scanned line by line, scan sweep, cyan holo glow, the content area
  "materialises". 404 = "Sektor nicht kartiert": an empty holo grid with coordinates of the
  typed URL, a scanner that finds nothing, nearby "known sectors" as suggestions.
- **d2 · "Quantum-Sprung"** — motion and depth: star streaks / quantum tunnel, a spool-up
  gauge as progress, the page arrives like a jump exit. Lädt zu lange = "Quantum-Antrieb
  spult noch". 404 = "Ziel außerhalb der Karte": the jump dropped you in empty space,
  a drifting beacon, a route back.
- **d3 · "Ruhiges MFD"** — calm, typographic cockpit multi-function display: bracket
  corners, monospace status lines, a boot log that ticks through real steps ("Daten laden ·
  Codex 4.3.1 · ok"), almost no motion; skeleton lines in MFD frames. 404 = a diagnostic
  readout `ROUTE 404 · /codex/…` with a search field and a short "Meintest du"-list.
