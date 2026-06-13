---
name: devops-ship
description: Project-specific overrides for /devops-ship in SC Companion.
---

# /devops-ship — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/devops-ship/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **Watch this repo's downstream deploy surfaces — they land after the merge.**
   `ship_release` only confirms PR merge + GitHub release/tag. The real
   artefacts arrive MINUTES later: the `data-uploader-build.yml` workflow
   (tag-push) gates a usable binary, and the Vercel web deploy runs on
   main-push. After `ship_release` succeeds with a tag that triggers external
   work, run `gh run watch <run-id> --exit-status` in the background before
   calling `render_completion_card`.

   The completion-card **variant** choice (merged ⇒ `ship-successful`;
   unverified downstream ⇒ a `userFinalTest` item, never a downgrade to the
   pre-ship `ready` variant) is owned by the **plugin base skill** — see
   `plugins/devops/skills/devops-ship/SKILL.md` Step 6. Do NOT re-encode it
   here; this project file only enumerates the project-specific surfaces
   (rule 2) to flag.

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

5. **Data-uploader binary release — full checklist in deep-knowledge.**
   **A web `/devops-ship` bumps `data-uploader/package.json` as SOURCE ONLY — it
   never builds or publishes a binary.** Merging to `main` runs only the
   typecheck/test job; the build is gated on the `data-uploader-v*` tag. So if a
   ship touched `data-uploader/**`, the completion card MUST flag the uploader
   binary as *unreleased* (`/desktop` keeps serving the old version) UNLESS you
   also push a `data-uploader-v*` tag and finish the checklist below — a source
   bump alone is invisible to users.

   A `data-uploader-v*` tag, a **full** public mirror release (NOT a
   prerelease — else `/releases/latest` + the download page skip it), AND a
   `desktop_releases` row (`is_current` + matching `release_token`) are ALL
   required before a version is visible to users. The `BINARIES_RELEASE_TOKEN`
   PAT must be ≤ 366 days (StarOrga org policy). When the CI mirror step fails,
   mirror the built assets via admin `gh` (no PAT). Always verify live in Edge
   (`/desktop` + GitHub `/releases/latest`) before declaring done. Full
   rationale + commands: `.claude/deep-knowledge/data-uploader-release.md`.

   *Why this rule exists:* in the 2026-06-13 web-hangar ship I bumped the
   uploader to 0.7.0 and rendered `ship-successful` — but no binary was built,
   so `/desktop` still served 0.6.1. The user had to surface it
   ("ich sehe keine neue uploader version auf der live website"). Source bump ≠
   release.
