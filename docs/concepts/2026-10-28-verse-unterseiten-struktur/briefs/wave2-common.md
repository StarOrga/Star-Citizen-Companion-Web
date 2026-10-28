# Wave 2 — common rules for every page agent

Repo: P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\planet-footer-vcerse-scroll-ff4b2b
(git worktree, branch `claude/red-marking-resolution-77ec02`; work directly on it; never main,
never switch branches, never stash/reset). Four agents work in this same worktree in parallel,
each on its own files.

Read first: root `CLAUDE.md` (project rules), `briefs/implement.md` (binding spec, your §),
the round-3 concept fragment `rounds/03.html` / `gen-round03.cjs` (visual reference, your
screen), `briefs/02.md` (facts about today's pages).

## What wave 1 delivered (use it, don't rebuild it)

- Shared subpage head (already placed at the top of each page):
  `<sc-verse-header planet="news|patches|gallery|starmap" [title] [subtitle] [rememberAs] [trail] [eyebrow] [root]>`
  with an actions slot: put elements with the attribute `vhActions` inside; each direct child
  gets a fine left divider. `title` is the page's only h1. 28 px gap below. File:
  `src/app/verse/shared/verse-header.component.ts` (do not change it; report needs).
- Entrance animation (pure CSS, `src/styles.scss` block „VERSE SUBPAGE FRAME"):
  `class="sc-enter"` + `style="--sc-enter-i: n"` (80 ms per step), or
  `class="sc-enter-stagger"` on a parent to stagger its direct children 1–8. Reduced motion →
  fade. Use it so every page „builds up nicely animated".
- Subpage backdrop: the scene shows deep space with the page planet's glow; remove opaque
  page-level boxes so it shows through.
- Transitions (View Transitions, `src/app/verse/shared/verse-flight.ts`) are done — elements
  with `data-verse-fly` take part; don't touch.
- Shell: apps menu next to the avatar (`src/app/shell/apps-menu.component.ts`), crest component
  `<sc-kartograph-crest [rank] [size] state="earned|current|locked">`
  (`src/app/verse/starmap/kartograph-crest.component.ts`, decorative/aria-hidden — host adds
  label + link). Terms already renamed in i18n („Sternkarte", never „Sternbild").

## i18n

You do NOT edit `public/i18n/*.json` (shared). Put every new key into JSON fragments, nested like
the real files, at
`C:\Users\Jeremy\AppData\Local\Temp\claude\P--Projects-Star-Citizen-Companion-Web--claude-worktrees-planet-footer-vcerse-scroll-ff4b2b\414c0742-f1a7-449d-8047-29e9197695d4\scratchpad\i18n\<bundle>.de.json`
and `<bundle>.en.json` (bundle = news | patches | gallery | starmap). Both languages, every key.
The session merges them after the wave. Changing an existing value: put the key with the new
value in the fragment too (the merge overwrites).

## Rules

Standalone, signals, OnPush; all UI strings via ngx-translate; navigations are real anchors;
real actions are buttons; no console.* (use core/log.ts); errors via toErrorKey; no native
title/select/confirm (`[scTooltip]`, `<sc-select>`, `ScConfirmService`); red accent only for
elevated access; worse comparison values use the warning colour; phones: floating bottom
surfaces use `--sc-float-bottom` / FAB-clear vars, wide tables in `.sc-table-scroll`.
Use Bash for edits if the Edit tool's branch guard complains (cd into the worktree first).

Commit `wip(<scope>): <what>` on your branch after every green sub-step and at the latest every
~10 file-changing tool calls — an agent cut off by a usage limit never gets to commit at the
end. Only on your own sub-branch or the session's branch — never above it: while the session is
on a feature branch, never on main, master or the default branch. No git repo: no commits.
Stage ONLY your own files (`git add <paths>`), never `git add -A`; index locked → wait a few
seconds and retry.

Verify: `npm run typecheck` (errors in files you don't own are not yours — name them); your
specs via `npx ng test --watch=false --include=<spec>` as its own Bash call, never chained
(Chrome is not installed: set `CHROME_BIN` to the Edge exe
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` if Karma can't find a browser).
Update or add specs for changed behaviour. Do not run `npm run build` (QA runs it after the
wave; parallel builds collide); never pattern-kill ng processes; if a build touched
`public/release-notes.json`, restore it.

Interaction: autonomous — reasonable decisions within scope, recorded in your report.
Budget class: [budget] Max 20x · window 8% (reset 135 min) · week 65% (reset 87 h) → free.
Tool-call budget: Complex, ~20–35; hit it → stop and report a scope cut.

Report: commits, files, decisions, open points, i18n fragment paths.
