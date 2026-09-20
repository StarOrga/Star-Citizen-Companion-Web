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

3. **Concept from a worktree: state file + durable store live in the
   WORKTREE, never in the primary checkout.** Concepts in this repo run from
   `.claude/worktrees/<name>/` (the page is the branch's deliverable), and
   `ss.concept.resume` reads `<process.cwd>/.claude/concept-active.json` —
   the worktree. The plugin's bridge-server.md ("project root, NOT the
   worktree") is written for single-checkout repos: written to the primary
   root, the state file is ONE file shared by every worktree, and a second
   concept session running in a sibling worktree overwrites / deletes it —
   its cron tick reads "state file now owns port X" and cleans up, our own
   waker then sees `STATE_GONE`, POSTs `/shutdown` and the page reads
   "Claude nicht verbunden" until someone relaunches (2026-09-20: twice, on
   the foreign tick's 15-min cadence, ~12 min + ~5 min outage, notes intact
   only thanks to the draft mirror). Layout that works:
   - `python concept-server.py <port> "<primary-root>" --html
     ".claude/worktrees/<name>/docs/concepts/<file>.html" --store
     "<worktree>/.claude/concepts/<file-basename>"` — server rooted in the
     primary so the URL already open in the user's tab stays valid (the
     ancestor-path serves), store where the resume hook expects it;
   - `<worktree>/.claude/concept-active.json` with `html_path` **worktree-
     relative** (`docs/concepts/<file>.html`) — tick and watchers resolve it
     against the state file's grandparent, which is now the worktree;
   - cron prompt + both `concept-watch.js` launches with the ABSOLUTE
     worktree state path; the completion card gets `cwd: <worktree>`.
   Relaunch order after any bridge death: server → state file → **pulser
   immediately** (every gap > 90 s without a heartbeat is a visible
   "nicht verbunden") → waker → `GET /recovery` + `GET /draft?slug=<html-
   basename>` before touching anything. Before opening a new concept,
   `ls ~/.claude/concept-bridges/` — a foreign entry means another session
   is live; never write its state file. Upstream: Jerry0022/dotclaude#417 (state file per session cwd, as the resume
   hook already assumes); the 1100px design-canvas cap is dotclaude#418 —
   until it lands, lift it in the page CSS
   (`html[data-template="design"] .concept-layout.design .concept-content { max-width: none; padding: 0 }`).

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
