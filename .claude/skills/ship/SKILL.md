---
name: ship
description: Project-specific overrides for /ship in SC Companion.
---

# /ship — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/ship/`.
Plugin defaults still apply; only the rules below override or add.

> **Also read [`../devops-ship/SKILL.md`](../devops-ship/SKILL.md).** It holds
> this project's rules 1–5 (downstream deploy surfaces, deploy-target
> enumeration, tag-retry policy, monorepo version bumps, uploader binary
> release). It was written when the plugin loaded project overrides from
> `.claude/skills/devops-ship/`; the current plugin loads *this* directory, so
> the two files are read together and neither supersedes the other.

## Project rules

1. **Mobile + tablet gate — MANDATORY extra quality gate in Step 2.**
   Any ship whose diff touches `src/**`, `public/**` or `angular.json` must run
   the responsive gate **after** `ship_build` succeeded (it audits the freshly
   built `dist/sc-companion/browser`):

   ```bash
   npm run gate:mobile
   ```

   It emulates iPhone 14 (390×844), Pixel 7 (393×851), iPad Air (820×1180) and
   Galaxy Tab S9 (800×1280) over the public routes and asserts: no horizontal
   overflow, tap targets ≥ 44 px, text ≥ 12 px, no clipped or overlapping
   content, no sticky/fixed element covering a control, a zoomable viewport
   meta, and no console errors on the mobile viewport.

   - **Exit 1 ⇒ ship blocked** — `render_completion_card` variant
     `ship-blocked`, quoting the failing device/route lines.
   - **Exit 2 ⇒ the gate could not run** (no Chrome, no target). That counts as
     red, never as green. Only an environment that provably has no Chromium may
     re-run with `npm run gate:mobile -- --skip-if-unavailable`; that exits `0`
     with a `SKIPPED` line, which must then be reported as a skip (not a pass)
     exactly like `SKIP-MOBILE-GATE` below.
   - Never lower `thresholds.minTapTargetPx` (44) or `minFontSizePx` (12) to get
     green. False positives get a narrow `ignore` entry plus a `$waivers` note
     in `scripts/mobile-gate.config.json`.
   - Backend-only ships skip it automatically (nothing frontend changed). A
     deliberate skip on a frontend ship needs `SKIP-MOBILE-GATE: <reason>` in
     the response **and** a `tests` line on the completion card.

   Full documentation: [`docs/mobile-gate.md`](../../../docs/mobile-gate.md).

   *Why this rule exists:* admin feedback c21fab87 ("Mobile ist es einfach noch
   nicht gut") — phone/tablet quality had only ever been eyeballed, so
   regressions shipped repeatedly. This is the last point where they can still
   be caught before users see them.
