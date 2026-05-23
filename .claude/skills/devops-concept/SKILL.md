---
name: devops-concept
description: Project-specific overrides for /devops-concept in SC Companion.
---

# /devops-concept — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/devops-concept/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **Final-report JS block: verbatim copy, no rewrites.**
   When emitting the Abschlussbericht-tab into a concept HTML, copy the
   ENTIRE `// --- Final-report …` script block from
   `plugins/devops/skills/devops-concept/deep-knowledge/templates.md` —
   that includes `updateCreateIssuesPanel`, `submitCreateIssues`,
   `collectDisposition`, `submitDisposeConcept`, the `#create-issues-btn`
   + `#dispose-concept-btn` `addEventListener('click', …)` calls, AND
   the `change` + `DOMContentLoaded` listeners at the bottom of the block.
   Don't substitute a "simpler" `updateCreateIssuesPanel`; the simpler
   version silently breaks the button. Symptom: clicking "Issues
   erstellen" does nothing, no console error.
2. **Post-generation grep check.** After writing the concept HTML, grep
   it for `submitCreateIssues` AND `submitDisposeConcept` — both must
   appear at least twice (function definition + listener attach). If
   either is missing, re-paste the full template block before reporting
   the concept as ready.
   *Why:* this rule was added after the 2026-05-23 phase-2 concept
   shipped with both handlers missing — user reported "klick passiert
   nix" days later. See git commit that introduces this file.
3. **Concept HTML CSP must allow `https://*.supabase.co` in `connect-src`.**
   Phase 2+ concepts reference Supabase Edge-Function URLs in copy-paste
   blocks; even though we don't fetch them from the concept page itself,
   future interactive demos in the concept (e.g. live-checking a deployed
   function) need this.
