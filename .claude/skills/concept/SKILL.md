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
