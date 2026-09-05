---
name: concept
description: Project-specific overrides for /concept in SC Companion.
---

# /concept — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/concept/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **Concept-HTML CSP: `connect-src` must allow the bridge AND Supabase.**
   Concept pages in this repo carry a `Content-Security-Policy` meta (reference
   header: `docs/concepts/2026-08-02-codex-companion-uebersicht.html`). When
   emitting one, `connect-src` MUST include
   `'self' http://localhost:* http://127.0.0.1:*` — without it the bridge
   heartbeat + submit are silently blocked and the page shows a permanent
   "Claude nicht verbunden" — plus `https://*.supabase.co`, because phase-2+
   concepts embed Supabase Edge-Function URLs and interactive demos (e.g.
   live-checking a deployed function) fetch them from the page.

2. **Donor chrome is never engine-current — re-sync the engine, then prove
   P15b by clicking.** This repo builds concept pages from the newest page in
   `docs/concepts/` as the chrome donor (fast, but the donor carries the
   engine of the plugin version that generated it). Observed 2026-09-04
   (`2026-09-04-patch-board-neu.html`, donor from 2026-09-02): the donor's
   screen-nav handler compared against the **build-time** `active` design
   and `showScreen()` had no membership guard, so "switch design via the
   ghost bar → click a nav entry of another design" hid every screen of the
   design on the canvas. Because the donor also lacked CSS rule 46 (design
   mode hides `.concept-content > header` + `.iteration-intro`), the blank
   canvas showed the page header overlapping the iteration intro — the
   "content breaks when switching" symptom. Before opening ANY donor-built
   page:
   - run the **complete** Phase 1 + design-P grep list from
     `validation-gate.md` — no hand-picked subset (46/47 and P15b were the
     ones skipped);
   - re-sync these three engine blocks verbatim from `templates.md`: the
     click-time `const cur = activeDesign()` nav handler, the
     `screens[0].id` fallback in `showScreen()`, and CSS rules 46/47;
   - then assert P15b **behaviourally** in a browser: switch to every design
     via the switcher, click every `#screen-nav` entry, and after each click
     count screens with `getClientRects().length > 0` — exactly 1, never 0.

## Retired rules (absorbed upstream — do not re-add)

The legacy `devops-concept` extension carried two more rules: "copy the
final-report JS block verbatim from templates.md" and "grep the generated HTML
for `submitCreateIssues` / `submitDisposeConcept` before reporting ready"
(written after the 2026-05-23 concept shipped with silently dead buttons;
reported upstream as Jerry0022/dotclaude#165). The plugin has absorbed both:
the post-generation validation gate
(`skills/concept/deep-knowledge/validation-gate.md`, shared patterns #29,
#33–35) plus the deterministic `post.concept.gate` PostToolUse hook now block
exactly that regression at write time.
