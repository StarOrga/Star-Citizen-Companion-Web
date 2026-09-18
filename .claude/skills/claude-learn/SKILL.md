---
name: claude-learn
description: Project-specific overrides for /claude-learn in SC Companion.
---

# /claude-learn — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/claude-learn/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **A learning for the feedback routine ships itself.** The plugin default
   ("shipping the fix is the user's call — ship only when a ship was asked
   for") does NOT apply to changes under `docs/feedback-routine.md`,
   `docs/feedback-routine/*.md`, `docs/routine/SKILL.snapshot.md` or
   `scripts/routine-gate*.mjs`: the scheduled tasks read the runbook from
   `origin/main` in a fresh session every tick, so an open PR changes
   nothing — the next 34 ticks run on the old rules. Finish branch C with the
   project's `/ship` path (version bump + CHANGELOG entry, `ship_release`
   with `tag`, `skipChecks` is fine for docs-only, tag verified afterwards —
   runbook STEP 4). Report the merge SHA, not the PR.

   *Why this rule exists:* 2026-09-18, learnings from the 22:07 run landed on
   PR #620 and stopped there; the user had to ask why nothing shipped.

2. **The routine's prompt is a twin + snapshot, edit all three in one go.**
   A rule that belongs in the tick prompt (`routing-details.md` → C →
   "Scheduled-task rules", item 2) is edited in
   `~/.claude/scheduled-tasks/nightly-admin-feedback/SKILL.md`, its body is
   copied verbatim to `nightly-admin-feedback-day/SKILL.md` (keep that file's
   own frontmatter), and `docs/routine/SKILL.snapshot.md` is refreshed (keep
   its header comment). `node scripts/check-routine-prompts.mjs` must print
   `OK` before the commit — the prebuild fails the Vercel build otherwise.
   A work-path rule still goes to the runbook; the prompt gets at most a
   one-line pointer to the runbook step.
