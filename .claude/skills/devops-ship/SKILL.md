---
name: devops-ship
description: Project-specific overrides for /devops-ship in SC Companion.
---

# /devops-ship — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/devops-ship/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **Never declare a ship "successful" before downstream builds turn green.**
   The ship pipeline only confirms PR merge + GitHub release/tag create. In
   this repo, the `data-uploader-build.yml` workflow runs MINUTES later via
   tag-push and is the actual gate for a usable artefact. Same applies to
   the Vercel deploy and any future GH-Actions chain.

   **Required after `ship_release` succeeds with a tag that triggers
   external work:**
   - Run `gh run watch <run-id> --exit-status` in the background BEFORE
     calling `render_completion_card`.
   - If the watch hasn't finished by the time the card is rendered,
     downgrade variant to `ready` (NOT `ship-successful`) and include an
     explicit `userFinalTest` item: "Build run #N läuft — verifizieren mit
     `gh run view N`".
   - The `ship-successful` variant is ONLY appropriate when the full chain
     (PR merged + tag + downstream builds + release-assets uploaded) is
     verified.

   *Why this rule exists:* in the 2026-05-24 Phase-2 ship, I rendered
   `ship-successful` immediately after `ship_release` returned ok. The
   `desktop-v0.3.0` tag-triggered Windows build then failed silently 2
   minutes later (numpy/Python compat) — the user had to ask "ist das
   schon durch, ist alles live?" to surface it. The Vercel deploy was
   never set up at all but my card didn't flag that either. The card
   IS the user's source of truth for "what worked"; rendering it
   prematurely makes me look done when I'm not.

2. **List every external deploy target in the completion card explicitly.**
   When the ship affects multiple deploy surfaces (web → Vercel, desktop →
   GH Release binary, edge functions → Supabase), enumerate ALL of them
   under `tests` or `userFinalTest` with their verification status —
   "Vercel: deployed ✓ / not deployed / pre-existing 404", "Binary build:
   green / red / pending", "Edge Functions: redeployed ✓". Don't hide an
   unverified-or-broken surface behind a global "shipped" headline.

3. **Tag-only retries: bump the tag, don't re-push the same one.**
   When the binary build fails and we need to retry after a fix, push a
   new patch tag (`data-uploader-v0.3.1`, then `.0.3.2`, …) — never delete +
   re-push the same tag. The GH-Action artefacts retention + release
   history rely on monotonic tags. The first failed tag stays as
   permanent record that "v0.3.0 binary never shipped, v0.3.1 was the
   actual first delivery".

4. **Monorepo subpackage version bumps: do them yourself.**
   `mcp__plugin_devops_dotclaude-ship__ship_version_bump` only updates the
   ROOT `package.json` (the one it auto-detects via `projectType: "npm"`).
   This repo has at least two version-baked-into-artefact `package.json`
   files: root (web app) AND `data-uploader/package.json` (electron-vite
   bakes `process.env.npm_package_version` into `__SC_TOOL_VERSION__`,
   which ends up in the Tool's update banner, OAuth headers, and the
   web's Data Uploader download page after admin-registration).

   **Required after `ship_version_bump` succeeds (root only):**
   - `grep -n '"version"' data-uploader/package.json data-uploader/package-lock.json`
     to confirm the subpackage version
   - If it doesn't match the new root version, bump it manually +
     run `npm install --package-lock-only` inside the subpackage to
     refresh the lockfile
   - Commit alongside the version-bump commit, never in a separate PR

   *Why this rule exists:* v0.3.0 / v0.3.1 / v0.3.2 all ended up with
   binaries reporting `0.1.3-dev` internally because the bump was missed.
   User had to surface this by checking the live page. Symptom: shipped
   tag number ≠ binary version constant ≠ DB-registered version. Three
   places to keep in sync, and the plugin tool only knows about one.
